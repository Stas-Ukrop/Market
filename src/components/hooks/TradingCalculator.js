// src/components/hooks/TradingCalculator.js
import React, { useState, useEffect, useRef } from "react";
import "./TradingCalculator.css";

const toNum = (v, def = 0) => {
  const n = Number(
    String(v ?? "")
      .trim()
      .replace(",", ".")
  );
  return Number.isFinite(n) ? n : def;
};

const calcDecimals = (v) => {
  const s = String(v ?? "");
  const i = s.includes(".") ? s.indexOf(".") : s.includes(",") ? s.indexOf(",") : -1;
  if (i < 0) return 4;
  return Math.max(2, Math.min(8, s.length - i - 1));
};

const fundingIsIncome = (isLong, fundingRatePct) => {
  const f = toNum(fundingRatePct, 0);
  if (f === 0) return false;
  if (f > 0) return !isLong;
  return isLong;
};

// --- КОМПОНЕНТ ПАНЕЛИ ---
const CalcPanel = ({
  title,
  isSpot,
  currentPrice,
  currentFunding,
  defaultDeposit = 1000,
  defaultRiskPct = 1, // Рискуем 1% от депозита
  defaultStopDist = 1, // Стоп на расстоянии 1%
  onApplyToGraph, // [NEW] Callback
}) => {
  const [direction, setDirection] = useState("long");

  // ВВОДНЫЕ ДАННЫЕ
  const [deposit, setDeposit] = useState(defaultDeposit);
  const [riskMoneyPct, setRiskMoneyPct] = useState(defaultRiskPct); // Риск деньгами (%)

  const [entry, setEntry] = useState(0);
  const [stopDistPct, setStopDistPct] = useState(defaultStopDist); // Дистанция стопа (%)
  const [stopPrice, setStopPrice] = useState(0); // Цена стопа (расчетная)

  const [leverageCap, setLeverageCap] = useState(isSpot ? 1 : 10);
  const [feeRate, setFeeRate] = useState(isSpot ? 0.1 : 0.06);
  const [fundingRate, setFundingRate] = useState(isSpot ? 0 : toNum(currentFunding, 0.01));

  const [results, setResults] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(null);

  const initializedRef = useRef(false);

  // --- 1. АВТО-ИНИЦИАЛИЗАЦИЯ (СТРОГО ОДИН РАЗ) ---
  useEffect(() => {
    // Если уже инициализировали - игнорируем любые изменения входных данных
    if (initializedRef.current) return;

    const p = toNum(currentPrice, 0);
    // Если цена пока невалидна (0 или загружается) - ждем следующего обновления
    if (p <= 0) return;

    // Инициализируем значения
    setEntry(p);

    const dist = p * (defaultStopDist / 100);
    const sl = p - dist;
    const dp = calcDecimals(p);

    setStopPrice(Number(sl.toFixed(dp)));
    setStopDistPct(defaultStopDist);

    if (!isSpot) setFundingRate(toNum(currentFunding, 0.01));

    // Ставим флаг, что инициализация прошла. Больше этот блок не выполнится.
    initializedRef.current = true;
  }, [currentPrice, currentFunding, isSpot, defaultStopDist]);

  // --- 2. Handlers ---
  const handleStopDistChange = (val) => {
    setStopDistPct(val);
    const dPct = toNum(val, 0);
    const ent = toNum(entry, 0);
    if (ent > 0) {
      const dist = ent * (dPct / 100);
      const sl = direction === "long" ? ent - dist : ent + dist;
      const dp = calcDecimals(ent);
      setStopPrice(Number(sl.toFixed(dp)));
    }
  };

  const handleStopPriceChange = (val) => {
    const sl = toNum(val, 0);
    setStopPrice(val);
    const ent = toNum(entry, 0);
    if (ent > 0 && sl > 0) {
      const distPoints = Math.abs(ent - sl);
      const dPct = (distPoints / ent) * 100;
      setStopDistPct(dPct.toFixed(2));
    }
  };

  useEffect(() => {
    const ent = toNum(entry, 0);
    const dPct = toNum(stopDistPct, 0);
    if (ent > 0) {
      const dist = ent * (dPct / 100);
      const sl = direction === "long" ? ent - dist : ent + dist;
      const dp = calcDecimals(ent);
      setStopPrice(Number(sl.toFixed(dp)));
    }
  }, [direction]);

  const handleCopy = (text, label) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopyFeedback(label);
      setTimeout(() => setCopyFeedback(null), 900);
    });
  };

  // [NEW] Logic to generate chart lines
  const handleSendToGraph = () => {
    if (!results || !onApplyToGraph) return;

    const lines = [];

    // 1. Entry
    lines.push({ price: toNum(entry), color: "#2196f3", title: "ENTRY", lineWidth: 2, lineStyle: 0 }); // Solid Blue

    // 2. Stop Loss
    lines.push({
      price: toNum(stopPrice),
      color: "#ef5350",
      title: `SL (-$${results.riskAmount.toFixed(1)})`,
      lineWidth: 2,
      lineStyle: 0,
    }); // Solid Red

    // 3. Take Profits
    lines.push({ price: results.tp2Price, color: "#00bfa5", title: "TP 1:2", lineWidth: 1, lineStyle: 2 }); // Dashed Green
    lines.push({ price: results.tp3Price, color: "#00bfa5", title: "TP 1:3", lineWidth: 1, lineStyle: 2 });

    // 4. Break Even
    lines.push({ price: results.breakEvenPrice, color: "#9e9e9e", title: "BE", lineWidth: 1, lineStyle: 2 }); // Dashed Gray

    // 5. Liquidation (if applicable)
    if (results.liqPrice > 0) {
      lines.push({ price: results.liqPrice, color: "#ff9800", title: "LIQ", lineWidth: 1, lineStyle: 0 }); // Orange
    }

    onApplyToGraph(lines);
  };

  // --- 3. ГЛАВНЫЙ РАСЧЕТ ---
  useEffect(() => {
    const dep = toNum(deposit, 0);
    const riskM_Pct = toNum(riskMoneyPct, 0);
    const ent = toNum(entry, 0);
    const stopDist_Pct = toNum(stopDistPct, 0);

    const fee = Math.max(0, toNum(feeRate, 0));
    const fund = isSpot ? 0 : toNum(fundingRate, 0);
    const levCap = isSpot ? 1 : Math.max(1, toNum(leverageCap, 10));

    setErrorMsg("");

    if (!(dep > 0 && ent > 0 && stopDist_Pct > 0)) {
      setResults(null);
      return;
    }

    const isLong = direction === "long";

    // 1. Риск в долларах
    const riskAmount = dep * (riskM_Pct / 100);

    // 2. Размер позиции (Position Size)
    const distDec = stopDist_Pct / 100;
    const posSizeUSDT = riskAmount / distDec;
    const posSizeCoins = posSizeUSDT / ent;

    // 3. Эффективное плечо
    const effectiveLev = posSizeUSDT / dep;

    // 4. Комиссии
    const feeDec = fee / 100;
    const estimatedFee = posSizeUSDT * feeDec * 2;
    const fVal = posSizeUSDT * (Math.abs(fund) / 100);
    const fIncome = !isSpot && fundingIsIncome(isLong, fund);
    const fundingSigned = isSpot ? 0 : fIncome ? +fVal : -fVal;

    // 5. Ликвидация
    let liqPrice = 0;
    let liqWarning = false;
    const mmrBuffer = 0.005;

    if (!isSpot) {
      liqPrice = isLong ? ent * (1 - 1 / levCap + mmrBuffer) : ent * (1 + 1 / levCap - mmrBuffer);

      const slPrice = toNum(stopPrice, 0);
      if (slPrice > 0) {
        if (isLong && liqPrice >= slPrice) liqWarning = true;
        if (!isLong && liqPrice <= slPrice) liqWarning = true;
      }
    }

    // 6. Тейки
    const distPoints = ent * distDec;
    const tp2Price = isLong ? ent + distPoints * 2 : ent - distPoints * 2;
    const tp3Price = isLong ? ent + distPoints * 3 : ent - distPoints * 3;
    const profit2Amt = riskAmount * 2;
    const profit3Amt = riskAmount * 3;

    // Безубыток
    const feeCostPrice = ent * (feeDec * 2);
    const breakEvenPrice = isLong ? ent + feeCostPrice : ent - feeCostPrice;

    const dp = calcDecimals(ent);

    setResults({
      side: isLong ? "LONG" : "SHORT",
      riskAmount,
      posSizeUSDT,
      posSizeCoins,
      effectiveLev,
      estimatedFee,
      fundingSigned,
      liqPrice,
      liqWarning,
      breakEvenPrice,
      tp2Price,
      tp3Price,
      tp2Profit: profit2Amt,
      tp3Profit: profit3Amt,
      dp,
    });
  }, [direction, deposit, riskMoneyPct, entry, stopDistPct, stopPrice, leverageCap, feeRate, fundingRate, isSpot]);

  return (
    <div className="calc-panel">
      <div className="calc-panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{title}</span>
        {results && (
          <button
            onClick={handleSendToGraph}
            style={{
              background: "#e3f2fd",
              border: "1px solid #2196f3",
              color: "#2196f3",
              cursor: "pointer",
              fontSize: "10px",
              padding: "2px 6px",
              borderRadius: "4px",
              fontWeight: "bold",
            }}
            title="Show Entry/SL/TP on Graph"
          >
            👁️ Graph
          </button>
        )}
      </div>

      <div className="calc-switch-row">
        <button className={`calc-switch-btn ${direction === "long" ? "active-long" : ""}`} onClick={() => setDirection("long")}>
          LONG
        </button>
        <button className={`calc-switch-btn ${direction === "short" ? "active-short" : ""}`} onClick={() => setDirection("short")}>
          SHORT
        </button>
      </div>

      <div className="calc-grid-inputs-3col">
        <div className="calc-inp-group">
          <label data-tooltip="Ваш рабочий депозит ($)">Dep</label>
          <input type="number" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </div>
        <div className="calc-inp-group">
          <label data-tooltip="Риск на сделку (% от депозита)">Risk %</label>
          <input type="number" value={riskMoneyPct} onChange={(e) => setRiskMoneyPct(e.target.value)} />
        </div>
        <div className="calc-inp-group">
          <label data-tooltip={isSpot ? "Откл. на споте" : "Макс. плечо биржи (для Ликвид.)"}>Lev</label>
          <input type="number" value={leverageCap} onChange={(e) => setLeverageCap(e.target.value)} disabled={isSpot} style={isSpot ? { opacity: 0.5 } : {}} />
        </div>
      </div>

      <div className="calc-grid-inputs-2col" style={{ marginTop: 6 }}>
        <div className="calc-inp-group">
          <label data-tooltip="Комиссия (Taker)">Fee %</label>
          <input type="number" step="0.01" value={feeRate} onChange={(e) => setFeeRate(e.target.value)} />
        </div>
        {!isSpot && (
          <div className="calc-inp-group">
            <label data-tooltip="Фандинг (8ч)">Fund %</label>
            <input type="number" step="0.0001" value={fundingRate} onChange={(e) => setFundingRate(e.target.value)} />
          </div>
        )}
      </div>

      <div className="calc-row full-width" style={{ marginTop: 4 }}>
        <span className="calc-label" data-tooltip="Цена входа">
          Entry Price
        </span>
        <input className="calc-input-large" type="number" value={entry} onChange={(e) => setEntry(e.target.value)} />
      </div>
      <div className="calc-row full-width">
        <span className="calc-label" data-tooltip="Дистанция до стопа (%)">
          Stop Dist %
        </span>
        <input className="calc-input-large" type="number" value={stopDistPct} onChange={(e) => handleStopDistChange(e.target.value)} />
      </div>

      <div className="calc-divider" />

      {errorMsg && <div className="calc-error">{errorMsg}</div>}

      {results ? (
        <div className="calc-results-container">
          <div className={`res-group ${results.liqWarning ? "border-red" : ""}`}>
            {!isSpot && (
              <div className="res-row">
                <span className="calc-res-label" data-tooltip="Цена Ликвидации">
                  Liq Price:
                </span>
                <span className={`val-bold ${results.liqWarning ? "val-red blink-anim" : ""}`}>{results.liqPrice.toFixed(results.dp)}</span>
              </div>
            )}
            {results.liqWarning && <div className="calc-liq-warn">⚠️ STOP LOSS WILL FAIL!</div>}
            <div className="res-row sub-metric">
              <span data-tooltip="Точка безубытка">BreakEven:</span>
              <span style={{ color: "#7f8c8d" }}>{results.breakEvenPrice.toFixed(results.dp)}</span>
            </div>
          </div>

          <div className="res-group">
            <div className="res-row main-metric">
              <span data-tooltip="Сколько $ потеряете при стопе">Loss:</span>
              <span className="val-red">-${results.riskAmount.toFixed(2)}</span>
              <span data-tooltip="Цена Стоп-лосса" style={{ fontSize: 10, color: "#999", marginLeft: 6 }}>
                (@{toNum(stopPrice).toFixed(results.dp)})
              </span>
            </div>

            <div className="res-row" style={{ alignItems: "center", marginTop: 4 }}>
              <span className="calc-res-label" data-tooltip="Размер позиции в монетах (Скопируйте)">
                Size:
              </span>
              <div className="copy-row" onClick={() => handleCopy(results.posSizeCoins.toFixed(5), "amnt")}>
                <span className="val-bold" style={{ color: "#2980b9", cursor: "pointer" }}>
                  {results.posSizeCoins.toFixed(4)} ❐
                </span>
                {copyFeedback === "amnt" && <span className="copy-ok">ok</span>}
              </div>
            </div>

            <div className="res-row sub-metric" style={{ marginTop: 2 }}>
              <span data-tooltip="Комиссия / Фандинг">Fee/Fund:</span>
              <span>
                <span className="val-orange">-{results.estimatedFee.toFixed(2)}$</span>
                {!isSpot && (
                  <>
                    {" / "}
                    <span style={{ color: results.fundingSigned >= 0 ? "#27ae60" : "#e74c3c" }}>
                      {results.fundingSigned >= 0 ? "+" : ""}
                      {results.fundingSigned.toFixed(4)}$
                    </span>
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="calc-divider" />

          <div className="res-header">Targets (R:R)</div>

          <div className="res-target-row">
            <div className="target-label">1:2</div>
            <div className="target-data">
              <span className="target-price">{results.tp2Price.toFixed(results.dp)}</span>
              <span className="target-profit">+{results.tp2Profit.toFixed(2)}$</span>
            </div>
          </div>
          <div className="res-target-row">
            <div className="target-label">1:3</div>
            <div className="target-data">
              <span className="target-price">{results.tp3Price.toFixed(results.dp)}</span>
              <span className="target-profit">+{results.tp3Profit.toFixed(2)}$</span>
            </div>
          </div>
        </div>
      ) : (
        !errorMsg && <div className="calc-placeholder">Enter Entry & Stop%</div>
      )}
    </div>
  );
};

export const TradingCalculator = ({
  onClose,
  isSpot,
  tickerPrice, // Конкретная цена для этого графика
  fundingRate, // Фандинг (если есть)
  onApplyToGraph, // [NEW] Callback
}) => {
  return (
    <div className="calc-overlay">
      <div className="calc-header">
        <span>{isSpot ? "SPOT Calc" : "FUTURES Calc"}</span>
        <button className="calc-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="calc-body">
        <CalcPanel title={isSpot ? "SPOT" : "FUTURES"} isSpot={isSpot} currentPrice={tickerPrice} currentFunding={fundingRate} defaultRiskPct={1} defaultStopDist={isSpot ? 2 : 1} onApplyToGraph={onApplyToGraph} />
      </div>
    </div>
  );
};
