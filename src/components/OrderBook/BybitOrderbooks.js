// src/components/OrderBook/BybitOrderbooks.js
import React, { memo } from "react";
import { FixedSizeList as List, areEqual } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import styles from "./BybitOrderbooks.module.css";

const ROW_H = 18;

const StatusDot = memo(({ status }) => {
  const s = String(status || "idle");
  const color = s === "live" ? "#26a69a" : s === "stale" ? "#ff9800" : "#999";
  return <span className={styles["ob-dot"]} style={{ backgroundColor: color }} title={s} />;
});

const Row = memo(({ index, style, data }) => {
  const { items, type, offsetY = 0 } = data;
  const row = items[index];
  if (!row) return <div style={style} className={`${styles["ob-row"]} ${styles[type]}`} />;

  const top = parseFloat(style.top) || 0;
  const finalStyle = type === "ask" ? { ...style, top: top + offsetY } : style;

  return (
    <div style={finalStyle} className={`${styles["ob-row"]} ${styles[type]} ${row.isStrong ? styles["strong"] : ""}`}>
      <div className={styles["ob-bg-bar"]} style={{ width: `${row.sizePct}%` }} />
      <span className={styles["ob-price"]}>{row.priceStr}</span>
      <span className={styles["ob-size"]}>{row.sizeStr}</span>
      <span className={styles["ob-cum"]}>{row.cumStr}</span>
    </div>
  );
}, areEqual);

const OrderbookPanel = memo(({ title, view }) => {
  const { asks = [], bids = [], bestBidStr, bestAskStr, midStr, bidRatio, domPct, spreadAbsStr, spreadPctStr, askCumStr, bidCumStr, status, symbol } = view || {};

  const br = bidRatio ?? 0.5;
  const domClass = br >= 0.55 ? "bid" : br <= 0.45 ? "ask" : "flat";
  const domLabel = br >= 0.55 ? "Buyers" : br <= 0.45 ? "Sellers" : "Neutral";

  return (
    <div className={styles["ob-panel"]}>
      <div className={styles["ob-head"]}>
        <div className={styles["ob-head-left"]}>
          <StatusDot status={status} />
          <b className={styles["ob-title"]}>{title}</b>
          <span className={styles["ob-symbol"]}>{symbol || "—"}</span>
        </div>
      </div>

      <div className={styles["ob-body"]}>
        <div className={`${styles["ob-side"]} ${styles.asks}`}>
          <AutoSizer>
            {({ height, width }) => {
              const totalH = asks.length * ROW_H;
              const offsetY = Math.max(0, height - totalH);
              return (
                <List height={height} width={width} itemCount={asks.length} itemSize={ROW_H} itemData={{ items: asks, type: "ask", offsetY }}>
                  {Row}
                </List>
              );
            }}
          </AutoSizer>
        </div>

        <div className={styles["ob-mid"]}>
          <div className={styles["ob-mid-sub"]}>
            <span className={styles["ob-mid-price"]}>B: {bestBidStr}</span>
            <span className={styles["ob-mid-price"]}>P: {midStr}</span>
            <span className={styles["ob-mid-price"]}>A: {bestAskStr}</span>
          </div>

          <div className={styles["ob-imbalance-bar"]} title={`ASK ${askCumStr} | BID ${bidCumStr}`}>
            <div className={styles["ob-imbalance-ask"]} style={{ width: `${(1 - br) * 100}%` }} />
            <div className={styles["ob-imbalance-bid"]} style={{ width: `${br * 100}%` }} />
          </div>

          <div className={styles["ob-imbalance-meta"]}>
            <span className={`${styles["ob-dom"]} ${domClass}`}>
              {domLabel}: {domPct}%
            </span>
            <span className={styles["ob-spread"]}>
              Spr: {spreadAbsStr} ({spreadPctStr})
            </span>
          </div>
        </div>

        <div className={`${styles["ob-side"]} ${styles.bids}`}>
          <AutoSizer>
            {({ height, width }) => (
              <List height={height} width={width} itemCount={bids.length} itemSize={ROW_H} itemData={{ items: bids, type: "bid", offsetY: 0 }}>
                {Row}
              </List>
            )}
          </AutoSizer>
        </div>
      </div>
    </div>
  );
});

export default function BybitOrderbooks({ coin, spotView, linearView, rows, onRowsChange, onToggleAnalysis, isAnalyzing }) {
  return (
    <div className={`${styles.appCol} ${styles.appColOrderbook}`}>
      <div className={styles.appObWrap}>
        <div className={styles.appObBody}>
          <div className={styles["ob-root"]}>
            <div className={styles["ob-caption"]}>
              <b>Orderbook</b>
              <span className={styles["ob-muted"]}>{coin || ""}</span>

              <button
                className={styles["ob-btn"]}
                onClick={onToggleAnalysis}
                title={isAnalyzing ? "Stop searching" : "Find Walls and Spoof Levels"}
                style={{
                  marginLeft: 8,
                  cursor: "pointer",
                  padding: "2px 8px",
                  fontSize: "11px",
                  background: isAnalyzing ? "#ef5350" : "#2196f3",
                  color: "white",
                  border: "none",
                  borderRadius: "3px",
                  fontWeight: isAnalyzing ? "bold" : "normal",
                }}
              >
                {isAnalyzing ? "Stop Search" : "Search Walls"}
              </button>

              <div className={styles["ob-caption-controls"]}>
                <span className={styles["ob-muted"]}>Rows:</span>
                <select className={styles["ob-select"]} value={rows} onChange={(e) => onRowsChange(Number(e.target.value))}>
                  {[20, 35, 50, 100, 200].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles["ob-grid"]}>
              <OrderbookPanel title="SPOT" view={spotView} />
              <OrderbookPanel title="LINEAR" view={linearView} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
