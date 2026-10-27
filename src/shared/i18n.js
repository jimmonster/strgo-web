import { english } from './translations.js';
import { traditional } from './traditional.js';
import { japanese, korean } from './east-asian.js';

export const LOCALE_KEY = 'strgo:locale:v1';
export const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'];
const dictionaries = { 'zh-TW': traditional, en: english, ja: japanese, ko: korean };
let current;

export function resolveLocale(saved, languages = []) {
  if (SUPPORTED_LOCALES.includes(saved)) return saved;
  const preferred = Array.isArray(languages) ? languages : [languages];
  const language = preferred.find(value => typeof value === 'string' && value.trim());
  if (!language) return 'zh-CN';
  if (/^zh(?:-|$)/i.test(language)) return /^zh-(?:Hant|TW|HK|MO)(?:-|$)/i.test(language) ? 'zh-TW' : 'zh-CN';
  if (/^ja(?:-|$)/i.test(language)) return 'ja';
  if (/^ko(?:-|$)/i.test(language)) return 'ko';
  return 'en';
}

export function getLocale() {
  if (current) return current;
  let saved;
  try { saved = globalThis.localStorage?.getItem(LOCALE_KEY); } catch { /* Storage may be blocked. */ }
  const languages = globalThis.navigator?.languages?.length ? globalThis.navigator.languages : [globalThis.navigator?.language];
  return current = resolveLocale(saved, languages);
}

export function setLocale(locale, { persist = true } = {}) {
  if (!SUPPORTED_LOCALES.includes(locale)) return false;
  current = locale;
  if (persist) { try { globalThis.localStorage?.setItem(LOCALE_KEY, locale); } catch { /* Keep this tab usable. */ } }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strgo:localechange', { detail: { locale } }));
  return true;
}

export function translate(source, locale = getLocale()) {
  if (locale === 'zh-CN' || typeof source !== 'string') return source;
  const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const text = match[2];
  const dictionary = dictionaries[locale] || english;
  let value = dictionary[text] ?? (locale === 'zh-TW' ? undefined : english[text]);
  if (value === undefined) {
    let m;
    if ((m = text.match(/^(\d+) 个主入口 \/ (\d+) 个沉浸空间 \/ 一个起点$/))) {
      value = { en: `${m[1]} features / ${m[2]} immersive spaces / one starting point`, 'zh-TW': `${m[1]} 個主入口 / ${m[2]} 個沉浸空間 / 一個起點`, ja: `${m[1]} の機能 / ${m[2]} つの空間 / ひとつの入口`, ko: `기능 ${m[1]}개 / 몰입형 공간 ${m[2]}개 / 하나의 시작점` }[locale];
    } else if ((m = text.match(/^(\d+) 个匹配入口$/))) {
      value = { en: `${m[1]} matching ${m[1] === '1' ? 'feature' : 'features'}`, 'zh-TW': `${m[1]} 個符合的入口`, ja: `${m[1]} 件の機能`, ko: `일치하는 기능 ${m[1]}개` }[locale];
    } else if ((m = text.match(/^本机访问记录 · (.+)$/))) {
      value = { en: 'Recent on this device', 'zh-TW': '本機訪問記錄', ja: 'このデバイスの最近の履歴', ko: '이 기기의 최근 기록' }[locale] + ' · ' + translate(m[1], locale);
    } else if ((m = text.match(/^梦境 (\d\d) ↗$/))) {
      value = { en: `Dream ${m[1]} ↗`, 'zh-TW': `夢境 ${m[1]} ↗`, ja: `夢 ${m[1]} ↗`, ko: `꿈 ${m[1]} ↗` }[locale];
    } else if ((m = text.match(/^(取消收藏|收藏)(.+)$/)) && (english[m[2]] || dictionary[m[2]])) {
      value = translate(m[1], locale) + translate(m[2], locale);
    } else if ((m = text.match(/^(.+)视觉示意$/)) && (english[m[1]] || dictionary[m[1]])) {
      value = translate(m[1], locale) + { en: ' illustration', 'zh-TW': '視覺示意', ja: 'のイメージ', ko: ' 이미지' }[locale];
    } else if ((m = text.match(/^(.+) · STRGO$/))) {
      const part = translate(m[1], locale); if (part !== m[1]) value = `${part} · STRGO`;
    } else if ((m = text.match(/^STRGO · (.+)$/))) {
      const part = translate(m[1], locale); if (part !== m[1]) value = `STRGO · ${part}`;
    }
  }
  return value !== undefined ? match[1] + value + match[3] : source;
}

// A whitelist of UI regions, not a translation service. Never traverse user content.
const protectedContent = [
  '[data-strgo-user-content]', 'option:not([value])', 'script', 'style', 'code', 'pre', '[contenteditable]:not([contenteditable="false"])',
  '#profile', '#dialog-title', '#dialog-description',
  '#posts', '#comments-list', '#notifications-list', '#detail-content', '#delete-description', '#header-name', '#side-name', '#side-avatar', '#header-avatar',
  '#account-name', '#conversation-list', '#auth-error', '.account-avatar', '.account', '#music-results', '#current-output', '#library-list', '#preset-results', '#preset-list', '#shared-preset-list', '#inspiration-list', '#reference-name', '#preview-prompt', '#model-label', '#storage-description', '.assistant-column',
  '#music-form select[name="model_id"]', '#toast', '[data-toast-text]', '.message-content', '.post-preview', '.post-author', '.author-name'
].join(',');
const records = new WeakMap();
let initialized = false;

function isHubPage() {
  return document.documentElement.dataset.strgoUi === 'hub' || (/^\/ai\/(?:tasks|assets)\/?$/.test(location.pathname) && !!document.querySelector('#railNav'));
}

function localizesTitle() { return isHubPage() || /^\/(?:home|dance|forum|image-playground)\/?$/.test(location.pathname); }

function eligible(element) {
  if (!element || element.closest(protectedContent)) return false;
  const html = document.documentElement;
  const surface = html.dataset.strgoUi;
  const path = location.pathname;
  if (element.tagName === 'TITLE' && localizesTitle()) return true;
  if (isHubPage() || surface === 'classic') return true;
  if (surface === 'experience') return /^\/(?:home|dance)\/?$/.test(path);
  if (path.startsWith('/forum/')) return !!element.closest('.skip, .topbar, #auth-view, #workspace, .mobile-bottom, dialog');
  if (path.startsWith('/image-playground/')) return !!element.closest('.skip, .topbar, #auth-view, #workspace, #image-dialog');
  if (path.startsWith('/ai/')) return !!element.closest('.sidebar nav, .back-home, .topbar, .workspace-footer, #main .page-heading, #main .overview-heading, #main .overview-cards, #main .history, #main .music-composer > .panel-title, #music-form') || (!!document.querySelector('#login-form') && !!element.closest('#dialog-content'));
  if (path.startsWith('/admin/')) return !!element.closest('.layout aside, .workspace > header, .workspace > footer');
  return false;
}

function updateValue(node, attribute) {
  const element = attribute ? node : node.parentElement;
  if (!eligible(element)) return;
  const value = attribute ? node.getAttribute(attribute) : node.nodeValue;
  if (value == null) return;
  let record = records.get(node);
  if (!record) { record = {}; records.set(node, record); }
  const key = attribute || '#text';
  let entry = record[key];
  // An application may update a status after we localize it; treat that as fresh UI copy.
  if (!entry || (value !== entry.source && value !== entry.rendered)) entry = { source: value, rendered: value };
  const next = translate(entry.source);
  entry.rendered = next; record[key] = entry;
  if (value !== next) {
    if (attribute) node.setAttribute(attribute, next); else node.nodeValue = next;
  }
}

export function localizeTree(node) {
  if (!node) return;
  if (node.nodeType === 3) { updateValue(node); return; }
  if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
  if (node.nodeType === 1) {
    if (node.matches(protectedContent)) return;
    for (const attribute of ['aria-label', 'placeholder']) if (node.hasAttribute(attribute)) updateValue(node, attribute);
    if (node.matches('input, textarea, option:not([value])')) return; // Never change form values.
  }
  for (const child of node.childNodes) localizeTree(child);
}

export function setupI18n() {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;
  const start = () => {
    const update = () => {
      const surface = document.documentElement.dataset.strgoUi;
      if (isHubPage() || surface === 'classic' || (surface === 'experience' && /^\/(?:home|dance)\/?$/.test(location.pathname)) || /^\/(?:forum|image-playground)\//.test(location.pathname)) document.documentElement.lang = getLocale();
      localizeTree(document.body);
      if (localizesTitle()) localizeTree(document.querySelector('title'));
    };
    update();
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') localizeTree(mutation.target);
        else if (mutation.type === 'attributes') updateValue(mutation.target, mutation.attributeName);
        else for (const node of mutation.addedNodes) localizeTree(node);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'placeholder'] });
    const title = document.querySelector('title');
    if (localizesTitle() && title) observer.observe(title, { childList: true, characterData: true, subtree: true });
    window.addEventListener('strgo:localechange', update);
    window.addEventListener('strgo:localerequest', event => setLocale(event.detail?.locale));
    window.addEventListener('storage', event => {
      if (event.key === LOCALE_KEY) setLocale(resolveLocale(event.newValue, navigator.languages), { persist: false });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
