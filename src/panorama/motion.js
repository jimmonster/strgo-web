import { normalizeView } from './core.js';
import { translate as t } from '../shared/i18n.js';

const radians = Math.PI / 180;

// Project the back of the device onto the horizon after the intrinsic Z-X-Y
// rotations. Turning the screen around its normal leaves the direction intact.
export function deviceLook({ alpha, beta, gamma }) {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;
  const a = alpha * radians, b = beta * radians, g = gamma * radians;
  const x = -Math.sin(g), y = Math.sin(b) * Math.cos(g), z = -Math.cos(b) * Math.cos(g);
  const east = Math.cos(a) * x - Math.sin(a) * y;
  const north = Math.sin(a) * x + Math.cos(a) * y;
  const horizontal = Math.hypot(east, north);
  return {
    yaw: horizontal < .001 ? null : Math.atan2(-east, north) / radians,
    pitch: Math.atan2(z, horizontal) / radians
  };
}

export function setupMotion({ button, feedback, getView, setView, isReady, isDragging }) {
  button.hidden = !(navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches);
  let state = 'off', message = '', revision = 0, timer;
  let latest, reference, initialView;

  function render() {
    button.disabled = !isReady() || state === 'requesting';
    button.setAttribute('aria-pressed', String(state === 'active' || state === 'waiting'));
    feedback.hidden = !message;
    feedback.textContent = t(message);
  }

  function stop(notice = '') {
    revision++;
    clearTimeout(timer);
    window.removeEventListener('deviceorientation', orient);
    state = 'off'; message = notice;
    latest = reference = initialView = null;
    render();
  }

  function rebase() {
    reference = latest;
    initialView = getView();
  }

  function orient(event) {
    if (!isReady() || document.hidden) return;
    const look = deviceLook(event);
    if (!look) return;
    latest = { ...look, yaw: look.yaw ?? latest?.yaw ?? null };
    if (state === 'waiting') {
      clearTimeout(timer);
      state = 'active'; message = ''; render();
    }
    if (!reference || isDragging()) { rebase(); return; }
    if (reference.yaw === null && latest.yaw !== null) reference = { ...reference, yaw: latest.yaw };
    const next = normalizeView({
      ...getView(),
      yaw: initialView.yaw + (reference.yaw === null ? 0 : latest.yaw - reference.yaw),
      pitch: initialView.pitch + latest.pitch - reference.pitch
    });
    const view = getView();
    const yawChange = Math.abs(next.yaw - view.yaw);
    if (Math.min(yawChange, 360 - yawChange) >= .05 || Math.abs(next.pitch - view.pitch) >= .05) setView(next);
  }

  button.addEventListener('click', async () => {
    if (state !== 'off') { stop(); return; }
    if (!isReady()) return;
    const orientation = window.DeviceOrientationEvent;
    if (!window.isSecureContext || !orientation) {
      stop('浏览器无法读取手机方向，仍可拖动全景。');
      return;
    }
    const ticket = ++revision;
    state = 'requesting'; message = '正在请求手机方向权限…'; render();
    let granted;
    try {
      granted = typeof orientation.requestPermission !== 'function' || await orientation.requestPermission() === 'granted';
    } catch { granted = false; }
    if (ticket !== revision || !isReady() || document.hidden) return;
    if (!granted) { stop('未获得手机方向权限，仍可拖动全景。'); return; }
    state = 'waiting'; message = '正在等待手机方向数据…'; render();
    window.addEventListener('deviceorientation', orient);
    timer = setTimeout(() => stop('未收到手机方向数据，仍可拖动全景。'), 3000);
  });

  render();
  return { rebase, render, stop };
}
