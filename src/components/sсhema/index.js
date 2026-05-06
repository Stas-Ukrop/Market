// /components/schema/index.js
import bybit from "./bybit";
import binance from "./binance";
import okx from "./okx";

import parameters, {
  CHUNK_SIZE,
  FILTER_LOG_LIMIT,
  FEED_TTL_MS,
  NUMERIC_MULTIPLIERS,
  STRICT_DOUBLE_QUOTE,
  QUOTE_ASSETS,
} from "./constants";

const config = {
  schemas: {
    bybit,
    binance,
    okx,
  },

  parameters: {
    raw: parameters,

    runtime: {
      CHUNK_SIZE,
      FILTER_LOG_LIMIT,
      FEED_TTL_MS,
      NUMERIC_MULTIPLIERS,
      STRICT_DOUBLE_QUOTE,
      QUOTE_ASSETS,
    },
  },
};

export default config;