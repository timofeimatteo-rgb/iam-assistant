// Проигрыватель заранее отрисованных анимаций маскота (WebP-листы с прозрачностью).
// Нагрузка минимальная: 12 кадров в секунду, смена background-position, без WebGL.
// Когда окно скрыто — таймер останавливается полностью.
export class Sprite {
  constructor(el, base = 'assets/mascot/') {
    this.el = el; this.base = base; this.state = null; this.frame = 0; this.timer = null;
    this.mode = 'full'; this.scale = 1; this.queue = []; this.loopState = 'idle'; this.onEnd = null;
    document.addEventListener('visibilitychange', () => (document.hidden ? this.halt() : this.resume()));
  }
  async init() {
    this.m = await (await fetch(this.base + 'manifest.json')).json();
    // предзагрузка: браузер декодирует листы один раз
    this.images = {};
    await Promise.all(Object.keys(this.m.states).map((s) => new Promise((ok) => {
      const i = new Image(); i.onload = i.onerror = ok; i.src = this.base + s + '.webp'; this.images[s] = i;
    })));
    this.apply(); this.set('idle');
  }
  get size() { return { w: Math.round(this.m.frameW / 2 * this.scale), h: Math.round(this.m.frameH / 2 * this.scale) }; }
  setScale(s) { this.scale = s; this.apply(); this.draw(); }
  setMode(mode) { this.mode = mode; this.restart(); }
  apply() {
    const { w, h } = this.size; this.el.style.width = w + 'px'; this.el.style.height = h + 'px';
  }
  // Постоянное состояние (idle / focus / think / break …)
  setLoop(state) { this.loopState = state; if (!this.oneShot) this.set(state); }
  // Разовая анимация (greet / joy / silly / dance N сек), затем возврат к постоянному состоянию
  play(state, { duration } = {}) {
    if (this.mode === 'off') { this.flashStill(state); return; }
    this.oneShot = true; this.set(state);
    clearTimeout(this.oneShotTimer);
    const st = this.m.states[state];
    const ms = duration || (st.loop ? 4000 : (st.frames / this.m.fps) * 1000);
    this.oneShotTimer = setTimeout(() => { this.oneShot = false; this.set(this.loopState); }, ms);
  }
  flashStill(state) {
    this.set(state); clearTimeout(this.oneShotTimer);
    this.oneShotTimer = setTimeout(() => this.set(this.loopState), 2500);
  }
  set(state) {
    if (!this.m || !this.m.states[state]) return;
    this.state = state; this.frame = 0; this.restart();
  }
  restart() {
    this.halt();
    if (!this.state) return;
    const st = this.m.states[this.state];
    const still = this.mode === 'off' || (this.mode === 'reduced' && st.loop && this.state !== 'dance' && this.state !== 'exercise');
    this.still = still;
    this.draw();
    if (still || document.hidden || this.paused) return;
    const fps = this.mode === 'reduced' ? this.m.fps / 2 : this.m.fps;
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % st.frames;
      if (!st.loop && this.frame === st.frames - 1) { this.draw(); this.halt(); return; }
      this.draw();
    }, 1000 / fps);
  }
  halt() { clearInterval(this.timer); this.timer = null; }
  setPaused(p) { this.paused = p; if (p) this.halt(); else this.resume(); }
  resume() { if (!this.timer) this.restart(); }
  draw() {
    if (!this.state || !this.m) return;
    const st = this.m.states[this.state]; const { w, h } = this.size;
    if (this.still) {
      this.el.style.backgroundImage = `url(${this.base}${this.state}_still.webp)`;
      this.el.style.backgroundSize = `${w}px ${h}px`; this.el.style.backgroundPosition = '0 0'; return;
    }
    const c = this.frame % st.cols, r = Math.floor(this.frame / st.cols);
    this.el.style.backgroundImage = `url(${this.base}${this.state}.webp)`;
    this.el.style.backgroundSize = `${st.cols * w}px ${st.rows * h}px`;
    this.el.style.backgroundPosition = `${-c * w}px ${-r * h}px`;
  }
}
