import { Component } from '../core/Component.js';
export class ScrambleLink extends Component {
  constructor(element, guard) {
    super(element, guard);
    const label = element.dataset.label, pool = '!<>-_\\/[]{}—=+*^?#________';
    let frame = 0;
    element.setAttribute('aria-label', label);
    element.style.minWidth = `${label.length * .66}em`;
    const restore = () => { cancelAnimationFrame(frame); frame = 0; element.textContent = label; };
    const scramble = () => {
      restore(); if (guard.paused || guard.mobile) return;
      const start = performance.now();
      const update = time => {
        const progress = Math.min(1, (time - start) / 350), locked = Math.floor(progress * label.length);
        element.textContent = Array.from(label, (character, index) => index < locked ? character : pool[Math.floor(Math.random() * pool.length)]).join('');
        if (progress < 1) frame = requestAnimationFrame(update); else restore();
      };
      frame = requestAnimationFrame(update);
    };
    this.on(element, 'mouseenter', scramble); this.on(element, 'focus', scramble);
    this.on(element, 'mouseleave', restore); this.on(element, 'blur', restore);
    this.own(guard.subscribe(() => { if (guard.paused || document.hidden) restore(); })); this.own(restore);
  }
}
export class FloatingNavbar extends Component {
  constructor(element, guard) {
    super(element, guard);
    element.querySelectorAll('.scramble-link').forEach(link => { const component = new ScrambleLink(link, guard); this.own(() => component.destroy()); });
    const toggle = element.querySelector('.menu-toggle'), menu = document.getElementById('mobile-menu');
    const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', '打开导航菜单'); };
    this.on(toggle, 'click', () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); toggle.setAttribute('aria-label', menu.hidden ? '打开导航菜单' : '关闭导航菜单'); });
    this.on(menu, 'click', event => { if (event.target.closest('a')) close(); });
    this.on(document, 'keydown', event => { if (event.key === 'Escape' && !menu.hidden) { close(); toggle.focus(); } });
    this.on(document, 'click', event => { if (!menu.hidden && !menu.contains(event.target) && !element.contains(event.target)) close(); });
    this.own(guard.subscribe(() => { if (!guard.mobile) close(); }));
    const sections = [...document.querySelectorAll('main>section[id]')], links = [...element.querySelectorAll('.scramble-link')];
    let scheduled = 0;
    const active = () => {
      scheduled = 0;
      const current = sections.findLast(section => section.getBoundingClientRect().top <= innerHeight * .45) || sections[0];
      links.forEach(link => { const selected = link.getAttribute('href') === `#${current.id}`; link.classList.toggle('active', selected); if (selected) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
    };
    this.on(window, 'scroll', () => { if (!scheduled) scheduled = requestAnimationFrame(active); }, { passive: true });
    active(); this.own(() => cancelAnimationFrame(scheduled));
  }
}
