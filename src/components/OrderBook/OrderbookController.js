// src/components/OrderBook/OrderbookController.js

/* ==================================================================================
   LOCAL HELPERS (ISOLATED)
   Копии функций форматирования для полной автономности контроллера.
================================================================================== */

const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const stripTrailingZeros = (s) => {
  if (!s.includes(".")) return s;
  s = s.replace(/0+$/, "");
  return s.replace(/\.$/, "");
};

// Компактный формат цены (для стакана обычно без $)
const formatPrice = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return "—";
    if (!/e/i.test(raw)) return stripTrailingZeros(raw);
  }
  const n = toNum(value);
  if (n === null) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  let s;
  if (abs >= 1) s = n.toFixed(6);
  else if (abs >= 0.01) s = n.toFixed(8);
  else s = n.toFixed(12);
  return stripTrailingZeros(s);
};

// Формат объема
const formatVolume = (v) => {
  if (v == null || isNaN(v)) return "—";
  const num = Number(v);
  if (num === 0) return "—";
  const abs = Math.abs(num);
  const precision = abs >= 1_000_000 ? 0 : abs >= 10_000 ? 1 : abs >= 100 ? 2 : 4;
  return num
    .toLocaleString("en-US", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
      useGrouping: true,
    })
    .replace(/,/g, " ");
};

// Формат процентов
const fmtPercent = (v, { withSign = true } = {}) => {
  if (v == null || isNaN(v)) return "—";
  const num = Number(v);
  if (num === 0) return "0%";
  const abs = Math.abs(num);
  const precision = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : abs >= 0.1 ? 3 : abs >= 0.01 ? 4 : 5;
  let formatted = num.toFixed(precision);
  if (withSign && num > 0) formatted = `+${formatted}`;
  return `${formatted}%`;
};

// Конфиг цветов для анализа
const COLOR_CONFIG = {
  SPOOF: "#9c27b0",
  SPOOF_HISTORY: "#ea80fc",
  ICEBERG: "#00bcd4",
  CONFIRMED_BID: "#2962ff",
  CONFIRMED_ASK: "#000000",
  NORMAL_BID: "#00bfa5",
  NORMAL_ASK: "#ff5252",
};

/* ==================================================================================
   CONTROLLER CLASS
================================================================================== */

export class OrderbookController {
  constructor() {
    this.contexts = new Map(); // type -> ctx
    this.rows = 35;
    this.analyzing = false;
    this.staleMs = 6000;
    this.activeCoin = "";
  }

  // ---- UI state ----
  getRows() {
    return this.rows;
  }

  setRows(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return;
    this.rows = v <= 0 ? 35 : v;
  }

  isAnalyzing() {
    return !!this.analyzing;
  }

  setAnalyzing(next) {
    const v = !!next;
    if (v === this.analyzing) return;
    this.analyzing = v;
    if (v) this._resetAnalysisCaches();
  }

  toggleAnalysis() {
    this.setAnalyzing(!this.analyzing);
  }

  // ---- lifecycle / selection ----
  reset() {
    this.contexts.clear();
  }

  onSelectCoin(baseId, srv, { grafInterval, grafBarsLimit, priority = 9999, reason = "ui_select" } = {}) {
    const id = String(baseId || "").trim();
    if (!id) return;

    if (this.activeCoin && this.activeCoin !== id) {
      try {
        srv?.releaseCoinFeeds?.(this.activeCoin, { reason: "ui_switch" });
      } catch (_) {}
    }

    this.activeCoin = id;
    this.reset();
    this.analyzing = false;

    try {
      srv?.ensureCoinFeeds?.(id, {
        feedKeys: ["tickers", "orderbook", "publicTrade", "kline"],
        priority,
        reason,
        klineOpts: { interval: grafInterval, barsLimit: grafBarsLimit },
      });
    } catch (_) {}
  }

  // ---- main API ----
  process(type, route, symbol, tradeChunk) {
    const t = String(type || "");
    const sym = String(symbol || "").trim();
    if (!sym) return this._empty(sym);

    const ctx = this._getCtx(t, sym);
    const bookChunk = this._pickBookChunk(route);

    this._applyBook(ctx, bookChunk);

    const ts = Number(bookChunk?.lastUpdateTs || 0) || 0;
    const view = this._buildView(ctx, this.rows, ts, sym);

    const lines = this.analyzing ? this._analyzeWalls(ctx, tradeChunk) : [];

    return { view, lines };
  }

  // ---- internals ----
  _pickBookChunk(route) {
    return route?.chunks?.orderbook || route?.chunk?.orderbook || null;
  }

  _getCtx(type, symbol) {
    let ctx = this.contexts.get(type);
    if (!ctx || ctx.symbol !== symbol) {
      ctx = {
        symbol,
        bids: new Map(),
        asks: new Map(),
        lastU: 0,
        walls: new Map(),
        ghosts: [],
        lastTradeIds: new Set(),
      };
      this.contexts.set(type, ctx);
    }
    return ctx;
  }

  _resetAnalysisCaches() {
    for (const ctx of this.contexts.values()) {
      ctx.walls?.clear?.();
      ctx.ghosts = [];
      ctx.lastTradeIds?.clear?.();
    }
  }

  _applyBook(ctx, bookChunk) {
    const hist = Array.isArray(bookChunk?.history) ? bookChunk.history : null;
    if (!hist || hist.length === 0) return;

    const window = 400;
    const start = Math.max(0, hist.length - window);

    const apply = (map, raw) => {
      const data = Array.isArray(raw) ? raw : [];
      for (let i = 0; i < data.length; i++) {
        const e = data[i];
        if (!e) continue;
        const p = Number(e[0]);
        const s = Number(e[1]);
        if (!Number.isFinite(p)) continue;
        if (Number.isFinite(s) && s > 0) map.set(p, s);
        else map.delete(p);
      }
    };

    for (let i = start; i < hist.length; i++) {
      const item = hist[i];
      if (!item) continue;

      const isSnapshot = item.type === "snapshot";
      const u = Number(item.u || 0);
      const data = item.data || {};

      if (isSnapshot) {
        ctx.bids.clear();
        ctx.asks.clear();
        ctx.walls?.clear?.();
        ctx.lastU = 0;
      } else {
        if (u > 0 && ctx.lastU > 0 && u <= ctx.lastU) continue;
      }

      apply(ctx.bids, data.b || data.bids);
      apply(ctx.asks, data.a || data.asks);

      if (u > 0) ctx.lastU = u;
    }
  }

  _statusFromTs(ts) {
    if (!ts) return "idle";
    return Date.now() - ts < this.staleMs ? "live" : "stale";
  }

  _empty(symbol) {
    return {
      view: {
        symbol: symbol || "—",
        status: "idle",
        asks: [],
        bids: [],
        bestBidStr: "",
        bestAskStr: "",
        midStr: "—",
        spreadAbsStr: "—",
        spreadPctStr: "—",
        bidCumStr: "—",
        askCumStr: "—",
        bidRatio: 0.5,
        domPct: "50.0",
        ts: 0,
      },
      lines: [],
    };
  }

  _buildView(ctx, rows, ts, symbol) {
    const toArr = (map) => {
      const out = new Array(map.size);
      let k = 0;
      for (const [p, s] of map.entries()) out[k++] = { price: p, size: s };
      return out;
    };

    const bRaw = toArr(ctx.bids)
      .sort((a, b) => b.price - a.price)
      .slice(0, rows);
    const aRaw = toArr(ctx.asks)
      .sort((a, b) => a.price - b.price)
      .slice(0, rows);

    let bc = 0,
      ac = 0;
    const maxB = bRaw.reduce((m, r) => (r.size > m ? r.size : m), 0);
    const maxA = aRaw.reduce((m, r) => (r.size > m ? r.size : m), 0);
    const maxGlobal = Math.max(maxB, maxA, 1);

    const prep = (arr, isAsk) => {
      const res = new Array(arr.length);
      for (let i = 0; i < arr.length; i++) {
        const r = arr[i];
        if (isAsk) ac += r.size;
        else bc += r.size;

        res[i] = {
          priceStr: formatPrice(r.price),
          sizeStr: formatVolume(r.size),
          cumStr: formatVolume(isAsk ? ac : bc),
          sizePct: (r.size / maxGlobal) * 100,
          isStrong: r.size / maxGlobal > 0.7,
        };
      }
      return isAsk ? res.reverse() : res;
    };

    const bids = prep(bRaw, false);
    const asks = prep(aRaw, true);

    const bestBid = bRaw[0]?.price;
    const bestAsk = aRaw[0]?.price;
    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
    const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
    const totalVol = bc + ac;
    const bidRatio = totalVol > 0 ? bc / totalVol : 0.5;

    return {
      symbol: symbol || "—",
      status: this._statusFromTs(ts),
      bids,
      asks,
      bestBidStr: bestBid ? formatPrice(bestBid) : "—",
      bestAskStr: bestAsk ? formatPrice(bestAsk) : "—",
      midStr: mid ? formatPrice(mid) : "—",
      spreadAbsStr: mid && spread ? formatPrice(spread) : "—",
      spreadPctStr: mid && spread ? fmtPercent((spread / mid) * 100, { withSign: false }) : "—",
      bidCumStr: formatVolume(bc),
      askCumStr: formatVolume(ac),
      bidRatio,
      domPct: (bidRatio * 100).toFixed(1),
      ts: ts || 0,
    };
  }

  _analyzeWalls(ctx, tradeChunk) {
    const now = Date.now();
    const minMult = 3.0;

    // A) trades -> hits/iceberg
    if (Array.isArray(tradeChunk?.history) && tradeChunk.history.length) {
      const trades = tradeChunk.history.slice(-100);
      for (const t of trades) {
        const id = t?.i;
        if (id != null && ctx.lastTradeIds.has(id)) continue;
        if (id != null) ctx.lastTradeIds.add(id);

        const price = parseFloat(t?.p);
        const size = parseFloat(t?.v);
        const side = t?.S;

        if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) continue;

        const w = ctx.walls.get(price);
        if (w && w.status === "active") {
          const isHit = (side === "Buy" && w.side === "ask") || (side === "Sell" && w.side === "bid");
          if (isHit) {
            w.totalTradeVol += size;
            w.hitCount++;
            if (w.totalTradeVol > w.initialSize * 1.1) w.type = "iceberg";
          }
        }
      }
      if (ctx.lastTradeIds.size > 2000) {
        const keep = Array.from(ctx.lastTradeIds).slice(-1000);
        ctx.lastTradeIds = new Set(keep);
      }
    }

    // B) scan orderbook
    const scanSide = (map, side) => {
      let total = 0;
      for (const v of map.values()) total += v;
      const avg = total / (map.size || 1);
      const threshold = avg * minMult;

      for (const [price, size] of map.entries()) {
        if (size < threshold) continue;
        const w = ctx.walls.get(price);
        if (w) {
          if (size > w.currentSize * 1.05) {
            w.refillCount++;
            if (w.refillCount > 2) w.type = "iceberg";
          }
          w.currentSize = size;
          w.status = "active";
        } else {
          ctx.walls.set(price, {
            price,
            side,
            initialSize: size,
            currentSize: size,
            status: "active",
            type: "normal",
            totalTradeVol: 0,
            hitCount: 0,
            refillCount: 0,
          });
        }
      }
    };
    scanSide(ctx.bids, "bid");
    scanSide(ctx.asks, "ask");

    // C) spoof detect
    const currentPrices = new Set([...ctx.bids.keys(), ...ctx.asks.keys()]);
    for (const [p, w] of ctx.walls.entries()) {
      if (w.status === "active" && !currentPrices.has(p)) {
        if (w.totalTradeVol >= w.currentSize * 0.9) ctx.walls.delete(p);
        else {
          w.status = "spoof";
          w.spoofStart = now;
        }
      }
      if (w.status === "spoof" && now - w.spoofStart > 5000) {
        ctx.ghosts.push({ ...w, ts: now });
        ctx.walls.delete(p);
      }
    }
    ctx.ghosts = ctx.ghosts.filter((g) => now - g.ts < 300000);

    // D) lines
    const lines = [];
    for (const w of ctx.walls.values()) {
      let color = w.side === "bid" ? COLOR_CONFIG.NORMAL_BID : COLOR_CONFIG.NORMAL_ASK;
      let title = formatVolume(w.currentSize);
      let lineWidth = 1;
      let lineStyle = 0;

      if (w.type === "iceberg") {
        color = COLOR_CONFIG.ICEBERG;
        title = `ICE: ${formatVolume(w.currentSize)}`;
        lineWidth = 3;
      } else if (w.hitCount > 0) {
        color = w.side === "bid" ? COLOR_CONFIG.CONFIRMED_BID : COLOR_CONFIG.CONFIRMED_ASK;
        lineWidth = 2;
      } else if (w.status === "spoof") {
        color = COLOR_CONFIG.SPOOF;
        title = "SPOOF";
        lineStyle = 2;
      }
      lines.push({ price: w.price, size: w.currentSize, color, title, lineWidth, lineStyle });
    }

    for (const g of ctx.ghosts) {
      lines.push({
        price: g.price,
        size: g.currentSize,
        color: COLOR_CONFIG.SPOOF_HISTORY,
        title: "Ghost",
        lineWidth: 1,
        lineStyle: 1,
      });
    }

    return lines;
  }
}
