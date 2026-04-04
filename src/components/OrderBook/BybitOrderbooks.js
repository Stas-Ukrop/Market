// src/components/OrderBook/BybitOrderbooks.js
import React, { memo } from "react";
import { FixedSizeList as List, areEqual } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import "./BybitOrderbooks.css";

const ROW_H = 18;

const StatusDot = memo(({ status }) => {
  const s = String(status || "idle");
  const color = s === "live" ? "#26a69a" : s === "stale" ? "#ff9800" : "#999";
  return <span className="ob-dot" style={{ backgroundColor: color }} title={s} />;
});

const Row = memo(({ index, style, data }) => {
  const { items, type, offsetY = 0 } = data;
  const row = items[index];
  if (!row) return <div style={style} className={`ob-row ${type}`} />;

  const top = parseFloat(style.top) || 0;
  const finalStyle = type === "ask" ? { ...style, top: top + offsetY } : style;

  return (
    <div style={finalStyle} className={`ob-row ${type}${row.isStrong ? " strong" : ""}`}>
      <div className="ob-bg-bar" style={{ width: `${row.sizePct}%` }} />
      <span className="ob-price">{row.priceStr}</span>
      <span className="ob-size">{row.sizeStr}</span>
      <span className="ob-cum">{row.cumStr}</span>
    </div>
  );
}, areEqual);

const OrderbookPanel = memo(({ title, view }) => {
  const { asks = [], bids = [], bestBidStr, bestAskStr, midStr, bidRatio, domPct, spreadAbsStr, spreadPctStr, askCumStr, bidCumStr, status, symbol } = view || {};

  const br = bidRatio ?? 0.5;
  const domClass = br >= 0.55 ? "bid" : br <= 0.45 ? "ask" : "flat";
  const domLabel = br >= 0.55 ? "Buyers" : br <= 0.45 ? "Sellers" : "Neutral";

  return (
    <div className="ob-panel">
      <div className="ob-head">
        <div className="ob-head-left">
          <StatusDot status={status} />
          <b className="ob-title">{title}</b>
          <span className="ob-symbol">{symbol || "—"}</span>
        </div>
      </div>

      <div className="ob-body">
        <div className="ob-side asks">
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

        <div className="ob-mid">
          <div className="ob-mid-sub">
            <span className="ob-mid-price">B: {bestBidStr}</span>
            <span className="ob-mid-price">P: {midStr}</span>
            <span className="ob-mid-price">A: {bestAskStr}</span>
          </div>

          <div className="ob-imbalance-bar" title={`ASK ${askCumStr} | BID ${bidCumStr}`}>
            <div className="ob-imbalance-ask" style={{ width: `${(1 - br) * 100}%` }} />
            <div className="ob-imbalance-bid" style={{ width: `${br * 100}%` }} />
          </div>

          <div className="ob-imbalance-meta">
            <span className={`ob-dom ${domClass}`}>
              {domLabel}: {domPct}%
            </span>
            <span className="ob-spread">
              Spr: {spreadAbsStr} ({spreadPctStr})
            </span>
          </div>
        </div>

        <div className="ob-side bids">
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
    <div className="ob-root">
      <div className="ob-caption">
        <b>Orderbook</b>
        <span className="ob-muted">{coin || ""}</span>

        <button
          className="ob-btn-search"
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

        <div className="ob-caption-controls">
          <span className="ob-muted">Rows:</span>
          <select className="ob-select" value={rows} onChange={(e) => onRowsChange(Number(e.target.value))}>
            {[20, 35, 50, 100, 200].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="ob-grid">
        <OrderbookPanel title="SPOT" view={spotView} />
        <OrderbookPanel title="LINEAR" view={linearView} />
      </div>
    </div>
  );
}
