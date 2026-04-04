// ./components/Core/BybitKernel.ts
const BYBIT_CHUNK_SIZE: number = 10;
const FILTER_LOG_LIMIT: number = 3500;
interface FilteredSymbolLogEntry {
    raw: string;
    reason: string;
    extra: Record<string, unknown> | null;
    ts: number | null;
}
const filteredSymbolsLog: FilteredSymbolLogEntry[] = [];
// ─────────────────────────────────────────────
// helpers (взято из utils/normalizeBaseName.js, без импорта)
// ─────────────────────────────────────────────
const RAW_QUOTE_ASSETS: string[] = ["USDT", "USDC", "BUSD", "TUSD", "FDUSD", "DAI", "PYUSD", "USDD", "USTC", "USDE", "MNT", "BTC", "ETH", "BNB", "SOL", "XRP", "TRX", "DOGE", "TON", "LTC", "ADA", "MATIC", "USD1", "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "NZD", "NOK", "SEK", "DKK", "CZK", "PLN", "HUF", "RON", "HRK", "ISK", "RUB", "UAH", "KZT", "BYN", "GEL", "BRL", "MXN", "ARS", "CLP", "COP", "PEN", "CNY", "CNH", "HKD", "SGD", "KRW", "TWD", "MYR", "THB", "IDR", "INR", "PHP", "VND", "SAR", "AED", "QAR", "KWD", "BHD", "ILS", "TRY", "ZAR", "EGP", "NGN", "KES", "GHS"];

const QUOTE_ASSETS: string[] = RAW_QUOTE_ASSETS.slice().sort((a, b) => b.length - a.length);
const STRICT_DOUBLE_QUOTE: Set<string> = new Set(["USDT", "USDC", "BUSD", "TUSD", "FDUSD", "DAI", "PYUSD", "USDD", "USTC", "USDE", "MNT", "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "NZD"]);
const NUMERIC_MULTIPLIERS: string[] = ["1000000000", "100000000", "10000000", "1000000", "100000", "10000", "1000"];
const logFilteredSymbol = (raw: string, reason: string, extra: null | {}) => {
    try {
        if (filteredSymbolsLog.length >= FILTER_LOG_LIMIT) filteredSymbolsLog.shift();
        filteredSymbolsLog.push({ raw, reason, extra, ts: null });
    } catch { }
};