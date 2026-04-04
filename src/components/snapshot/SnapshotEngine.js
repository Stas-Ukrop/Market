// ./components/snapshot/SnapshotEngine.js
import html2canvas from "html2canvas";

export const takeFullSnapshot = async (symbol) => {
  try {
    // 1. Получаем текущую дату и время
    const now = new Date();

    // Формат папки (Даты): YYYY-MM-DD
    const dateFolder = now.toISOString().slice(0, 10);

    // Формат времени: HH-MM-SS
    const timeStr = now.toLocaleTimeString("ru-RU", { hour12: false }).replace(/:/g, "-");

    // Имя монеты (если не выбрана, ставим General)
    const safeSymbol = symbol ? symbol.replace(/[\/:]/g, "-") : "General";

    // Итоговое имя файла: "2023-10-27__BTCUSDT__14-30-05.png"
    const fileName = `${dateFolder}__${safeSymbol}__${timeStr}.png`;

    // 2. Захват экрана
    // document.body захватывает вообще всё окно приложения
    const canvas = await html2canvas(document.body, {
      backgroundColor: "#f7f8fa", // Цвет фона (как в CSS)
      scale: 1, // Можно увеличить до 2 для Retina качества (файл будет тяжелее)
      useCORS: true, // Важно для картинок с других доменов
      logging: false,
    });

    // 3. Скачивание файла
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Звуковой эффект затвора камеры (опционально)
    playShutterSound();

    console.log(`[Snapshot] Saved: ${fileName}`);
  } catch (e) {
    console.error("[Snapshot] Error:", e);
  }
};

// Простой звук щелчка камеры
const playShutterSound = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    // Короткий белый шум или "чик"
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.05);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  } catch (e) {}
};
