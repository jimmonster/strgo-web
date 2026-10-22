import { Component } from '../core/Component.js';
import { emitConfetti } from '../core/confetti.js';
import { clamp } from '../core/math.js';
export async function copyText(value, environment = window) {
  try { if (environment.navigator.clipboard && environment.isSecureContext) { await environment.navigator.clipboard.writeText(value); return true; } } catch { /* HTTP sites use the selection-based fallback. */ }
  const input = environment.document.createElement('textarea');
  input.value = value; input.setAttribute('aria-hidden', 'true'); input.style.cssText = 'position:fixed;left:-9999px;top:0';
  environment.document.body.append(input);
  const previousFocus = environment.document.activeElement;
  let copied = false;
  try { input.focus(); input.select(); copied = environment.document.execCommand('copy'); } catch { copied = false; }
  finally { input.remove(); previousFocus?.focus({ preventScroll: true }); }
  return copied;
}
export class FooterHorizon extends Component {
  constructor(element, guard, config, toast) {
    super(element, guard);
    const horizon = element.querySelector('.planet-horizon'), button = element.querySelector('.supernova-cta');
    const email = config.email, value = email || `${(config.BASE_ORIGIN || `${config.scheme || 'http'}://${config.domain}`).replace(/\/$/, '')}/`;
    element.querySelector('[data-contact-caption]').textContent = email ? `点击复制邮箱 · ${email}` : '点击复制小站地址';
    let visible = false, frame = 0;
    const render = () => {
      frame = 0;
      if (!visible || document.hidden) return;
      const box = element.getBoundingClientRect(), progress = clamp((innerHeight - box.top) / (innerHeight + box.height * .2), 0, 1);
      horizon.style.transform = `translateY(${guard.paused ? 0 : 50 - progress * 50}px)`;
      horizon.style.opacity = String(.55 + progress * .45);
      if (!guard.mobile && !guard.paused) horizon.style.boxShadow = `0 -2px 10px #fff,0 -10px ${40 + progress * 20}px #00dfd8,0 -30px ${90 + progress * 30}px #7928ca,inset 0 10px 30px rgba(0,223,216,.4)`;
    };
    this.own(guard.observe(element, intersecting => { visible = intersecting; element.classList.toggle('animation-sleeping', !visible); if (visible) render(); else { cancelAnimationFrame(frame); frame = 0; } }));
    this.on(window, 'scroll', () => { if (visible && !document.hidden && !frame) frame = requestAnimationFrame(render); }, { passive: true });
    this.own(guard.subscribe(() => { if (document.hidden || guard.paused) { cancelAnimationFrame(frame); frame = 0; } if (visible) render(); }));
    let cleanupConfetti = () => {}, busy = false;
    this.on(button, 'click', async () => {
      if (busy) return; busy = true;
      cleanupConfetti(); cleanupConfetti = emitConfetti(button, guard);
      try {
        const copied = await copyText(value);
        if (copied) toast(email ? '邮箱已复制，期待你的新想法。' : '小站地址已复制。');
        else toast(`复制未完成，请手动保存：${value}`, false);
      } finally { busy = false; }
    });
    this.own(() => { cancelAnimationFrame(frame); cleanupConfetti(); });
  }
}
