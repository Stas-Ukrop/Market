// src/components/Trades/TradesController.js

/* ==================================================================================
   LOCAL HELPERS (ISOLATED)
   Копии функций форматирования, чтобы модуль не зависел от внешних файлов.
================================================================================== */

const upper = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();

const numOr = (v, d = NaN) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const parseNum = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

const toSec = (ts) => {
  const n = Number(ts);
  if (!Number.isFinite(n)) return 0;
  return n > 2e10 ? Math.floor(n / 1000) : Math.floor(n);
};

const normalizeTime = (ts, intervalStr) => {
  const sec = toSec(ts);
  switch (intervalStr) {
    case "1m":
      return Math.floor(sec / 60) * 60;
    case "3m":
      return Math.floor(sec / 180) * 180;
    case "5m":
      return Math.floor(sec / 300) * 300;
    case "15m":
      return Math.floor(sec / 900) * 900;
    case "30m":
      return Math.floor(sec / 1800) * 1800;
    case "1h":
      return Math.floor(sec / 3600) * 3600;
    case "4h":
      return Math.floor(sec / 14400) * 14400;
    case "1d":
      return Math.floor(sec / 86400) * 86400;
    default:
      return sec;
  }
};

const sideKey = (S) => (S === "Buy" ? "buy" : S === "Sell" ? "sell" : "");

const tradeKey = (t) => {
  if (!t) return "";
  const i = t.i != null ? String(t.i) : "";
  return i || `${String(t.T ?? "")}|${String(t.p ?? "")}|${String(t.v ?? "")}|${String(t.S ?? "")}`;
};

// --- Local Formatters ---

const fmtVolume = (v) => {
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

const formatTimeShort = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

/* ==================================================================================
   CONTROLLER CLASS
================================================================================== */

export class TradesController {
  constructor() {
    this.stateBySym = new Map(); // sym -> { lastKey, flashKey }

    // UI/state живёт здесь
    this.ui = {
      rangeMin: "",
      rangeMax: "",
      targetInput: null, // 'min' | 'max' | null
      deviationPct: -20, // %
      showOnGraph: false,
    };
    this.uiRev = 0;

    // Последний результат
    this.lastOut = {
      tapeRows: [],
      analysisRows: [],
      rangeStats: null,
      markers: [],
      lastUpdateTs: 0,
    };
  }

  // --- UI API ---
  setRangeMin(v) {
    this.ui.rangeMin = String(v ?? "");
    this.uiRev++;
    return this.uiRev;
  }
  setRangeMax(v) {
    this.ui.rangeMax = String(v ?? "");
    this.uiRev++;
    return this.uiRev;
  }

  setTargetInput(v) {
    const x = v === "min" || v === "max" ? v : null;
    if (this.ui.targetInput === x) return this.uiRev;
    this.ui.targetInput = x;
    this.uiRev++;
    return this.uiRev;
  }

  setDeviationPct(v) {
    const n = Number(v);
    if (Number.isFinite(n)) this.ui.deviationPct = n;
    this.uiRev++;
    return this.uiRev;
  }

  setShowOnGraph(v) {
    this.ui.showOnGraph = !!v;
    this.uiRev++;
    return this.uiRev;
  }

  applyPriceClick(rawVal) {
    const t = this.ui.targetInput;
    if (!t) return false;
    const normalized = String(rawVal ?? "").replace(",", ".");
    if (t === "min") this.ui.rangeMin = normalized;
    else if (t === "max") this.ui.rangeMax = normalized;
    else return false;
    this.uiRev++;
    return true;
  }

  // --- Main Process ---
  process(chunk, symbol, opts = {}) {
    const sym = upper(symbol);
    const history = Array.isArray(chunk?.history) ? chunk.history : [];

    const interval = String(opts.interval ?? "5m");
    const analysisLimit = Number(opts.analysisLimit) || 2000;
    const tapeLimit = Number(opts.tapeLimit) || 50;

    // UI overrides (priority: opts -> internal state)
    const rangeMinRaw = opts.rangeMin ?? this.ui.rangeMin;
    const rangeMaxRaw = opts.rangeMax ?? this.ui.rangeMax;
    const deviationPct = opts.deviationPct ?? this.ui.deviationPct;
    const showGraph = opts.showGraph ?? this.ui.showOnGraph;

    // Flash key logic
    const last = history.length ? history[history.length - 1] : null;
    const lastP = last?.p != null ? String(last.p) : "";
    const lastSide = sideKey(last?.S);
    const lastK = tradeKey(last);

    const st = this.stateBySym.get(sym) || { lastKey: "", flashKey: "" };
    st.flashKey = lastK && lastK !== st.lastKey ? lastK : "";
    st.lastKey = lastK || st.lastKey;
    this.stateBySym.set(sym, st);

    // Build Lists
    const { analysisRows, validHistory } = this._buildAnalysis(history, analysisLimit, lastP, lastSide);
    const tapeRows = this._buildTape(history, tapeLimit, st.flashKey);

    // Stats & Markers
    const min = parseNum(rangeMinRaw);
    const max = parseNum(rangeMaxRaw);
    const hasRange = Number.isFinite(min) && Number.isFinite(max) && min <= max;

    const rangeStats = hasRange ? this._calculateStats(analysisRows, min, max) : null;

    const markers = showGraph && hasRange && rangeStats && validHistory.length ? this._generateRangeMarkers(validHistory, rangeStats, deviationPct, interval) : [];

    this.lastOut = {
      tapeRows,
      analysisRows,
      rangeStats,
      markers,
      lastUpdateTs: chunk?.lastUpdateTs || 0,
    };

    return this.lastOut;
  }

  /**
   * [NEW] Метод поиска крупных сделок для графика.
   * Перенесен из indexApp.js для изоляции логики.
   */
  findBigTrades(chunk, minMultiplier = 10.0) {
    if (!chunk || !Array.isArray(chunk.history) || chunk.history.length === 0) return [];

    // Берем последние 200 сделок
    const history = chunk.history.slice(-200);

    let totalVol = 0;
    let count = 0;
    const trades = [];

    for (const t of history) {
      const v = parseFloat(t.v);
      if (v > 0) {
        totalVol += v;
        count++;
        trades.push({
          time: t.T,
          price: parseFloat(t.p),
          size: v,
          side: t.S,
        });
      }
    }

    if (count < 10) return [];
    const avgVol = totalVol / count;
    const threshold = avgVol * minMultiplier;

    return trades
      .filter((t) => t.size >= threshold)
      .map((t) => ({
        time: Math.floor(toSec(t.time)),
        price: t.price,
        position: t.side === "Buy" ? "belowBar" : "aboveBar",
        color: t.side === "Buy" ? "#00bfa5" : "#ff5252",
        shape: t.side === "Buy" ? "arrowUp" : "arrowDown",
        text: fmtVolume(t.size),
      }));
  }

  // --- Internal Builders ---

  _buildAnalysis(history, limit, lastPriceStr, lastSide) {
    if (!history.length) return { analysisRows: [], validHistory: [] };

    const start = Math.max(0, history.length - limit);
    const sliced = history.slice(start);
    const map = new Map();
    const validHistory = [];

    for (const t of sliced) {
      const p = t?.p != null ? String(t.p) : "";
      if (!p) continue;

      const vol = numOr(t?.v, NaN);
      if (!Number.isFinite(vol) || vol <= 0) continue;

      validHistory.push(t);

      const cur = map.get(p) || { price: p, buyVol: 0, sellVol: 0 };
      if (t?.S === "Buy") cur.buyVol += vol;
      else if (t?.S === "Sell") cur.sellVol += vol;
      map.set(p, cur);
    }

    const rows = Array.from(map.values());
    rows.sort((a, b) => {
      const ap = parseFloat(a.price);
      const bp = parseFloat(b.price);
      if (!Number.isNaN(ap) && !Number.isNaN(bp)) return bp - ap;
      return String(b.price).localeCompare(String(a.price));
    });

    // Formatting happens HERE in controller
    const formattedRows = rows.map((r) => {
      const delta = r.buyVol - r.sellVol;
      const deltaClass = delta > 0 ? "pt-green" : delta < 0 ? "pt-red" : "pt-muted";

      let lastClass = "";
      if (lastPriceStr && r.price === lastPriceStr) {
        lastClass = lastSide === "buy" ? "pt-last-buy" : lastSide === "sell" ? "pt-last-sell" : "pt-last";
      }

      return {
        key: r.price,
        priceStr: r.price,
        buyStr: fmtVolume(r.buyVol),
        sellStr: fmtVolume(r.sellVol),
        deltaStr: fmtVolume(delta),
        deltaClass,
        lastClass,
        // Raw data needed for calculations
        rawPrice: parseFloat(r.price),
        rawBuy: r.buyVol,
        rawSell: r.sellVol,
      };
    });

    return { analysisRows: formattedRows, validHistory };
  }

  _buildTape(history, limit, flashKey) {
    const n = history.length;
    if (!n) return [];

    const L = Math.max(0, Number(limit) || 0);
    const outN = Math.min(L, n);
    const out = new Array(outN);

    for (let k = 0; k < outN; k++) {
      const t = history[n - 1 - k];
      const s = sideKey(t?.S);
      const key = tradeKey(t) || `${n - 1 - k}`;

      out[k] = {
        key,
        priceStr: t?.p != null ? String(t.p) : "—",
        volStr: fmtVolume(t?.v),
        timeStr: formatTimeShort(t?.T),
        sideClass: s === "buy" ? "pt-buy" : s === "sell" ? "pt-sell" : "",
        flashClass: flashKey && key === flashKey ? (s === "buy" ? "pt-flash-buy" : "pt-flash-sell") : "",
      };
    }
    return out;
  }

  _calculateStats(rows, min, max) {
    let sumBuy = 0,
      sumSell = 0,
      count = 0;
    for (const r of rows) {
      const p = r.rawPrice;
      if (p >= min && p <= max) {
        sumBuy += r.rawBuy;
        sumSell += r.rawSell;
        count++;
      }
    }
    if (!count) return null;

    // Return formatted strings directly
    return {
      sumBuy,
      sumSell,
      avgBuy: sumBuy / count,
      avgSell: sumSell / count,
      totalDelta: sumBuy - sumSell,
      min,
      max,
      // Pre-formatted strings for View
      avgBuyStr: fmtVolume(sumBuy / count),
      avgSellStr: fmtVolume(sumSell / count),
      sumBuyStr: fmtVolume(sumBuy),
      sumSellStr: fmtVolume(sumSell),
    };
  }

  _generateRangeMarkers(history, stats, deviationPct, interval) {
    const factor = 1 + deviationPct / 100;
    const threshBuy = stats.avgBuy * factor;
    const threshSell = stats.avgSell * factor;
    const aggMap = new Map();

    for (const t of history) {
      const price = parseFloat(t?.p);
      if (price < stats.min || price > stats.max) continue;

      const time = normalizeTime(t?.T, interval);
      const size = parseFloat(t?.v);
      if (!Number.isFinite(size) || size <= 0) continue;

      const rec = aggMap.get(time) || { buyVol: 0, sellVol: 0, lastPrice: price };
      if (t?.S === "Buy") rec.buyVol += size;
      else rec.sellVol += size;
      rec.lastPrice = price;
      aggMap.set(time, rec);
    }

    const markers = [];
    for (const [time, v] of aggMap.entries()) {
      if (v.buyVol >= threshBuy) {
        markers.push({
          time,
          position: "belowBar",
          color: "#004d40",
          shape: "arrowUp",
          text: `ΣB:${fmtVolume(v.buyVol)}`,
          price: v.lastPrice,
        });
      }
      if (v.sellVol >= threshSell) {
        markers.push({
          time,
          position: "aboveBar",
          color: "#b71c1c",
          shape: "arrowDown",
          text: `ΣS:${fmtVolume(v.sellVol)}`,
          price: v.lastPrice,
        });
      }
    }
    markers.sort((a, b) => a.time - b.time);
    return markers;
  }
}
