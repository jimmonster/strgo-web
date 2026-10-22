import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironment } from './dom-harness.mjs';

test('Full production bundle mounts and remains usable without WebGL or external animation libraries', () => {
  const env = createEnvironment();
  assert.deepEqual(env.errors, []);
  assert.equal(env.window.StrgoApp.diagnostics.failed.length, 0);
  assert.equal(env.document.querySelector('.hero-section').dataset.renderer, 'css-fallback');
  assert.equal(env.document.querySelectorAll('.contribution-grid i').length, 196);
  assert.match(env.document.querySelector('[data-contribution-label]').textContent, /非 GitHub/);
  assert.equal(env.document.querySelectorAll('.tech-chip').length, 20);
  assert.equal(env.document.querySelector('.icp-link').textContent, '渝ICP备2026024419号-1');
  assert.match(env.document.querySelector('[data-clock]').textContent, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(env.document.querySelector('.showcase-section').classList.contains('native-pinned'), true);
  const ids = [...env.document.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length);
  env.destroy(); assert.equal(env.observers.size, 0); assert.equal(env.frames.size, 0);
});
test('Intersection and page visibility cancel RAF; visible regions resume only one loop', () => {
  const env = createEnvironment(); const guard = env.window.StrgoApp.guard;
  const element = env.document.querySelector('.lab-stage'); let rendered = 0;
  const stop = guard.animationLoop(element, () => rendered++);
  env.intersect(element, true); assert.equal(env.frames.size, 1);
  env.tick(); assert.equal(rendered, 1); assert.equal(env.frames.size, 1);
  env.intersect(element, false); assert.equal(env.frames.size, 0);
  env.intersect(element, true); env.hidden(true); assert.equal(env.frames.size, 0);
  env.hidden(false); assert.equal(env.frames.size, 1);
  guard.togglePause(); assert.equal(env.frames.size, 0);
  guard.togglePause(); assert.equal(env.frames.size, 1);
  stop(); assert.equal(env.frames.size, 0); env.destroy();
});
test('Coarse pointers and narrow screens disable cursor and 3D tilt and unpin the gallery', () => {
  const env = createEnvironment({ mobile: true });
  assert.equal(env.window.StrgoApp.guard.mobile, true);
  assert.equal(env.document.documentElement.classList.contains('is-mobile'), true);
  assert.equal(env.document.querySelector('.showcase-section').classList.contains('native-pinned'), false);
  const card = env.document.querySelector('.bento-card');
  card.dispatchEvent(env.makeEvent('pointermove', { clientX: 180, clientY: 80, pointerType: 'touch' }));
  env.tick(); assert.equal(card.classList.contains('is-tilting'), false);
  env.window.dispatchEvent(env.makeEvent('pointermove', { clientX: 180, clientY: 80, pointerType: 'touch' }));
  assert.equal(env.document.documentElement.classList.contains('cursor-ready'), false);
  const menu = env.document.querySelector('.menu-toggle'); menu.dispatchEvent(env.makeEvent('click'));
  assert.equal(menu.getAttribute('aria-expanded'), 'true'); assert.equal(env.document.querySelector('.mobile-menu').hidden, false);
  env.document.dispatchEvent(env.makeEvent('keydown', { key: 'Escape' })); assert.equal(menu.getAttribute('aria-expanded'), 'false');
  const button = env.document.querySelector('[data-gallery-step="1"]'); button.dispatchEvent(env.makeEvent('click'));
  assert.ok(env.document.querySelector('.showcase-window').scrollLeft > 0);
  env.destroy();
});
test('Reduced motion shows completed counters, native scrolling and disabled motion control', () => {
  const env = createEnvironment({ reduced: true });
  assert.equal(env.document.querySelector('[data-count="99.9"]').textContent, '99.9');
  assert.equal(env.document.querySelector('[data-count="60"]').textContent, '60');
  assert.equal(env.document.querySelector('.motion-toggle').disabled, true);
  assert.equal(env.document.querySelector('.showcase-section').classList.contains('native-pinned'), false);
  env.document.querySelector('[data-lab-pulse]').dispatchEvent(env.makeEvent('click'));
  assert.equal(env.document.querySelector('.lab-stage').classList.contains('pulsing'), false);
  assert.match(env.document.querySelector('.lab-status').textContent, /信号已收到/);
  env.destroy();
});
test('Proximity updates every card while only the hovered card tilts; resize resets transforms', () => {
  const env = createEnvironment(); const cards = [...env.document.querySelectorAll('.bento-card')];
  cards[0].dispatchEvent(env.makeEvent('pointermove', { clientX: 120, clientY: 70 })); env.tick();
  assert.ok(cards.every(card => card.style.getPropertyValue('--card-mouse-x') === '120px'));
  assert.equal(cards[0].classList.contains('is-tilting'), true);
  assert.equal(cards[1].classList.contains('is-tilting'), false);
  env.resize(true); assert.equal(cards[0].style.transform, '');
  env.destroy();
});
test('Project details and lab spectrum respond to click without leaving broken links', () => {
  const env = createEnvironment(); const dialog = env.document.querySelector('dialog');
  env.document.querySelector('[data-project="terminal"]').dispatchEvent(env.makeEvent('click'));
  assert.equal(dialog.open, true); assert.equal(env.document.querySelector('#dialog-title').textContent, '随身终端');
  assert.equal(env.document.documentElement.classList.contains('dialog-open'), true);
  env.document.querySelector('.dialog-close').dispatchEvent(env.makeEvent('click')); assert.equal(dialog.open, false);
  assert.equal(env.document.documentElement.classList.contains('dialog-open'), false);
  const spectrum = env.document.querySelector('[data-lab-spectrum]'); spectrum.dispatchEvent(env.makeEvent('click'));
  assert.equal(spectrum.getAttribute('aria-pressed'), 'true'); assert.equal(env.document.querySelector('.lab-stage').classList.contains('violet'), true);
  env.destroy();
});
test('Clipboard success and failure show accurate messages and remove temporary textareas', async () => {
  const env = createEnvironment({ reduced: true }); const button = env.document.querySelector('.supernova-cta');
  let copied;
  env.window.navigator.clipboard.writeText = async value => { copied = value; };
  button.dispatchEvent(env.makeEvent('click')); await new Promise(resolve => setImmediate(resolve));
  const config = JSON.parse(env.document.querySelector('#site-config').textContent);
  assert.equal(copied, config.email || env.document.querySelector('link[rel="canonical"]').getAttribute('href'));
  assert.match(env.document.querySelector('[data-toast-text]').textContent, config.email ? /邮箱已复制/ : /小站地址已复制/);
  env.window.navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); };
  env.document.execCommand = () => false;
  button.dispatchEvent(env.makeEvent('click')); await new Promise(resolve => setImmediate(resolve));
  assert.match(env.document.querySelector('[data-toast-text]').textContent, /复制未完成/);
  assert.equal(env.document.querySelectorAll('textarea').length, 0);
  env.destroy();
});

test('Space themes show matching cards, announce the selection and restore all original entrances', () => {
  const env = createEnvironment({ reduced: true });
  const cards = [...env.document.querySelectorAll('[data-space-categories]')];
  assert.equal(cards.length, 8);
  assert.equal(env.document.querySelector('[data-space-filter-bar]').hidden, false);
  const expected = { life: ['room', 'dreams', 'meow'], 'sci-fi': ['nexus', 'polyverse', 'swarmera'], art: ['dance', 'dreams', 'polyverse'], tools: ['terminal'] };
  for (const [category, ids] of Object.entries(expected)) {
    const filter = env.document.querySelector(`[data-space-filter="${category}"]`);
    filter.dispatchEvent(env.makeEvent('click'));
    assert.deepEqual(cards.filter(card => !card.hidden).map(card => card.dataset.spaceId), ids);
    assert.equal(filter.getAttribute('aria-pressed'), 'true');
    assert.equal(env.document.querySelectorAll('[data-space-filter][aria-pressed="true"]').length, 1);
    assert.match(env.document.querySelector('[data-space-status]').textContent, new RegExp(`${ids.length} 个空间`));
  }
  env.document.querySelector('[data-space-filter="all"]').dispatchEvent(env.makeEvent('click'));
  assert.equal(cards.filter(card => !card.hidden).length, 8);
  env.destroy();
});

test('All existing project previews share the public story descriptions and verified experience links', () => {
  const env = createEnvironment();
  const projects = JSON.parse(env.document.querySelector('#site-config').textContent).projects;
  for (const project of projects) {
    env.document.querySelector(`[data-project="${project.id}"]`).dispatchEvent(env.makeEvent('click'));
    assert.equal(env.document.querySelector('#dialog-title').textContent, project.name);
    assert.equal(env.document.querySelector('[data-dialog-description]').textContent, project.description);
    const links = [...env.document.querySelectorAll('.dialog-actions a')].map(link => link.getAttribute('href'));
    assert.ok(links.includes(project.storyPath));
    assert.ok(links.includes(project.experience.href));
    env.document.querySelector('.dialog-close').dispatchEvent(env.makeEvent('click'));
  }
  env.destroy();
});

test('Short desktop windows keep the enlarged project cards in an unpinned native gallery', () => {
  const env = createEnvironment();
  env.window.innerHeight = 650;
  // Toggling motion forces the existing gallery mode to be reconfigured.
  env.window.StrgoApp.guard.togglePause(); env.window.StrgoApp.guard.togglePause();
  assert.equal(env.document.querySelector('.showcase-section').classList.contains('native-pinned'), false);
  assert.equal(env.document.querySelector('.showcase-section').classList.contains('horizontal-enabled'), false);
  const rail = env.document.querySelector('.showcase-window');
  assert.equal(rail.style.overflowX, 'auto');
  env.document.querySelector('[data-gallery-step="1"]').dispatchEvent(env.makeEvent('click'));
  assert.ok(rail.scrollLeft > 0);
  env.destroy();
});
