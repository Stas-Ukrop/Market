// src/components/Tickers/Tickers.js
import React, { useMemo, useRef, useState, useEffect, memo } from "react";
import { FixedSizeList as List, areEqual } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";

import styles from "./Tickers.module.css";
import { TickerController, PRICE_RANGES } from "./TickerController.js";
import MarketStats from "./MarketStats.js";

const PriceCell = memo(function PriceCell({ text, num }) {
  const prev = useRef(num);
  const [trend, setTrend] = useState(null);

  useEffect(() => {
    const p = prev.current;
    if (Number.isFinite(num) && Number.isFinite(p) && num !== p) {
      setTrend(num > p ? "up" : "down");
    }
    prev.current = num;
  }, [num]);

  return <div className={`${styles.price_cell} ${trend === "up" ? `${styles.trend_up}` : trend === "down" ? `${styles.trend_down}` : ""}`}>{text}</div>;
});

const Row = memo(function Row({ index, style, data }) {
  const row = data.rows[index];
  const { onRowClick } = data;

  const cellR = { textAlign: "right", paddingRight: 6 };
  const cellL = { textAlign: "left" };

  return (
    <div style={style} className={`${styles.Tickers_row} ${row.active ? `${styles.selected}` : ""}`} onClick={() => onRowClick(row)}>
      <div style={{ ...cellL, fontWeight: 700 }}>
        {index + 1}. {row.baseId}
        {row.quote !== "USDT" ? <span style={{ fontWeight: 400, color: "#666" }}>/{row.quote}</span> : null}
      </div>

      <div style={cellL}>{row.spot.symbol}</div>
      <PriceCell text={row.spot.priceStr} num={row.spot.rawPrice} />
      <div style={{ ...cellR, color: row.spot.pcntColor }}>{row.spot.pcntStr}</div>

      <div style={cellL} className={row.linear.symClass}>
        {row.linear.symbol}
      </div>
      <PriceCell text={row.linear.priceStr} num={row.linear.rawPrice} />
      <div style={{ ...cellR, color: row.linear.pcntColor }}>{row.linear.pcntStr}</div>
      <div style={{ ...cellR, fontSize: 10, color: "#555" }}>{row.linear.oiStr}</div>
    </div>
  );
}, areEqual);

export default function Tickers({ itemsMap, q, onQ, selectedId, onPick, controller, tick }) {
  const ctrlRef = useRef(null);
  if (!ctrlRef.current) ctrlRef.current = controller || new TickerController();
  const ctrl = ctrlRef.current;

  const [sortConfig, setSortConfig] = useState({ key: "linOI", dir: "desc" });
  // Старый фильтр (чекбоксы)
  const [filterMode, setFilterMode] = useState("all");
  // Новый фильтр (выпадающий список наличия рынков)
  const [marketPresence, setMarketPresence] = useState("all");
  const [rangeKey, setRangeKey] = useState("от min до max");

  const viewRows = useMemo(() => ctrl.process(itemsMap, { q, filterMode, marketPresence, rangeKey, sortConfig, selectedId }), [ctrl, itemsMap, q, filterMode, marketPresence, rangeKey, sortConfig, selectedId, tick]);

  const handleSort = (key) => {
    setSortConfig((p) => (p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  };

  const itemData = useMemo(() => ({ rows: viewRows, onRowClick: (row) => onPick?.(row.baseId) }), [viewRows, onPick]);

  const cellR = { textAlign: "right", paddingRight: 6 };
  const cellL = { textAlign: "left" };

  const renderHead = (label, key, style = {}) => {
    const active = sortConfig.key === key;
    const arrow = active ? (sortConfig.dir === "asc" ? "▲" : "▼") : "";
    return (
      <div className={`styles.sortable_head ${active ? "active" : ""}`} style={style} onClick={() => handleSort(key)}>
        {label} <span className="sort-arrow">{arrow}</span>
      </div>
    );
  };

  return (
            <div className={`${styles.appCol} ${styles.appColTickers}`}>
          <div className={styles.appBody}>
    <div className={styles.Tickers_root}>
      <div className={styles.Tickers_top}>
        <div className={styles.Tickers_controls}>
          <input className={styles.Tickers_search} value={q} onChange={(e) => onQ?.(e.target.value)} placeholder="Search (BTC)..." />

          {/* НОВЫЙ ФИЛЬТР: Выбор типа рынка (между поиском и старым фильтром) */}
          <select className={styles.Tickers_presence_select} value={marketPresence} onChange={(e) => setMarketPresence(e.target.value)}>
            <option value="all">Показать все</option>
            <option value="both">Спот + Фьючерс (Пары)</option>
            <option value="spot_only">Только Спот</option>
            <option value="linear_only">Только Фьючерс</option>
          </select>

          {/* СТАРЫЙ ФИЛЬТР (Filter Bar) - оставлен без изменений */}
          <div className={styles.Tickers_filter_bar}>
            <span>Filter:</span>
            <select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} disabled={filterMode === "all"}>
              {Object.keys(PRICE_RANGES).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <label>
              <input type="checkbox" checked={filterMode === "spot"} onChange={() => setFilterMode(filterMode === "spot" ? "all" : "spot")} /> Spot
            </label>
            <label>
              <input type="checkbox" checked={filterMode === "linear"} onChange={() => setFilterMode(filterMode === "linear" ? "all" : "linear")} /> Perp
            </label>
            <label>
              <input type="checkbox" checked={filterMode === "all"} onChange={() => setFilterMode("all")} /> All
            </label>
          </div>
        </div>

        <MarketStats symbol={selectedId} controller={ctrl} />

        <div className={styles.Tickers_head}>
          {renderHead("Coin", "baseId", cellL)}
          <div style={cellL}>Spot</div>
          {renderHead("Price", "spotPrice", cellR)}
          {renderHead("24h%", "spotPcnt", cellR)}
          <div style={cellL}>Linear</div>
          {renderHead("Price", "linPrice", cellR)}
          {renderHead("24h%", "linPcnt", cellR)}
          {renderHead("OI", "linOI", cellR)}
        </div>

        <div style={{ fontSize: 10, color: "#999", padding: "2px 8px", textAlign: "right" }}>Count: {viewRows.length}</div>
      </div>

      <div className={styles.Tickers_body}>
        <AutoSizer>
          {({ height, width }) => (
            <List height={height} width={width} itemCount={viewRows.length} itemSize={32} itemData={itemData}>
              {Row}
            </List>
          )}
        </AutoSizer>
      </div>
      </div>
            </div>
 </div>
  );
}
