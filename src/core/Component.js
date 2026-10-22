export class Component {
  constructor(element, guard) { this.element = element; this.guard = guard; this.cleanups = []; }
  on(target, event, listener, options) { target.addEventListener(event, listener, options); this.cleanups.push(() => target.removeEventListener(event, listener, options)); }
  own(cleanup) { this.cleanups.push(cleanup); return cleanup; }
  destroy() { this.cleanups.splice(0).reverse().forEach(cleanup => cleanup()); }
}
export function attachMagnetic(element, guard, strength = .35) {
  let animation, x = 0, y = 0;
  const move = event => {
    if (guard.mobile || guard.paused) return;
    const box = element.getBoundingClientRect();
    x = (event.clientX - (box.left + box.width / 2) + x) * strength;
    y = (event.clientY - (box.top + box.height / 2) + y) * strength;
    if (window.gsap) window.gsap.to(element, { x, y, duration: .25, overwrite: true, ease: 'power2.out' });
    else { animation?.cancel(); element.style.transform = `translate3d(${x}px,${y}px,0)`; }
  };
  const reset = () => {
    if (window.gsap && (guard.paused || guard.mobile)) window.gsap.set(element, { x: 0, y: 0, overwrite: true });
    else if (window.gsap) window.gsap.to(element, { x: 0, y: 0, duration: .8, overwrite: true, ease: 'elastic.out(1, 0.3)' });
    else if (!guard.paused && !guard.mobile && (x || y)) {
      animation?.cancel();
      animation = element.animate([
        { transform: `translate(${x}px,${y}px)` },
        { transform: `translate(${-x * .17}px,${-y * .17}px)`, offset: .45 },
        { transform: `translate(${x * .04}px,${y * .04}px)`, offset: .7 },
        { transform: 'translate(0,0)' }
      ], { duration: 700, easing: 'ease-out' });
    }
    element.style.transform = 'translate(0,0)'; x = y = 0;
  };
  element.addEventListener('pointermove', move); element.addEventListener('pointerleave', reset);
  const unsubscribe = guard.subscribe(() => { if (guard.mobile || guard.paused) { animation?.cancel(); reset(); } });
  return () => { unsubscribe(); animation?.cancel(); window.gsap?.killTweensOf(element); element.removeEventListener('pointermove', move); element.removeEventListener('pointerleave', reset); element.style.transform = ''; };
}
