// /components/schema/bybit.js
const bybit = {
spot : {
      url: "https://api.bybit.com/v5/market/instruments-info?category=spot",
    ws: "wss://stream.bybit.com/v5/public/spot",
      instrument: {
  listPath: ["result", "list"],
  symbolField: "symbol",
  baseField: "baseCoin",
  quoteField: "quoteCoin",
  statusField: "status",
  activeStatuses: ["TRADING", "ONLINE"],
},
      adapter: {
        tickers: { template: "tickers.{symbol}", symbolCase: "UPPER" },
        orderbook: {
          template: "orderbook.{depth}.{symbol}",
          symbolCase: "UPPER",
          allowedDepths: [1, 50],
          defaults: { depth: 50 },
        },
        publicTrade: { template: "publicTrade.{symbol}", symbolCase: "UPPER" },
        kline: {
          mode: "topic",
          template: "kline.{interval}.{symbol}",
          symbolCase: "UPPER",
          defaults: { uiInterval: "5m", barsLimit: 200 },
          historyPolicy: { minBars: 200 },
          intervalsMap: {
            "1m": "1",
            "5m": "5",
            "15m": "15",
            "30m": "30",
            "1h": "60",
            "4h": "240",
            "12h": "720",
            "1d": "D",
            "1M": "M",
          },
        },
      },
    },
linear : {
      url: "https://api.bybit.com/v5/market/instruments-info?category=linear",
  ws: "wss://stream.bybit.com/v5/public/linear",
instrument: {
  listPath: ["result", "list"],
  symbolField: "symbol",
  baseField: "baseCoin",
  quoteField: "quoteCoin",
  statusField: "status",
  activeStatuses: ["TRADING", "ONLINE"],
},
      adapter: {
        tickers: { template: "tickers.{symbol}", symbolCase: "UPPER" },
        orderbook: {
          template: "orderbook.{depth}.{symbol}",
          symbolCase: "UPPER",
          allowedDepths: [1, 50, 200, 500],
          defaults: { depth: 50 },
        },
        publicTrade: { mode: "topic", template: "publicTrade.{symbol}", symbolCase: "UPPER" },
        kline: {
          template: "kline.{interval}.{symbol}",
          symbolCase: "UPPER",
          defaults: { uiInterval: "5m", barsLimit: 200 },
          historyPolicy: { minBars: 200 },
          intervalsMap: {
            "1m": "1",
            "5m": "5",
            "15m": "15",
            "30m": "30",
            "1h": "60",
            "4h": "240",
            "12h": "720",
            "1d": "D",
            "1M": "M",
          },
        },
      },
    }
};

export default bybit;