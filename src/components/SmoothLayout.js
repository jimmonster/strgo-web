import { Component } from '../core/Component.js';
import { clamp, lerp } from '../core/math.js';
export class SmoothLayout extends Component {
  constructor(element, guard) {
    super(element, guard);
    this.current = this.target = window.scrollY;
    this.frame = 0;
    this.lenis = null;
    if (window.gsap && window.ScrollTrigger) window.gsap.registerPlugin(window.ScrollTrigger);
    if (window.Lenis && window.gsap) {
      this.lenis = new window.Lenis({ lerp: .08, smoothWheel: true });
      this.lenis.on('scroll', () => window.ScrollTrigger?.update());
      this.ticker = time => this.lenis.raf(time * 1000);
      window.gsap.ticker.lagSmoothing(0);
      let attached = false;
      this.own(guard.subscribe(() => {
        const enabled = !guard.paused && !guard.mobile && !document.hidden;
        if (enabled && !attached) { this.lenis.start(); window.gsap.ticker.add(this.ticker); attached = true; }
        if (!enabled && attached) { window.gsap.ticker.remove(this.ticker); this.lenis.start(); attached = false; }
        // Leave Lenis running with smoothing disabled so native wheel events stay usable.
        this.lenis.options.smoothWheel = enabled;
      }));
      this.own(() => { window.gsap.ticker.remove(this.ticker); this.lenis.destroy(); });
      document.documentElement.dataset.scrollEngine = 'lenis';
    } else {
      document.documentElement.dataset.scrollEngine = 'native-inertia';
      const tick = () => {
        this.frame = 0;
        this.target = clamp(this.target, 0, this.maxScroll());
        this.current = lerp(this.current, this.target, .08);
        if (Math.abs(this.current - this.target) < .5) this.current = this.target;
        window.scrollTo(0, this.current);
        if (this.current !== this.target) this.frame = requestAnimationFrame(tick);
      };
      this.start = () => { if (!this.frame) this.frame = requestAnimationFrame(tick); };
      this.on(window, 'wheel', event => {
        if (guard.mobile || guard.paused || document.hidden || event.ctrlKey || event.defaultPrevented) return;
        const nested = event.target.closest?.('dialog, textarea, input, [data-native-scroll]');
        if (nested || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        event.preventDefault();
        if (!this.frame) this.current = this.target = window.scrollY;
        const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
        this.target = clamp(this.target + event.deltaY * multiplier, 0, this.maxScroll());
        this.start();
      }, { passive: false });
      this.on(window, 'scroll', () => { if (!this.frame) this.current = this.target = window.scrollY; }, { passive: true });
      this.own(guard.subscribe(() => { if (guard.mobile || guard.paused || document.hidden) { cancelAnimationFrame(this.frame); this.frame = 0; this.target = this.current = window.scrollY; } }));
      this.own(() => cancelAnimationFrame(this.frame));
    }
    this.on(document, 'click', event => {
      const anchor = event.target.closest?.('a[href^="#"]');
      const id = anchor?.getAttribute('href')?.slice(1);
      if (!id || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const destination = document.getElementById(id);
      if (!destination) return;
      event.preventDefault();
      this.scrollTo(destination.getBoundingClientRect().top + window.scrollY - (id === 'home' ? 0 : 95));
      history.pushState(null, '', `#${id}`);
      destination.setAttribute('tabindex', '-1'); destination.focus({ preventScroll: true });
    });
    this.on(window, 'keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) {
        cancelAnimationFrame(this.frame); this.frame = 0;
      }
    });
    this.on(window, 'pointerdown', () => { cancelAnimationFrame(this.frame); this.frame = 0; });
  }
  maxScroll() { return Math.max(0, document.documentElement.scrollHeight - innerHeight); }
  scrollTo(y) {
    y = clamp(y, 0, this.maxScroll());
    if (this.guard.paused || this.guard.mobile) { window.scrollTo({ top: y, behavior: 'auto' }); this.current = this.target = y; }
    else if (this.lenis) this.lenis.scrollTo(y);
    else { this.current = window.scrollY; this.target = y; this.start(); }
  }
}
