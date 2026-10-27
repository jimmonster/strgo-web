import { LOCALES, STRINGS } from './content.js';
function initialLocale() {
  try { const saved = localStorage.getItem('strgo:locale:v1'); if (LOCALES.includes(saved)) return saved; } catch {}
  const language = navigator.language || 'en';
  if (/^zh-(?:Hant|TW|HK|MO)(?:-|$)/i.test(language)) return 'zh-TW';
  if (/^zh(?:-|$)/i.test(language)) return 'zh-CN';
  if (/^ja(?:-|$)/i.test(language)) return 'ja';
  if (/^ko(?:-|$)/i.test(language)) return 'ko';
  return 'en';
}
function localize(locale) {
  if (!LOCALES.includes(locale)) return;
  document.documentElement.lang = locale;
  document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = STRINGS[locale][element.dataset.i18n]; });
}
localize(initialLocale());
window.addEventListener('strgo:localechange', event => localize(event.detail?.locale));
