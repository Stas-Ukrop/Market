// /components/Core/BybitKernel.js
// ─────────────────────────────────────────────
// ItemsSchema
// ─────────────────────────────────────────────

export class ItemsSchema {
  constructor(spot, linear, chunkSize, filterLogLimit, numericMultipliers, strictDoubleQuote, quoteAssets, FEED_TTL_MS ) {   
    this.chunkSize = chunkSize;
  this.filterLogLimit = filterLogLimit;
  this.numericMultipliers = numericMultipliers;
  this.strictDoubleQuote = strictDoubleQuote;
    this.quoteAssets = quoteAssets;
    this.FEED_TTL_MS = FEED_TTL_MS;
    
    this.spot = spot;    
    this.linear = linear;
    
    this.filteredSymbolsLog = [];
    this.items = [];
  }

hydrateItems({ exchange = "bybit", marketsJson = {}, now = Date.now(), parseInstruments = this.parseInstruments } = {}) {
  this.filteredSymbolsLog.length = 0;

  const baseMap = new Map();

  for (const [marketType, json] of Object.entries(marketsJson)) {
    for (const instrument of parseInstruments.call(this, json, marketType)) {
      this.upsertInstrumentRoute(baseMap, {
        exchange,
        marketType,
        instrument,
      });
    }
  }

  this.linkOppositeRoutes(baseMap);

  return this.commitHydratedItems(baseMap, now);
  }
  
parseInstruments(json, marketType) {
  const instrumentSchema = this.getInstrumentSchema(marketType);

  return this.pickInstrumentList(json, instrumentSchema.listPath)
    .map((item) => this.normalizeInstrumentRecord(item, instrumentSchema))
    .filter((instrument) => instrument.symbol && this.isActiveInstrument(instrument, instrumentSchema));
}

getMarketSchema(marketType) {
  return this[this.lower(marketType)] || null;
}

getInstrumentSchema(marketType) {
  return this.getMarketSchema(marketType)?.instrument || {};
}

pickInstrumentList(json, listPath = []) {
  if (Array.isArray(listPath) && listPath.length) {
    let node = json;

    for (const key of listPath) {
      node = node?.[key];
    }

    if (Array.isArray(node)) return node;
  }

  if (Array.isArray(json?.result?.list)) return json.result.list;
  if (Array.isArray(json?.symbols)) return json.symbols;
  if (Array.isArray(json?.data)) return json.data;

  return [];
}

normalizeInstrumentRecord(item, instrumentSchema = {}) {
  return {
    symbol: item?.[instrumentSchema.symbolField] ?? item?.symbol ?? item?.instId ?? "",
    base: item?.[instrumentSchema.baseField] ?? item?.baseAsset ?? item?.baseCcy ?? item?.ctValCcy ?? "",
    quote: item?.[instrumentSchema.quoteField] ?? item?.quoteAsset ?? item?.quoteCcy ?? item?.settleCcy ?? "",
    status: item?.[instrumentSchema.statusField] ?? item?.status ?? item?.state ?? "",
    raw: item,
  };
}

isActiveInstrument(instrument, instrumentSchema = {}) {
  const status = this.upper(instrument?.status);
  const activeStatuses = instrumentSchema.activeStatuses || [];

  if (!status || !activeStatuses.length) return true;

  return activeStatuses.map((item) => this.upper(item)).includes(status);
}

  upsertInstrumentRoute(baseMap, { exchange, marketType, instrument }) {
    const symbol = this.upper(instrument?.symbol);

    if (!symbol) {
      this.logFilteredSymbol(String(instrument?.symbol ?? ""), "empty_symbol");
      return;
    }

    if (this.isRejectedSymbol(symbol)) return;

    const quote = this.resolveQuote(instrument, symbol);

if (!quote) {
  this.logFilteredSymbol(symbol, "unknown_quote_suffix");
  return;
}

const baseId = this.resolveBaseId(instrument, symbol);

if (!baseId) return;

    const routeId = this.buildRouteId({
      exchange,
      marketType,
      symbol,
      quote,
    });

    const item = baseMap.get(baseId) || {
      baseId,
      routesById: {},
    };

    const route = item.routesById[routeId] || this.createRoute(routeId);

    route.id = routeId;
    route.linkedOppositeRouteIds = this.uniqSorted(route.linkedOppositeRouteIds);
    route.chunks = route.chunks && typeof route.chunks === "object" ? route.chunks : {};

    this.ensureRouteChunks(route, ["tickers", "orderbook", "kline", "publicTrade"]);

    item.routesById[routeId] = route;
    baseMap.set(baseId, item);
  }
resolveQuote(instrument, symbol) {
  const quote = this.upper(instrument?.quote);

  if (quote) return quote;

  return this.splitBaseQuoteFromSymbol(symbol).quote;
}

resolveBaseId(instrument, symbol) {
  const base = this.upper(instrument?.base);

  if (base) return this.cleanBaseId(base);

  return this.upper(this.normalizeBaseName(symbol));
}

cleanBaseId(base) {
  let value = this.upper(base).replace(/[^A-Z0-9]/g, "");

  for (const multiplier of this.numericMultipliers || []) {
    if (value.startsWith(multiplier) && value.length > multiplier.length + 1) {
      value = value.slice(multiplier.length);
      break;
    }
  }

  for (const multiplier of this.numericMultipliers || []) {
    if (value.endsWith(multiplier) && value.length > multiplier.length + 1) {
      value = value.slice(0, value.length - multiplier.length);
      break;
    }
  }

  if (value === "1INCH") value = "INCH";
  else if (value === "BABY1") value = "BABY";
  else if (value === "AAVEGOTCHI") value = "GHST";

  return value;
}
  isRejectedSymbol(symbol) {
    if (/-\d{2}[A-Z]{3}\d{2,4}$/.test(symbol)) {
      this.logFilteredSymbol(symbol, "dated_contract");
      return true;
    }

    if (symbol.endsWith("PERP")) {
      this.logFilteredSymbol(symbol, "perp_contract");
      return true;
    }

    return false;
  }

  buildRouteId({ exchange, marketType, symbol, quote }) {
    return `${this.lower(exchange)}:${this.lower(marketType)}:${this.upper(symbol)}:${this.upper(quote)}`;
  }

  createRoute(routeId) {
    return {
      id: routeId,
      pinned: false,
      linkedOppositeRouteIds: [],
      chunks: {},
    };
  }

  ensureRouteChunks(route, feedKeys) {
    for (const feedKey of feedKeys) {
      if (!route.chunks[feedKey]) {
        route.chunks[feedKey] = this.createChunk(feedKey);
      }
    }
  }

  createChunk(feedKey) {
    const fk = String(feedKey);
    const ttlMs = fk === "tickers" ? this.FEED_TTL_MS.tickers : fk === "orderbook" ? this.FEED_TTL_MS.orderbook : this.FEED_TTL_MS.default;

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
    }

    if (fk === "tickers") {
      chunk.stats = {};
    }

    return chunk;
  }

  linkOppositeRoutes(baseMap) {
    for (const item of baseMap.values()) {
      const byQuote = this.buildRoutesByQuote(item);

      for (const [quote, bucket] of byQuote.entries()) {
        this.linkBestSpotLinearPair(item, quote, bucket);
      }
    }
  }

  buildRoutesByQuote(item) {
    const byQuote = new Map();

    for (const route of Object.values(item.routesById || {})) {
      const { marketType, quote } = this.parseRouteId(route?.id);

      if (!quote) continue;

      const bucket = byQuote.get(quote) || {
        spot: [],
        linear: [],
      };

      if (marketType === "spot") bucket.spot.push(route);
      if (marketType === "linear") bucket.linear.push(route);

      byQuote.set(quote, bucket);
    }

    return byQuote;
  }

  linkBestSpotLinearPair(item, quote, bucket) {
    const preferred = `${this.upper(item.baseId)}${this.upper(quote)}`;
    const spotId = this.pickBestId(bucket.spot, preferred);
    const linearId = this.pickBestId(bucket.linear, preferred);

    if (!spotId || !linearId) return;

    const spot = item.routesById[spotId];
    const linear = item.routesById[linearId];

    if (!spot || !linear) return;

    spot.linkedOppositeRouteIds = this.uniqSorted([...(spot.linkedOppositeRouteIds || []), linear.id]);

    linear.linkedOppositeRouteIds = this.uniqSorted([...(linear.linkedOppositeRouteIds || []), spot.id]);
  }

  commitHydratedItems(baseMap, now) {
    const items = Array.from(baseMap.values()).sort((a, b) => String(a.baseId).localeCompare(String(b.baseId)));

    this.items = items;
    this.applyChunkViews(baseMap, now);

    const ts = Number.isFinite(now) ? Number(now) : null;

    return {
      ok: true,
      ts,
      iso: this.tsToIso(ts),
      bases: items.length,
      routes: items.reduce((acc, item) => acc + Object.keys(item.routesById || {}).length, 0),
      filtered: this.filteredSymbolsLog.length,
    };
  }

applyChunkViews(baseMap, now, options = {}) {
  const routesByMarket = this.getRoutesByMarket(baseMap);
  const ts = Number.isFinite(now) ? Number(now) : null;
  const iso = this.tsToIso(ts);

  const chunkSize = options.chunkSize ?? this.chunkSize ?? 10;
  const markets = options.markets ?? ["spot", "linear"].filter((marketType) => this.getMarketSchema(marketType));
  const groupedFeedKeys = options.groupedFeedKeys ?? ["tickers"];
  const singleFeedKeys = options.singleFeedKeys ?? ["orderbook", "kline", "publicTrade"];

  for (const marketType of markets) {
    const routes = routesByMarket[marketType] || [];

    for (const feedKey of groupedFeedKeys) {
      this.applyGroupedChunks(routes, marketType, feedKey, chunkSize, ts, iso);
    }

    this.applySingleSymbolChunks(routes, marketType, singleFeedKeys, ts, iso);
  }

  console.log(
    `[ItemsSchema] Applied chunks. Spot Routes: ${routesByMarket.spot?.length ?? 0}, Linear Routes: ${
      routesByMarket.linear?.length ?? 0
    }`
  );
  }
  
  getRoutesByMarket(baseMap) {
    const routesByMarket = {
      spot: [],
      linear: [],
    };

    for (const item of baseMap.values()) {
      for (const route of Object.values(item.routesById || {})) {
        const { marketType } = this.parseRouteId(route?.id);

        if (routesByMarket[marketType]) {
          routesByMarket[marketType].push(route);
        }
      }
    }

    for (const routes of Object.values(routesByMarket)) {
      routes.sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
    }

    return routesByMarket;
  }

  applyGroupedChunks(routes, marketType, feedKey, chunkSize, ts, iso) {
    for (let off = 0, idx = 0; off < routes.length; off += chunkSize, idx++) {
      const slice = routes.slice(off, off + chunkSize);

      if (!slice.length) continue;

      const symbols = slice.map((route) => this.parseRouteId(route.id).symbol);
      const routeIds = slice.map((route) => route.id);
      const chunkId = this.buildGroupedChunkId(slice[0]?.id, marketType, feedKey, idx);

      for (const route of slice) {
        this.assignChunk(route.chunks?.[feedKey], {
          id: chunkId,
          symbols,
          routeIds,
          ts,
          iso,
        });
      }
    }
  }

  applySingleSymbolChunks(routes, marketType, feedKeys, ts, iso) {
    for (const route of routes) {
      const { symbol, quote } = this.parseRouteId(route.id);

      if (!symbol || !quote) continue;

      for (const feedKey of feedKeys) {
        this.assignChunk(route.chunks?.[feedKey], {
          id: this.buildSymbolChunkId(route.id, marketType, feedKey, symbol, quote),
          symbols: [symbol],
          routeIds: [route.id],
          ts,
          iso,
        });
      }
    }
  }

  assignChunk(chunk, { id, symbols, routeIds, ts, iso }) {
    if (!chunk) return;

    chunk.id = id;
    chunk.symbols = symbols;
    chunk.routeIds = routeIds;
    chunk.lastUpdateTs = ts;
    chunk.lastUpdateIso = iso;
  }

  buildGroupedChunkId(routeId, marketType, feedKey, index) {
    const { exchange } = this.parseRouteId(routeId);

    return `${exchange}:${this.lower(marketType)}:${feedKey}:full:${index}`;
  }

  buildSymbolChunkId(routeId, marketType, feedKey, symbol, quote) {
    const { exchange } = this.parseRouteId(routeId);

    return `${exchange}:${this.lower(marketType)}:${feedKey}:${symbol}:${quote}`;
  }

  pickBestId(routes, preferredSymbol) {
    if (!routes?.length) return null;

    return (
      routes
        .map((route) => {
          const id = String(route?.id ?? "").trim();
          const symbol = this.parseRouteId(id).symbol;

          let score = 100;

          if (preferredSymbol && symbol === preferredSymbol) score = 0;
          else if (symbol && !/^\d/.test(symbol)) score = 10;
          else score = 20;

          return {
            id: id || null,
            score,
            len: symbol.length,
            symbol,
          };
        })
        .sort((a, b) => a.score - b.score || a.len - b.len || a.symbol.localeCompare(b.symbol))[0]?.id || null
    );
  }

  parseRouteId(id) {
    const parts = String(id ?? "")
      .trim()
      .split(":");

    if (parts.length < 4) {
      return {
        exchange: "",
        marketType: "",
        symbol: "",
        quote: "",
      };
    }

    return {
      exchange: this.lower(parts[0]),
      marketType: this.lower(parts[1]),
      symbol: this.upper(parts[2]),
      quote: this.upper(parts[3]),
    };
  }

splitBaseQuoteFromSymbol(symbol) {
  const value = this.upper(symbol);

  if (!value) {
    return {
      base: "",
      quote: "",
    };
  }

  for (const quote of this.quoteAssets || []) {
    if (value.endsWith(quote)) {
      return {
        base: value.slice(0, value.length - quote.length),
        quote,
      };
    }
  }

  return {
    base: "",
    quote: "",
  };
}

normalizeBaseName(symbol = "") {
  if (!symbol) return "";

  const raw = this.upper(symbol);

  if (raw.includes("PERP")) {
    this.logFilteredSymbol(raw, "perp_contract");
    return "";
  }

  if (/\d$/.test(raw)) {
    this.logFilteredSymbol(raw, "numeric_suffix");
    return "";
  }

  let value = raw.replace(/[/:._-]/g, "");
  let removedQuote = null;

  for (const quote of this.quoteAssets || []) {
    if (value.endsWith(quote)) {
      value = value.slice(0, value.length - quote.length);
      removedQuote = quote;
      break;
    }
  }

  if (!removedQuote) {
    this.logFilteredSymbol(raw, "unknown_quote_suffix");
    return "";
  }

  if (
    this.strictDoubleQuote?.has?.(removedQuote) &&
    value.length > removedQuote.length &&
    value.endsWith(removedQuote)
  ) {
    this.logFilteredSymbol(raw, "double_quote_suffix", {
      removedQuote,
      remainsEndsWith: removedQuote,
      remains: value,
    });

    return "";
  }

  for (const multiplier of this.numericMultipliers || []) {
    if (value.startsWith(multiplier) && value.length > multiplier.length + 1) {
      value = value.slice(multiplier.length);
      break;
    }
  }

  for (const multiplier of this.numericMultipliers || []) {
    if (value.endsWith(multiplier) && value.length > multiplier.length + 1) {
      value = value.slice(0, value.length - multiplier.length);
      break;
    }
  }

  if (value === "1INCH") value = "INCH";
  else if (value === "BABY1") value = "BABY";
  else if (value === "AAVEGOTCHI") value = "GHST";

  value = value.replace(/[^A-Z0-9]/g, "");

  if (value.length < 1) {
    this.logFilteredSymbol(raw, "too_short_after_normalize");
    return "";
  }

  return value;
}

  uniqSorted(arr) {
    const seen = new Set();
    const out = [];

    for (const item of Array.isArray(arr) ? arr : []) {
      const value = String(item ?? "").trim();

      if (!value || seen.has(value)) continue;

      seen.add(value);
      out.push(value);
    }

    out.sort();

    return out;
  }

  getFilteredSymbolsSnapshot() {
    return this.filteredSymbolsLog.slice();
  }

logFilteredSymbol(raw, reason, extra = null) {
  try {
    const limit = Number.isFinite(Number(this.filterLogLimit)) ? Number(this.filterLogLimit) : 3500;

    if (this.filteredSymbolsLog.length >= limit) {
      this.filteredSymbolsLog.shift();
    }

    this.filteredSymbolsLog.push({
      raw,
      reason,
      extra,
      ts: null,
    });
  } catch {
    console.log("filtered symbol log error");
  }
}

  upper(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase();
  }

  lower(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase();
  }

  tsToIso(ts) {
    return ts != null ? new Date(Number(ts)).toISOString() : null;
  }
}