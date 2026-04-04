// ./components/Core/BybitServerKernel.js (ESM)
//
// Full Production Version
// Features:
// - Universal Deduplication: Works for Spot Trades, Linear Trades, and Orderbooks
// - Self-Healing: Auto-resets deduplication Set if history is empty
// - Dual Data Flow: 'data' (UI Snapshot) + 'history' (Strategy Stream)
// - Memory protection: Rolling buffer with Set cleanup
// - Dynamic Kline Config: Supports changing intervals and limits on the fly without breaking WS connection where possible
// - REST Backfill: Fetches historical klines via REST on WS open
// - Queue Integrity: Fixed race conditions during config hot-swaps

const upper = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();
const lower = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
const tsToIso = (ts) => (ts != null ? new Date(Number(ts)).toISOString() : null);

// Helper для сравнения массивов топиков (для детекта смены интервала)
const isTopicsEqual = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sA = [...a].sort();
  const sB = [...b].sort();
  for (let i = 0; i < sA.length; i++) {
    if (sA[i] !== sB[i]) return false;
  }
  return true;
};

const normFeedKey = (v) => {
  const s = String(v ?? "").trim();
  const lo = s.toLowerCase();
  if (lo === "publictrade") return "publicTrade";
  if (lo === "orderbook" || lo === "tickers" || lo === "kline") return lo;
  return s;
};

const parseChunkId = (chunkId) => {
  const p = String(chunkId ?? "")
    .trim()
    .split(":");
  if (p.length < 5) return { venue: "", marketType: "", feedKey: "", group: "", index: "" };

  const venue = lower(p[0]);
  const marketType = lower(p[1]);
  const feedKey = normFeedKey(p[2]);

  // tickers group/index historically lower / numeric
  if (feedKey === "tickers") return { venue, marketType, feedKey, group: lower(p[3]), index: String(p[4]) };

  // other feeds: keep “semantic” group/index (often uppercase)
  return { venue, marketType, feedKey, group: upper(p[3]), index: upper(p[4]) };
};

const chunkIdToShardId = (chunkId) => {
  const c = parseChunkId(chunkId);
  if (!c.venue || !c.marketType || !c.feedKey) return String(chunkId || "");
  return `${c.venue}-${upper(c.marketType)}-${upper(c.feedKey)}-${c.group}-${c.index}`;
};

const extractSymbolFromBybitTopic = (topic) => {
  const s = String(topic ?? "").trim();
  if (!s) return "";
  const dot = s.lastIndexOf(".");
  return dot >= 0 && dot < s.length - 1 ? upper(s.slice(dot + 1)) : "";
};

const safeJsonParse = (raw) => {
  try {
    if (raw == null) return null;
    if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
    const s = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const isBybitTechMsg = (m) => {
  if (!m || typeof m !== "object") return true;
  if (m.success === false) return false; // keep errors visible to error logger
  if (m.topic && m.data != null) return false; // real payload
  if (m.op === "pong" || m.op === "ping") return true;
  if (m.success === true || m.conn_id != null) return true;
  return true;
};

const is403 = (s) =>
  String(s || "").includes("403") ||
  String(s || "")
    .toLowerCase()
    .includes("forbidden");
const is429 = (s) => {
  const t = String(s || "").toLowerCase();
  return t.includes("429") || t.includes("too many") || t.includes("ratelimit");
};

const clampInt = (n, min, max) => Math.max(min, Math.min(max, n | 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, clampInt(ms, 0, 300_000)));
const parseRouteId = (id) => {
  const p = String(id ?? "")
    .trim()
    .split(":");
  if (p.length < 4) return { exchange: "", marketType: "", symbol: "", quote: "" };
  return { exchange: lower(p[0]), marketType: lower(p[1]), symbol: upper(p[2]), quote: upper(p[3]) };
};
export class BybitServerKernel {
  constructor({ bybitKernel, connector, logger = console, opts = {} } = {}) {
    if (!bybitKernel) throw new Error("BybitServerKernel: missing bybitKernel");
    if (!connector) throw new Error("BybitServerKernel: missing connector");

    this.k = bybitKernel;
    this.ws = connector;
    this.log = logger;

    this.opts = {
      mode: "active",

      maxInflight: 1,
      connectDelayMs: 450,
      subscribeDelayMs: 150,

      rxLogAfterSubscribe: true,
      rxLogWindowMs: 10_000,
      rxLogMaxPerShard: 6,
      rxLogMaxBytes: 2000,
      rxLogRawOnParseFail: true,

      livenessIntervalMs: 1000,
      defaultSubscribeSilenceMs: 6000,
      defaultSilenceMs: 12_000,

      baseRetryBackoffMs: 1000,
      maxRetryBackoffMs: 30_000,

      cooldown403Ms: 60_000,
      cooldown429Ms: 30_000,

      pingEveryMs: 20_000,

      tickersSubscribeSilenceMs: 60_000,
      tickersSilenceMs: 180_000,

      // Лимит истории событий для стратегии (защита памяти)
      maxHistorySize: 3000,

      ...opts,
    };

    if (this.opts.connectDelayMs < 450) this.opts.connectDelayMs = 450;
    if (this.opts.maxInflight < 1) this.opts.maxInflight = 1;

    this.mode = lower(this.opts.mode) === "sleep" ? "sleep" : "active";
    this._stopped = true;

    this.shards = new Map(); // shardId -> state
    this.plans = new Map(); // shardId -> plan

    this.queue = [];
    this.queueHi = [];
    this._jobKeys = new Set(); // `${type}|${shardId}`

    this.inflight = 0;
    this._timers = { drain: null, liveness: null };
  }

  // ───────────────────────── lifecycle ─────────────────────────
  start() {
    this.log?.log?.(`[Kernel] Starting... mode=${this.mode}`);
    if (!this._stopped) return this.getSnapshot();
    this._stopped = false;
    this._armLiveness();
    this._drainSoon();
    return this.getSnapshot();
  }

  stop(reason = "stop") {
    this._stopped = true;
    this._disarmLiveness();
    this._clearDrain();
    this._clearQueue();
    this.shutdownAll(reason);
    return this.getSnapshot();
  }

  setMode(mode) {
    const m = lower(mode);
    if (m !== "active" && m !== "sleep") return this.mode;
    this.mode = m;
    if (this.mode === "sleep") this._clearQueue();
    this._drainSoon();
    return this.mode;
  }

  // ───────────────────────── public orchestration ─────────────────────────
  ensureTickers({ priority = 100, reason = "ensure_tickers" } = {}) {
    const plans = this._buildAllPlansForFeed("tickers");
    this.log?.log?.(`[Kernel] ensureTickers: found ${plans.length} plans. Queueing...`);
    return this.ensurePlans(plans, { priority, reason });
  }

  ensureCoinFeeds(selected, { priority = 50, reason = "ensure_coin_feeds", feedKeys = ["orderbook", "kline", "publicTrade"], klineOpts = null } = {}) {
    const target = selected || "BTC";

    // Фоново запрашиваем REST статистику (OI, LS, Funding) с кэшированием
    this._backfillStats(target).catch((e) => this.log?.warn?.("[Stats] backfill error", e));

    // Прокидываем klineOpts дальше в билдер
    return this.ensurePlans(this._buildPlansForSelected(target, feedKeys, klineOpts), { priority, reason });
  }

  releaseCoinFeeds(selected, { feedKeys = ["orderbook", "kline", "publicTrade"], reason = "release_coin" } = {}) {
    const plans = this._buildPlansForSelected(selected, feedKeys, null);
    let closed = 0;

    for (const p of plans) {
      if (this.closeShard(p.shardId, reason)) {
        closed++;
      }
    }

    if (closed > 0) {
      this.log?.log?.(`[Kernel] Released ${closed} shards for ${selected}`);
      this._drainSoon();
    }

    return this.getSnapshot();
  }

  ensurePlans(plans, { priority = 0, reason = "ensure_plans" } = {}) {
    const arr = Array.isArray(plans) ? plans : [];
    let added = 0;

    for (const p of arr) {
      if (!p?.shardId || !p?.wsUrl) continue;

      this.plans.set(p.shardId, p);
      const st = this._ensureShard(p.shardId, p);

      // [CRITICAL FIX] Логика смены конфигурации "на лету"
      if (this._isOpenOrOpening(p.shardId)) {
        // 1. Проверяем, изменились ли топики (например, kline.5.BTC -> kline.60.BTC)
        const topicsChanged = st.activeTopics && !isTopicsEqual(st.activeTopics, p.topics);

        if (topicsChanged) {
          this.log?.log?.(`[Kernel] Config change for ${p.shardId}. Reconnecting...`);

          // Закрываем шард
          this.closeShard(p.shardId, "config_change");

          // [ВАЖНО] closeShard удаляет план из this.plans.
          // Мы должны вернуть его обратно, иначе воркер _open не найдет конфигурацию при запуске.
          this.plans.set(p.shardId, p);

          // После закрытия он попадет в условие ниже (!isOpenOrOpening) и корректно добавится в очередь
        }
        // 2. Проверяем, изменился ли ТОЛЬКО лимит свечей (без смены интервала)
        else if (p.feedKey === "kline") {
          const oldLimit = st.lastBarsLimit || 0;
          const newLimit = p.klineOpts?.barsLimit || 200;

          // Если топик тот же, но лимит другой — просто догружаем историю через REST, не разрывая WS
          if (newLimit !== oldLimit) {
            st.lastBarsLimit = newLimit;
            this._backfillKlineHistory(p.shardId).catch(() => {});
          }
          continue; // WS соединение перезапускать не нужно
        } else {
          continue; // Все совпадает, ничего не делаем
        }
      }

      if (this._inCooldown(p.shardId)) continue;

      if (this._enqueue({ type: "open", shardId: p.shardId, reason }, priority, false)) added++;
    }

    if (added) {
      this.log?.log?.(`[Kernel] Queued ${added} new jobs. Total queue: ${this.queue.length + this.queueHi.length}`);
      this._drainSoon();
    }

    return this.getSnapshot();
  }

  closeShard(shardId, reason = "close") {
    const id = String(shardId ?? "").trim();
    const st = this.shards.get(id);
    if (!st) return false;

    const rsn = String(reason || "");
    const p = this.plans.get(id);
    const fk = normFeedKey(p?.feedKey);

    const shouldClear = fk && fk !== "tickers" && !rsn.startsWith("reconnect:");

    if (shouldClear && Array.isArray(p?.dataRefs)) {
      for (const ch of p.dataRefs) {
        if (!ch || typeof ch !== "object") continue;
        ch.data = null;

        // [CLEANUP] Полная очистка истории и дедупликатора
        ch.history = [];
        if (ch.ids) ch.ids.clear();

        ch.lastUpdateTs = null;
        ch.lastUpdateIso = null;
      }
    }

    this._dropJobsForShard(id);
    st.token = (st.token | 0) + 1;

    if (st.pingTimer) clearInterval(st.pingTimer);
    if (st.reconnectTimer) clearTimeout(st.reconnectTimer);
    if (st.subscribeTimer) clearTimeout(st.subscribeTimer);
    st.pingTimer = null;
    st.reconnectTimer = null;
    st.subscribeTimer = null;

    const handle = st.handle;
    st.handle = null;
    st.status = "closed";
    st.lastReason = rsn;

    try {
      if (handle) {
        if (this.ws.close) this.ws.close(handle, rsn);
        else if (handle.close) handle.close(1000, rsn);
      }
    } catch {}

    if (p?.feedKey !== "tickers" && !rsn.startsWith("reconnect:")) {
      this.shards.delete(id);
      this.plans.delete(id);
    }

    return true;
  }

  reconnectShard(shardId, reason = "manual_reconnect") {
    const id = String(shardId ?? "").trim();
    if (!id) return false;
    if (this._stopped || this.mode !== "active") return false;
    if (!this.plans.get(id)) return false;
    if (this._inCooldown(id)) return false;

    this._enqueue({ type: "reconnect", shardId: id, reason }, 90, true);
    this._drainSoon();
    return true;
  }

  applyCooldown(shardId, ms, reason = "cooldown") {
    const id = String(shardId ?? "").trim();
    const st = this._ensureShard(id);
    const dur = clampInt(ms, 0, 10 * 60_000);
    if (!dur) return st.cooldownUntilTs || 0;

    const until = Date.now() + dur;
    st.cooldownUntilTs = Math.max(st.cooldownUntilTs || 0, until);
    st.status = "cooldown";
    st.lastReason = `${reason}:${dur}`;
    return st.cooldownUntilTs;
  }

  shutdownAll(reason = "shutdown_all") {
    for (const [id] of this.shards.entries()) this.closeShard(id, reason);
    return true;
  }

  getSnapshot() {
    const out = [];
    for (const [id, st] of this.shards.entries()) {
      const p = this.plans.get(id);
      out.push({
        shardId: id,
        status: st.status,
        wsUrl: st.wsUrl || null,
        symbols: Array.isArray(p?.symbols) ? p.symbols : [],

        lastMsgAt: st.lastMsgAt || 0,
        openedAt: st.openedAt || 0,
        subscribeAt: st.subscribeAt || 0,
        firstDataAt: st.firstDataAt || 0,
        lastDataAt: st.lastDataAt || 0,

        chunkId: p?.chunkId || null,
        marketType: p?.marketType || null,
        feedKey: p?.feedKey || null,

        retryCount: st.retryCount || 0,
        cooldownUntilTs: st.cooldownUntilTs || 0,
        lastReason: st.lastReason || null,
      });
    }
    return {
      ok: true,
      ts: Date.now(),
      mode: this.mode,
      inflight: this.inflight,
      queued: this.queue.length + this.queueHi.length,
      queuedHi: this.queueHi.length,
      shards: out,
    };
  }

  // ───────────────────────── plan builders ─────────────────────────
  _buildAllPlansForFeed(feedKey) {
    const fk = normFeedKey(feedKey);
    const plans = [];
    for (const marketType of ["spot", "linear"]) {
      const chunks = this._collectChunksIndex(marketType, fk, null);
      for (const entry of chunks.values()) plans.push(this._entryToPlan(entry, marketType, fk, null));
    }
    return plans;
  }

  _buildPlansForSelected(selected, feedKeys, klineOpts) {
    const sel = String(selected ?? "").trim();
    if (!sel) return [];

    const keys = Array.isArray(feedKeys) ? feedKeys.map(normFeedKey).filter(Boolean) : [];
    if (!keys.length) return [];

    const want = this._resolveSelectedRoutes(sel);
    if (!want.length) return [];

    const needByMtFk = new Map();

    for (const r of want) {
      for (const fk of keys) {
        const ch = this._getRouteChunk(r.routeId, fk);
        const cid = String(ch?.id ?? "").trim();
        if (!cid) continue;
        const k = `${r.marketType}|${fk}`;
        const set = needByMtFk.get(k) || new Set();
        set.add(cid);
        needByMtFk.set(k, set);
      }
    }

    const plans = [];
    for (const [k, set] of needByMtFk.entries()) {
      const [mt, fk] = k.split("|");
      const chunks = this._collectChunksIndex(mt, fk, set);
      // Передаем klineOpts дальше
      for (const entry of chunks.values()) plans.push(this._entryToPlan(entry, mt, fk, klineOpts));
    }

    return plans;
  }

  _resolveSelectedRoutes(sel) {
    if (sel.includes(":")) {
      const p = sel.split(":");
      const mt = lower(p[1] || "");
      if (mt === "spot" || mt === "linear") return [{ marketType: mt, routeId: sel }];
      return [];
    }

    const baseId = upper(sel);
    const items = Array.isArray(this.k.items) ? this.k.items : [];
    const item = items.find((x) => upper(x?.baseId) === baseId);
    if (!item?.routesById) return [];

    const out = [];
    for (const rid of Object.keys(item.routesById)) {
      const p = String(rid).split(":");
      const mt = lower(p[1] || "");
      if (mt === "spot" || mt === "linear") out.push({ marketType: mt, routeId: rid });
    }
    return out;
  }

  _getRouteChunk(routeId, feedKey) {
    const rid = String(routeId ?? "").trim();
    const fk = normFeedKey(feedKey);
    if (!rid || !fk) return null;

    const items = Array.isArray(this.k.items) ? this.k.items : [];
    for (const item of items) {
      const r = item?.routesById?.[rid];
      if (!r) continue;
      const bucket = r?.chunks || r?.chunk; // ✅ compatibility
      return bucket?.[fk] || null;
    }
    return null;
  }

  _collectChunksIndex(marketType, feedKey, onlyChunkIdsSetOrNull) {
    const mt = lower(marketType);
    const fk = normFeedKey(feedKey);
    const only = onlyChunkIdsSetOrNull instanceof Set ? onlyChunkIdsSetOrNull : null;

    const map = new Map();
    const wsUrl = this._wsUrl(mt);
    const items = Array.isArray(this.k.items) ? this.k.items : [];

    for (const item of items) {
      const routes = item?.routesById ? Object.values(item.routesById) : [];
      for (const r of routes) {
        const rid = String(r?.id ?? "").trim();
        if (!rid) continue;

        const p = rid.split(":");
        const rMt = lower(p[1] || "");
        if (rMt !== mt) continue;

        const bucket = r?.chunks || r?.chunk; // ✅ compatibility
        const ch = bucket?.[fk];
        const cid = String(ch?.id ?? "").trim();
        if (!cid) continue;
        if (only && !only.has(cid)) continue;

        const e = map.get(cid) || { chunkId: cid, symbols: [], wsUrl, dataRefs: [] };
        e.wsUrl = wsUrl;

        if (!e.symbols.length && Array.isArray(ch?.symbols)) e.symbols = ch.symbols;
        e.dataRefs.push(ch);

        map.set(cid, e);
      }
    }

    return map;
  }

  _entryToPlan(entry, marketType, feedKey, klineOpts) {
    const chunkId = String(entry?.chunkId ?? "").trim();
    const shardId = chunkIdToShardId(chunkId);
    const symbols = Array.isArray(entry?.symbols) ? entry.symbols : [];
    const wsUrl = String(entry?.wsUrl ?? "") || this._wsUrl(marketType);

    const fk = normFeedKey(feedKey);
    const isTickers = fk === "tickers";
    const ttlMs = entry?.dataRefs?.[0]?.ttlMs;

    const baseSilence = Number(ttlMs) ? Number(ttlMs) * 3 : this.opts.defaultSilenceMs;
    const silenceMs = isTickers ? clampInt(this.opts.tickersSilenceMs, 20_000, 10 * 60_000) : clampInt(Math.max(baseSilence, this.opts.defaultSilenceMs), 2000, 10 * 60_000);

    const subscribeSilenceMs = isTickers ? clampInt(this.opts.tickersSubscribeSilenceMs, 2000, 6 * 120_000) : clampInt(this.opts.defaultSubscribeSilenceMs, 500, 6 * 60_000);

    // Строим топики с учетом klineOpts (интервала)
    const topics = this._buildTopics(marketType, fk, symbols, klineOpts);

    return {
      shardId,
      chunkId,
      marketType: lower(marketType),
      feedKey: fk,
      wsUrl,
      symbols,
      topics,
      klineOpts, // Сохраняем опции в плане
      dataRefs: Array.isArray(entry?.dataRefs) ? entry.dataRefs : [],
      silenceMs,
      subscribeSilenceMs,
      buildSubscribeMsg: (p) => ({ op: "subscribe", args: Array.isArray(p?.topics) ? p.topics : [] }),
    };
  }

  _wsUrl(marketType) {
    const mt = lower(marketType);
    return String(this.k?.[mt]?.ws ?? "").trim();
  }

  _buildTopics(marketType, feedKey, symbols, klineOpts) {
    const mt = lower(marketType);
    const fk = normFeedKey(feedKey);
    const cfg = this.k?.[mt]?.adapter?.[fk] || null;

    const tpl = String(cfg?.template ?? "").trim() || (fk === "publicTrade" ? "publicTrade.{symbol}" : fk === "kline" ? "kline.{interval}.{symbol}" : fk === "orderbook" ? "orderbook.{depth}.{symbol}" : fk === "tickers" ? "tickers.{symbol}" : "");

    if (!tpl || !Array.isArray(symbols) || !symbols.length) return [];

    const depth = fk === "orderbook" ? clampInt(cfg?.defaults?.depth ?? 50, 1, 200) : null;

    let interval = null;
    if (fk === "kline") {
      // 1. Приоритет: переданный UI interval
      // 2. Дефолт из конфига
      const uiRaw = klineOpts?.interval || cfg?.defaults?.uiInterval || "5m";
      const uiInterval = String(uiRaw).trim();

      // Маппим "1h" -> "60", "5m" -> "5" и т.д.
      interval = String(cfg?.intervalsMap?.[uiInterval] ?? uiInterval).trim();
      if (!interval) interval = "5"; // fallback
    }

    const out = [];
    for (const sym of symbols) {
      const s = upper(sym);
      if (!s) continue;

      out.push(
        tpl
          .replace("{symbol}", s)
          .replace("{depth}", depth != null ? String(depth) : "")
          .replace("{interval}", interval != null ? String(interval) : "")
      );
    }

    return out;
  }

  // ───────────────────────── queue/drain ─────────────────────────
  _clearQueue() {
    for (const j of this.queue) this._jobKeys.delete(`${j.type}|${j.shardId}`);
    for (const j of this.queueHi) this._jobKeys.delete(`${j.type}|${j.shardId}`);
    this.queue.length = 0;
    this.queueHi.length = 0;
  }

  _dropJobsForShard(shardId) {
    const id = String(shardId ?? "").trim();
    if (!id) return;

    for (let i = this.queue.length - 1; i >= 0; i--) {
      const j = this.queue[i];
      if (j?.shardId !== id) continue;
      this._jobKeys.delete(`${j.type}|${j.shardId}`);
      this.queue.splice(i, 1);
    }

    for (let i = this.queueHi.length - 1; i >= 0; i--) {
      const j = this.queueHi[i];
      if (j?.shardId !== id) continue;
      this._jobKeys.delete(`${j.type}|${j.shardId}`);
      this.queueHi.splice(i, 1);
    }
  }

  _enqueue(job, priority, hi = false) {
    if (this._stopped || this.mode !== "active") return false;
    if (!job?.shardId) return false;
    if (this._inCooldown(job.shardId)) return false;

    const key = `${job.type}|${job.shardId}`;
    if (this._jobKeys.has(key)) return false;

    const q = hi ? this.queueHi : this.queue;
    const j = { ...job, priority: priority | 0, at: Date.now() };

    // insert sorted: higher priority first, then older first
    let i = q.length;
    while (i > 0) {
      const prev = q[i - 1];
      if (prev.priority > j.priority) break;
      if (prev.priority === j.priority && prev.at <= j.at) break;
      i--;
    }
    q.splice(i, 0, j);

    this._jobKeys.add(key);
    return true;
  }

  _drainSoon() {
    if (this._stopped || this.mode !== "active") return;
    if (this._timers.drain) return;
    this._timers.drain = setTimeout(() => {
      this._timers.drain = null;
      this._drain();
    }, 0);
  }

  _clearDrain() {
    if (!this._timers.drain) return;
    clearTimeout(this._timers.drain);
    this._timers.drain = null;
  }

  async _drain() {
    if (this._stopped || this.mode !== "active") return;
    if (this.inflight >= this.opts.maxInflight) return;

    let src = this.queueHi;
    let idx = -1;

    for (let i = 0; i < src.length; i++) {
      const j = src[i];
      if (!j) continue;
      if (this._inCooldown(j.shardId)) continue;
      idx = i;
      break;
    }

    if (idx === -1) {
      src = this.queue;
      for (let i = 0; i < src.length; i++) {
        const j = src[i];
        if (!j) continue;
        if (this._inCooldown(j.shardId)) continue;
        idx = i;
        break;
      }
    }

    if (idx === -1) return;

    const job = src.splice(idx, 1)[0];
    this._jobKeys.delete(`${job.type}|${job.shardId}`);

    // [FIX] Если плана нет, проверяем не является ли это задачей на закрытие
    // Иначе мы можем застрять в попытке открыть несуществующий план
    if (!this.plans.get(job.shardId) && job.type !== "close") {
      this._drainSoon();
      return;
    }

    this.inflight += 1;
    try {
      if (job.type === "open") await this._open(job.shardId, job.reason);
      else if (job.type === "reconnect") await this._reconnect(job.shardId, job.reason);
      else if (job.type === "close") this.closeShard(job.shardId, job.reason);
    } finally {
      this.inflight -= 1;
    }

    if (this.opts.connectDelayMs > 0) await sleep(this.opts.connectDelayMs);
    this._drainSoon();
  }

  // ───────────────────────── open/reconnect ─────────────────────────
  async _open(shardId, reason) {
    const id = String(shardId ?? "").trim();
    const plan = this.plans.get(id);
    if (!plan?.wsUrl) return;

    const st = this._ensureShard(id, plan);
    if (this._isOpenOrOpening(id)) return;
    if (this._inCooldown(id)) return;

    // new token for this open attempt; callbacks must match it
    const token = (st.token = (st.token | 0) + 1);

    // reset session state
    if (st.pingTimer) clearInterval(st.pingTimer);
    if (st.reconnectTimer) clearTimeout(st.reconnectTimer);
    if (st.subscribeTimer) clearTimeout(st.subscribeTimer);
    st.pingTimer = null;
    st.reconnectTimer = null;
    st.subscribeTimer = null;

    st.status = "opening";
    st.lastReason = String(reason || "open");
    st.openedAt = 0;
    st.subscribeAt = 0;
    st.firstDataAt = 0;
    st.lastDataAt = 0;

    try {
      const handle = await this.ws.open({
        shardId: id,
        wsUrl: plan.wsUrl,
        onOpen: () => this._onOpen(id, token),
        onMessage: (raw) => this._onMessage(id, token, raw),
        onClose: (code, msg) => this._onClose(id, token, code, msg),
        onError: (err) => this._onError(id, token, err),
      });

      // If token changed while awaiting open -> this handle is stale, close it.
      const live = this.shards.get(id);
      if (!live || live.token !== token) {
        try {
          if (handle) {
            if (this.ws.close) this.ws.close(handle, "stale_open");
            else handle?.close?.(1000, "stale_open");
          }
        } catch {}
        return;
      }

      live.handle = handle || null;

      // connector may already have fired onOpen; but if not, ensure subscribe path
      if (live.status === "open" && live.handle?.send && !live.subscribeAt) this._onOpen(id, token);
    } catch (e) {
      const live = this.shards.get(id);
      if (!live || live.token !== token) return;

      live.handle = null;
      live.status = "closed";
      live.lastReason = `open_failed:${String(e?.message || e)}`;

      this._scheduleReconnect(id, "open_failed");
    }
  }

  async _reconnect(shardId, reason) {
    const id = String(shardId ?? "").trim();
    this.closeShard(id, `reconnect:${String(reason || "")}`);
    await sleep(50);
    await this._open(id, `reconnect:${String(reason || "")}`);
  }

  _scheduleReconnect(shardId, reason) {
    const id = String(shardId ?? "").trim();
    if (!id) return;
    if (this._stopped || this.mode !== "active") return;
    if (this._inCooldown(id)) return;

    const st = this.shards.get(id);
    if (!st) return; // do not resurrect removed shards
    if (st.status === "closing") return;

    const n = Math.max(0, st.retryCount | 0);
    const base = clampInt(this.opts.baseRetryBackoffMs, 1000, 60_000);
    const max = clampInt(this.opts.maxRetryBackoffMs, base, 300_000);
    const backoff = Math.min(max, base * Math.pow(2, Math.min(10, n)));

    st.retryCount = n + 1;
    st.lastReason = `reconnect_scheduled:${String(reason || "")}`;

    const seq = (st.reconnectSeq = (st.reconnectSeq | 0) + 1);
    if (st.reconnectTimer) clearTimeout(st.reconnectTimer);

    st.reconnectTimer = setTimeout(() => {
      const st2 = this.shards.get(id);
      if (!st2 || st2.reconnectSeq !== seq) return;
      if (this._stopped || this.mode !== "active") return;
      if (this._inCooldown(id)) return;

      this._enqueue({ type: "reconnect", shardId: id, reason }, 1000, true);
      this._drainSoon();
    }, backoff);
  }

  // ───────────────────────── ws callbacks ─────────────────────────
  _onOpen(shardId, token) {
    const st = this.shards.get(shardId);
    if (!st || st.token !== token) return;

    const plan = this.plans.get(shardId);
    if (!plan) return;

    st.status = "open";
    st.retryCount = 0;
    st.openedAt = Date.now();
    st.lastMsgAt = st.openedAt;

    // Сохраняем активные топики, чтобы потом сравнивать (для смены интервала)
    st.activeTopics = plan.topics ? [...plan.topics] : [];

    // [FIX] Сохраняем текущий лимит баров
    st.lastBarsLimit = plan.klineOpts?.barsLimit || 200;

    // [NEW] Запускаем подгрузку истории, если это Kline
    if (plan.feedKey === "kline") {
      this._backfillKlineHistory(shardId).catch(() => {});
    }

    if (st.subscribeAt) return;
    if (!plan.topics?.length) {
      this.log?.log?.(`[bybit:subscribe_skip] ${shardId} no_topics feedKey=${plan.feedKey || ""}`);
      return;
    }
    if (!st.handle?.send) {
      this.log?.log?.(`[bybit:subscribe_defer] ${shardId} handle_not_ready`);
      return;
    }

    if (st.subscribeTimer) clearTimeout(st.subscribeTimer);
    st.subscribeTimer = setTimeout(
      () => {
        const live = this.shards.get(shardId);
        if (!live || live.token !== token) return;
        if (live.status !== "open") return;

        try {
          const msg = plan.buildSubscribeMsg ? plan.buildSubscribeMsg(plan) : { op: "subscribe", args: plan.topics };
          live.subscribeAt = Date.now();
          live.lastMsgAt = live.subscribeAt;

          live.handle.send(typeof msg === "string" ? msg : JSON.stringify(msg));

          if (this.opts.rxLogAfterSubscribe) {
            live.rxSinceSub = 0;
            live.rxLogUntilTs = Date.now() + clampInt(this.opts.rxLogWindowMs, 0, 60_000);
          }

          if (live.pingTimer) clearInterval(live.pingTimer);
          live.pingTimer = setInterval(
            () => {
              const st3 = this.shards.get(shardId);
              if (!st3 || st3.token !== token) return;
              try {
                st3.handle?.send?.('{"op":"ping"}');
              } catch {}
            },
            clampInt(this.opts.pingEveryMs, 5000, 120_000)
          );
        } catch (e) {
          live.lastReason = `subscribe_failed:${String(e?.message || e)}`;
          this._scheduleReconnect(shardId, "subscribe_failed");
        }
      },
      clampInt(this.opts.subscribeDelayMs, 50, 500)
    );
  }

  // [NEW] Запрос истории через REST API
  async _backfillKlineHistory(shardId) {
    const plan = this.plans.get(shardId);
    if (!plan || plan.feedKey !== "kline" || !plan.symbols?.length) return;

    // Получаем корректный API интервал (та же логика, что и в _buildTopics)
    const cfg = this.k?.[plan.marketType]?.adapter?.kline || null;
    const uiRaw = plan.klineOpts?.interval || cfg?.defaults?.uiInterval || "5m";
    const uiInterval = String(uiRaw).trim();
    const interval = String(cfg?.intervalsMap?.[uiInterval] ?? uiInterval).trim() || "5";

    // Расширяем лимит до 1000 для запроса истории
    const limit = clampInt(plan.klineOpts?.barsLimit ?? cfg?.defaults?.barsLimit ?? 200, 20, 1000);

    // Только один символ на чанк для kline в текущей схеме
    const symbol = plan.symbols[0];
    if (!symbol) return;

    // Bybit V5 URL
    const url = `https://api.bybit.com/v5/market/kline?category=${plan.marketType}&symbol=${symbol}&interval=${interval}&limit=${limit}`;

    try {
      const resp = await fetch(url);
      const json = await resp.json();

      // Проверка на 429/ошибку
      if (json.retCode !== 0) {
        this.log?.log?.(`[KlineBackfill] Error: ${json.retMsg}`);
        return;
      }

      const list = Array.isArray(json.result?.list) ? json.result.list : [];
      if (!list.length) return;

      // Bybit отдает list: [ts, open, high, low, close, volume, turnover]
      // Сортировка DESC (новое первое). Для графика обычно нужно ASC, но мы просто кладем в массив и сортируем потом в UI.
      // Важно: нужно сконвертировать в наш формат {ts, o, h, l, c, v}

      const parsed = list.map((item) => ({
        ts: Number(item[0]),
        o: item[1],
        h: item[2],
        l: item[3],
        c: item[4],
        v: item[5],
        t: item[6],
        confirm: true, // исторические свечи считаем подтвержденными (кроме, возможно, самой первой, но для простоты ок)
      }));

      // Сортируем по возрастанию времени (старые -> новые) для корректного мерджа
      parsed.sort((a, b) => a.ts - b.ts);

      // Записываем в chunk
      for (const ch of plan.dataRefs) {
        if (!ch) continue;
        if (!Array.isArray(ch.history)) ch.history = [];

        // Перезаписываем историю полученным снапшотом
        // НО! Если WS уже успел прислать тик для *текущей* свечи, мы не хотим его потерять.
        // Поэтому берем REST данные, и если последняя свеча совпадает по времени с последней свечой WS - берем WS (она новее)

        const existingLast = ch.history[ch.history.length - 1];

        ch.history = parsed;

        if (existingLast && existingLast.ts === parsed[parsed.length - 1].ts) {
          // Восстанавливаем WS обновление для последней свечи
          ch.history[ch.history.length - 1] = existingLast;
        }

        ch.lastUpdateTs = Date.now();
        ch.lastUpdateIso = tsToIso(ch.lastUpdateTs);
      }
    } catch (e) {
      this.log?.error?.(`[KlineBackfill] Failed fetch for ${symbol}: ${e.message}`);
    }
  }
  // ───────────────────────── REST Data Fetchers (Stats) ─────────────────────────
  async _backfillStats(selected) {
    const sel = String(selected || "BTC").trim();
    const want = this._resolveSelectedRoutes(sel);

    // Ищем только линейный контракт (фьючерс), так как там есть OI и Funding
    const linearRoute = want.find((r) => r.marketType === "linear");
    if (!linearRoute) return;

    // Находим нужный чанк 'tickers', куда мы будем писать статистику
    const chunk = this._getRouteChunk(linearRoute.routeId, "tickers");
    if (!chunk || !chunk.stats) return;

    const routeParts = linearRoute.routeId.split(":");
    const symbol = routeParts[2] ? routeParts[2].toUpperCase() : "BTC";

    // Очищаем символ для REST API (убираем PERP и т.д., оставляем чистый тикер + USDT)
    let cleanSym = symbol.replace(/[:/]/g, "").replace("USDT", "").replace("PERP");
    const safeSymbol = `${cleanSym}USDT`;

    const now = Date.now();
    const CACHE_TTL = 8 * 60 * 60 * 1000; // 8 часов в миллисекундах

    // Инициализируем объект для монеты, если его еще нет
    if (!chunk.stats[symbol]) chunk.stats[symbol] = {};
    const statsObj = chunk.stats[symbol];

    // Проверяем кэш: если данные запрашивались менее 8 часов назад, отменяем запрос
    if (statsObj.lastFetchTs && now - statsObj.lastFetchTs < CACHE_TTL) {
      return;
    }

    this.log?.log?.(`[StatsLoader] Fetching OI/LS/Funding for ${safeSymbol} sequentially...`);

    const limit = 50;
    const category = "linear";
    const interval = "15min";

    // Универсальный хелпер для загрузки одного типа данных
    const fetchMode = async (mode) => {
      let url = "";
      let mapper = null;

      if (mode === "oi") {
        url = `https://api.bybit.com/v5/market/open-interest?category=${category}&symbol=${safeSymbol}&intervalTime=${interval}&limit=${limit}`;
        mapper = (item) => ({ time: Math.floor(Number(item.timestamp) / 1000), value: parseFloat(item.openInterest) });
      } else if (mode === "ls") {
        url = `https://api.bybit.com/v5/market/account-ratio?category=${category}&symbol=${safeSymbol}&period=${interval}&limit=${limit}`;
        mapper = (item) => ({ time: Math.floor(Number(item.timestamp) / 1000), value: parseFloat(item.buyRatio), color: parseFloat(item.buyRatio) >= 0.5 ? "#00bfa5" : "#ff5252" });
      } else if (mode === "funding") {
        url = `https://api.bybit.com/v5/market/funding/history?category=${category}&symbol=${safeSymbol}&limit=${limit}`;
        mapper = (item) => ({ time: Math.floor(Number(item.fundingRateTimestamp) / 1000), value: parseFloat(item.fundingRate) * 100, color: parseFloat(item.fundingRate) > 0 ? "#00bfa5" : "#ff5252" });
      }

      try {
        const res = await fetch(url);
        const json = await res.json();
        if (json.retCode === 0 && json.result && Array.isArray(json.result.list)) {
          return json.result.list.map(mapper).reverse();
        }
      } catch (e) {
        this.log?.warn?.(`[StatsLoader] Failed to fetch ${mode} for ${safeSymbol}:`, e);
      }
      return [];
    };

    // ВАЖНО: Запускаем строго последовательно с защитными паузами в 200мс (предотвращает rate limits)
    const oi = await fetchMode("oi");
    await sleep(200);

    const ls = await fetchMode("ls");
    await sleep(200);

    const funding = await fetchMode("funding");

    // Записываем полученные данные в ядро и ставим метку времени (кэш)
    chunk.stats[symbol] = { oi, ls, funding, lastFetchTs: now };

    // Дергаем общее время обновления чанка, чтобы UI отреагировал
    chunk.lastUpdateTs = Date.now();
    chunk.lastUpdateIso = tsToIso(chunk.lastUpdateTs);
  }

  // ───────────────────────── REST Data Fetchers (Stats) ─────────────────────────
  async _backfillStats(selected) {
    const sel = String(selected || "BTC").trim();
    const want = this._resolveSelectedRoutes(sel);

    // Ищем только линейный контракт (фьючерс), так как там есть OI и Funding
    const linearRoute = want.find((r) => r.marketType === "linear");
    if (!linearRoute) return;

    // Находим нужный чанк 'tickers', куда мы будем писать статистику
    const chunk = this._getRouteChunk(linearRoute.routeId, "tickers");
    if (!chunk || !chunk.stats) return;

    const routeParts = linearRoute.routeId.split(":");
    const symbol = routeParts[2] ? routeParts[2].toUpperCase() : "BTC";

    // Очищаем символ для REST API (убираем PERP и т.д., оставляем чистый тикер + USDT)
    let cleanSym = symbol.replace(/[:/]/g, "").replace("USDT", "").replace("PERP", "");
    const safeSymbol = `${cleanSym}USDT`;

    const now = Date.now();

    // Инициализируем объект для монеты, если его еще нет
    if (!chunk.stats[symbol]) chunk.stats[symbol] = {};
    const statsObj = chunk.stats[symbol];

    // Разделяем логику кэширования
    const CACHE_TTL_5M = 5 * 60 * 1000; // 5 минут
    const EIGHT_HOURS = 8 * 60 * 60 * 1000; // 8 часов

    // 1. Проверяем необходимость обновления OI и LS (каждые 5 минут)
    const needsOiLs = !statsObj.lastFetchOiLsTs || now - statsObj.lastFetchOiLsTs >= CACHE_TTL_5M;

    // 2. Проверяем необходимость обновления фандинга.
    // Bybit обновляет фандинг в 00:00, 08:00, 16:00 UTC. Вычисляем начало текущего 8-часового окна в UTC.
    const currentFundingEpoch = Math.floor(now / EIGHT_HOURS) * EIGHT_HOURS;
    const needsFunding = !statsObj.lastFetchFundingTs || statsObj.lastFetchFundingTs < currentFundingEpoch;

    // Если ничего обновлять не нужно — прерываем выполнение
    if (!needsOiLs && !needsFunding) {
      return;
    }

    this.log?.log?.(`[StatsLoader] Fetching data for ${safeSymbol}. Needs OI/LS: ${needsOiLs}, Needs Funding: ${needsFunding}`);

    const limit = 50;
    const category = "linear";
    const interval = "15min";

    // Универсальный хелпер для загрузки одного типа данных с поддержкой ретраев
    const fetchMode = async (mode, maxRetries = 3) => {
      let url = "";
      let mapper = null;

      if (mode === "oi") {
        url = `https://api.bybit.com/v5/market/open-interest?category=${category}&symbol=${safeSymbol}&intervalTime=${interval}&limit=${limit}`;
        mapper = (item) => ({ time: Math.floor(Number(item.timestamp) / 1000), value: parseFloat(item.openInterest) });
      } else if (mode === "ls") {
        url = `https://api.bybit.com/v5/market/account-ratio?category=${category}&symbol=${safeSymbol}&period=${interval}&limit=${limit}`;
        mapper = (item) => ({ time: Math.floor(Number(item.timestamp) / 1000), value: parseFloat(item.buyRatio), color: parseFloat(item.buyRatio) >= 0.5 ? "#00bfa5" : "#ff5252" });
      } else if (mode === "funding") {
        url = `https://api.bybit.com/v5/market/funding/history?category=${category}&symbol=${safeSymbol}&limit=${limit}`;
        mapper = (item) => ({ time: Math.floor(Number(item.fundingRateTimestamp) / 1000), value: parseFloat(item.fundingRate) * 100, color: parseFloat(item.fundingRate) > 0 ? "#00bfa5" : "#ff5252" });
      }

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(url);
          const json = await res.json();
          if (json.retCode === 0 && json.result && Array.isArray(json.result.list)) {
            return json.result.list.map(mapper).reverse();
          } else {
            this.log?.warn?.(`[StatsLoader] Invalid response for ${mode} on ${safeSymbol} (Attempt ${attempt}/${maxRetries}):`, json);
          }
        } catch (e) {
          this.log?.warn?.(`[StatsLoader] Failed to fetch ${mode} for ${safeSymbol} (Attempt ${attempt}/${maxRetries}):`, e);
        }

        // Если это не последняя попытка, ждем 1 секунду перед повтором
        if (attempt < maxRetries) {
          await sleep(1000);
        }
      }

      return null; // Возвращаем null, если все попытки исчерпаны
    };

    // Берем уже загруженные данные как фолбэк
    let oi = statsObj.oi || [];
    let ls = statsObj.ls || [];
    let funding = statsObj.funding || [];

    let updatedOiLs = false;
    let updatedFunding = false;

    // ВАЖНО: Запускаем строго последовательно с защитными паузами
    if (needsOiLs) {
      const fetchedOi = await fetchMode("oi");
      await sleep(200);
      const fetchedLs = await fetchMode("ls");

      // Сохраняем данные, если они загрузились (не затираем null'ами)
      if (fetchedOi !== null) oi = fetchedOi;
      if (fetchedLs !== null) ls = fetchedLs;

      // Обновляем таймер, только если оба запроса прошли без ошибок
      if (fetchedOi !== null && fetchedLs !== null) {
        updatedOiLs = true;
      }

      if (needsFunding) await sleep(200);
    }

    if (needsFunding) {
      const fetchedFunding = await fetchMode("funding");
      if (fetchedFunding !== null) {
        funding = fetchedFunding;
        updatedFunding = true;
      }
    }

    // Записываем данные в ядро. Метки времени обновляем только в случае успешного ответа API
    chunk.stats[symbol] = {
      ...statsObj,
      oi,
      ls,
      funding,
      lastFetchOiLsTs: updatedOiLs ? now : statsObj.lastFetchOiLsTs,
      lastFetchFundingTs: updatedFunding ? now : statsObj.lastFetchFundingTs,
    };

    // Дергаем общее время обновления чанка, чтобы UI отреагировал
    chunk.lastUpdateTs = Date.now();
    chunk.lastUpdateIso = tsToIso(chunk.lastUpdateTs);
  }
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // [MODIFIED] _onMessage with Universal Deduplication & Dual Flow
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  _onMessage(shardId, token, raw) {
    const st = this.shards.get(shardId);
    if (!st || st.token !== token) return;

    const now = Date.now();
    st.lastMsgAt = now;

    const msg = safeJsonParse(raw);
    if (msg?.topic && msg?.data != null) st.lastDataAt = now;

    const plan = this.plans.get(shardId);

    if (st.subscribeAt && this.opts.rxLogAfterSubscribe && st.rxLogUntilTs && now <= st.rxLogUntilTs) {
      const maxPer = clampInt(this.opts.rxLogMaxPerShard, 1, 50);
      if ((st.rxSinceSub | 0) < maxPer) {
        st.rxSinceSub = (st.rxSinceSub | 0) + 1;
      }
    }

    if (!msg) return;

    if (st.subscribeAt && !st.firstDataAt && msg?.op === "subscribe" && msg?.success === true) st.firstDataAt = now;

    if (msg.success === false) {
      this.log?.error?.(`[BYBIT API ERROR] ${shardId}: ${JSON.stringify(msg)}`);
      return;
    }

    if (isBybitTechMsg(msg)) return;
    if (!plan?.feedKey || !plan.dataRefs?.length) return;

    const symbol = extractSymbolFromBybitTopic(String(msg.topic ?? ""));
    if (!symbol) return;

    if (Array.isArray(plan.symbols) && plan.symbols.length && plan.symbols.indexOf(symbol) < 0) return;
    if (!st.firstDataAt) st.firstDataAt = now;

    const iso = tsToIso(now);

    // Tickers optimization
    if (plan.feedKey === "tickers" && msg.data && typeof msg.data === "object" && !Array.isArray(msg.data)) {
      msg.data.lastUpdateTs = now;
      msg.data.lastUpdateIso = iso;
    }

    for (const ch of plan.dataRefs) {
      if (!ch) continue;
      if (!ch.data || typeof ch.data !== "object") ch.data = {};

      // 1. UI STATE (Snapshot)
      ch.data[symbol] = msg.data;

      // 2. STRATEGY HISTORY (Events) + Universal Deduplication
      if (plan.feedKey === "publicTrade" || plan.feedKey === "orderbook") {
        if (!Array.isArray(ch.history)) ch.history = [];

        // [FIX] Self-healing: если история пуста, очищаем Set, иначе он заблокирует новые данные
        if (!ch.ids) ch.ids = new Set();
        if (ch.history.length === 0 && ch.ids.size > 0) {
          ch.ids.clear();
        }

        // --- PUBLIC TRADES (Spot & Futures) ---
        if (plan.feedKey === "publicTrade") {
          const incoming = Array.isArray(msg.data) ? msg.data : [msg.data];
          const uniqueIncoming = [];

          for (const t of incoming) {
            if (!t.i || !ch.ids.has(t.i)) {
              // Если ID нет или он уникален
              if (t.i) ch.ids.add(t.i);
              uniqueIncoming.push(t);
            }
          }
          if (uniqueIncoming.length > 0) {
            ch.history.push(...uniqueIncoming);
          }
        }

        // --- ORDERBOOK (Snapshot & Delta) ---
        else {
          const u = msg.data?.u || msg.u;
          let isDuplicate = false;
          if (u) {
            if (ch.ids.has(u)) isDuplicate = true;
            else ch.ids.add(u);
          }

          if (!isDuplicate) {
            ch.history.push({
              ts: now,
              type: msg.type,
              u: u,
              data: msg.data,
            });
          }
        }

        // --- MEMORY PROTECTION (Rolling Buffer) ---
        if (ch.history.length > this.opts.maxHistorySize) {
          const removeCount = ch.history.length - this.opts.maxHistorySize;
          const removed = ch.history.splice(0, removeCount);

          // Cleanup IDs from Set
          for (const item of removed) {
            if (plan.feedKey === "publicTrade") {
              if (item.i) ch.ids.delete(item.i);
            } else {
              if (item.u) ch.ids.delete(item.u);
            }
          }
        }
      }

      ch.lastUpdateTs = now;
      ch.lastUpdateIso = iso;
    }

    // Kline History Logic
    if (plan.feedKey === "kline" && plan.dataRefs?.length) {
      const cfg = this.k?.[plan.marketType]?.adapter?.kline || null;

      // [UPDATE] Используем лимит из klineOpts если есть
      const limitRaw = plan.klineOpts?.barsLimit ?? cfg?.defaults?.barsLimit ?? 200;
      const lim = clampInt(limitRaw, 20, 2000);

      const arr = Array.isArray(msg.data) ? msg.data : msg.data && typeof msg.data === "object" ? [msg.data] : [];
      if (arr.length) {
        for (const ch of plan.dataRefs) {
          if (!ch) continue;
          if (!Array.isArray(ch.history)) ch.history = [];
          const hist = ch.history;
          for (const b of arr) {
            const tsRaw = b?.start ?? b?.startTime ?? b?.timestamp ?? b?.t ?? b?.openTime;
            const ts = Number(tsRaw);
            if (!Number.isFinite(ts)) continue;
            const bar = {
              ts: Math.floor(ts),
              o: String(b?.open ?? b?.o ?? ""),
              h: String(b?.high ?? b?.h ?? ""),
              l: String(b?.low ?? b?.l ?? ""),
              c: String(b?.close ?? b?.c ?? ""),
              v: String(b?.volume ?? b?.v ?? ""),
              t: String(b?.turnover ?? ""),
              confirm: !!b?.confirm,
            };
            const last = hist[hist.length - 1];
            if (!last) {
              hist.push(bar);
              continue;
            }
            if (last.ts === bar.ts) {
              hist[hist.length - 1] = bar;
              continue;
            }

            // Если пришел бар из прошлого (редко, но бывает при переподписке), сортируем
            if (last.ts > bar.ts) {
              // Simple linear check
              const existIdx = hist.findIndex((h) => h.ts === bar.ts);
              if (existIdx >= 0) hist[existIdx] = bar;
              else {
                hist.push(bar);
                hist.sort((a, b) => a.ts - b.ts);
              }
              continue;
            }

            hist.push(bar);
          }
          if (hist.length > lim) hist.splice(0, hist.length - lim);
        }
      }
    }
  }

  // ... (методы onClose, onError, liveness, shard helpers - без изменений) ...
  _onClose(shardId, token, code, msg) {
    const st = this.shards.get(shardId);
    if (!st || st.token !== token) return;
    const s = String(msg ?? "");
    if (st.pingTimer) clearInterval(st.pingTimer);
    if (st.reconnectTimer) clearTimeout(st.reconnectTimer);
    if (st.subscribeTimer) clearTimeout(st.subscribeTimer);
    st.pingTimer = null;
    st.reconnectTimer = null;
    st.subscribeTimer = null;
    st.handle = null;
    st.status = "closed";
    st.lastReason = `closed:${code || ""}:${s}`;
    this.log?.log?.(`[bybit:closed] ${shardId} code=${code} reason=${s}`);
    if (this._stopped || this.mode !== "active") return;
    if (is403(s)) {
      this.applyCooldown(shardId, this.opts.cooldown403Ms, "bybit_403");
      return;
    }
    if (is429(s)) {
      this.applyCooldown(shardId, this.opts.cooldown429Ms, "bybit_429");
      return;
    }
    this._scheduleReconnect(shardId, "close");
  }

  _onError(shardId, token, err) {
    const st = this.shards.get(shardId);
    if (!st || st.token !== token) return;
    const s = String(err?.message || err || "");
    st.lastReason = `error:${s}`;
    this.log?.log?.(`[bybit:error] ${shardId} ${s}`);
    if (this._stopped || this.mode !== "active") return;
    if (is403(s)) {
      this.applyCooldown(shardId, this.opts.cooldown403Ms, "bybit_403");
      return;
    }
    if (is429(s)) {
      this.applyCooldown(shardId, this.opts.cooldown429Ms, "bybit_429");
      return;
    }
    this._scheduleReconnect(shardId, "error");
  }

  _armLiveness() {
    this._disarmLiveness();
    this._timers.liveness = setInterval(() => this._checkLiveness(), this.opts.livenessIntervalMs | 0);
  }
  _disarmLiveness() {
    if (this._timers.liveness) {
      clearInterval(this._timers.liveness);
      this._timers.liveness = null;
    }
  }
  _checkLiveness() {
    if (this._stopped || this.mode !== "active") return;
    const now = Date.now();
    for (const [id, st] of this.shards.entries()) {
      if (st.status !== "open" || this._inCooldown(id)) continue;
      const plan = this.plans.get(id);
      const isTickers = plan?.feedKey === "tickers";
      const silenceMs = clampInt(isTickers ? this.opts.tickersSilenceMs : (plan?.silenceMs ?? this.opts.defaultSilenceMs), 1000, 10 * 60_000);
      const subSilenceMs = clampInt(isTickers ? this.opts.tickersSubscribeSilenceMs : (plan?.subscribeSilenceMs ?? this.opts.defaultSubscribeSilenceMs), 500, 120_000);
      if (st.subscribeAt && !st.firstDataAt && now - st.subscribeAt > subSilenceMs) {
        this._enqueue({ type: "reconnect", shardId: id, reason: "subscribe_silence" }, 1000, true);
        continue;
      }
      const lastActivity = st.lastDataAt || st.lastMsgAt;
      if (lastActivity && now - lastActivity > silenceMs) {
        this.log?.log?.(`[Watchdog] ${id} data silence: ${st.lastDataAt ? `${now - st.lastDataAt}ms` : "never"} (silenceMs=${silenceMs})`);
        this._enqueue({ type: "reconnect", shardId: id, reason: "data_silence" }, 1000, true);
      }
    }
    this._drainSoon();
  }
  _ensureShard(shardId, plan) {
    const id = String(shardId ?? "").trim();
    if (!id) throw new Error("BybitServerKernel: empty shardId");
    const prev = this.shards.get(id);
    if (prev) {
      if (plan?.wsUrl) prev.wsUrl = plan.wsUrl;
      return prev;
    }
    const st = {
      shardId: id,
      wsUrl: String(plan?.wsUrl ?? "") || null,
      status: "idle",
      handle: null,
      openedAt: 0,
      subscribeAt: 0,
      firstDataAt: 0,
      lastMsgAt: 0,
      lastDataAt: 0,
      retryCount: 0,
      cooldownUntilTs: 0,
      lastReason: null,
      pingTimer: null,
      reconnectTimer: null,
      subscribeTimer: null,
      rxSinceSub: 0,
      rxLogUntilTs: 0,
      token: 0,
      reconnectSeq: 0,
    };
    this.shards.set(id, st);
    return st;
  }
  _isOpenOrOpening(shardId) {
    const st = this.shards.get(shardId);
    return !!st && (st.status === "open" || st.status === "opening");
  }
  _inCooldown(shardId) {
    const st = this.shards.get(shardId);
    return !!st && st.cooldownUntilTs && Date.now() < st.cooldownUntilTs;
  }
}
