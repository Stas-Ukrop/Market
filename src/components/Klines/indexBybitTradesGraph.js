// ./components/Klines/index.js
// brains: chunk -> candles(+volumes) + precision + cache (no React)
// этот коментарий запрещается удалять! этот модуль служит мозгами, в нем происходят все вычисления, сортировки. вся логика и математика!
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const toUnixSec = (v) => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 2e10 ? Math.floor(n / 1000) : Math.floor(n);
};

const decimalsFromStr = (s) => {
  const t = String(s ?? "");
  const i = t.indexOf(".");
  return i >= 0 ? t.length - i - 1 : 0;
};

const pickHistSig = (history) => {
  const n = Array.isArray(history) ? history.length : 0;
  if (!n) return "0";
  const last = history[n - 1] || {};
  return `${n}|${String(last.ts ?? "")}|${String(last.c ?? "")}|${String(last.v ?? "")}`;
};

const guessPrecisionFromHistory = (history) => {
  if (!Array.isArray(history) || history.length === 0) return 2;
  let maxDec = 0;
  const limit = Math.min(history.length, 20);
  for (let i = history.length - limit; i < history.length; i++) {
    const b = history[i] || {};
    maxDec = Math.max(maxDec, decimalsFromStr(b.o), decimalsFromStr(b.h), decimalsFromStr(b.l), decimalsFromStr(b.c));
  }
  return clamp(maxDec, 0, 10);
};

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

const buildCandlesFromHistory = (history, barsLimit) => {
  if (!Array.isArray(history) || history.length === 0) return [];

  const lim = clamp(Number(barsLimit) || 200, 20, 2000);
  const take = Math.min(history.length, Math.max(80, lim * 3));
  const start = history.length - take;

  const map = new Map();
  for (let i = start; i < history.length; i++) {
    const b = history[i];
    if (!b) continue;
    const t = toUnixSec(b.ts);
    if (!t) continue;

    const c = num(b.c);
    if (c == null) continue;

    const o = num(b.o);
    const h = num(b.h);
    const l = num(b.l);
    const v = num(b.v);

    map.set(t, {
      time: t,
      open: o != null ? o : c,
      high: h != null ? h : c,
      low: l != null ? l : c,
      close: c,
      volume: v != null ? v : 0,
    });
  }

  const out = Array.from(map.values());
  out.sort((a, b) => a.time - b.time);

  return out.length > lim ? out.slice(out.length - lim) : out;
};

const volColor = (c) => (c.close >= c.open ? "rgba(38, 166, 154, 0.5)" : "rgba(239, 83, 80, 0.5)");

const buildVolumes = (candles) => {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const out = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    out[i] = { time: c.time, value: c.volume, color: volColor(c) };
  }
  return out;
};

const fmtPrice = (x, precision) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  const p = clamp(Number(precision) || 0, 0, 10);
  return n.toFixed(p);
};

export const INTERVALS = [
  { label: "1m", ui: "1m" },
  { label: "3m", ui: "3m" },
  { label: "5m", ui: "5m" },
  { label: "15m", ui: "15m" },
  { label: "1h", ui: "1h" },
  { label: "4h", ui: "4h" },
  { label: "1d", ui: "1d" },
];

export const LIMITS = [50, 100, 200, 500, 1000];

export class KlinesLogic {
  constructor() {
    this.cache = new Map();
  }

  getEmpty(ts = 0) {
    return { candles: [], volumes: [], precision: 2, minMove: 0.01, ts: ts || 0 };
  }

  process(chunk, barsLimit) {
    const history = chunk?.history;
    const srcTs = Number(chunk?.lastUpdateTs) || 0;
    const sig = `${srcTs}|${pickHistSig(history)}|${String(barsLimit ?? "")}`;

    const key = "kline";
    const prev = this.cache.get(key);
    if (prev && prev.sig === sig) return prev.vm;

    if (!Array.isArray(history) || history.length === 0) {
      const vm = this.getEmpty(srcTs);
      this.cache.set(key, { sig, vm });
      return vm;
    }

    const precision = guessPrecisionFromHistory(history);
    const minMove = 1 / Math.pow(10, precision);

    const candles = buildCandlesFromHistory(history, barsLimit);
    const volumes = buildVolumes(candles);

    const vm = { candles, volumes, precision, minMove, ts: srcTs };
    this.cache.set(key, { sig, vm });
    return vm;
  }
}

export { fmtPrice };
