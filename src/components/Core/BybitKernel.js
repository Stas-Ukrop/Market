// ./components/Core/BybitKernel.js
const BYBIT_CHUNK_SIZE = 10;

// ─────────────────────────────────────────────
// helpers (взято из utils/normalizeBaseName.js, без импорта)
// ─────────────────────────────────────────────
const RAW_QUOTE_ASSETS = ["USDT", "USDC", "BUSD", "TUSD", "FDUSD", "DAI", "PYUSD", "USDD", "USTC", "USDE", "MNT", "BTC", "ETH", "BNB", "SOL", "XRP", "TRX", "DOGE", "TON", "LTC", "ADA", "MATIC", "USD1", "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "NZD", "NOK", "SEK", "DKK", "CZK", "PLN", "HUF", "RON", "HRK", "ISK", "RUB", "UAH", "KZT", "BYN", "GEL", "BRL", "MXN", "ARS", "CLP", "COP", "PEN", "CNY", "CNH", "HKD", "SGD", "KRW", "TWD", "MYR", "THB", "IDR", "INR", "PHP", "VND", "SAR", "AED", "QAR", "KWD", "BHD", "ILS", "TRY", "ZAR", "EGP", "NGN", "KES", "GHS"];

export const QUOTE_ASSETS = RAW_QUOTE_ASSETS.slice().sort((a, b) => b.length - a.length);

const STRICT_DOUBLE_QUOTE = new Set(["USDT", "USDC", "BUSD", "TUSD", "FDUSD", "DAI", "PYUSD", "USDD", "USTC", "USDE", "MNT", "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "NZD"]);

const NUMERIC_MULTIPLIERS = ["1000000000", "100000000", "10000000", "1000000", "100000", "10000", "1000"];

const FILTER_LOG_LIMIT = 3500;
export const filteredSymbolsLog = [];

const logFilteredSymbol = (raw, reason, extra = null) => {
  try {
    if (filteredSymbolsLog.length >= FILTER_LOG_LIMIT) filteredSymbolsLog.shift();
    filteredSymbolsLog.push({ raw, reason, extra, ts: null });
  } catch { }
};

export function normalizeBaseName(symbol = "") {
  if (!symbol) return "";
  const raw = String(symbol).toUpperCase().trim();

  if (raw.includes("PERP")) {
    logFilteredSymbol(raw, "perp_contract");
    return "";
  }
  if (/\d$/.test(raw)) {
    logFilteredSymbol(raw, "numeric_suffix");
    return "";
  }

  let s = raw.replace(/[\/:._-]/g, "");

  let removedQuote = null;
  for (const quote of QUOTE_ASSETS) {
    if (s.endsWith(quote)) {
      s = s.slice(0, s.length - quote.length);
      removedQuote = quote;
      break;
    }
  }
  if (!removedQuote) {
    logFilteredSymbol(raw, "unknown_quote_suffix");
    return "";
  }

  if (STRICT_DOUBLE_QUOTE.has(removedQuote) && s.length > removedQuote.length && s.endsWith(removedQuote)) {
    logFilteredSymbol(raw, "double_quote_suffix", { removedQuote, remainsEndsWith: removedQuote, remains: s });
    return "";
  }

  for (const mul of NUMERIC_MULTIPLIERS)
    if (s.startsWith(mul) && s.length > mul.length + 1) {
      s = s.slice(mul.length);
      break;
    }
  for (const mul of NUMERIC_MULTIPLIERS)
    if (s.endsWith(mul) && s.length > mul.length + 1) {
      s = s.slice(0, s.length - mul.length);
      break;
    }

  if (s === "1INCH") s = "INCH";
  else if (s === "BABY1") s = "BABY";
  else if (s === "AAVEGOTCHI") s = "GHST";

  s = s.replace(/[^A-Z0-9]/g, "");
  if (s.length < 1) {
    logFilteredSymbol(raw, "too_short_after_normalize");
    return "";
  }

  return s;
}

export const getFilteredSymbolsSnapshot = () => filteredSymbolsLog.slice();

const upper = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();
const lower = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
const tsToIso = (ts) => (ts != null ? new Date(Number(ts)).toISOString() : null);

const uniqSorted = (arr) => {
  const seen = new Set();
  const out = [];
  for (const x of Array.isArray(arr) ? arr : []) {
    const s = String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  out.sort();
  return out;
};

const splitBaseQuoteFromSymbol = (symbol) => {
  const s = upper(symbol);
  if (!s) return { base: "", quote: "" };
  for (const q of QUOTE_ASSETS) if (s.endsWith(q)) return { base: s.slice(0, s.length - q.length), quote: q };
  return { base: "", quote: "" };
};

const parseRouteId = (id) => {
  const p = String(id ?? "")
    .trim()
    .split(":");
  if (p.length < 4) return { exchange: "", marketType: "", symbol: "", quote: "" };
  return { exchange: lower(p[0]), marketType: lower(p[1]), symbol: upper(p[2]), quote: upper(p[3]) };
};

const pickBestId = (routes, preferredSymbol) => {
  if (!routes?.length) return null;
  return (
    routes
      .map((r) => {
        const id = String(r?.id ?? "").trim();
        const sym = parseRouteId(id).symbol;
        let score = 100;
        if (preferredSymbol && sym === preferredSymbol) score = 0;
        else if (sym && !/^\d/.test(sym)) score = 10;
        else score = 20;
        return { id: id || null, score, len: sym.length, sym };
      })
      .sort((a, b) => a.score - b.score || a.len - b.len || a.sym.localeCompare(b.sym))[0]?.id || null
  );
};

// ─────────────────────────────────────────────
// ItemsSchema
// ─────────────────────────────────────────────
export class ItemsSchema {
  constructor() {
    this.spot = {
      url: "https://api.bybit.com/v5/market/instruments-info?category=spot",
      ws: "wss://stream.bybit.com/v5/public/spot",
      adapter: {
        tickers: { template: "tickers.{symbol}", symbolCase: "UPPER" },
        orderbook: {
          template: "orderbook.{depth}.{symbol}",
          symbolCase: "UPPER",
          allowedDepths: [1, 50],
          defaults: { depth: 50 },
        },
        publicTrade: { template: "publicTrade.{symbol}", symbolCase: "UPPER" },
        kline: {
          mode: "topic",
          template: "kline.{interval}.{symbol}",
          symbolCase: "UPPER",
          defaults: { uiInterval: "5m", barsLimit: 200 },
          historyPolicy: { minBars: 200 },
          intervalsMap: {
            "1m": "1",
            "5m": "5",
            "15m": "15",
            "30m": "30",
            "1h": "60",
            "4h": "240",
            "12h": "720",
            "1d": "D",
            "1M": "M",
          },
        },
      },
    };

    this.linear = {
      url: "https://api.bybit.com/v5/market/instruments-info?category=linear",
      ws: "wss://stream.bybit.com/v5/public/linear",
      adapter: {
        tickers: { template: "tickers.{symbol}", symbolCase: "UPPER" },
        orderbook: {
          template: "orderbook.{depth}.{symbol}",
          symbolCase: "UPPER",
          allowedDepths: [1, 50, 200, 500],
          defaults: { depth: 50 },
        },
        publicTrade: { mode: "topic", template: "publicTrade.{symbol}", symbolCase: "UPPER" },
        kline: {
          template: "kline.{interval}.{symbol}",
          symbolCase: "UPPER",
          defaults: { uiInterval: "5m", barsLimit: 200 },
          historyPolicy: { minBars: 200 },
          intervalsMap: {
            "1m": "1",
            "5m": "5",
            "15m": "15",
            "30m": "30",
            "1h": "60",
            "4h": "240",
            "12h": "720",
            "1d": "D",
            "1M": "M",
          },
        },
      },
    };

    this.items = [];
  }

  applyChunkViews(baseMap, now) {
    const spotRoutes = [];
    const linearRoutes = [];

    // 1. Separation
    for (const item of baseMap.values()) {
      for (const r of Object.values(item.routesById || {})) {
        const mt = parseRouteId(r?.id).marketType;
        if (mt === "spot") spotRoutes.push(r);
        else if (mt === "linear") linearRoutes.push(r);
      }
    }

    spotRoutes.sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
    linearRoutes.sort((a, b) => String(a?.id).localeCompare(String(b?.id)));

    const ts = Number.isFinite(now) ? Number(now) : null;
    const iso = tsToIso(ts);

    // 2. Chunking
    const applyToGroup = (routes, marketType, chunkSize) => {
      const mt = lower(marketType);

      // 1) TICKERS: чанки по N (10)
      {
        const feedKey = "tickers";
        for (let off = 0, idx = 0; off < routes.length; off += chunkSize, idx++) {
          const end = Math.min(off + chunkSize, routes.length);
          const slice = routes.slice(off, end);

          const symbols = slice.map((r) => parseRouteId(r.id).symbol);
          const routeIds = slice.map((r) => r.id);

          const chunkId = `bybit:${mt}:${feedKey}:full:${idx}`;

          for (const r of slice) {
            const ch = r.chunks?.[feedKey];
            if (!ch) continue;
            ch.id = chunkId;
            ch.symbols = symbols;
            ch.routeIds = routeIds;
            ch.lastUpdateTs = ts;
            ch.lastUpdateIso = iso;
          }
        }
      }

      // 2) Остальные фиды: ИНДИВИДУАЛЬНО (1 символ = 1 чанк)
      for (const r of routes) {
        const { symbol, quote } = parseRouteId(r.id);
        if (!symbol || !quote) continue;

        for (const feedKey of ["orderbook", "kline", "publicTrade"]) {
          const ch = r.chunks?.[feedKey];
          if (!ch) continue;

          ch.id = `bybit:${mt}:${feedKey}:${symbol}:${quote}`;
          ch.symbols = [symbol];
          ch.routeIds = [r.id];
          ch.lastUpdateTs = ts;
          ch.lastUpdateIso = iso;
        }
      }
    };
    applyToGroup(spotRoutes, "spot", BYBIT_CHUNK_SIZE);
    applyToGroup(linearRoutes, "linear", BYBIT_CHUNK_SIZE);

    // Log stats for debugging
    console.log(`[BybitKernel] Applied chunks. Spot Routes: ${spotRoutes.length}, Linear Routes: ${linearRoutes.length}`);
  }

  hydrateBybitItems({ spotJson, linearJson, now } = {}) {
    filteredSymbolsLog.length = 0;

    const parseBybitInstruments = (json) => {
      const list = json?.result?.list;
      if (!Array.isArray(list)) return [];
      return list.map((x) => ({ symbol: x?.symbol })).filter((x) => x.symbol);
    };

    const mkRouteId = ({ marketType, symbol, quote }) => `bybit:${lower(marketType)}:${upper(symbol)}:${upper(quote)}`;

    // ─────────────────────────────────────────────────────────────
    // [CHANGE] Обновленная функция mkChunk
    // Добавляем history: [] для orderbook и publicTrade
    // ─────────────────────────────────────────────────────────────
    const mkChunk = ({ feedKey }) => {
      const fk = String(feedKey);
      const ttlMs = fk === "tickers" ? 8000 : fk === "orderbook" ? 5000 : 4000;

      const chunk = {
        id: null,
        symbols: [],
        routeIds: [],
        lastUpdateTs: null,
        lastUpdateIso: null,
        ttlMs,
        data: null,
      };

      if (fk === "kline" || fk === "orderbook" || fk === "publicTrade") {
        chunk.history = [];
      } else if (fk === "tickers") {
        // Создаем контейнер для исторических данных виджетов из REST API
        chunk.stats = {};
      }

      return chunk;
    };

    const baseMap = new Map();

    const upsert = (marketType, e) => {
      const symbol = upper(e?.symbol);
      if (!symbol) {
        logFilteredSymbol(String(e?.symbol ?? ""), "empty_symbol");
        return;
      }

      if (/-\d{2}[A-Z]{3}\d{2,4}$/.test(symbol)) {
        logFilteredSymbol(symbol, "dated_contract");
        return;
      }
      if (symbol.endsWith("PERP")) {
        logFilteredSymbol(symbol, "perp_contract");
        return;
      }

      const { quote } = splitBaseQuoteFromSymbol(symbol);
      if (!quote) {
        logFilteredSymbol(symbol, "unknown_quote_suffix");
        return;
      }

      const baseId = upper(normalizeBaseName(symbol));
      if (!baseId) return;

      const routeId = mkRouteId({ marketType, symbol, quote });

      const item = baseMap.get(baseId) || { baseId, routesById: {} };
      const prev = item.routesById[routeId];

      const route = prev || {
        id: routeId,
        pinned: false,
        linkedOppositeRouteIds: [],
        chunks: {},
      };

      route.id = routeId;
      route.linkedOppositeRouteIds = uniqSorted(route.linkedOppositeRouteIds);

      // Ensure chunks object structure
      route.chunks = route.chunks && typeof route.chunks === "object" ? route.chunks : {};

      // Upsert chunks (preserve existing data if any, but ensure keys exist)
      for (const k of ["tickers", "orderbook", "kline", "publicTrade"]) {
        if (!route.chunks[k]) route.chunks[k] = mkChunk({ feedKey: k });
      }

      item.routesById[routeId] = route;
      baseMap.set(baseId, item);
    };

    for (const e of parseBybitInstruments(spotJson)) upsert("spot", e);
    for (const e of parseBybitInstruments(linearJson)) upsert("linear", e);

    // Linking Spot <-> Linear
    for (const item of baseMap.values()) {
      const all = Object.values(item.routesById || {});
      const byQuote = new Map();

      for (const r of all) {
        const { marketType, quote } = parseRouteId(r?.id);
        if (!quote) continue;

        const b = byQuote.get(quote) || { spot: [], linear: [] };
        if (marketType === "spot") b.spot.push(r);
        if (marketType === "linear") b.linear.push(r);
        byQuote.set(quote, b);
      }

      for (const [quote, bucket] of byQuote.entries()) {
        const preferred = `${upper(item.baseId)}${upper(quote)}`;
        const spotId = pickBestId(bucket.spot, preferred);
        const linId = pickBestId(bucket.linear, preferred);
        if (!spotId || !linId) continue;

        const spot = item.routesById[spotId];
        const lin = item.routesById[linId];
        if (!spot || !lin) continue;

        spot.linkedOppositeRouteIds = uniqSorted([...(spot.linkedOppositeRouteIds || []), lin.id]);
        lin.linkedOppositeRouteIds = uniqSorted([...(lin.linkedOppositeRouteIds || []), spot.id]);
      }
    }

    const items = Array.from(baseMap.values()).sort((a, b) => String(a.baseId).localeCompare(String(b.baseId)));
    this.items = items;
    this.applyChunkViews(baseMap, now);

    const ts = Number.isFinite(now) ? Number(now) : null;
    return {
      ok: true,
      ts,
      iso: tsToIso(ts),
      bases: items.length,
      routes: items.reduce((acc, it) => acc + Object.keys(it.routesById || {}).length, 0),
      filtered: filteredSymbolsLog.length,
    };
  }
}
