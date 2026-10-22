import * as T from '../vendor/three.module.js';
import { SceneControls } from './controls.js';
import { disposeScene } from './geometry.js';

export async function start() {
  const mode = document.body.dataset.scene, dance = mode === 'dance';
  const canvas = document.querySelector('#scene-canvas'), status = document.querySelector('#scene-status');
  const errorUI = document.querySelector('#scene-error'), loading = document.querySelector('#scene-loading');
  const mobile = matchMedia('(max-width: 767px)').matches, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cleanup = []; let renderer, model, controls, frame = 0, destroyed = false, failed = false;
  const on = (element, name, listener, options) => { element.addEventListener(name, listener, options); cleanup.push(() => element.removeEventListener(name, listener, options)); };
  const destroy = () => {
    if (destroyed) return; destroyed = true; cancelAnimationFrame(frame); cleanup.splice(0).reverse().forEach(fn => fn());
    controls?.destroy(); if (model) disposeScene(model.scene); renderer?.dispose(); renderer?.forceContextLoss();
    if (window.StrgoScene) window.StrgoScene.disposed = true;
  };
  const fail = error => {
    if (destroyed) return; failed = true; loading.hidden = true; errorUI.hidden = false;
    document.querySelector('#scene-error-detail').textContent = error.message || '三维渲染暂时不可用，请重试。';
    document.body.dataset.state = 'error'; destroy();
  };
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: mobile ? 'low-power' : 'high-performance' });
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = dance ? 1.12 : 1.02;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    const module = await (dance ? import('./dance.js') : import('./home.js'));
    model = module.createScene({ mobile });
    const camera = new T.PerspectiveCamera(dance ? 43 : 42, 1, .1, 180);
    let playing = dance && !reducedMotion, autoCamera = dance && !reducedMotion, time = 0, last = 0, lastDraw = 0, dirty = true;
    const pauseButton = document.querySelector('[data-action="play"]'), autoButton = document.querySelector('[data-action="auto"]');
    function syncButtons() {
      if (!dance) return;
      pauseButton.textContent = playing ? 'Ⅱ 暂停' : '▷ 播放'; pauseButton.setAttribute('aria-pressed', String(!playing));
      autoButton.textContent = autoCamera ? '自动运镜 · 开' : '恢复自动运镜'; autoButton.setAttribute('aria-pressed', String(autoCamera));
      document.body.dataset.playing = String(playing); document.body.dataset.autoCamera = String(autoCamera);
    }
    const requestDraw = () => { dirty = true; schedule(); };
    controls = new SceneControls(camera, canvas, model, requestDraw, () => { if (dance && autoCamera) { autoCamera = false; syncButtons(); status.textContent = '手动视角 · 可恢复自动运镜'; } });
    const resize = () => {
      const bounds = canvas.getBoundingClientRect(), small = bounds.width < 768;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.25 : 1.6)); renderer.setSize(bounds.width, bounds.height, false);
      camera.aspect = bounds.width / Math.max(1, bounds.height); camera.updateProjectionMatrix(); controls.mobile = small;
      requestDraw();
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); cleanup.push(() => observer.disconnect());
    function draw(now) {
      frame = 0; if (destroyed || document.hidden) return;
      const delta = last ? Math.min((now - last) / 1000, .08) : 0; last = now;
      if (playing) time = (time + delta) % model.duration;
      if (dance && autoCamera) {
        controls.desired.theta = .22 * Math.sin(time * Math.PI * 2 / 48) + .08;
        controls.desired.phi = 1.18 + .025 * Math.sin(time * Math.PI * 2 / 24);
        controls.desired.radius = model.camera.radius + .45 * Math.sin(time * Math.PI * 2 / 48);
      }
      const moving = controls.update(Math.max(delta, .016));
      if ((dirty || playing || moving) && (!mobile || now - lastDraw > 31 || dirty)) {
        model.update(time); renderer.render(model.scene, camera); dirty = false; lastDraw = now;
        if (dance) {
          document.querySelector('#show-time').textContent = `${String(Math.floor(time)).padStart(2, '0')} / 48 SEC`;
          document.querySelector('#show-progress').value = time;
          document.querySelector('#show-section').textContent = model.sections[Math.floor(time / 12)];
        }
        if (window.StrgoScene) { window.StrgoScene.time = time; window.StrgoScene.frames++; }
      }
      if (playing || moving || dirty) schedule();
    }
    function schedule() { if (!frame && !destroyed && !document.hidden) frame = requestAnimationFrame(draw); }
    on(document, 'visibilitychange', () => { last = 0; if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else requestDraw(); });
    on(canvas, 'webglcontextlost', event => { event.preventDefault(); fail(new Error('图形上下文已中断。请点击重试，重新加载场景。')); });
    on(window, 'pagehide', () => destroy());
    // Browser back/forward cache must recreate a context after pagehide disposal.
    const restore = event => { if (event.persisted) { window.removeEventListener('pageshow', restore); location.reload(); } };
    window.addEventListener('pageshow', restore);
    on(document.querySelector('[data-action="reset-view"]'), 'click', () => {
      autoCamera = false; controls.reset(); syncButtons(); requestDraw(); status.textContent = '已重置视角';
      if (!dance) document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === 'room')));
    });
    if (dance) {
      on(pauseButton, 'click', () => { playing = !playing; last = 0; syncButtons(); requestDraw(); status.textContent = playing ? '表演继续' : '表演与灯光已暂停 · 仍可拖动视角'; });
      on(document.querySelector('[data-action="restart"]'), 'click', () => { time = 0; last = 0; requestDraw(); status.textContent = '已回到表演开场'; });
      on(autoButton, 'click', () => { autoCamera = !autoCamera; syncButtons(); requestDraw(); status.textContent = autoCamera ? '自动运镜已恢复' : '已切换手动视角'; });
    } else {
      const buttons = document.querySelectorAll('[data-view]');
      buttons.forEach(button => on(button, 'click', () => {
        controls.setView(model.views[button.dataset.view]);
        buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        status.textContent = button.dataset.view === 'garden' ? '阳台与窗外花园视角' : '卧室全景视角';
      }));
    }
    window.StrgoScene = {
      mode, time, frames: 0, disposed: false, inspect: () => ({ ...model.inspect(), time, playing, autoCamera, geometries: renderer.info.memory.geometries, drawCalls: renderer.info.render.calls }),
      // Read-only snapshots make browser acceptance checks possible without exposing credentials or commands.
      snapshot: () => model.dancers?.map(d => ({ position: d.root.position.toArray(), arms: d.arms.map(a => a.upper.rotation.toArray().slice(0, 3)), torso: d.torso.rotation.toArray().slice(0, 3), legs: d.legs.map(l => l.thigh.quaternion.toArray()) })),
      destroy
    };
    syncButtons(); resize(); model.update(0); renderer.render(model.scene, camera);
    loading.hidden = true; errorUI.hidden = true; document.body.dataset.state = 'ready';
    status.textContent = reducedMotion && dance ? '遵循减少动态效果设置 · 点击播放开始' : '场景就绪'; schedule();
  } catch (error) { fail(new Error(`无法加载三维场景：${error.message}`)); }
  return { destroy, get failed() { return failed; } };
}
