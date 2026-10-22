import { Component } from '../core/Component.js';
import { clamp, horizontalDistance, lerp } from '../core/math.js';
export class ShowcaseSection extends Component {
  constructor(element, guard, layout) {
    super(element, guard);
    const pin = element.querySelector('.showcase-pin'), track = element.querySelector('.showcase-track'), windowElement = element.querySelector('.showcase-window');
    const cards = [...element.querySelectorAll('.project-card')];
    const nativeGallery = () => guard.mobile || guard.paused || window.innerHeight < 720;
    const progressBar = element.querySelector('.gallery-progress'), index = element.querySelector('[data-project-index]');
    let teardown = () => {}, distance = 0, frame = 0, lastScroll = window.scrollY, lastTime = performance.now(), skew = 0, desiredSkew = 0, visible = false;
    let quickSetters = [];
    const progress = value => { value = clamp(value, 0, 1); progressBar.style.setProperty('--progress-x', `${value * 200}%`); index.textContent = String(Math.min(cards.length, Math.floor(value * cards.length) + 1)).padStart(2, '0'); };
    const reset = () => {
      teardown(); teardown = () => {}; cancelAnimationFrame(frame); frame = 0;
      element.style.height = ''; track.style.transform = ''; cards.forEach(card => card.style.transform = '');
      element.classList.remove('native-pinned', 'horizontal-enabled'); quickSetters = [];
    };
    const configure = () => {
      reset();
      if (nativeGallery()) {
        windowElement.style.overflowX = 'auto';
        track.style.transform = ''; windowElement.style.scrollSnapType = 'x mandatory';
        progress(windowElement.scrollLeft / Math.max(1, track.scrollWidth - windowElement.clientWidth));
        return;
      }
      element.classList.add('horizontal-enabled');
      windowElement.style.overflowX = ''; windowElement.style.scrollSnapType = ''; windowElement.scrollLeft = 0;
      distance = horizontalDistance(track.scrollWidth, windowElement.clientWidth);
      if (window.gsap && window.ScrollTrigger) {
        quickSetters = cards.map(card => window.gsap.quickTo(card, 'skewX', { duration: .4, ease: 'power3.out' }));
        let settleTimer;
        const tween = window.gsap.to(track, {
          x: () => -horizontalDistance(track.scrollWidth, windowElement.clientWidth), ease: 'none',
          scrollTrigger: {
            trigger: element, pin, start: 'top top', end: () => `+=${horizontalDistance(track.scrollWidth, windowElement.clientWidth)}`,
            scrub: 1, invalidateOnRefresh: true,
            onUpdate: self => {
              progress(self.progress);
              const angle = clamp(self.getVelocity() / 300, -8, 8);
              quickSetters.forEach(setter => setter(angle));
              clearTimeout(settleTimer); settleTimer = setTimeout(() => quickSetters.forEach(setter => setter(0)), 110);
            }
          }
        });
        teardown = () => { clearTimeout(settleTimer); tween.scrollTrigger?.kill(true); tween.kill(); window.gsap.killTweensOf(cards); window.gsap.set([track, ...cards], { clearProps: 'transform' }); };
        window.ScrollTrigger.refresh();
      } else {
        element.classList.add('native-pinned');
        element.style.height = `${pin.offsetHeight + distance}px`;
        let currentX = -clamp(-element.getBoundingClientRect().top, 0, distance);
        const update = time => {
          frame = 0;
          const offset = clamp(-element.getBoundingClientRect().top, 0, distance);
          currentX = lerp(currentX, -offset, .15);
          if (Math.abs(currentX + offset) < .15) currentX = -offset;
          track.style.transform = `translate3d(${currentX}px,0,0)`;
          desiredSkew *= .83; skew = lerp(skew, desiredSkew, .12);
          if (Math.abs(skew) < .01) skew = 0;
          cards.forEach(card => card.style.transform = `skewX(${skew}deg)`);
          progress(offset / Math.max(distance, 1));
          if (Math.abs(currentX + offset) > .15 || skew !== 0) frame = requestAnimationFrame(update);
        };
        const scroll = () => {
          if (!visible) return;
          const time = performance.now(), elapsed = Math.max(16, time - lastTime);
          desiredSkew = clamp((window.scrollY - lastScroll) / elapsed * 1000 / 300, -8, 8);
          lastScroll = window.scrollY; lastTime = time;
          if (!frame && !document.hidden) frame = requestAnimationFrame(update);
        };
        window.addEventListener('scroll', scroll, { passive: true });
        update(performance.now());
        teardown = () => window.removeEventListener('scroll', scroll);
      }
    };
    let previousMode = '';
    this.own(guard.subscribe(() => {
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; desiredSkew = 0; quickSetters.forEach(setter => setter(0)); return; }
      const mode = `${guard.mobile}:${guard.paused}`;
      if (mode !== previousMode) { previousMode = mode; configure(); }
    }));
    let resizeTimer;
    this.on(window, 'resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(configure, 140); }, { passive: true });
    this.on(windowElement, 'scroll', () => { if (nativeGallery()) progress(windowElement.scrollLeft / Math.max(1, track.scrollWidth - windowElement.clientWidth)); }, { passive: true });
    cards.forEach(card => {
      const enter = () => { element.style.setProperty('--ambient-color', card.dataset.theme); if (!guard.paused) element.classList.add('project-hovered'); };
      const leave = () => element.classList.remove('project-hovered');
      this.on(card, 'mouseenter', enter); this.on(card, 'mouseleave', leave);
      this.on(card, 'focusin', enter); this.on(card, 'focusout', leave);
    });
    this.own(guard.observe(element, intersecting => { visible = intersecting; if (!visible) { cancelAnimationFrame(frame); frame = 0; } }));
    element.querySelectorAll('[data-gallery-step]').forEach(button => this.on(button, 'click', () => {
      const direction = Number(button.dataset.galleryStep);
      if (nativeGallery()) windowElement.scrollBy({ left: direction * (cards[0].offsetWidth + (guard.mobile ? 16 : 28)), behavior: guard.paused ? 'auto' : 'smooth' });
      else {
        const start = window.scrollY + element.getBoundingClientRect().top;
        const current = clamp(window.scrollY - start, 0, distance);
        layout.scrollTo(start + clamp(current + direction * distance / (cards.length - 1), 0, distance));
      }
    }));
    this.own(() => { clearTimeout(resizeTimer); reset(); });
  }
}
