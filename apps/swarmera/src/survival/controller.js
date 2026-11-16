import { SurvivalGame } from './engine.js';
import { SurvivalRenderer } from './renderer.js';
import { survivalText } from './copy.js';
const formatTime = time => `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
const storageKey = difficulty => `swarmera:survival:best:v1:${difficulty}`;

export function mountSurvival(root, locale, previousGame) {
  const t = key => survivalText(key, locale);
  const $ = selector => root.querySelector(selector);
  const canvas = $('#survival-canvas');
  const arena = $('#survival-arena');
  const overlay = $('#survival-overlay');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try { renderer = new SurvivalRenderer(canvas, { reduced }); }
  catch { overlay.querySelector('p').textContent = t('unavailable'); overlay.querySelector('button').disabled = true; return { dispose() {} }; }
  const game = previousGame || new SurvivalGame();
  if (game.state === 'playing') game.pause();
  const abort = new AbortController();
  const on = (node, type, callback, options = {}) => node.addEventListener(type, callback, { ...options, signal: abort.signal });
  const keys = new Set();
  const input = { x: 0, y: 0, aim: null };
  let stick = { x: 0, y: 0 }, pointerId = null, aimPointer = null, autoAim = true, lastState = '', lastFrame = performance.now(), raf, audio, sound = false, lastTone = 0, lastHud = 0, saved = false;

  function best(difficulty = game.difficulty) {
    try { const value = Number(localStorage.getItem(storageKey(difficulty))); return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; } catch { return 0; }
  }
  function showBest() { const label = $('#survival-best'); if (label) label.textContent = `${t('best')} · ${best($('#survival-difficulty')?.value)}`; }
  function releaseInputs() {
    keys.clear(); stick = { x: 0, y: 0 }; input.x = input.y = 0; input.aim = null; aimPointer = null; pointerId = null;
    $('#survival-stick i').style.transform = '';
  }
  function pause() { releaseInputs(); if (game.pause()) syncOverlay(); audio?.suspend(); }
  function tone(kind) {
    if (!sound || !audio || audio.state !== 'running') return;
    const now = audio.currentTime;
    if (kind === 'shot' && now - lastTone < .11) return;
    lastTone = now;
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = kind === 'shot' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(kind === 'shot' ? 260 : kind === 'hurt' ? 100 : 440, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'shot' ? 65 : 45, now + .12);
    gain.gain.setValueAtTime(kind === 'shot' ? .025 : .06, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + .16);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(now); oscillator.stop(now + .17);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  function syncOverlay() {
    if (lastState === game.state) return;
    lastState = game.state;
    const state = game.state;
    overlay.hidden = state === 'playing';
    $('[data-survival="pause"]').setAttribute('aria-pressed', String(state === 'paused'));
    if (state === 'ready') { showBest(); return; }
    if (state === 'playing') { canvas.focus({ preventScroll: true }); return; }
    releaseInputs();
    const dialog = overlay.querySelector('.survival-dialog');
    if (state === 'upgrade') {
      dialog.innerHTML = `<span class="survival-kicker">EVOLUTION / ${String(game.level).padStart(2, '0')}</span><h2>${t('upgrade')}</h2><p>${t('choose')}</p><div class="survival-upgrades">${game.choices.map((choice, i) => `<button type="button" data-survival="upgrade" data-upgrade="${choice}"><span>0${i + 1} / ${['damage', 'rate', 'multishot', 'repair', 'speed', 'pierce'].indexOf(choice) + 1}</span><strong>${t(choice)}</strong><small>${t(choice + 'Desc')}</small><b>↗</b></button>`).join('')}</div>`;
    } else if (state === 'paused') {
      dialog.innerHTML = `<span class="survival-kicker">OPERATION ON HOLD</span><h2>${t('paused')}</h2><p>${t(matchMedia('(pointer: coarse)').matches?'touch':'controls')}</p><button type="button" class="survival-primary" data-survival="resume">${t('resume')} ↗</button>`;
    } else {
      let failed = false;
      if (!saved) {
        try { localStorage.setItem(storageKey(game.difficulty), String(Math.max(best(), game.kills))); } catch { failed = true; }
        saved = true;
      }
      dialog.innerHTML = `<span class="survival-kicker">${state === 'won' ? 'MISSION COMPLETE' : 'SIGNAL LOST'} / 07</span><h2>${t(state === 'won' ? 'won' : 'dead')}</h2><div class="survival-results"><div><span>${t('kills')}</span><strong>${game.kills}</strong></div><div><span>${t('time')}</span><strong>${formatTime(game.time)}</strong></div><div><span>${t('level')}</span><strong>${game.level}</strong></div></div><button type="button" class="survival-primary" data-survival="start">${t('restart')} ↗</button><small>${t('best')} · ${best()}${failed ? `<br>${t('storage')}` : ''}</small>`;
    }
    // Keyboard users can select upgrades without tabbing through the arena toolbar.
    if (!document.hidden) dialog.querySelector('button')?.focus({ preventScroll: true });
  }
  function updateHud() {
    const p = game.player;
    $('#survival-health').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    $('#survival-health-bar').style.width = `${p.hp / p.maxHp * 100}%`;
    $('#survival-health-bar').classList.toggle('critical', p.hp / p.maxHp < .3);
    $('#survival-wave').textContent = String(game.wave).padStart(2, '0');
    $('#survival-kills').textContent = String(game.kills).padStart(4, '0');
    $('#survival-time').textContent = formatTime(game.time);
    $('#survival-level').textContent = String(game.level).padStart(2, '0');
    $('#survival-xp-bar').style.width = `${Math.min(100, game.xp / game.requiredXp * 100)}%`;
    $('#survival-population').textContent = `${game.enemies.length} / 420`;
    for (const [key, cooldown, shortcut] of [['dash', game.dashCooldown, 'SPACE'], ['pulse', game.pulseCooldown, 'E']]) {
      $(`#survival-${key}`).textContent = cooldown > 0 ? `${Math.ceil(cooldown)}s` : shortcut;
      $(`[data-survival="${key}"]`).disabled = game.state !== 'playing' || cooldown > 0;
    }
    const warning = $('#survival-warning');
    warning.hidden = game.time >= game.warningUntil || game.state === 'ready';
    warning.textContent = t(game.finalSpawned ? 'final' : 'warning');
  }
  async function action(button) {
    const name = button.dataset.survival;
    if (name === 'start') {
      const difficulty = $('#survival-difficulty')?.value || game.difficulty;
      saved = false; game.start(difficulty); releaseInputs(); await audio?.resume();
    } else if (name === 'pause') {
      if (game.state === 'playing') pause(); else if (game.resume()) await audio?.resume();
    } else if (name === 'resume') { game.resume(); await audio?.resume(); }
    else if (name === 'dash') game.dash(input);
    else if (name === 'pulse') game.pulse();
    else if (name === 'upgrade') game.choose(button.dataset.upgrade);
    else if (name === 'aim') {
      autoAim = !autoAim; input.aim = null; button.textContent = t(autoAim ? 'auto' : 'aim'); button.setAttribute('aria-pressed', String(autoAim));
    } else if (name === 'sound') {
      sound = !sound;
      if (sound) { const Audio = window.AudioContext || window.webkitAudioContext; if (Audio) { audio ||= new Audio(); await audio.resume(); } else sound = false; }
      else await audio?.suspend();
      button.setAttribute('aria-pressed', String(sound));
    } else if (name === 'fullscreen') {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await arena.requestFullscreen(); } catch { /* Fullscreen is optional; the inline arena remains playable. */ }
    }
    syncOverlay(); updateHud();
  }
  on(root, 'click', event => {
    const button = event.target.closest('[data-survival]');
    if (button) action(button).catch(console.error);
  });
  on(root, 'change', event => { if (event.target.id === 'survival-difficulty') showBest(); });
  on(document, 'keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    if (!arena.contains(document.activeElement) || document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if (key === 'p' || key === 'escape') {
      if (game.state === 'playing') { event.preventDefault(); pause(); }
      else if (game.state === 'paused') { event.preventDefault(); game.resume(); audio?.resume(); syncOverlay(); }
      return;
    }
    if (game.state !== 'playing') return;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'e'].includes(key)) {
      event.preventDefault(); keys.add(key);
      if (!event.repeat && key === ' ') game.dash(input);
      if (!event.repeat && key === 'e') game.pulse();
    }
  });
  on(document, 'keyup', event => keys.delete(event.key.toLowerCase()));
  on(canvas, 'pointerdown', () => { if (game.state === 'playing') canvas.focus({ preventScroll: true }); });
  on(canvas, 'pointermove', event => { if (!autoAim && event.pointerType !== 'touch') aimPointer = {x:event.clientX,y:event.clientY}; });
  on(canvas, 'pointerleave', () => { input.aim = null; aimPointer = null; });
  const stickElement = $('#survival-stick');
  function moveStick(event) {
    const rect = stickElement.getBoundingClientRect();
    let x = (event.clientX - rect.left - rect.width / 2) / 36, y = (event.clientY - rect.top - rect.height / 2) / 36;
    const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
    stick = { x, y }; $('#survival-stick i').style.transform = `translate(${x * 28}px, ${y * 28}px)`;
  }
  on(stickElement, 'pointerdown', event => {
    if (game.state !== 'playing' || pointerId !== null) return;
    event.preventDefault(); pointerId = event.pointerId; stickElement.setPointerCapture(pointerId); moveStick(event);
  });
  on(stickElement, 'pointermove', event => { if (event.pointerId === pointerId) { event.preventDefault(); moveStick(event); } });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(stickElement, type, event => {
    if (event.pointerId === pointerId) { pointerId = null; stick = { x: 0, y: 0 }; $('#survival-stick i').style.transform = ''; }
  });
  on(document, 'visibilitychange', () => { if (document.hidden) pause(); lastFrame = performance.now(); });
  on(window, 'blur', pause);
  on(document, 'focusin', event => { if (game.state === 'playing' && !root.contains(event.target)) pause(); });
  on(document, 'toggle', () => { if (document.querySelector('dialog[open]')) pause(); }, { capture: true });
  const resize = new ResizeObserver(() => renderer.resize()); resize.observe(arena); renderer.resize();
  function frame(now) {
    input.x = stick.x + Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
    input.y = stick.y + Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
    input.aim = !autoAim && aimPointer ? renderer.screenToWorld(aimPointer.x, aimPointer.y) : null;
    game.advance((now - lastFrame) / 1000, input); lastFrame = now;
    if (document.querySelector('dialog[open]')) pause();
    for (const event of game.events.splice(0)) if (['shot', 'hurt', 'pulse', 'upgrade', 'boss-kill'].includes(event)) tone(event);
    renderer.draw(game, now); syncOverlay();
    if (now - lastHud > 90) { updateHud(); lastHud = now; }
    raf = requestAnimationFrame(frame);
  }
  syncOverlay(); updateHud(); raf = requestAnimationFrame(frame);
  return { game, renderer, pause, dispose() { pause(); abort.abort(); cancelAnimationFrame(raf); resize.disconnect(); renderer.dispose(); audio?.close(); } };
}
