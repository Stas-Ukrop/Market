// ./components/hooks/SoundEngine.js

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.lastPlay = 0;
    this.DEBOUNCE = 100; // мс между звуками, чтобы не было "пулемета"
  }

  _init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) this.ctx = new AudioContext();
    }
  }

  play(type) {
    const now = Date.now();
    if (now - this.lastPlay < this.DEBOUNCE) return;
    this.lastPlay = now;

    this._init();
    if (!this.ctx) return;

    // Восстанавливаем контекст, если браузер его приостановил (политика автоплея)
    if (this.ctx.state === "suspended") this.ctx.resume();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    const t = this.ctx.currentTime;

    if (type === "buy") {
      // Звонкий высокий "Дзынь" (High Pitch)
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.exponentialRampToValueAtTime(1200, t + 0.1);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.3);
    } else if (type === "sell") {
      // Резкий низкий "Клик" (Low Pitch)
      osc.type = "triangle";
      osc.frequency.setValueAtTime(300, t);
      osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.start(t);
      osc.stop(t + 0.2);
    } else if (type === "wall") {
      // Глухой тяжелый "Бас" (Deep Thud) для стен
      osc.type = "square";
      osc.frequency.setValueAtTime(80, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.3);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t);
      osc.stop(t + 0.4);
    }
  }
}

export const soundManager = new SoundEngine();
