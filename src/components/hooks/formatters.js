// === ./src/components/hooks/formatters.js — унифицированный модуль форматирования

// --- HELPERS ---
export const upper = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();
export const lower = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();

// ═══════════════════════════════════════════════════════════
// Вспомогательные функции
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// Основные функции форматирования
// ═══════════════════════════════════════════════════════════

/**
 * 💰 Форматирование цены С валютой ($)
 * Сохраняет ведущие нули, добавляет пробелы для читаемости
 *
 * @example
 * fmtPrice(0.00001234)  // "$0.00001 234"
 * fmtPrice(123.456)     // "$123.4560"
 * fmtPrice(123456)      // "$123 456.00"
 */
export const fmtPrice = (v) => {
  if (v == null || isNaN(v)) return "—";
  const n = Number(v);
  if (n === 0) return "—";
  const abs = Math.abs(n);

  // Для микрочисел — анализ ведущих нулей
  if (abs < 1) {
    const str = abs.toString();
    const match = str.match(/^0\.(0+)(\d+)/);
    if (match) {
      const zeros = match[1].length;
      const digits = match[2].slice(0, 5);
      const formatted = "0." + "0".repeat(zeros) + digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
      return `$${formatted}`;
    }
  }

  // Обычное форматирование
  const precision = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : abs >= 0.0001 ? 8 : abs >= 0.000001 ? 10 : 12;

  const formatted = abs
    .toLocaleString("en-US", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
      useGrouping: true,
    })
    .replace(/,/g, " ");

  return `$${formatted}`;
};

/**
 * 🔢 Форматирование цены БЕЗ валюты (компактно)
 * Убирает лишние нули, работает со строками и числами
 * Идеально для ордербука
 *
 * @example
 * formatPrice(0.00001234)  // "0.00001234"
 * formatPrice(123.456)     // "123.456"
 * formatPrice(123456.00)   // "123456"
 */
export const formatPrice = (value) => {
  if (value === null || value === undefined || value === "") return "—";

  // Если строка без экспоненты — оставляем как есть
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return "—";
    if (!/e/i.test(raw)) {
      return stripTrailingZeros(raw);
    }
  }

  const n = toNum(value);
  if (n === null) return "—";
  if (n === 0) return "0";

  const abs = Math.abs(n);

  let s;
  if (abs >= 1) {
    s = n.toFixed(6);
  } else if (abs >= 0.01) {
    s = n.toFixed(8);
  } else {
    s = n.toFixed(12);
  }

  return stripTrailingZeros(s);
};

/**
 * 📊 Форматирование объёма (без валюты, с пробелами)
 * Адаптивная точность: 0-4 знака
 *
 * @example
 * fmtVolume(1234567)     // "1 234 567"
 * fmtVolume(123.456)     // "123.46"
 * fmtVolume(0.123)       // "0.1230"
 */
export const fmtVolume = (v) => {
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

/**
 * 📈 Форматирование процентов (адаптивная точность, знак ±)
 * Автоматически убирает нули, показывает знак
 *
 * @param {number} v - значение (0.0523 для 5.23%)
 * @param {object} options - { withSign: true }
 *
 * @example
 * fmtPercent(0.0523)       // "+5.23%"
 * fmtPercent(-0.123)       // "-12.3%"
 * fmtPercent(0.00012)      // "+0.012%"
 */
export const fmtPercent = (v, { withSign = true } = {}) => {
  if (v == null || isNaN(v)) return "—";
  const num = Number(v);
  if (num === 0) return "0%";

  const abs = Math.abs(num);
  const precision = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : abs >= 0.1 ? 3 : abs >= 0.01 ? 4 : 5;

  let formatted = num.toFixed(precision);
  if (withSign && num > 0) formatted = `+${formatted}`;
  return `${formatted}%`;
};

/**
 * 🎯 Универсальное форматирование (точные нули + 5 значащих цифр)
 * Автоматически выбирает формат в зависимости от величины
 *
 * @example
 * fmtSmart(0.00001234)   // "0.00001 234"
 * fmtSmart(123.456)      // "123.456"
 * fmtSmart(123456)       // "123 456"
 */
export const fmtSmart = (v) => {
  if (v == null || isNaN(v)) return "—";
  const num = Number(v);
  if (num === 0) return "0";
  const abs = Math.abs(num);

  // Микрочисла — считаем нули после запятой
  if (abs < 1) {
    const str = abs.toString();
    const match = str.match(/^0\.(0+)(\d+)/);
    if (match) {
      const zeros = match[1].length;
      const digits = match[2].slice(0, 5);
      const formatted = "0." + "0".repeat(zeros) + digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
      return formatted;
    }
  }

  // Стандартный вариант
  const precision = abs >= 1_000_000 ? 0 : abs >= 1_000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : abs >= 0.0001 ? 8 : abs >= 0.000001 ? 10 : 12;

  return num
    .toLocaleString("en-US", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
      useGrouping: true,
    })
    .replace(/,/g, " ");
};

/**
 * ⏱️ Форматирование времени (короткий формат HH:MM:SS)
 *
 * @param {number|Date} ts - timestamp или Date
 *
 * @example
 * formatTime(Date.now())  // "14:23:45"
 */
export const formatTime = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

/**
 * 💸 Форматирование funding rate (с направлением)
 *
 * @param {number} rate - funding rate (0.0001 для 0.01%)
 * @param {string} direction - "shorts_pay_longs" | "longs_pay_shorts" | null
 *
 * @example
 * formatFunding(0.0001, "longs_pay_shorts")  // "0.0100%  L→S"
 * formatFunding(-0.0002, "shorts_pay_longs") // "-0.0200%  S→L"
 */
export const formatFunding = (rate, direction) => {
  const n = toNum(rate);
  const pct = n !== null ? (n * 100).toFixed(4) + "%" : "—";
  if (!direction) return pct;
  if (direction === "shorts_pay_longs") return `${pct}  S→L`;
  if (direction === "longs_pay_shorts") return `${pct}  L→S`;
  return pct;
};

// ═══════════════════════════════════════════════════════════
// Алиасы для совместимости
// ═══════════════════════════════════════════════════════════

export const fmtDelta = fmtPercent; // алиас для дельты
export const formatDelta = fmtPercent; // алиас для дельты
export const formatVolume = fmtVolume; // алиас для объёма
export const formatTimeShort = formatTime; // алиас для времени

// ═══════════════════════════════════════════════════════════
// Экспорт по умолчанию (объект со всеми функциями)
// ═══════════════════════════════════════════════════════════

export default {
  fmtPrice, // цена с $
  formatPrice, // цена без $
  fmtVolume, // объём
  fmtPercent, // проценты
  fmtSmart, // универсальный
  formatTime, // время
  formatFunding, // funding rate

  // Алиасы
  fmtDelta,
  formatDelta,
  formatVolume,
  formatTimeShort,
};
