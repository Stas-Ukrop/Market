// src/components/Trades/PublicTrades.js
import React, { memo, useRef, useState, useMemo, useLayoutEffect, useCallback } from "react";
import styles from "./PublicTrades.module.css";
import { TradesController } from "./TradesController.js";

const DEVIATION_OPTIONS = [-50, -30, -20, -10, 0, 10, 20, 30, 50, 100];

/* ===========================
   Pure sub-components
=========================== */

const TapeRow = memo(({ row }) => (
  <div className={`${styles["pt-trade-row"]} ${styles[row.flashClass]}`}>
    <span className={`${styles["pt-price"]} ${styles[row.sideClass]}`}>{row.priceStr}</span>
    <span className={styles["pt-vol"]}>{row.volStr}</span>
    <span className={styles["pt-time"]}>{row.timeStr}</span>
  </div>
));

const AnalysisRow = memo(({ row, onPriceClick }) => (
  <div className={`${styles["pt-analysis-row"]} ${styles[row.lastClass]}`}>
    <span className={`${styles["pt-bold"]} ${styles["pt-price-action"]}`} onClick={() => onPriceClick(row.priceStr)} title="Click to copy to Range">
      {row.priceStr}
    </span>
    <span className={`${styles["pt-right"]} ${styles["pt-green"]}`}>{row.buyStr}</span>
    <span className={`${styles["pt-right"]} ${styles["pt-red"]}`}>{row.sellStr}</span>
    <span className={`${styles["pt-right"]} ${styles["pt-bold"]} ${styles[row.deltaClass]}`}>{row.deltaStr}</span>
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
     <div className={`${styles["appCol"]} ${styles["appColTrades"]}`}>
      <div className={styles.appTradesWrap}>
            <div className={styles.appTradesHalf}>
    <div className={styles["pt-root"]}>
      {/* --- ANALYSIS PANEL --- */}
      <div className={`${styles["pt-panel"]} ${styles["pt-analysis"]}`}>
        <div className={styles["pt-range-block"]}>
          {/* Inputs Row */}
          <div className={styles["pt-range-row"]}>
            <input className={`${styles["pt-range-input"]} ${ui.targetInput === "min" ? styles["pt-input-target"] : ""}`} placeholder="Min" value={ui.rangeMin} onFocus={onMinFocus} onChange={onMinChange} />
            <span className={styles["pt-range-sep"]}>-</span>
            <input className={`${styles["pt-range-input"]} ${ui.targetInput === "max" ? styles["pt-input-target"] : ""}`} placeholder="Max" value={ui.rangeMax} onFocus={onMaxFocus} onChange={onMaxChange} />
          </div>

          {/* Stats & Controls */}
          {rangeStats ? (
            <>
              <div className={`${styles["pt-range-row"]} ${styles["pt-range-stats"]}`}>
                <span className={styles["pt-green"]} title="Avg Buy Volume">
                  ØB: {rangeStats.avgBuyStr}
                </span>
                <span className={styles["pt-red"]} title="Average Sell Volume">
                  ØS: {rangeStats.avgSellStr}
                </span>
              </div>

              <div className={`${styles["pt-range-row"]} ${styles["pt-range-totals"]}`}>
                <span className={`${styles["pt-green"]}`}>ΣB: {rangeStats.sumBuyStr}</span>
                <span className={styles["pt-red"]}>ΣS: {rangeStats.sumSellStr}</span>
                <span className={`${styles["pt-range-delta"]} ${rangeStats.totalDelta > 0 ? styles["pt-green"] : styles["pt-red"]}`}>{rangeStats.totalDelta > 0 ? "B" : "S"}</span>
              </div>

              <div className={styles["pt-range-controls"]}>
                <select className={styles["pt-dev-select"]} value={ui.deviationPct} onChange={onDevChange} title="Deviation %">
                  {DEVIATION_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v > 0 ? `+${v}` : v}%
                    </option>
                  ))}
                </select>

                <button className={`${styles["pt-graph-btn"]} ${ui.showOnGraph ? styles["active"] : ""}`} onClick={onToggleGraph}>
                  {ui.showOnGraph ? "ON GRAPH" : "TO GRAPH"}
                </button>
              </div>
            </>
          ) : (
            <div className={`${styles["pt-range-placeholder"]}`}>{ui.targetInput ? `Set ${String(ui.targetInput).toUpperCase()}` : "Range Analysis"}</div>
          )}
        </div>

        {/* Grid Header */}
        <div className={`${styles["pt-head"]} ${styles["pt-analysis-row"]} ${styles["pt-analysis-head"]}`}>
          <span>Px</span>
          <span className={styles["pt-right"]}>Buy</span>
          <span className={styles["pt-right"]}>Sell</span>
          <span className={styles["pt-right"]}>Δ</span>
        </div>

        {/* Grid Body */}
        <div className={styles["pt-scroll"]}>
          {analysisRows.map((row) => (
            <AnalysisRow key={row.key} row={row} onPriceClick={handlePriceClick} />
          ))}
        </div>
      </div>

      {/* --- TAPE PANEL --- */}
      <div className={`${styles["pt-panel"]} ${styles["pt-tape"]}`}>
        <div className={`${styles["pt-head"]} ${styles["pt-tape-head"]}`}>
          <span className={styles["pt-title"]}>{title}</span>
          <span className={styles["pt-muted"]}>Tape</span>
        </div>

        <div className={styles["pt-scroll"]}>
          {tapeRows.map((row) => (
            <TapeRow key={row.key} row={row} />
          ))}
        </div>
      </div>
      </div>
        </div>
        </div>
        </div>
      
  );
}
