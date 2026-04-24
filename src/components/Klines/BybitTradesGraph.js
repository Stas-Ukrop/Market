// src/components/Klines/BybitTradesGraph.js
import React, { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import * as LWC from "lightweight-charts";
import { soundManager } from "../hooks/SoundEngine.js";
import { TradingCalculator } from "../hooks/TradingCalculator.js";
import styles from "./BybitTradesGraph.module.css";

/* ===========================
   Helpers
=========================== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const toUnixSec = (v) => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 2e10 ? Math.floor(n / 1000) : Math.floor(n);
};

const decimalsFromStr = (s) => {
  const t = String(s ?? "");
  if (t.includes("e") || t.includes("E")) return 0;
  const i = t.indexOf(".");
  return i >= 0 ? t.length - i - 1 : 0;
};

const guessPrecisionFromBars = (bars) => {
  if (!bars || bars.length === 0) return 2;
  let maxDec = 0;
  const limit = Math.min(bars.length, 50);
  for (let i = bars.length - limit; i < bars.length; i++) {
    const b = bars[i];
    if (!b) continue;
    maxDec = Math.max(maxDec, decimalsFromStr(b.open), decimalsFromStr(b.high), decimalsFromStr(b.low), decimalsFromStr(b.close));
  }
  return clamp(maxDec, 0, 10);
};

const trimZeros = (s) =>
  String(s)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");

const fmtPrice = (x, precision) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  const p = clamp(Number(precision) || 0, 0, 10);
  return trimZeros(n.toFixed(p));
};

const fmtRulerVol = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "0";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e9) return sign + trimZeros((a / 1e9).toFixed(2)) + "B";
  if (a >= 1e6) return sign + trimZeros((a / 1e6).toFixed(2)) + "M";
  if (a >= 1e3) return sign + trimZeros((a / 1e3).toFixed(1)) + "K";
  if (a >= 1) return sign + trimZeros(a.toFixed(2));
  return sign + trimZeros(a.toFixed(6));
};

const normalizeTime = (tsMs, intervalStr) => {
  const sec = Math.floor(Number(tsMs) / 1000);
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

/* ===========================
   Constants
=========================== */
const INTERVALS = [
  { label: "1m", ui: "1m" },
  { label: "3m", ui: "3m" },
  { label: "5m", ui: "5m" },
  { label: "15m", ui: "15m" },
  { label: "1h", ui: "1h" },
  { label: "4h", ui: "4h" },
  { label: "1d", ui: "1d" },
];

const LIMITS = [50, 100, 200, 500, 1000];

const TOP_N_OPTIONS = [
  { label: "All", val: Infinity },
  { label: "1", val: 1 },
  { label: "3", val: 3 },
  { label: "5", val: 5 },
  { label: "10", val: 10 },
];

// [NEW] Added "Calc" entry for toggling calculator lines
const FILTER_CONFIG = [
  { color: "#00bfa5", label: "Bid", title: "Bids" },
  { color: "#ff5252", label: "Ask", title: "Asks" },
  { color: "#2962ff", label: "Hold B", title: "Buy Wall" },
  { color: "#000000", label: "Hold A", title: "Sell Wall" },
  { color: "#00bcd4", label: "Iceberg", title: "Iceberg" },
  { color: "#9c27b0", label: "Spoof", title: "Spoofing" },
  { color: "#ea80fc", label: "Ghost", title: "History" },
  { color: "#ff9800", label: "VWAP", title: "VWAP" },
  { color: "#7b1fa2", label: "CVD", title: "CVD" },
  { color: "#7e57c2", label: "Calc", title: "Calc Lines" },
];

/* ===========================
   Data hooks/helpers
=========================== */
function useChunkCandles(chunk) {
  const history = chunk?.history ?? chunk?.data?.history ?? chunk?.bars ?? [];
  const srcTs = Number(chunk?.lastUpdateTs) || 0;

  return useMemo(() => {
    if (!Array.isArray(history) || history.length === 0) return [];

    const barMap = new Map();

    for (let i = 0; i < history.length; i++) {
      const bar = history[i];
      if (!bar) continue;

      const t = toUnixSec(bar.ts ?? bar.t ?? bar.time ?? bar.start ?? bar.startTime);
      if (!t) continue;

      const c = parseFloat(bar.c ?? bar.close ?? bar.C);
      if (!Number.isFinite(c)) continue;

      barMap.set(t, {
        time: t,
        open: parseFloat(bar.o ?? bar.open ?? bar.O) || c,
        high: parseFloat(bar.h ?? bar.high ?? bar.H) || c,
        low: parseFloat(bar.l ?? bar.low ?? bar.L) || c,
        close: c,
        volume: parseFloat(bar.v ?? bar.volume ?? bar.V) || 0,
      });
    }

    return Array.from(barMap.values()).sort((a, b) => a.time - b.time);
  }, [history, srcTs]);
}

const volColor = (c) => (c.close >= c.open ? "rgba(38, 166, 154, 0.5)" : "rgba(239, 83, 80, 0.5)");

const filterTopN = (items, n) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const nn = Number(n);
  if (!Number.isFinite(nn) || nn === Infinity) return items;

  const sizeOf = (x) => Number(x?.size ?? x?.qty ?? x?.value ?? 0) || 0;
  const bids = items.filter((i) => /bid|buy/i.test(i?.side)).sort((a, b) => sizeOf(b) - sizeOf(a));
  const asks = items.filter((i) => /ask|sell/i.test(i?.side)).sort((a, b) => sizeOf(b) - sizeOf(a));
  const rest = items.filter((i) => !/bid|buy|ask|sell/i.test(i?.side));
  return [...bids.slice(0, nn), ...asks.slice(0, nn), ...rest.slice(0, nn)];
};

function useCVDData(candles, tradesChunk, interval) {
  return useMemo(() => {
    if (!candles.length) return [];
    const trades = tradesChunk?.history || [];
    if (!trades.length) return [];

    const deltaMap = new Map();
    for (const t of trades) {
      const time = normalizeTime(t?.T ?? t?.ts ?? t?.time, interval);
      const size = parseFloat(t?.v ?? t?.qty ?? t?.size);
      if (!Number.isFinite(size)) continue;
      const isBuy = (t?.S ?? t?.side) === "Buy";
      deltaMap.set(time, (deltaMap.get(time) || 0) + (isBuy ? size : -size));
    }

    let cumulative = 0;
    const res = [];
    for (const c of candles) {
      cumulative += deltaMap.get(c.time) || 0;
      res.push({ time: c.time, value: cumulative });
    }
    return res;
  }, [candles, tradesChunk, interval]);
}

const calculateAnchoredVWAP = (candles, anchorTime) => {
  if (!anchorTime || !candles.length) return [];
  const res = [];
  let cumPV = 0,
    cumV = 0,
    started = false;
  for (const c of candles) {
    if (!started) {
      if (c.time >= anchorTime) started = true;
      else continue;
    }
    const hlc3 = (c.high + c.low + c.close) / 3;
    cumPV += hlc3 * c.volume;
    cumV += c.volume;
    if (cumV > 0) res.push({ time: c.time, value: cumPV / cumV });
  }
  return res;
};

const safePlay = (key) => {
  try {
    soundManager?.play?.(key);
  } catch (_) {}
};
const isBuyColor = (c) => c === "#00bfa5" || c === "#2962ff";
const isSellColor = (c) => c === "#ff5252" || c === "#000000";

/* ===========================
   ChartWithVolume
=========================== */
const ChartWithVolume = memo(function ChartWithVolume({ symbol, category, candlesInput, tradesChunk, feedStatus, interval, setInterval, limit, setLimit, analysisLines = [], tradeMarkers = [], rangeMarkers = [], currentTickerPrice, fundingRate, rightInsetPx = 0 }) {
  const containerRef = useRef(null);
  const mainElRef = useRef(null);
  const volElRef = useRef(null);

  const mainChartRef = useRef(null);
  const volChartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const vwapSeriesRef = useRef(null);
  const cvdSeriesRef = useRef(null);
  const markersApiRef = useRef(null);

  const aliveRef = useRef(false);
  const syncingRangeRef = useRef(false);
  const syncingCrosshairRef = useRef(false);

  const closeByTimeRef = useRef(new Map());
  const volByTimeRef = useRef(new Map());
  const lastCloseRef = useRef(null);
  const lastVolRef = useRef(null);

  const linesRef = useRef([]);
  const rangeLinesRef = useRef([]);

  const [hover, setHover] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showRangeLines, setShowRangeLines] = useState(false);
  const [anchorTime, setAnchorTime] = useState(null);
  const [isSelectingAnchor, setIsSelectingAnchor] = useState(false);
  const isSelectingAnchorRef = useRef(false);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [topN, setTopN] = useState(Infinity);
  const [ruler, setRuler] = useState(null);

  // --- LOCAL CALCULATOR STATE ---
  const [calcSnapshot, setCalcSnapshot] = useState(null);
  const [calcLines, setCalcLines] = useState([]); // Lines from calculator
  const currentRightInset = calcSnapshot ? 300 : rightInsetPx;

  // [FIX] Fallback to last candle close if ticker price is missing (0 or null)
  const lastCandleClose = useMemo(() => {
    if (!candlesInput || candlesInput.length === 0) return 0;
    return candlesInput[candlesInput.length - 1].close || 0;
  }, [candlesInput]);

  const effectivePrice = currentTickerPrice > 0 ? currentTickerPrice : lastCandleClose;

  const liveDataRef = useRef({ price: 0, funding: 0 });
  liveDataRef.current = { price: effectivePrice, funding: fundingRate };

  const handleToggleCalc = useCallback(() => {
    setCalcSnapshot((prev) => {
      if (prev) return null;
      return { ...liveDataRef.current };
    });
  }, []);

  const handleApplyCalcToGraph = useCallback((lines) => {
    setCalcLines(lines);
  }, []);
  // ------------------------------

  const [lineSettings, setLineSettings] = useState(() => {
    const m = {};
    FILTER_CONFIG.forEach((c) => {
      m[c.color] = { visible: true, width: c.label.includes("Hold") ? 2 : 1, soundEnabled: true };
    });
    return m;
  });

  const lastSoundAtRef = useRef(0);
  const prevWallKeysRef = useRef(new Set());
  const prevMarkerKeyRef = useRef("");
  const didFitRef = useRef(false);
  const priceFmtRef = useRef({ precision: 2, minMove: 0.01 });

  const cvdData = useCVDData(candlesInput, tradesChunk, interval);

  useEffect(() => {
    isSelectingAnchorRef.current = isSelectingAnchor;
  }, [isSelectingAnchor]);
  const canBeep = useCallback(() => {
    const now = Date.now();
    if (now - lastSoundAtRef.current < 150) return false;
    lastSoundAtRef.current = now;
    return true;
  }, []);
  const toggleVisibility = (c) => setLineSettings((p) => ({ ...p, [c]: { ...p[c], visible: !p[c].visible } }));
  const safeSetHover = useCallback((val) => setHover(val), []);

  useEffect(() => {
    didFitRef.current = false;
    prevWallKeysRef.current = new Set();
    prevMarkerKeyRef.current = "";
    setAnchorTime(null);
    setIsSelectingAnchor(false);
    setHover(null);
    setRuler(null);
    setCalcSnapshot(null);
    setCalcLines([]); // Reset calc lines on symbol change
  }, [symbol, category]);

  /* ===========================
     Ruler (Shift + drag)
  =========================== */
  const handleMouseDown = useCallback((e) => {
    if (!e.shiftKey || e.button !== 0) return;
    if (!aliveRef.current || !mainChartRef.current || !candleSeriesRef.current || !mainElRef.current) return;
    const rect = mainElRef.current.getBoundingClientRect();
    e.preventDefault();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const time = mainChartRef.current.timeScale().coordinateToTime(x);
    const price = candleSeriesRef.current.coordinateToPrice(y);
    if (time != null && price != null && Number.isFinite(price)) {
      setRuler({ active: true, x1: x, y1: y, x2: x, y2: y, p1: price, p2: price, t1: time, t2: time });
    }
  }, []);

  const handleMouseMove = useCallback(
    (e) => {
      if (!ruler?.active) return;
      if (!aliveRef.current || !mainChartRef.current || !candleSeriesRef.current || !mainElRef.current) return;
      const rect = mainElRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const time = mainChartRef.current.timeScale().coordinateToTime(x);
      const price = candleSeriesRef.current.coordinateToPrice(y);
      if (time != null && price != null && Number.isFinite(price)) {
        setRuler((prev) => (prev ? { ...prev, x2: x, y2: y, p2: price, t2: time } : prev));
      }
    },
    [ruler]
  );

  const handleMouseUp = useCallback(() => {
    if (ruler?.active) setRuler((p) => (p ? { ...p, active: false } : p));
  }, [ruler]);

  useEffect(() => {
    const onDown = (e) => {
      if (e.shiftKey) return;
      setRuler((p) => (p && !p.active ? null : p));
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  /* ===========================
     INIT (create charts + subscriptions)
  =========================== */
  useEffect(() => {
    if (isCollapsed) return;
    if (!containerRef.current || !mainElRef.current || !volElRef.current) return;

    try {
      mainChartRef.current?.remove?.();
    } catch (_) {}
    try {
      volChartRef.current?.remove?.();
    } catch (_) {}

    mainChartRef.current = null;
    volChartRef.current = null;
    candleSeriesRef.current = null;
    volumeSeriesRef.current = null;
    vwapSeriesRef.current = null;
    cvdSeriesRef.current = null;
    markersApiRef.current = null;
    aliveRef.current = false;

    const mainEl = mainElRef.current;
    const volEl = volElRef.current;
    const commonOptions = {
      layout: { background: { color: "#ffffff" }, textColor: "#333", fontSize: 11, fontFamily: "sans-serif" },
      grid: { vertLines: { color: "#f0f0f0" }, horzLines: { color: "#f0f0f0" } },
      crosshair: { mode: 1 },
      timeScale: { borderColor: "#e0e0e0", rightOffset: 10, barSpacing: 8, timeVisible: true },
      rightPriceScale: { visible: true, borderColor: "#e0e0e0", minimumWidth: 60 },
    };

    const mainChart = LWC.createChart(mainEl, {
      ...commonOptions,
      width: mainEl.clientWidth,
      height: mainEl.clientHeight,
    });
    const candleSeries = mainChart.addSeries(LWC.CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
    const vwapSeries = mainChart.addSeries(LWC.LineSeries, {
      color: "#ff9800",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const volChart = LWC.createChart(volEl, {
      ...commonOptions,
      width: volEl.clientWidth,
      height: volEl.clientHeight,
      timeScale: { ...commonOptions.timeScale, visible: false },
    });
    const volumeSeries = volChart.addSeries(LWC.HistogramSeries, {
      priceFormat: { type: "custom", minMove: 1, formatter: fmtRulerVol },
      priceScaleId: "right",
      lastValueVisible: true,
    });
    volChart.applyOptions({
      leftPriceScale: { visible: false, borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
    });
    const cvdSeries = volChart.addSeries(LWC.BaselineSeries, {
      priceScaleId: "left",
      baseValue: { type: "price", price: 0 },
      topLineColor: "#26a69a",
      bottomLineColor: "#ef5350",
      topFillColor1: "rgba(38, 166, 154, 0.28)",
      topFillColor2: "rgba(38, 166, 154, 0.05)",
      bottomFillColor1: "rgba(239, 83, 80, 0.05)",
      bottomFillColor2: "rgba(239, 83, 80, 0.28)",
      lineWidth: 2,
      lastValueVisible: true,
    });

    let markersApi = null;
    try {
      if (typeof candleSeries.setMarkers === "function") markersApi = { set: (arr) => candleSeries.setMarkers(arr) };
    } catch (_) {}

    mainChartRef.current = mainChart;
    volChartRef.current = volChart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    vwapSeriesRef.current = vwapSeries;
    cvdSeriesRef.current = cvdSeries;
    markersApiRef.current = markersApi;
    aliveRef.current = true;

    const mainTS = mainChart.timeScale();
    const volTS = volChart.timeScale();
    const onMainRange = (r) => {
      if (!aliveRef.current || syncingRangeRef.current) return;
      syncingRangeRef.current = true;
      try {
        r && volTS.setVisibleLogicalRange(r);
      } catch (_) {}
      syncingRangeRef.current = false;
    };
    const onVolRange = (r) => {
      if (!aliveRef.current || syncingRangeRef.current) return;
      syncingRangeRef.current = true;
      try {
        r && mainTS.setVisibleLogicalRange(r);
      } catch (_) {}
      syncingRangeRef.current = false;
    };
    mainTS.subscribeVisibleLogicalRangeChange(onMainRange);
    volTS.subscribeVisibleLogicalRangeChange(onVolRange);

    const onMainCrosshair = (p) => {
      if (!aliveRef.current || syncingCrosshairRef.current) return;
      if (!p || p.time == null || !p.point || p.point.x < 0) {
        syncingCrosshairRef.current = true;
        try {
          volChart.clearCrosshairPosition();
        } catch (_) {}
        syncingCrosshairRef.current = false;
        safeSetHover(null);
        return;
      }
      const src = p.seriesData?.get?.(candleSeries);
      if (src) safeSetHover({ ...src, time: p.time });
      const v = volByTimeRef.current.get(p.time);
      const vv = Number.isFinite(v) ? v : lastVolRef.current;
      if (Number.isFinite(vv)) {
        syncingCrosshairRef.current = true;
        try {
          volChart.setCrosshairPosition(vv, p.time, volumeSeries);
        } catch (_) {}
        syncingCrosshairRef.current = false;
      }
    };
    const onVolCrosshair = (p) => {
      if (!aliveRef.current || syncingCrosshairRef.current) return;
      if (!p || p.time == null || !p.point || p.point.x < 0) {
        syncingCrosshairRef.current = true;
        try {
          mainChart.clearCrosshairPosition();
        } catch (_) {}
        syncingCrosshairRef.current = false;
        return;
      }
      const c = closeByTimeRef.current.get(p.time);
      const cc = Number.isFinite(c) ? c : lastCloseRef.current;
      if (Number.isFinite(cc)) {
        syncingCrosshairRef.current = true;
        try {
          mainChart.setCrosshairPosition(cc, p.time, candleSeries);
        } catch (_) {}
        syncingCrosshairRef.current = false;
      }
    };
    mainChart.subscribeCrosshairMove(onMainCrosshair);
    volChart.subscribeCrosshairMove(onVolCrosshair);

    const onClick = (p) => {
      if (aliveRef.current && isSelectingAnchorRef.current && p?.time != null) {
        setAnchorTime(p.time);
        setIsSelectingAnchor(false);
      }
    };
    mainChart.subscribeClick(onClick);

    const ro = new ResizeObserver(() => {
      if (!aliveRef.current) return;
      try {
        const rMain = mainEl.getBoundingClientRect();
        const rVol = volEl.getBoundingClientRect();
        if (rMain.width > 0 && rMain.height > 0) mainChart.applyOptions({ width: rMain.width, height: rMain.height });
        if (rVol.width > 0 && rVol.height > 0) volChart.applyOptions({ width: rVol.width, height: rVol.height });
      } catch (_) {}
    });
    ro.observe(containerRef.current);

    return () => {
      aliveRef.current = false;
      try {
        ro.disconnect();
      } catch (_) {}
      try {
        mainTS.unsubscribeVisibleLogicalRangeChange(onMainRange);
      } catch (_) {}
      try {
        volTS.unsubscribeVisibleLogicalRangeChange(onVolRange);
      } catch (_) {}
      try {
        mainChart.unsubscribeCrosshairMove(onMainCrosshair);
      } catch (_) {}
      try {
        volChart.unsubscribeCrosshairMove(onVolCrosshair);
      } catch (_) {}
      try {
        mainChart.unsubscribeClick(onClick);
      } catch (_) {}
      try {
        mainChart.remove();
      } catch (_) {}
      try {
        volChart.remove();
      } catch (_) {}
      mainChartRef.current = null;
      volChartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      vwapSeriesRef.current = null;
      cvdSeriesRef.current = null;
      markersApiRef.current = null;
      linesRef.current = [];
      rangeLinesRef.current = [];
      syncingRangeRef.current = false;
      syncingCrosshairRef.current = false;
    };
  }, [isCollapsed, safeSetHover]);

  /* ===========================
     UPDATE data
  =========================== */
  useEffect(() => {
    if (!aliveRef.current) return;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const mainChart = mainChartRef.current;
    if (!candleSeries || !volumeSeries || !mainChart) return;

    const view = Array.isArray(candlesInput) ? candlesInput : [];
    const sliced = limit ? view.slice(-Number(limit)) : view;
    const cleanCandles = sliced.filter((c) => c && c.time && Number.isFinite(c.close));
    if (!cleanCandles.length) return;

    const closeMap = new Map();
    const volMap = new Map();
    for (const c of cleanCandles) {
      closeMap.set(c.time, c.close);
      volMap.set(c.time, Number.isFinite(c.volume) ? c.volume : 0);
    }
    closeByTimeRef.current = closeMap;
    volByTimeRef.current = volMap;
    lastCloseRef.current = cleanCandles[cleanCandles.length - 1]?.close ?? lastCloseRef.current;
    lastVolRef.current = Number.isFinite(cleanCandles[cleanCandles.length - 1]?.volume) ? cleanCandles[cleanCandles.length - 1]?.volume : 0;

    const prec = guessPrecisionFromBars(cleanCandles);
    priceFmtRef.current = { precision: prec, minMove: 1 / 10 ** prec };
    const cleanVols = cleanCandles.map((c) => ({
      time: c.time,
      value: Number.isFinite(c.volume) ? c.volume : 0,
      color: volColor(c),
    }));

    try {
      candleSeries.applyOptions({
        priceFormat: { type: "price", precision: prec, minMove: priceFmtRef.current.minMove },
      });
      candleSeries.setData(cleanCandles);
      volumeSeries.setData(cleanVols);
      if (!didFitRef.current) {
        didFitRef.current = true;
        mainChart.timeScale().fitContent();
      }
    } catch (_) {}
  }, [candlesInput, limit, isCollapsed]);

  /* ===========================
     UPDATE indicators & lines
  =========================== */
  useEffect(() => {
    if (!aliveRef.current || !cvdSeriesRef.current) return;
    const s = cvdSeriesRef.current;
    const set = lineSettings["#7b1fa2"];
    const valid = Array.isArray(cvdData) ? cvdData.filter((d) => d && d.time != null && Number.isFinite(d.value)) : [];
    if (!set?.visible || !valid.length) {
      try {
        s.setData([]);
      } catch (_) {}
      return;
    }
    try {
      s.applyOptions({ visible: true, lineWidth: set.width });
      s.setData(valid);
    } catch (_) {}
  }, [cvdData, lineSettings, isCollapsed]);
  useEffect(() => {
    if (!aliveRef.current || !vwapSeriesRef.current) return;
    const s = vwapSeriesRef.current;
    const set = lineSettings["#ff9800"];
    if (!anchorTime || !set?.visible) {
      try {
        s.setData([]);
      } catch (_) {}
      return;
    }
    const view = Array.isArray(candlesInput) ? candlesInput : [];
    const sliced = limit ? view.slice(-Number(limit)) : view;
    const vwap = calculateAnchoredVWAP(sliced, anchorTime);
    const valid = vwap.filter((d) => d && d.time != null && Number.isFinite(d.value));
    try {
      s.applyOptions({ visible: true, lineWidth: set.width });
      s.setData(valid);
    } catch (_) {}
  }, [candlesInput, limit, anchorTime, lineSettings, isCollapsed]);

  useEffect(() => {
    if (!aliveRef.current || !candleSeriesRef.current) return;
    const series = candleSeriesRef.current;

    linesRef.current.forEach((l) => {
      try {
        series.removePriceLine(l);
      } catch (_) {}
    });
    rangeLinesRef.current.forEach((l) => {
      try {
        series.removePriceLine(l);
      } catch (_) {}
    });
    linesRef.current = [];
    rangeLinesRef.current = [];

    // 1. Orderbook Walls
    const validLines = Array.isArray(analysisLines) ? analysisLines.filter((l) => l && Number.isFinite(parseFloat(l.price))) : [];
    const wallLines = filterTopN(validLines, topN);
    const currKeys = new Set();
    wallLines.forEach((l) => {
      const color = l.color || (l.side === "bid" ? "#00bfa5" : "#ff5252");
      const conf = lineSettings[color];
      if (conf && conf.visible === false) return;
      try {
        const pl = series.createPriceLine({
          price: parseFloat(l.price),
          color,
          lineWidth: conf?.width || 1,
          lineStyle: l.lineStyle || 0,
          axisLabelVisible: true,
          title: l.title || "WALL",
        });
        linesRef.current.push(pl);
        const key = `${l.price}_${color}`;
        currKeys.add(key);
        if (!isMuted && conf?.soundEnabled && !prevWallKeysRef.current.has(key) && canBeep()) safePlay("wall");
      } catch (_) {}
    });
    prevWallKeysRef.current = currKeys;

    // 2. Calculator Lines [NEW]
    // Use the "Calc" key color (#7e57c2) to check visibility
    if (lineSettings["#7e57c2"]?.visible && calcLines.length > 0) {
      calcLines.forEach((l) => {
        try {
          const pl = series.createPriceLine({
            price: parseFloat(l.price),
            color: l.color,
            lineWidth: l.lineWidth,
            lineStyle: l.lineStyle,
            axisLabelVisible: true,
            title: l.title,
          });
          linesRef.current.push(pl);
        } catch (_) {}
      });
    }

    // 3. Range Markers
    if (showRangeLines) {
      const validRange = Array.isArray(rangeMarkers) ? rangeMarkers.filter((m) => m && Number.isFinite(parseFloat(m.price))) : [];
      const rLines = filterTopN(validRange, topN);
      rLines.forEach((m) => {
        try {
          rangeLinesRef.current.push(
            series.createPriceLine({
              price: parseFloat(m.price),
              color: m.color,
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: false,
              title: m.text,
            })
          );
        } catch (_) {}
      });
    }

    // 4. Trade Markers
    const allM = [...(tradeMarkers || []), ...(rangeMarkers || [])].sort((a, b) => (a.time || 0) - (b.time || 0)).filter((m) => m && m.time && lineSettings[m.color]?.visible !== false);
    const finalM = filterTopN(allM, topN);
    if (markersApiRef.current) {
      try {
        markersApiRef.current.set(finalM);
      } catch (_) {}
    }
    if (!isMuted && finalM.length) {
      const last = finalM[finalM.length - 1];
      const key = `${last.time}_${last.color}`;
      if (key !== prevMarkerKeyRef.current && lineSettings[last.color]?.soundEnabled && canBeep()) {
        prevMarkerKeyRef.current = key;
        safePlay(isBuyColor(last.color) ? "buy" : isSellColor(last.color) ? "sell" : "marker");
      }
    }
  }, [analysisLines, tradeMarkers, rangeMarkers, showRangeLines, lineSettings, topN, isMuted, canBeep, isCollapsed, calcLines]);

  /* ===========================
     Render
  =========================== */
  const dotColor = feedStatus === "live" ? "#26a69a" : "#ffa726";
  const p = priceFmtRef.current.precision;

  let rulerStats = null;
  if (ruler && ruler.active && Number.isFinite(ruler.p1) && Number.isFinite(ruler.p2)) {
    const diff = ruler.p2 - ruler.p1;
    const pct = (diff / ruler.p1) * 100;
    const t1 = Number(ruler.t1);
    const t2 = Number(ruler.t2);
    const tMin = Math.min(t1, t2);
    const tMax = Math.max(t1, t2);
    let vol = 0;
    const view = Array.isArray(candlesInput) ? candlesInput : [];
    const sliced = limit ? view.slice(-Number(limit)) : view;
    for (const c of sliced) if (c && c.time >= tMin && c.time <= tMax) vol += Number(c.volume) || 0;
    rulerStats = { pct, time: Math.abs(t2 - t1), vol };
  }
  const rulerBoxStyle = ruler
    ? {
        position: "absolute",
        pointerEvents: "none",
        left: Math.min(ruler.x1, ruler.x2),
        top: Math.min(ruler.y1, ruler.y2),
        width: Math.abs(ruler.x2 - ruler.x1),
        height: Math.abs(ruler.y2 - ruler.y1),
        border: "1px solid #2962ff",
        backgroundColor: "rgba(41, 98, 255, 0.1)",
        zIndex: 10,
      }
    : null;

  return (
    <div className={styles.card} style={{ flex: isCollapsed ? "0 0 auto" : 1, minHeight: isCollapsed ? "auto" : 0 }}>
      <div className={styles.header}>
        <div className={styles.info}>
          <span className={styles.dot} style={{ background: dotColor }} />
          <b style={{ color: category === "spot" ? "#2196f3" : "#ab47bc", fontSize: 13 }}>{category.toUpperCase()}</b>
          <span className={styles.symbol}>{symbol}</span>
          <button className={styles.btn} onClick={handleToggleCalc} style={{ background: "#f0f0f0", fontWeight: "bold", marginLeft: 8 }} title="Open Calculator">
            🧮
          </button>
          <button className={styles.btn} onClick={() => setIsCollapsed(!isCollapsed)} style={{ marginLeft: 8, width: 24 }}>
            {isCollapsed ? "+" : "−"}
          </button>
          {!isCollapsed && (
            <>
              <button
                onClick={() => {
                  setIsSelectingAnchor((v) => !v);
                  if (anchorTime) setAnchorTime(null);
                }}
                className={styles.btn}
                style={{
                  marginLeft: 10,
                  border: isSelectingAnchor ? "1px solid #ff9800" : "none",
                  color: anchorTime ? "#ef6c00" : "#555",
                }}
              >
                ⚓ {anchorTime ? "ON" : "VWAP"}
              </button>
              <button onClick={() => setIsMuted(!isMuted)} className={styles.btn} style={{ marginLeft: 6 }}>
                {isMuted ? "🔇" : "🔊"}
              </button>
              <button onClick={() => setShowFilters(!showFilters)} className={styles.btn} style={{ marginLeft: 4, border: "1px solid #ddd" }}>
                ⚙
              </button>
              {showFilters && (
                <div className={styles.filterRow}>
                  {FILTER_CONFIG.map((c) => (
                    <div key={c.color} className={styles.filterGroup}>
                      <button
                        onClick={() => toggleVisibility(c.color)}
                        className={styles.filterBtn}
                        style={{
                          borderColor: c.color,
                          background: lineSettings[c.color]?.visible ? c.color : "#eee",
                          color: lineSettings[c.color]?.visible ? "#fff" : "#999",
                        }}
                      >
                        {c.title}
                      </button>
                    </div>
                  ))}
                  <div style={{ width: 1, height: 14, background: "#ddd", margin: "0 4px" }} />
                  <button
                    onClick={() => setShowRangeLines(!showRangeLines)}
                    className={styles.filterBtn}
                    style={{
                      background: showRangeLines ? "#555" : "#fff",
                      color: showRangeLines ? "#fff" : "#333",
                    }}
                  >
                    Rng
                  </button>
                  <select value={topN} onChange={(e) => setTopN(Number(e.target.value))} style={{ fontSize: 9, border: "1px solid #ccc", marginLeft: 2 }}>
                    {TOP_N_OPTIONS.map((o) => (
                      <option key={o.val} value={o.val}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {hover && (
                <span className={styles.ohlc}>
                  O:<b style={{ color: "#000" }}>{fmtPrice(hover.open, p)}</b> H:<b>{fmtPrice(hover.high, p)}</b> L:
                  <b>{fmtPrice(hover.low, p)}</b> C:<b>{fmtPrice(hover.close, p)}</b>
                </span>
              )}
            </>
          )}
        </div>
        {!isCollapsed && (
          <div className={styles.tools}>
            {INTERVALS.map((i) => (
              <button
                key={i.ui}
                onClick={() => setInterval?.(i.ui)}
                className={styles.btn}
                style={{
                  background: interval === i.ui ? "#26a69a" : "transparent",
                  color: interval === i.ui ? "#fff" : "#777",
                }}
              >
                {i.label}
              </button>
            ))}
            <div className={styles.sep} />
            {LIMITS.map((l) => (
              <button
                key={l}
                onClick={() => setLimit?.(l)}
                className={styles.btn}
                style={{
                  background: Number(limit) === l ? "#7e57c2" : "transparent",
                  color: Number(limit) === l ? "#fff" : "#777",
                }}
              >
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
      {!isCollapsed && (
        <div ref={containerRef} className={styles.chartBody} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
          {calcSnapshot && <TradingCalculator onClose={() => setCalcSnapshot(null)} isSpot={category === "spot"} tickerPrice={calcSnapshot.price} fundingRate={calcSnapshot.funding} onApplyToGraph={handleApplyCalcToGraph} />}
          <div
            style={{
              width: currentRightInset ? `calc(100% - ${currentRightInset}px)` : "100%",
              height: "100%",
              marginLeft: 0,
              marginRight: currentRightInset ? currentRightInset : 0,
              position: "relative",
            }}
          >
            <div ref={mainElRef} style={{ width: "100%", height: "75%", position: "relative" }}>
              {ruler && ruler.active && rulerBoxStyle && (
                <div style={rulerBoxStyle}>
                  {rulerStats && (
                    <span
                      style={{
                        position: "absolute",
                        bottom: "100%",
                        left: 0,
                        background: "#333",
                        color: "#fff",
                        padding: "2px 4px",
                        fontSize: 10,
                        borderRadius: 2,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {rulerStats.pct.toFixed(2)}% | Vol: {fmtRulerVol(rulerStats.vol)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div style={{ width: "100%", height: 1, background: "#eee" }} />
            <div ref={volElRef} style={{ width: "100%", height: "25%" }} />
          </div>
        </div>
      )}
    </div>
  );
});

/* ===========================
   Wrapper
=========================== */
export default function BybitTradesGraph({ spotSymbol, linearSymbol, spotChunk, linearChunk, spotTradeChunk, linearTradeChunk, spotInterval, setSpotInterval, spotLimit, setSpotLimit, linearInterval, setLinearInterval, linearLimit, setLinearLimit, grafIntervalUI, setGrafIntervalUI, grafBarsLimit, setGrafBarsLimit, spotLines, linearLines, spotMarkers, linearMarkers, spotRangeMarkers, linearRangeMarkers, spotPrice, linearPrice, funding }) {
  const spotCandles = useChunkCandles(spotChunk);
  const linearCandles = useChunkCandles(linearChunk);

  const spotStatus = spotChunk ? "live" : "loading";
  const linearStatus = linearChunk ? "live" : "loading";
  const hasData = spotCandles.length > 0 || linearCandles.length > 0;

  const spotIntervalEff = spotInterval ?? grafIntervalUI ?? "5m";
  const linearIntervalEff = linearInterval ?? grafIntervalUI ?? "5m";
  const spotLimitEff = spotLimit ?? grafBarsLimit ?? 200;
  const linearLimitEff = linearLimit ?? grafBarsLimit ?? 200;
  const setSpotIntervalEff = setSpotInterval ?? setGrafIntervalUI;
  const setLinearIntervalEff = setLinearInterval ?? setGrafIntervalUI;
  const setSpotLimitEff = setSpotLimit ?? setGrafBarsLimit;
  const setLinearLimitEff = setLinearLimit ?? setGrafBarsLimit;

  return (
    <div className={`${styles.appCol}  ${styles.appColGraph}`}>
      <div className={styles.appBody}>
        <div className={styles.container}>
          {spotSymbol ? (
            <ChartWithVolume
              symbol={spotSymbol}
              category="spot"
              candlesInput={spotCandles}
              tradesChunk={spotTradeChunk}
              feedStatus={spotStatus}
              interval={spotIntervalEff}
              setInterval={setSpotIntervalEff}
              limit={spotLimitEff}
              setLimit={setSpotLimitEff}
              analysisLines={spotLines}
              tradeMarkers={spotMarkers}
              rangeMarkers={spotRangeMarkers}
              // Pass live data for calc logic
              currentTickerPrice={spotPrice}
              fundingRate={0}
            />
          ) : null}
          {linearSymbol ? (
            <ChartWithVolume
              symbol={linearSymbol}
              category="linear"
              candlesInput={linearCandles}
              tradesChunk={linearTradeChunk}
              feedStatus={linearStatus}
              interval={linearIntervalEff}
              setInterval={setLinearIntervalEff}
              limit={linearLimitEff}
              setLimit={setLinearLimitEff}
              analysisLines={linearLines}
              tradeMarkers={linearMarkers}
              rangeMarkers={linearRangeMarkers}
              // Pass live data for calc logic
              currentTickerPrice={linearPrice}
              fundingRate={funding}
            />
          ) : (
            <div className={styles.emptyState}>LINEAR Not Available</div>
          )}
          {!hasData && <div className={styles.loadingState}>Waiting for data...</div>}
        </div>
      </div>
    </div>
  );
}
