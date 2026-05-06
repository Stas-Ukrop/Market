// /components/schema/binance.js
const binance = {
  spot: {
    url: "https://api.binance.com/api/v3/exchangeInfo",
    ws: "wss://stream.binance.com:9443/ws",
instrument: {
  listPath: ["symbols"],
  symbolField: "symbol",
  baseField: "baseAsset",
  quoteField: "quoteAsset",
  statusField: "status",
  activeStatuses: ["TRADING"],
},
    adapter: {
      tickers: {
        mode: "topic",
        template: "{symbol}@ticker",
        symbolCase: "LOWER",
      },

      orderbook: {
        mode: "topic",
        template: "{symbol}@depth{depth}@{speed}",
        symbolCase: "LOWER",
        allowedDepths: [5, 10, 20],
        allowedSpeeds: ["100ms", "1000ms"],
        defaults: {
          depth: 20,
          speed: "100ms",
        },
      },

      publicTrade: {
        mode: "topic",
        template: "{symbol}@trade",
        symbolCase: "LOWER",
      },

      kline: {
        mode: "topic",
        template: "{symbol}@kline_{interval}",
        symbolCase: "LOWER",
        defaults: {
          uiInterval: "5m",
          barsLimit: 200,
        },
        historyPolicy: {
          minBars: 200,
        },
        intervalsMap: {
          "1m": "1m",
          "3m": "3m",
          "5m": "5m",
          "15m": "15m",
          "30m": "30m",
          "1h": "1h",
          "2h": "2h",
          "4h": "4h",
          "6h": "6h",
          "8h": "8h",
          "12h": "12h",
          "1d": "1d",
          "3d": "3d",
          "1w": "1w",
          "1M": "1M",
        },
      },
    },
  },

  linear: {
    url: "https://fapi.binance.com/fapi/v1/exchangeInfo",

    ws: "wss://fstream.binance.com/ws",

    wsRoutes: {
      public: "wss://fstream.binance.com/public/ws",
      market: "wss://fstream.binance.com/market/ws",
    },
instrument: {
  listPath: ["symbols"],
  symbolField: "symbol",
  baseField: "baseAsset",
  quoteField: "quoteAsset",
  statusField: "status",
  activeStatuses: ["TRADING"],
},
    adapter: {
      tickers: {
        mode: "topic",
        wsRoute: "market",
        template: "{symbol}@ticker",
        symbolCase: "LOWER",
      },

      orderbook: {
        mode: "topic",
        wsRoute: "public",
        template: "{symbol}@depth{depth}@{speed}",
        symbolCase: "LOWER",
        allowedDepths: [5, 10, 20],
        allowedSpeeds: ["100ms", "500ms"],
        defaults: {
          depth: 20,
          speed: "100ms",
        },
      },

      publicTrade: {
        mode: "topic",
        wsRoute: "market",
        template: "{symbol}@aggTrade",
        symbolCase: "LOWER",
      },

      kline: {
        mode: "topic",
        wsRoute: "market",
        template: "{symbol}@kline_{interval}",
        symbolCase: "LOWER",
        defaults: {
          uiInterval: "5m",
          barsLimit: 200,
        },
        historyPolicy: {
          minBars: 200,
        },
        intervalsMap: {
          "1m": "1m",
          "3m": "3m",
          "5m": "5m",
          "15m": "15m",
          "30m": "30m",
          "1h": "1h",
          "2h": "2h",
          "4h": "4h",
          "6h": "6h",
          "8h": "8h",
          "12h": "12h",
          "1d": "1d",
          "3d": "3d",
          "1w": "1w",
          "1M": "1M",
        },
      },
    },
  },
};

export default binance;