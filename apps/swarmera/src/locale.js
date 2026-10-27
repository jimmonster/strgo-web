import { east } from './locale-east.js';
import { traditional } from './locale-traditional.js';
export const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'];
export function phrase(zh, en, locale) {
  if (locale === 'zh-CN') return zh;
  if (locale === 'en') return en;
  if (locale === 'zh-TW') {
    const count = typeof zh === 'string' && zh.match(/^找到 (\d+) 项结果$/);
    return count ? `找到 ${count[1]} 項結果` : traditional[zh] ?? zh;
  }
  if (locale === 'ja' || locale === 'ko') {
    const value = east[zh]?.[locale === 'ja' ? 0 : 1];
    if (value !== undefined) return value;
    const count = typeof zh === 'string' && zh.match(/^找到 (\d+) 项结果$/);
    if (count) return locale === 'ja' ? `${count[1]} 件の結果` : `${count[1]}개의 결과`;
  }
  return en;
}
export function localized(value, locale) {
  return Array.isArray(value) ? phrase(value[0], value[1], locale) : value;
}
