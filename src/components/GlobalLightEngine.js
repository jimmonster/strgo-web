import { Component } from '../core/Component.js';
import { lerp } from '../core/math.js';
export class GlobalLightEngine extends Component {
  constructor(element, guard) {
    super(element, guard);
    const dot = document.querySelector('.cursor-dot'), ring = document.querySelector('.cursor-ring');
    const root = document.documentElement;
    let x = innerWidth / 2, y = innerHeight / 2, ringX = x, ringY = y, scale = 1, hovered = false, frame = 0, initialized = false;
    const animate = () => {
      frame = 0;
      root.style.setProperty('--mouse-x', `${x}px`); root.style.setProperty('--mouse-y', `${y}px`);
      dot.style.transform = `translate3d(${x - 4}px,${y - 4}px,0)`;
      ringX = lerp(ringX, x, .15); ringY = lerp(ringY, y, .15); scale = lerp(scale, hovered ? 72 / 42 : 1, .15);
      ring.style.transform = `translate3d(${ringX - 21}px,${ringY - 21}px,0) scale(${scale})`;
      if (Math.abs(ringX - x) + Math.abs(ringY - y) + Math.abs(scale - (hovered ? 72 / 42 : 1)) > .01) frame = requestAnimationFrame(animate);
    };
    this.on(window, 'pointermove', event => {
      if (guard.mobile || guard.paused || event.pointerType === 'touch') return;
      x = event.clientX; y = event.clientY;
      if (!initialized) { ringX = x; ringY = y; initialized = true; }
      root.classList.add('cursor-ready'); root.classList.remove('cursor-hidden');
      if (!frame) frame = requestAnimationFrame(animate);
    }, { passive: true });
    this.on(document, 'pointerover', event => {
      hovered = !!event.target.closest?.('a,button,[data-cursor="magnetic"]');
      ring.classList.toggle('is-hovering', hovered);
      if (!guard.mobile && !guard.paused && !frame) frame = requestAnimationFrame(animate);
    });
    this.on(document, 'pointerleave', () => { root.classList.add('cursor-hidden'); cancelAnimationFrame(frame); frame = 0; });
    this.on(window, 'blur', () => { root.classList.add('cursor-hidden'); cancelAnimationFrame(frame); frame = 0; });
    this.own(guard.subscribe(() => {
      if (guard.mobile || guard.paused || document.hidden) { root.classList.remove('cursor-ready'); cancelAnimationFrame(frame); frame = 0; initialized = false; }
    }));
    this.own(() => { cancelAnimationFrame(frame); root.classList.remove('cursor-ready'); });
  }
}
