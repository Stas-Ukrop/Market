// /components/schema/okx.js
const okx = {
  spot: {
    url: "https://www.okx.com/api/v5/public/instruments?instType=SPOT",

    ws: "wss://ws.okx.com:8443/ws/v5/public",

    wsRoutes: {
      public: "wss://ws.okx.com:8443/ws/v5/public",
      business: "wss://ws.okx.com:8443/ws/v5/business",
    },

instrument: {
  listPath: ["data"],
  instType: "SPOT",
  symbolField: "instId",
  baseField: "baseCcy",
  quoteField: "quoteCcy",
  statusField: "state",
  activeStatuses: ["LIVE"],
  symbolFormat: "DASHED",
  example: "BTC-USDT",
},
    adapter: {
      tickers: {
        mode: "arg",
        wsRoute: "public",
        template: {
          channel: "tickers",
          instId: "{symbol}",
        },
        symbolCase: "UPPER",
        symbolFormat: "DASHED",
      },

      orderbook: {
        mode: "arg",
        wsRoute: "public",
        template: {
          channel: "{channel}",
          instId: "{symbol}",
        },
        symbolCase: "UPPER",
        symbolFormat: "DASHED",
        allowedDepths: [5, 400],
        channelsMap: {
          5: "books5",
          400: "books",
        },
        defaults: {
          depth: 400,
          channel: "books",
        },
      },

      publicTrade: {
        mode: "arg",
        wsRoute: "public",
        template: {
          channel: "trades",
          instId: "{symbol}",
        },
        symbolCase: "UPPER",
        symbolFormat: "DASHED",
      },

      kline: {
        mode: "arg",
        wsRoute: "business",
        template: {
          channel: "{interval}",
          instId: "{symbol}",
        },
        symbolCase: "UPPER",
        symbolFormat: "DASHED",
        defaults: {
          uiInterval: "5m",
          barsLimit: 200,
        },
        historyPolicy: {
          minBars: 200,
        },
        intervalsMap: {
          "1m": "candle1m",
          "3m": "candle3m",
          "5m": "candle5m",
          "15m": "candle15m",
          "30m": "candle30m",
          "1h": "candle1H",
          "2h": "candle2H",
          "4h": "candle4H",
          "6h": "candle6H",
          "12h": "candle12H",
          "1d": "candle1D",
          "1w": "candle1W",
          "1M": "candle1M",
        },
      },
    },
  },

  linear: {
    url: "https://www.okx.com/api/v5/public/instruments?instType=SWAP",

    ws: "wss://ws.okx.com:8443/ws/v5/public",

    wsRoutes: {
      public: "wss://ws.okx.com:8443/ws/v5/public",
      business: "wss://ws.okx.com:8443/ws/v5/business",
    },

instrument: {
  listPath: ["data"],
  instType: "SWAP",
  symbolField: "instId",
  baseField: "ctValCcy",
  quoteField: "settleCcy",
  statusField: "state",
  activeStatuses: ["LIVE"],
  symbolFormat: "DASHED_SWAP",
  contractSuffix: "-SWAP",
  settleCcy: "USDT",
  example: "BTC-USDT-SWAP",
},

    adapter: {
      tickers: {
        mode: "arg",
        wsRoute: "public",
        template: {
          channel: "tickers",
          instId: "{symbol}",
        },
        symbolCase: "UPPER",
        symbolFormat: "DASHED_SWAP",
      },

      orderbook: {
        mode: "arg",
        wsRoute: "public",
        template: {
          channel: "{channel}",
          instId: "{symbol}",
        },
        symbolCase: "UPPER",
        symbolFormat: "DASHED_SWAP",
        allowedDepths: [5, 400],
        channelsMap: {
          5: "books5",
          400: "books",
        },
        defaults: {
          depth: 400,
          channel: "books",
        },
      },

      publicTrade: {
        mode: "arg",
        wsRoute: "public",
        template: {
          channel: "trades",
          instId: "{symbol}",
        },
        symbolCase: "UPPER",
        symbolFormat: "DASHED_SWAP",
      },

      kline: {
        mode: "arg",
        wsRoute: "business",
        template: {
          channel: "{interval}",
          instId: "{symbol}",
        },
        symbolCase: "UPPER",
        symbolFormat: "DASHED_SWAP",
        defaults: {
          uiInterval: "5m",
          barsLimit: 200,
        },
        historyPolicy: {
          minBars: 200,
        },
        intervalsMap: {
          "1m": "candle1m",
          "3m": "candle3m",
          "5m": "candle5m",
          "15m": "candle15m",
          "30m": "candle30m",
          "1h": "candle1H",
          "2h": "candle2H",
          "4h": "candle4H",
          "6h": "candle6H",
          "12h": "candle12H",
          "1d": "candle1D",
          "1w": "candle1W",
          "1M": "candle1M",
        },
      },
    },
  },
};

export default okx;