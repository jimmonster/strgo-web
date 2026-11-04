import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { forumEditorRows } from '../src/shared/forum-editor-copy.js';
import { translate, localizeTree, setLocale } from '../src/shared/i18n.js';

test('editor and PDF UI localize in every language while Markdown text and input values remain unchanged', () => {
  const previous = { document: globalThis.document, location: globalThis.location };
  const { document } = parseHTML('<html><body><dialog open><button id="import">导入 MD</button><textarea>导入 MD</textarea>' +
    '<div class="markdown-body" data-strgo-user-content><p>导入 MD</p><span data-forum-pdf><button data-strgo-ui-copy>预览 PDF</button></span></div></dialog></body></html>');
  globalThis.document = document; globalThis.location = { pathname: '/forum/' };
  try {
    for (const [locale, label] of [['zh-CN','导入 MD'], ['zh-TW','匯入 MD'], ['en','Import MD'], ['ja','MD を読み込む'], ['ko','MD 가져오기']]) {
      setLocale(locale, { persist: false }); localizeTree(document.body);
      assert.equal(document.querySelector('#import').textContent, label);
      assert.equal(document.querySelector('.markdown-body p').textContent, '导入 MD');
      assert.equal(document.querySelector('textarea').value, '导入 MD');
      assert.equal(document.querySelector('[data-forum-pdf] button').textContent, translate('预览 PDF', locale));
    }
    const keys = new Set();
    for (const [source, ...values] of forumEditorRows) {
      assert.equal(keys.has(source), false, source); keys.add(source);
      assert.equal(values.length, 4); assert.ok(values.every(value => value.trim()));
    }
  } finally { setLocale('zh-CN', { persist: false }); Object.assign(globalThis, previous); }
});
