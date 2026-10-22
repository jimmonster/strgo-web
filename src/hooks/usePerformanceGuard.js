export class PerformanceGuard {
  constructor(environment = window) {
    this.environment = environment;
    this.media = [environment.matchMedia('(pointer: coarse)'), environment.matchMedia('(max-width: 767px)'), environment.matchMedia('(prefers-reduced-motion: reduce)')];
    this.listeners = new Set();
    this.manualPause = false;
    this.refresh = () => {
      this.mobile = this.media[0].matches || this.media[1].matches;
      this.reducedMotion = this.media[2].matches;
      this.paused = this.manualPause || this.reducedMotion;
      const root = environment.document.documentElement;
      root.classList.toggle('is-mobile', this.mobile);
      root.classList.toggle('motion-paused', this.paused || environment.document.hidden);
      for (const callback of this.listeners) callback(this);
    };
    this.media.forEach(query => query.addEventListener('change', this.refresh));
    environment.document.addEventListener('visibilitychange', this.refresh);
    this.refresh();
  }
  subscribe(callback) { this.listeners.add(callback); callback(this); return () => this.listeners.delete(callback); }
  togglePause() { this.manualPause = !this.paused; this.refresh(); }
  observe(element, callback) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => callback(entry.isIntersecting)), { rootMargin: '0px', threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }
  animationLoop(element, render, { desktopOnly = false, pauseCSS = false } = {}) {
    let frame = 0, visible = false, last = 0;
    const active = () => visible && !this.paused && !this.environment.document.hidden && !(desktopOnly && this.mobile);
    const tick = time => {
      frame = 0;
      if (!active()) return;
      render(time, last ? Math.min(time - last, 50) : 16.67);
      last = time;
      frame = this.environment.requestAnimationFrame(tick);
    };
    const sync = () => {
      if (pauseCSS) element.classList.toggle('animation-sleeping', !active());
      if (active() && !frame) { last = 0; frame = this.environment.requestAnimationFrame(tick); }
      else if (!active() && frame) { this.environment.cancelAnimationFrame(frame); frame = 0; last = 0; }
    };
    const unobserve = this.observe(element, intersecting => { visible = intersecting; sync(); });
    const unsubscribe = this.subscribe(sync);
    return () => { unobserve(); unsubscribe(); this.environment.cancelAnimationFrame(frame); };
  }
  destroy() { this.media.forEach(query => query.removeEventListener('change', this.refresh)); this.environment.document.removeEventListener('visibilitychange', this.refresh); this.listeners.clear(); }
}
export const usePerformanceGuard = () => new PerformanceGuard();
