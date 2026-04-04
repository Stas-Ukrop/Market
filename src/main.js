// src/main.js
import { ItemsSchema } from "./components/Core/BybitKernel.js";
import { BybitServerKernel } from "./components/Core/BybitServerKernel.js";
import { takeFullSnapshot } from "./components/snapshot/SnapshotEngine.js";

// Controllers
import { OrderbookController } from "./components/OrderBook/OrderbookController.js";
import { TradesController } from "./components/Trades/TradesController.js";
import { TickerController } from "./components/Tickers/TickerController.js";

// Helpers (перенесены из App.js для универсального доступа)
export const upper = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();
export const lower = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();

export const parseRouteId = (id) => {
  const p = String(id ?? "")
    .trim()
    .split(":");
  if (p.length < 4) return { exchange: "", marketType: "", symbol: "", quote: "" };
  return { exchange: lower(p[0]), marketType: lower(p[1]), symbol: upper(p[2]), quote: upper(p[3]) };
};

export const pickRoute = (item, marketType, quote = "") => {
  const mt = lower(marketType);
  const q = upper(quote);
  const routes = item?.routesById ? Object.values(item.routesById) : [];
  for (const r of routes) {
    const meta = parseRouteId(r?.id);
    if (meta.exchange !== "bybit") continue;
    if (meta.marketType !== mt) continue;
    if (q && meta.quote !== q) continue;
    return r;
  }
  // Если квота не совпала, пробуем найти любой подходящий тип рынка (fallback)
  if (q) {
    for (const r of routes) {
      const meta = parseRouteId(r?.id);
      if (meta.exchange !== "bybit") continue;
      if (meta.marketType !== mt) continue;
      return r;
    }
  }
  return null;
};

// Selectors
export const pickTradeChunk = (route) => route?.chunks?.publicTrade || route?.chunk?.publicTrade || null;
export const pickKlineChunk = (route) => route?.chunks?.kline || route?.chunk?.kline || null;

class CoreApplication {
  constructor() {
    // 1. Core State
    this.schema = new ItemsSchema();
    this.kernel = null; // Будет инициализирован в init()
    this.itemsMap = new Map();
    this.routeToBase = new Map();
    this.activeCoin = ""; // Текущая выбранная монета

    // 2. Controllers (Singleton instances)
    this.obCtrl = new OrderbookController();
    this.spotTradesCtrl = new TradesController();
    this.linearTradesCtrl = new TradesController();
    this.tickerCtrl = new TickerController();

    // 3. UI Bridge
    this.uiCallback = null; // Функция bump() из React
    this.rafId = 0;
    this.isDirty = false;
    this.ready = false;
    this.error = "";
  }

  // Привязка UI (React вызывает это при маунте)
  bindUI(callback) {
    this.uiCallback = callback;
  }

  // Основной цикл уведомления UI (Debounced RAF)
  bump() {
    if (this.isDirty) return;
    this.isDirty = true;
    this.rafId = requestAnimationFrame(() => {
      this.isDirty = false;
      if (this.uiCallback) this.uiCallback();
    });
  }

  // Логика выбора монеты (вызывается из UI)
  selectCoin(idOrBase, options = {}) {
    const { grafInterval = "5m", grafBarsLimit = 200 } = options;

    // 1. Проверяем монету через контроллер тикеров
    const details = this.tickerCtrl.getSubscriptionDetails(this.itemsMap, idOrBase);
    if (!details) return;

    const { baseId } = details;
    this.activeCoin = baseId;

    // 2. Уведомляем контроллер стакана (он управляет подписками в Kernel)
    // Прим: OrderbookController обычно подписывается на все каналы.
    // Мы передаем параметры, но они могут применяться глобально.
    // Для раздельного управления мы используем updateKlineConfig после выбора.
    this.obCtrl.onSelectCoin(baseId, this.kernel, {
      grafInterval,
      grafBarsLimit,
      priority: 9999,
      reason: "ui_select",
    });

    this.bump();
    return baseId; // Возвращаем ID для UI
  }

  // === NEW: Метод для точечного обновления конфигурации свечей ===
  updateKlineConfig(marketType, interval, limit) {
    if (!this.activeCoin || !this.kernel) return;

    const item = this.itemsMap.get(this.activeCoin);
    if (!item) return;

    // Ищем конкретный роут (например, Spot route для BTC)
    // Мы не знаем точную котируемую (USDT/USDC), поэтому берем первую попавшуюся
    // или наиболее приоритетную через pickRoute.
    // Обычно OrderbookController уже выбрал правильную пару, но здесь мы
    // работаем от baseId. Попробуем найти USDT пару как дефолт, или первую доступную.
    const route = pickRoute(item, marketType, "USDT") || pickRoute(item, marketType, "");

    if (!route) return; // У этой монеты может не быть спота или фьючерса

    // Отправляем в Kernel запрос на обеспечение фида ТОЛЬКО для kline
    // Kernel достаточно умен, чтобы понять, что если поменялся интервал/лимит, нужно переподписаться.
    this.kernel.ensureCoinFeeds(route.id, {
      feedKeys: ["kline"], // Обновляем только свечи
      klineOpts: {
        interval: String(interval),
        barsLimit: Number(limit),
      },
      priority: 100, // Высокий приоритет, так как это действие пользователя
      reason: `ui_update_${marketType}_kline`,
    });

    //console.log(`[AppCore] Updated ${marketType} kline config: ${interval}, limit=${limit}`);
  }

  // Инициализация приложения (Запускается один раз из index.js)
  async init() {
    if (this.ready) return;

    // A. Настройка коннектора
    const connector = {
      open: ({ wsUrl, onOpen, onClose, onError, onMessage }) => {
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => onOpen?.();
        ws.onclose = (e) => onClose?.(e?.code, e?.reason);
        ws.onerror = () => onError?.(new Error("ws_error"));
        ws.onmessage = (e) => {
          const d = e?.data;
          if (typeof d === "string") {
            onMessage?.(d);
          } else if (d && typeof d === "object" && typeof d.text === "function") {
            d.text()
              .then((txt) => onMessage?.(String(txt ?? "")))
              .catch(() => {});
          } else {
            onMessage?.(String(d ?? ""));
          }
          this.bump(); // Уведомляем React о новых данных
        };
        return ws;
      },
      close: (ws, r) => {
        try {
          ws?.close?.(1000, String(r ?? "").slice(0, 120));
        } catch (_) {}
      },
    };

    // B. Создание Kernel
    this.kernel = new BybitServerKernel({
      bybitKernel: this.schema,
      connector,
      logger: console,
      opts: { livenessIntervalMs: 1000, defaultSilenceMs: 120000, connectDelayMs: 250, maxInflight: 5 },
    });

    this.kernel.start();

    // C. Загрузка данных (Instruments Info)
    try {
      const [spotJson, linearJson] = await Promise.all([fetch(this.schema.spot.url).then((r) => r.json()), fetch(this.schema.linear.url).then((r) => r.json())]);

      this.schema.hydrateBybitItems({ spotJson, linearJson, now: Date.now() });

      const items = Array.isArray(this.schema.items) ? this.schema.items : [];
      this.itemsMap = new Map(items.map((it) => [String(it.baseId || ""), it]));

      const rt = new Map();
      for (const it of items) {
        const routes = it?.routesById || {};
        for (const rid of Object.keys(routes)) rt.set(String(rid), String(it?.baseId || ""));
      }
      this.routeToBase = rt;

      // Автоподписка на тикеры
      this.kernel.ensureTickers({ priority: 50, reason: "app_auto_init" });

      this.ready = true;
      this.bump();
      console.log("[CoreApp] Initialized successfully");
    } catch (e) {
      console.error("[CoreApp] Init failed", e);
      this.error = String(e?.message || e || "init_failed");
      this.bump();
    }

    // D. Глобальные хоткеи (snapshot)
    this._initHotkeys();
  }

  _initHotkeys() {
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.altKey && e.shiftKey) {
        if (e.code === "KeyP" || e.code === "PrintScreen") {
          e.preventDefault();
          const name = this.activeCoin || "BybitMarket";
          takeFullSnapshot(name);
        }
      }
    });
  }
}

// Экспортируем SINGLETON экземпляр
export const appCore = new CoreApplication();
