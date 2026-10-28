import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
export function createEnvironment({ mobile = false, reduced = false } = {}) {
  const { window: domWindow, document } = parseHTML(readFileSync(new URL('../dist/classic/index.html', import.meta.url), 'utf8'));
  // Linkedom's default window proxies Node globals; isolate timers and navigator.
  const window = new domWindow.EventTarget();
  window.document = document; window.HTMLElement = domWindow.HTMLElement; window.Event = domWindow.Event;
  let serial = 0, time = 0, scrollY = 0;
  const frames = new Map(), timers = new Map(), media = [], observers = new Set(), animations = new Set();
  const raf = callback => { frames.set(++serial, callback); return serial; }, cancel = id => frames.delete(id);
  const setTimer = callback => { timers.set(++serial, callback); return serial; };
  const makeEvent = (type, properties = {}) => { const event = new window.Event(type, { bubbles: true, cancelable: true }); Object.assign(event, properties); return event; };
  const define = (target, key, value) => Object.defineProperty(target, key, { value, configurable: true, writable: true });
  define(document, 'hidden', false); define(document, 'activeElement', document.body);
  define(window, 'innerWidth', mobile ? 390 : 1440); define(window, 'innerHeight', 900); define(window, 'devicePixelRatio', 1);
  define(window, 'requestAnimationFrame', raf); define(window, 'cancelAnimationFrame', cancel);
  define(window, 'setTimeout', setTimer); define(window, 'clearTimeout', id => timers.delete(id));
  define(window, 'setInterval', setTimer); define(window, 'clearInterval', id => timers.delete(id));
  Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true });
  define(window, 'scrollTo', (x, y) => { scrollY = typeof x === 'object' ? x.top : y; window.dispatchEvent(makeEvent('scroll')); });
  define(window, 'navigator', { clipboard: { writeText: async () => {} } }); define(window, 'isSecureContext', true);
  define(window, 'history', { pushState() {} }); define(window, 'location', { protocol: 'file:' });
  define(window, 'matchMedia', query => {
    const listeners = new Set(); const item = { media: query, matches: query.includes('reduced') ? reduced : query.includes('coarse') || query.includes('max-width') ? mobile : false, addEventListener: (_, callback) => listeners.add(callback), removeEventListener: (_, callback) => listeners.delete(callback), listeners };
    media.push(item); return item;
  });
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.add(this); }
    observe(element) { this.targets.add(element); }
    disconnect() { this.targets.clear(); observers.delete(this); }
  }
  class ResizeObserver { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} }
  const baseElement = window.HTMLElement.prototype;
  baseElement.getBoundingClientRect = function () {
    const top = this.id === 'stack' ? 1050 : this.id === 'projects' ? 2000 - scrollY : this.id === 'lab' ? 3400 : this.id === 'contact' ? 4000 : 0;
    return { left: 0, top, width: window.innerWidth, height: 900, right: window.innerWidth, bottom: top + 900 };
  };
  baseElement.animate = function () { const animation = { cancel() { animations.delete(animation); }, finish() { animations.delete(animation); } }; animations.add(animation); return animation; };
  baseElement.focus = function () { document.activeElement = this; };
  for (const element of document.querySelectorAll('*')) {
    define(element, 'offsetHeight', 900); define(element, 'offsetWidth', 720); define(element, 'clientWidth', window.innerWidth);
    define(element, 'scrollWidth', element.classList.contains('showcase-track') ? 2328 : element.classList.contains('tech-track') ? 1000 : window.innerWidth);
    define(element, 'scrollLeft', 0);
    element.scrollBy = ({ left }) => { element.scrollLeft += left; element.dispatchEvent(makeEvent('scroll')); };
  }
  define(document.documentElement, 'scrollHeight', 5500);
  for (const canvas of document.querySelectorAll('canvas')) canvas.getContext = () => null;
  define(document, 'execCommand', () => false);
  const dialog = document.querySelector('dialog'); dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; dialog.dispatchEvent(makeEvent('close')); };
  const errors = [];
  const sandbox = { window, document, IntersectionObserver, ResizeObserver, requestAnimationFrame: raf, cancelAnimationFrame: cancel, setTimeout: setTimer, clearTimeout: id => timers.delete(id), setInterval: setTimer, clearInterval: id => timers.delete(id), innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: 1, history: window.history, location: window.location, performance: { now: () => time }, console: { log() {}, warn() {}, error(...args) { if (!String(args[0]).startsWith('THREE.WebGLRenderer:')) errors.push(args.join(' ')); } } };
  const context = vm.createContext(sandbox);
  const source = readFileSync(new URL('../dist/assets/main.js', import.meta.url), 'utf8');
  vm.runInContext(source, context, { timeout: 5000 });
  return { window, document, frames, observers, timers, media, errors, animations, makeEvent,
    intersect(element, visible) { for (const observer of [...observers]) if (observer.targets.has(element)) observer.callback([{ target: element, isIntersecting: visible }]); },
    tick() { time += 16.67; const current = [...frames]; frames.clear(); current.forEach(([, callback]) => callback(time)); },
    resize(mobileValue) { media.forEach(item => { if (!item.media.includes('reduced')) item.matches = mobileValue; item.listeners.forEach(callback => callback()); }); },
    hidden(value) { document.hidden = value; document.dispatchEvent(makeEvent('visibilitychange')); },
    destroy() { window.StrgoApp.destroy(); }
  };
}
