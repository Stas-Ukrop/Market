// src/App.js
import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

import { appCore, parseRouteId, pickRoute, pickTradeChunk, pickKlineChunk } from "./main.js";
import { takeFullSnapshot } from "./components/snapshot/SnapshotEngine.js";

// TradingCalculator удален отсюда, он теперь внутри Graph

import Tickers from "./components/Tickers/Tickers.js";
import PublicTrades from "./components/Trades/PublicTrades.js";
import BybitTradesGraph from "./components/Klines/BybitTradesGraph.js";
import BybitOrderbooks from "./components/OrderBook/BybitOrderbooks.js";

export default function App() {
  const [tick, setTick] = useState(0);

  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState("BTC");

  // === Settings for spot/linear graph ===
  const [spotGrafInterval, setSpotGrafInterval] = useState("5m");
  const [spotGrafLimit, setSpotGrafLimit] = useState(200);
  const [linearGrafInterval, setLinearGrafInterval] = useState("5m");
  const [linearGrafLimit, setLinearGrafLimit] = useState(200);

  // === LEGACY: keep for compatibility ===
  const grafIntervalUI = useMemo(() => linearGrafInterval || spotGrafInterval || "5m", [linearGrafInterval, spotGrafInterval]);

  const [spotRangeMarkers, setSpotRangeMarkers] = useState([]);
  const [linearRangeMarkers, setLinearRangeMarkers] = useState([]);

  useEffect(() => {
    appCore.bindUI(() => setTick((v) => v + 1));
    if (!appCore.ready && !appCore.kernel) appCore.init();
    return () => appCore.bindUI(null);
  }, []);

  // === SYNC EFFECTS ===
  useEffect(() => {
    if (appCore.activeCoin && appCore.ready) {
      appCore.updateKlineConfig("spot", spotGrafInterval, spotGrafLimit);
    }
  }, [spotGrafInterval, spotGrafLimit, selectedId]);

  useEffect(() => {
    if (appCore.activeCoin && appCore.ready) {
      appCore.updateKlineConfig("linear", linearGrafInterval, linearGrafLimit);
    }
  }, [linearGrafInterval, linearGrafLimit, selectedId]);

  const selectedBaseId = useMemo(() => {
    const id = String(selectedId || "");
    if (!id) return "";
    return appCore.routeToBase.get(id) || id;
  }, [selectedId, tick]);

  const selectedQuote = useMemo(() => {
    const id = String(selectedId || "");
    return id.includes(":") ? parseRouteId(id).quote : "";
  }, [selectedId]);

  const onPick = useCallback(
    (idOrBase) => {
      const newBaseId = appCore.selectCoin(idOrBase, {
        grafInterval: linearGrafInterval,
        grafBarsLimit: linearGrafLimit,
      });
      if (newBaseId) {
        setSelectedId(newBaseId);
        setSpotRangeMarkers([]);
        setLinearRangeMarkers([]);
      }
    },
    [linearGrafInterval, linearGrafLimit]
  );
  // >>> АВТОЗАГРУЗКА ДАННЫХ ПРИ СТАРТЕ <<<
  useEffect(() => {
    // Как только ядро загрузило весь список с биржи, принудительно "кликаем" на BTC
    if (appCore.ready && !appCore.activeCoin) {
      onPick("BTC");
    }
  }, [tick, onPick]);
  const selItem = useMemo(() => appCore.itemsMap.get(selectedBaseId) || null, [selectedBaseId, tick]);

  const spotRoute = useMemo(() => pickRoute(selItem, "spot", selectedQuote), [selItem, selectedQuote, tick]);
  const linearRoute = useMemo(() => pickRoute(selItem, "linear", selectedQuote), [selItem, selectedQuote, tick]);

  const spotSymbol = useMemo(() => parseRouteId(spotRoute?.id).symbol || "", [spotRoute?.id]);
  const linSymbol = useMemo(() => parseRouteId(linearRoute?.id).symbol || "", [linearRoute?.id]);

  const spotTradeChunk = pickTradeChunk(spotRoute);
  const linearTradeChunk = pickTradeChunk(linearRoute);
  const spotKlineChunk = pickKlineChunk(spotRoute);
  const linearKlineChunk = pickKlineChunk(linearRoute);

  const spotData = useMemo(() => appCore.obCtrl.process("spot", spotRoute, spotSymbol, spotTradeChunk), [spotRoute, spotSymbol, spotTradeChunk, tick]);
  const linearData = useMemo(() => appCore.obCtrl.process("linear", linearRoute, linSymbol, linearTradeChunk), [linearRoute, linSymbol, linearTradeChunk, tick]);

  const spotMarkers = useMemo(() => (appCore.obCtrl.isAnalyzing() ? appCore.spotTradesCtrl.findBigTrades(spotTradeChunk, 10.0) : []), [spotTradeChunk, tick]);
  const linearMarkers = useMemo(() => (appCore.obCtrl.isAnalyzing() ? appCore.linearTradesCtrl.findBigTrades(linearTradeChunk, 10.0) : []), [linearTradeChunk, tick]);

  // --- Calculator Data Preparation ---
  const getTickerData = useCallback((route, symbol) => {
    if (!route || !symbol) return null;
    const holder = route.chunks || route.chunk;
    return holder?.tickers?.data?.[symbol];
  }, []);

  const spotPriceVal = useMemo(() => {
    const s = getTickerData(spotRoute, spotSymbol);
    return Number(s?.lastPrice ?? s?.last ?? s?.price) || 0;
  }, [getTickerData, spotRoute, spotSymbol, tick]);

  const linearPriceVal = useMemo(() => {
    const l = getTickerData(linearRoute, linSymbol);
    return Number(l?.lastPrice ?? l?.last ?? l?.price) || 0;
  }, [getTickerData, linearRoute, linSymbol, tick]);

  const currentFundingForCalc = useMemo(() => {
    const l = getTickerData(linearRoute, linSymbol);
    const rawFunding = Number(l?.fundingRate);
    return Number.isFinite(rawFunding) ? rawFunding * 100 : 0.01;
  }, [getTickerData, linearRoute, linSymbol, tick]);

  const snap = appCore.kernel?.getSnapshot?.() || null;

  return (
    <div className="appRoot">
      <div className="appCol appColTickers">
        <div className="appHeader">
          <div className="appTitle" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            Bybit Lite Client
            <div style={{ display: "flex", gap: "4px" }}>
              <button className="app-btn-icon" onClick={() => takeFullSnapshot(appCore.activeCoin || "BybitMarket")}>
                📸
              </button>
            </div>
          </div>
          <div className="appSub">
            {appCore.error ? `ERR: ${appCore.error}` : appCore.ready ? "ready" : "loading..."}
            {snap?.inflight !== undefined ? ` | inflight=${snap.inflight}` : ""}
          </div>
        </div>
        <div className="appBody">
          <Tickers controller={appCore.tickerCtrl} itemsMap={appCore.itemsMap} q={q} onQ={setQ} selectedId={selectedId} onPick={onPick} tick={tick} />
        </div>
      </div>

      <div className="appCol appColOrderbook">
        <div className="appObWrap">
          <div className="appObBody">
            <BybitOrderbooks
              coin={selectedBaseId}
              spotView={spotData.view}
              linearView={linearData.view}
              rows={appCore.obCtrl.getRows()}
              onRowsChange={(n) => {
                appCore.obCtrl.setRows(n);
                appCore.bump();
              }}
              onToggleAnalysis={() => {
                appCore.obCtrl.toggleAnalysis();
                appCore.bump();
              }}
              isAnalyzing={appCore.obCtrl.isAnalyzing()}
            />
          </div>
          <div className="appFooter">shards: {snap?.shards?.length ?? 0}</div>
        </div>
      </div>

      <div className="appCol appColTrades">
        <div className="appTradesWrap">
          <div className="appTradesHalf">
            <PublicTrades controller={appCore.spotTradesCtrl} title={`Spot Trades (${spotSymbol})`} tradeChunk={spotTradeChunk} symbol={spotSymbol} interval={spotGrafInterval} onUpdateMarkers={setSpotRangeMarkers} />
          </div>
          <div className="appTradesHalf">
            <PublicTrades controller={appCore.linearTradesCtrl} title={`Linear Trades (${linSymbol})`} tradeChunk={linearTradeChunk} symbol={linSymbol} interval={linearGrafInterval} onUpdateMarkers={setLinearRangeMarkers} />
          </div>
        </div>
      </div>

      <div className="appCol appColGraph">
        <div className="appBody">
          <BybitTradesGraph
            coin={selectedBaseId}
            spotSymbol={spotSymbol}
            linearSymbol={linSymbol}
            spotChunk={spotKlineChunk}
            linearChunk={linearKlineChunk}
            spotTradeChunk={spotTradeChunk}
            linearTradeChunk={linearTradeChunk}
            // Graph Controls
            spotInterval={spotGrafInterval}
            setSpotInterval={setSpotGrafInterval}
            spotLimit={spotGrafLimit}
            setSpotLimit={setSpotGrafLimit}
            linearInterval={linearGrafInterval}
            setLinearInterval={setLinearGrafInterval}
            linearLimit={linearGrafLimit}
            setLinearLimit={setLinearGrafLimit}
            // Legacy fallbacks
            grafIntervalUI={grafIntervalUI}
            setGrafIntervalUI={setLinearGrafInterval}
            grafBarsLimit={linearGrafLimit}
            setGrafBarsLimit={setLinearGrafLimit}
            // Overlays
            spotLines={spotData.lines}
            linearLines={linearData.lines}
            spotMarkers={spotMarkers}
            linearMarkers={linearMarkers}
            spotRangeMarkers={spotRangeMarkers}
            linearRangeMarkers={linearRangeMarkers}
            // === NEW: Calculator Data passed to Graph ===
            spotPrice={spotPriceVal}
            linearPrice={linearPriceVal}
            funding={currentFundingForCalc}
          />
        </div>
      </div>
    </div>
  );
}
