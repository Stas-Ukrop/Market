// /components/schema/constants.js
const parameters = {
    CHUNK_SIZE: 10,
    FILTER_LOG_LIMIT: 3500,
    FEED_TTL_MS: {
    tickers: 8000,
    orderbook: 5000,
    default: 4000,
  },
    NUMERIC_MULTIPLIERS: [
        "1000000000",
        "100000000",
        "10000000",
        "1000000",
        "100000",
        "10000",
        "1000"
    ],
    STRICT_DOUBLE_QUOTE: [
        "USDT",
        "USDC",
        "BUSD",
        "TUSD",
        "FDUSD",
        "DAI",
        "PYUSD",
        "USDD",
        "USTC",
        "USDE",
        "MNT",
        "USD",
        "EUR",
        "GBP",
        "CHF",
        "JPY",
        "AUD",
        "CAD",
        "NZD"
    ],
    RAW_QUOTE_ASSETS: [
        "USDT",
        "USDC",
        "BUSD",
        "TUSD",
        "FDUSD",
        "DAI",
        "PYUSD",
        "USDD",
        "USTC",
        "USDE",
        "MNT",
        "BTC",
        "ETH",
        "BNB",
        "SOL",
        "XRP",
        "TRX",
        "DOGE",
        "TON",
        "LTC",
        "ADA",
        "MATIC",
        "USD1",
        "USD",
        "EUR",
        "GBP",
        "CHF",
        "JPY",
        "AUD",
        "CAD",
        "NZD",
        "NOK",
        "SEK",
        "DKK",
        "CZK",
        "PLN",
        "HUF",
        "RON",
        "HRK",
        "ISK",
        "RUB",
        "UAH",
        "KZT",
        "BYN",
        "GEL",
        "BRL",
        "MXN",
        "ARS",
        "CLP",
        "COP",
        "PEN",
        "CNY",
        "CNH",
        "HKD",
        "SGD",
        "KRW",
        "TWD",
        "MYR",
        "THB",
        "IDR",
        "INR",
        "PHP",
        "VND",
        "SAR",
        "AED",
        "QAR",
        "KWD",
        "BHD",
        "ILS",
        "TRY",
        "ZAR",
        "EGP",
        "NGN",
        "KES",
        "GHS"
    ],
};

export const CHUNK_SIZE = parameters.CHUNK_SIZE;

export const FILTER_LOG_LIMIT = parameters.FILTER_LOG_LIMIT;

export const FEED_TTL_MS = parameters.FEED_TTL_MS;

export const NUMERIC_MULTIPLIERS = parameters.NUMERIC_MULTIPLIERS;

export const STRICT_DOUBLE_QUOTE = new Set(parameters.STRICT_DOUBLE_QUOTE);

export const QUOTE_ASSETS = parameters.RAW_QUOTE_ASSETS
  .slice()
  .sort((a, b) => String(b).length - String(a).length);

export default parameters;