// src/components/Tickers/TickerController.js

/* ==================================================================================
   LOCAL HELPERS
================================================================================== */
const upper = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();
const lower = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();

const parseRouteId = (id) => {
  const p = String(id ?? "")
    .trim()
    .split(":");
  if (p.length < 4) return { exchange: "", marketType: "", symbol: "", quote: "" };
  return { exchange: lower(p[0]), marketType: lower(p[1]), symbol: upper(p[2]), quote: upper(p[3]) };
};

const formatPrice = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  if (abs < 0.000001) return n.toFixed(10);
  if (abs < 0.001) return n.toFixed(8);
  if (abs < 1) return n.toFixed(6);
  if (abs < 10) return n.toFixed(4);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatPct = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—";
};

const getPctColor = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "#666";
  if (n > 0) return "#0a8f3c";
  if (n < 0) return "#c62828";
  return "#666";
};

const getFundingClass = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n > 0 ? "sym-funding-pos" : n < 0 ? "sym-funding-neg" : "";
};

const formatOI = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

/* ==================================================================================
   CONSTANTS
================================================================================== */
export const PRICE_RANGES = {
  "от min до max": [0, Infinity],
  "от min до 0,001": [0, 0.001],
  "от 0,001 до 0,01": [0.001, 0.01],
  "от 0,1 до 1": [0.1, 1],
  "от 1 до 10": [1, 10],
  "от 10 до max": [10, Infinity],
};

/* ==================================================================================
   CONTROLLER CLASS (Tickers only)
================================================================================== */
export class TickerController {
  constructor() {
    this.cache = new Map(); // routeId -> merged ticker snapshot
    this.defaultSort = { key: "linOI", dir: "desc" };
  }

  // Обновленный метод process с поддержкой marketPresence
  process(itemsMap, { q = "", filterMode = "all", marketPresence = "all", rangeKey = "от min до max", sortConfig = null, selectedId = "" }) {
    const list = [];
    const src = itemsMap instanceof Map ? itemsMap : new Map();
    const searchQ = upper(q);
    const [minPrice, maxPrice] = PRICE_RANGES[rangeKey] || [0, Infinity];
    const isPriceFilterActive = filterMode !== "all";
    const sort = sortConfig || this.defaultSort;

    for (const item of src.values()) {
      const baseId = String(item?.baseId || "");
      if (searchQ && !upper(baseId).includes(searchQ)) continue;

      const groups = this._groupRoutes(item);
      for (const g of groups) {
        // --- ЛОГИКА НОВОГО ФИЛЬТРА (Market Presence) ---
        const hasSpot = !!g.spotRoute;
        const hasLin = !!g.linearRoute;

        if (marketPresence === "both") {
          // Строго: и спот, и фьючерс
          if (!hasSpot || !hasLin) continue;
        } else if (marketPresence === "spot_only") {
          // Только спот (без фьючерса)
          if (!hasSpot || hasLin) continue;
        } else if (marketPresence === "linear_only") {
          // Только фьючерс (без спота)
          if (!hasLin || hasSpot) continue;
        }
        // marketPresence === "all" пропускает всё

        // --- ЛОГИКА СТАРОГО ФИЛЬТРА (Price check based on mode) ---
        if (isPriceFilterActive) {
          const route = filterMode === "spot" ? g.spotRoute : g.linearRoute;
          const t = this._resolveTicker(route);
          const price = Number(t?.lastPrice ?? t?.last_price ?? 0);
          if (!price || price < minPrice || price > maxPrice) continue;
        }

        list.push(this._createViewModel(g, selectedId));
      }
    }

    this._applySort(list, sort);
    return list;
  }

  getSubscriptionDetails(itemsMap, idOrBase) {
    if (!(itemsMap instanceof Map)) return null;
    const id = String(idOrBase ?? "").trim();
    if (!id) return null;

    let item = itemsMap.get(id);
    if (!item) {
      for (const it of itemsMap.values()) {
        if (String(it?.baseId || "") === id) {
          item = it;
          break;
        }
      }
    }
    if (!item) return null;

    const routes = item?.routesById ? Object.values(item.routesById) : [];
    const bybit = routes.filter((r) => parseRouteId(r?.id).exchange === "bybit");
    const linear = bybit.find((r) => String(r?.id || "").includes(":linear"));
    const spot = bybit.find((r) => String(r?.id || "").includes(":spot"));
    const main = linear || spot || bybit[0];
    if (!main) return null;

    const meta = parseRouteId(main.id);
    return {
      baseId: String(item.baseId || ""),
      symbol: meta.symbol || String(item.baseId || ""),
      hasLinear: !!linear,
      hasSpot: !!spot,
    };
  }

  _groupRoutes(item) {
    const routes = item?.routesById ? Object.values(item.routesById) : [];
    const byQuote = new Map();

    for (const r of routes) {
      const meta = parseRouteId(r?.id);
      if (meta.exchange !== "bybit") continue;
      if (meta.marketType !== "spot" && meta.marketType !== "linear") continue;

      const key = meta.quote || "USD";
      const group = byQuote.get(key) || {
        baseId: String(item?.baseId || ""),
        quote: key,
        spotRoute: null,
        linearRoute: null,
      };
      if (meta.marketType === "spot") group.spotRoute = r;
      else group.linearRoute = r;
      byQuote.set(key, group);
    }

    return Array.from(byQuote.values());
  }

  _resolveTicker(route) {
    if (!route?.id) return null;

    const meta = parseRouteId(route.id);
    const sym = upper(meta.symbol);

    const holder = route.chunks || route.chunk || {};
    const raw = holder?.tickers?.data?.[sym];

    const prev = this.cache.get(route.id) || {};
    if (!raw) return prev.lastPrice ? prev : null;

    const merged = { ...prev, ...raw };
    this.cache.set(route.id, merged);
    return merged;
  }

  _createViewModel(group, selectedId) {
    const spotRoute = group.spotRoute;
    const linearRoute = group.linearRoute;

    const spotId = spotRoute?.id || "";
    const linId = linearRoute?.id || "";

    const spotTick = this._resolveTicker(spotRoute);
    const linTick = this._resolveTicker(linearRoute);

    const sPrice = spotTick?.lastPrice ?? spotTick?.last_price ?? null;
    const sPcnt = spotTick?.price24hPcnt != null ? Number(spotTick.price24hPcnt) : null;

    const lPrice = linTick?.lastPrice ?? linTick?.last_price ?? null;
    const lPcnt = linTick?.price24hPcnt != null ? Number(linTick.price24hPcnt) : null;

    const funding = linTick?.fundingRate;
    const oi = linTick?.openInterest;

    const uSel = upper(selectedId);
    const active = group.baseId === selectedId || spotId === selectedId || linId === selectedId || (spotId && upper(parseRouteId(spotId).symbol) === uSel) || (linId && upper(parseRouteId(linId).symbol) === uSel);

    const sNum = Number(sPrice);
    const lNum = Number(lPrice);

    return {
      key: `${group.baseId}:${group.quote}`,
      baseId: group.baseId,
      quote: group.quote,
      active,
      ids: { spot: spotId, linear: linId, base: group.baseId },

      spot: {
        symbol: spotId ? parseRouteId(spotId).symbol : "—",
        priceStr: formatPrice(sPrice),
        pcntStr: formatPct(sPcnt),
        pcntColor: getPctColor(sPcnt),
        rawPrice: Number.isFinite(sNum) ? sNum : 0,
        rawPcnt: Number.isFinite(sPcnt) ? sPcnt : 0,
      },

      linear: {
        symbol: linId ? parseRouteId(linId).symbol : "—",
        symClass: getFundingClass(funding),
        priceStr: formatPrice(lPrice),
        pcntStr: formatPct(lPcnt),
        pcntColor: getPctColor(lPcnt),
        oiStr: formatOI(oi),
        rawPrice: Number.isFinite(lNum) ? lNum : 0,
        rawPcnt: Number.isFinite(lPcnt) ? lPcnt : 0,
        rawOI: Number.isFinite(Number(oi)) ? Number(oi) : 0,
      },
    };
  }

  _applySort(list, { key, dir }) {
    const mult = dir === "asc" ? 1 : -1;

    list.sort((a, b) => {
      // if (a.quote !== b.quote) return (a.quote === "USDT" ? 0 : 1) - (b.quote === "USDT" ? 0 : 1);

      let va = 0,
        vb = 0;
      switch (key) {
        case "baseId":
          return a.baseId.localeCompare(b.baseId) * mult;
        case "spotPrice":
          va = a.spot.rawPrice;
          vb = b.spot.rawPrice;
          break;
        case "spotPcnt":
          va = a.spot.rawPcnt;
          vb = b.spot.rawPcnt;
          break;
        case "linPrice":
          va = a.linear.rawPrice;
          vb = b.linear.rawPrice;
          break;
        case "linPcnt":
          va = a.linear.rawPcnt;
          vb = b.linear.rawPcnt;
          break;
        case "linOI":
          va = a.linear.rawOI;
          vb = b.linear.rawOI;
          break;
        default:
          return 0;
      }

      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      return (va - vb) * mult;
    });
  }
}

// ВАЖНО: Алиас для совместимости (исправляет ошибку в BybitTickersGraph.js)
// export { TickerController as TradingCalculator };
