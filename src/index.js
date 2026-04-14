import React from "react";
import ReactDOM from "react-dom/client";
import "modern-normalize/modern-normalize.css";
import "./index.css";
import App from "./components/App";
import { appCore } from "./main.js"; // 1. Импортируем ядро
// 2. Запускаем инициализацию ядра
// Оно начнет грузить данные и поднимать сокеты независимо от React
appCore.init();
console.log(appCore);
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
