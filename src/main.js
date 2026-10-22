import { usePerformanceGuard } from './hooks/usePerformanceGuard.js';
import { attachMagnetic } from './core/Component.js';
import { SmoothLayout } from './components/SmoothLayout.js';
import { GlobalLightEngine } from './components/GlobalLightEngine.js';
import { FloatingNavbar } from './components/FloatingNavbar.js';
import { HeroSection } from './components/HeroSection.js';
import { BentoGridSection } from './components/BentoGridSection.js';
import { SpacesSection } from './components/SpacesSection.js';
import { ShowcaseSection } from './components/ShowcaseSection.js';
import { FooterHorizon } from './components/FooterHorizon.js';

const config = JSON.parse(document.getElementById('site-config').textContent);
const guard = usePerformanceGuard();
const layout = new SmoothLayout(document.querySelector('main'), guard);
const components = [layout];
const cleanup = [];
const diagnostics = { failed: [], engines: { scroll: document.documentElement.dataset.scrollEngine, motion: window.gsap ? 'gsap' : 'web-animations', confetti: window.confetti ? 'canvas-confetti' : 'local-canvas' } };
const mount = (name, Factory, selector, ...args) => {
  try { const instance = new Factory(document.querySelector(selector), guard, ...args); components.push(instance); }
  catch (error) { diagnostics.failed.push({ component: name, message: error.message }); console.error(`[${name}]`, error); }
};
mount('GlobalLightEngine', GlobalLightEngine, '.background-engine');
mount('FloatingNavbar', FloatingNavbar, '.floating-navbar');
mount('HeroSection', HeroSection, '.hero-section');
mount('SpacesSection', SpacesSection, '.spaces-section');
mount('BentoGridSection', BentoGridSection, '.bento-section', config);
mount('ShowcaseSection', ShowcaseSection, '.showcase-section', layout);
document.querySelectorAll('.magnetic').forEach(element => cleanup.push(attachMagnetic(element, guard)));
let toastTimer;
const toastElement = document.querySelector('.toast');
const toast = (message, success = true) => {
  clearTimeout(toastTimer); toastElement.querySelector('[data-toast-text]').textContent = message;
  toastElement.querySelector('.toast-icon').textContent = success ? '✓' : '↗';
  toastElement.classList.add('visible'); toastTimer = setTimeout(() => toastElement.classList.remove('visible'), success ? 4500 : 9000);
};
mount('FooterHorizon', FooterHorizon, '.footer-horizon', config, toast);
const motion = document.querySelector('.motion-toggle');
const toggleMotion = () => guard.togglePause(); motion.addEventListener('click', toggleMotion);
cleanup.push(() => motion.removeEventListener('click', toggleMotion));
cleanup.push(guard.subscribe(() => {
  motion.setAttribute('aria-pressed', String(guard.paused));
  motion.setAttribute('aria-label', guard.reducedMotion ? '系统已启用减少动态效果' : guard.paused ? '恢复动态效果' : '暂停动态效果');
  motion.querySelector('.motion-label').textContent = guard.paused ? 'MOTION OFF' : 'MOTION ON';
  motion.querySelector('.motion-icon').textContent = guard.paused ? '▷' : 'Ⅱ';
  motion.disabled = guard.reducedMotion;
}));
const lab = document.querySelector('.lab-stage'), labStatus = document.querySelector('.lab-status');
let labTimer;
const labPulse = () => {
  clearTimeout(labTimer); lab.classList.remove('pulsing');
  if (!guard.paused) { void lab.offsetWidth; lab.classList.add('pulsing'); }
  labStatus.textContent = guard.paused ? 'SIGNAL RECEIVED / 信号已收到' : 'ENERGY RELEASED / 能量已释放';
  labTimer = setTimeout(() => { lab.classList.remove('pulsing'); labStatus.textContent = 'FIELD STABLE / 等待你的信号'; }, 1600);
};
const spectrum = document.querySelector('[data-lab-spectrum]');
const toggleSpectrum = () => { const violet = lab.classList.toggle('violet'); spectrum.setAttribute('aria-pressed', String(violet)); spectrum.setAttribute('aria-label', violet ? '切换为青色光谱' : '切换为紫色光谱'); labStatus.textContent = violet ? 'SPECTRUM / 紫色光谱' : 'SPECTRUM / 青色光谱'; };
document.querySelector('[data-lab-pulse]').addEventListener('click', labPulse); spectrum.addEventListener('click', toggleSpectrum);
cleanup.push(() => { document.querySelector('[data-lab-pulse]').removeEventListener('click', labPulse); spectrum.removeEventListener('click', toggleSpectrum); clearTimeout(labTimer); });
cleanup.push(guard.observe(document.querySelector('.lab-section'), visible => { lab.classList.toggle('animation-sleeping', !visible); if (!visible) { clearTimeout(labTimer); lab.classList.remove('pulsing'); } }));
cleanup.push(guard.observe(document.querySelector('.word-ticker'), visible => document.querySelector('.word-ticker').classList.toggle('animation-sleeping', !visible)));

const projects = Object.fromEntries(config.projects.map(project => [project.id, project]));
const dialog = document.querySelector('.project-dialog');
let previousFocus;
const openProject = event => {
  const button = event.target.closest('[data-project]'); if (!button) return;
  const project = projects[button.dataset.project]; if (!project) return;
  previousFocus = button;
  dialog.querySelector('[data-dialog-category]').textContent = project.category;
  dialog.querySelector('#dialog-title').textContent = project.name;
  dialog.querySelector('[data-dialog-description]').textContent = project.description;
  const tags = dialog.querySelector('.dialog-tags'); tags.replaceChildren();
  project.tags.forEach(text => { const span = document.createElement('span'); span.textContent = text; tags.append(span); });
  const actions = dialog.querySelector('.dialog-actions'); actions.replaceChildren();
  const story = document.createElement('a'); story.className = 'button button-primary'; story.textContent = '作品故事 ↗'; story.href = project.storyPath; actions.append(story);
  for (const experience of [project.experience, project.secondaryExperience].filter(Boolean)) {
    const action = document.createElement('a'); action.className = 'button button-secondary'; action.textContent = `${experience.label} ↗`; action.href = experience.href;
    action.addEventListener('click', () => dialog.close()); actions.append(action);
  }
  document.documentElement.classList.add('dialog-open'); dialog.showModal();
};
const closeDialog = () => dialog.close();
const backdropClose = event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } };
const restoreFocus = () => { document.documentElement.classList.remove('dialog-open'); previousFocus?.focus({ preventScroll: true }); };
document.querySelector('.showcase-section').addEventListener('click', openProject);
dialog.querySelector('.dialog-close').addEventListener('click', closeDialog);
dialog.addEventListener('click', backdropClose); dialog.addEventListener('close', restoreFocus);
cleanup.push(() => { document.querySelector('.showcase-section').removeEventListener('click', openProject); dialog.querySelector('.dialog-close').removeEventListener('click', closeDialog); dialog.removeEventListener('click', backdropClose); dialog.removeEventListener('close', restoreFocus); });
window.StrgoApp = {
  diagnostics, guard, components,
  destroy() { clearTimeout(toastTimer); cleanup.splice(0).reverse().forEach(dispose => dispose()); components.splice(0).reverse().forEach(component => component.destroy()); guard.destroy(); }
};
const pageHide = event => { if (!event.persisted) window.StrgoApp.destroy(); };
window.addEventListener('pagehide', pageHide);
cleanup.push(() => window.removeEventListener('pagehide', pageHide));
