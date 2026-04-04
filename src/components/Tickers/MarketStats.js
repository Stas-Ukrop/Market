// src/components/Tickers/MarketStats.js
import React, { useEffect, useRef, useState, useMemo } from "react";
import * as LWC from "lightweight-charts";

const MODES = [
  { id: "oi", label: "Open Interest (OI)", type: "Line" },
  { id: "ls", label: "Long/Short Ratio", type: "Histogram" },
  { id: "funding", label: "Funding Rate %", type: "Histogram" },
];

export default function MarketStats({ symbol, controller }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  const [modeIdx, setModeIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  const currentMode = MODES[modeIdx];

  // Нормализация имени для отображения (убираем лишние :linear:...)
  const displaySymbol = useMemo(() => {
    if (!symbol) return "BTC";
    const str = String(symbol);
    if (str.includes(":")) {
      const parts = str.split(":");
      return parts[2] || "BTC";
    }
    return str;
  }, [symbol]);

  // 1. Создание графика (один раз)
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = LWC.createChart(containerRef.current, {
      layout: { background: { color: "#ffffff" }, textColor: "#333", fontSize: 10 },
      grid: { vertLines: { color: "#f9f9f9" }, horzLines: { color: "#f9f9f9" } },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
        visible: true,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        fixLeftEdge: true,
      },
      crosshair: { vertLine: { labelVisible: false } },
      handleScroll: false,
      handleScale: false,
    });

    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      if (!containerRef.current || !chartRef.current) return;
      const rect = entries[0].contentRect;
      chart.applyOptions({ width: rect.width, height: rect.height });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // 2. Логика данных и обновления серии
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    let isActive = true; // Флаг: предотвращает обновление, если монета уже сменилась

    // --- А. Создаем новую серию ---
    let newSeries = null;
    try {
      if (currentMode.type === "Line") {
        newSeries = chart.addSeries(LWC.AreaSeries, {
          topColor: "rgba(33, 150, 243, 0.4)",
          bottomColor: "rgba(33, 150, 243, 0.0)",
          lineColor: "#2196f3",
          lineWidth: 2,
          priceFormat: { type: "volume" },
        });
      } else {
        newSeries = chart.addSeries(LWC.HistogramSeries, {
          priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
        });
      }
      seriesRef.current = newSeries;
    } catch (e) {
      console.error("Chart addSeries error:", e);
    }

    // --- Б. Загружаем данные через Controller ---
    const load = async () => {
      if (!isActive) return;
      setLoading(true);

      try {
        let data = [];
        // Используем метод из контроллера, переданного в props
        if (controller && typeof controller.fetchStats === "function") {
          data = await controller.fetchStats(currentMode.id, displaySymbol);
        }

        // Если пока грузились, пользователь переключил монету - ничего не делаем
        if (!isActive) return;

        if (newSeries) {
          const validData = Array.isArray(data) ? data : [];
          newSeries.setData(validData);

          if (validData.length > 0) {
            chart.timeScale().fitContent();
          }
        }
      } catch (err) {
        console.error("MarketStats load error:", err);
      } finally {
        if (isActive) setLoading(false);
      }
    };

    load();

    // --- В. Очистка (Cleanup) при смене монеты ---
    return () => {
      isActive = false; // Отменяем обработку результата старого запроса

      // Удаляем серию графика перед созданием новой
      if (chart && newSeries) {
        try {
          chart.removeSeries(newSeries);
        } catch (e) {
          // Игнорируем ошибки удаления
        }
      }
      seriesRef.current = null;
    };
  }, [displaySymbol, currentMode, controller]);

  const handlePrev = () => setModeIdx((prev) => (prev - 1 + MODES.length) % MODES.length);
  const handleNext = () => setModeIdx((prev) => (prev + 1) % MODES.length);

  return (
    <div className="ms-root">
      <div className="ms-header">
        <button className="ms-nav-btn" onClick={handlePrev}>
          &lt;
        </button>
        <div className="ms-title-box">
          <span className="ms-symbol">{displaySymbol}</span>
          <span className="ms-label">{currentMode.label}</span>
        </div>
        <button className="ms-nav-btn" onClick={handleNext}>
          &gt;
        </button>
      </div>
      <div className="ms-chart-wrap" ref={containerRef}>
        {loading && <div className="ms-loading">Загрузка...</div>}
      </div>
    </div>
  );
}
