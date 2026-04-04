// src/components/Trades/PublicTrades.js
import React, { memo, useRef, useState, useMemo, useLayoutEffect, useCallback } from "react";
import "./PublicTrades.css";
import { TradesController } from "./TradesController.js";

const DEVIATION_OPTIONS = [-50, -30, -20, -10, 0, 10, 20, 30, 50, 100];

/* ===========================
   Pure sub-components
=========================== */

const TapeRow = memo(({ row }) => (
  <div className={`pt-trade-row ${row.flashClass}`}>
    <span className={`pt-price ${row.sideClass}`}>{row.priceStr}</span>
    <span className="pt-vol">{row.volStr}</span>
    <span className="pt-time">{row.timeStr}</span>
  </div>
));

const AnalysisRow = memo(({ row, onPriceClick }) => (
  <div className={`pt-analysis-row ${row.lastClass}`}>
    <span className="pt-bold pt-price-action" onClick={() => onPriceClick(row.priceStr)} title="Click to copy to Range">
      {row.priceStr}
    </span>
    <span className="pt-right pt-green">{row.buyStr}</span>
    <span className="pt-right pt-red">{row.sellStr}</span>
    <span className={`pt-right pt-bold ${row.deltaClass}`}>{row.deltaStr}</span>
  </div>
));

/* ===========================
   Main view
=========================== */

export default function PublicTrades({
  title,
  tradeChunk,
  symbol,
  interval,
  onUpdateMarkers,
  controller, // optional external controller instance
}) {
  // Controller instance (stable)
  const ctrlRef = useRef(null);
  if (!ctrlRef.current) ctrlRef.current = controller || new TradesController();
  const ctrl = ctrlRef.current;

  // Single local state: just to trigger re-render on ctrl.ui changes
  const [uiRev, setUiRev] = useState(ctrl.uiRev);
  const ui = ctrl.ui;

  // One input -> many outputs
  const { tapeRows, analysisRows, rangeStats, markers } = useMemo(() => {
    return ctrl.process(tradeChunk, symbol, { interval });
  }, [
    tradeChunk,
    tradeChunk?.lastUpdateTs, // критично для мутабельного tradeChunk
    symbol,
    interval,
    ctrl,
    uiRev, // меняется только через методы контроллера
  ]);

  // Side effect: push markers upstream
  useLayoutEffect(() => {
    if (onUpdateMarkers) onUpdateMarkers(markers);
  }, [markers, onUpdateMarkers]);

  // Handlers
  const handlePriceClick = useCallback(
    (v) => {
      if (ctrl.applyPriceClick(v)) setUiRev(ctrl.uiRev);
    },
    [ctrl]
  );
  const onMinChange = useCallback((e) => setUiRev(ctrl.setRangeMin(e.target.value)), [ctrl]);
  const onMaxChange = useCallback((e) => setUiRev(ctrl.setRangeMax(e.target.value)), [ctrl]);
  const onMinFocus = useCallback(() => setUiRev(ctrl.setTargetInput("min")), [ctrl]);
  const onMaxFocus = useCallback(() => setUiRev(ctrl.setTargetInput("max")), [ctrl]);
  const onDevChange = useCallback((e) => setUiRev(ctrl.setDeviationPct(Number(e.target.value))), [ctrl]);
  const onToggleGraph = useCallback(() => setUiRev(ctrl.setShowOnGraph(!ui.showOnGraph)), [ctrl, ui.showOnGraph]);

  return (
    <div className="pt-root">
      {/* --- ANALYSIS PANEL --- */}
      <div className="pt-panel pt-analysis">
        <div className="pt-range-block">
          {/* Inputs Row */}
          <div className="pt-range-row">
            <input className={`pt-range-input ${ui.targetInput === "min" ? "pt-input-target" : ""}`} placeholder="Min" value={ui.rangeMin} onFocus={onMinFocus} onChange={onMinChange} />
            <span className="pt-range-sep">-</span>
            <input className={`pt-range-input ${ui.targetInput === "max" ? "pt-input-target" : ""}`} placeholder="Max" value={ui.rangeMax} onFocus={onMaxFocus} onChange={onMaxChange} />
          </div>

          {/* Stats & Controls */}
          {rangeStats ? (
            <>
              <div className="pt-range-row pt-range-stats">
                <span className="pt-green" title="Avg Buy Volume">
                  ØB: {rangeStats.avgBuyStr}
                </span>
                <span className="pt-red" title="Average Sell Volume">
                  ØS: {rangeStats.avgSellStr}
                </span>
              </div>

              <div className="pt-range-row pt-range-totals">
                <span className="pt-green">ΣB: {rangeStats.sumBuyStr}</span>
                <span className="pt-red">ΣS: {rangeStats.sumSellStr}</span>
                <span className={`pt-range-delta ${rangeStats.totalDelta > 0 ? "pt-green" : "pt-red"}`}>{rangeStats.totalDelta > 0 ? "B" : "S"}</span>
              </div>

              <div className="pt-range-controls">
                <select className="pt-dev-select" value={ui.deviationPct} onChange={onDevChange} title="Deviation %">
                  {DEVIATION_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v > 0 ? `+${v}` : v}%
                    </option>
                  ))}
                </select>

                <button className={`pt-graph-btn ${ui.showOnGraph ? "active" : ""}`} onClick={onToggleGraph}>
                  {ui.showOnGraph ? "ON GRAPH" : "TO GRAPH"}
                </button>
              </div>
            </>
          ) : (
            <div className="pt-range-placeholder">{ui.targetInput ? `Set ${String(ui.targetInput).toUpperCase()}` : "Range Analysis"}</div>
          )}
        </div>

        {/* Grid Header */}
        <div className="pt-head pt-analysis-row pt-analysis-head">
          <span>Px</span>
          <span className="pt-right">Buy</span>
          <span className="pt-right">Sell</span>
          <span className="pt-right">Δ</span>
        </div>

        {/* Grid Body */}
        <div className="pt-scroll">
          {analysisRows.map((row) => (
            <AnalysisRow key={row.key} row={row} onPriceClick={handlePriceClick} />
          ))}
        </div>
      </div>

      {/* --- TAPE PANEL --- */}
      <div className="pt-panel pt-tape">
        <div className="pt-head pt-tape-head">
          <span className="pt-title">{title}</span>
          <span className="pt-muted">Tape</span>
        </div>

        <div className="pt-scroll">
          {tapeRows.map((row) => (
            <TapeRow key={row.key} row={row} />
          ))}
        </div>
      </div>
    </div>
  );
}
