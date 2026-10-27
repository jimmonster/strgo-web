import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { east } from '../src/locale-east.js';
import { traditional } from '../src/locale-traditional.js';
import { phrase, localized, locales } from '../src/locale.js';
import { pages, searchPages } from '../src/data.js';
import { renderPage } from '../src/views.js';

function validatePairs(value) {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && /[\u3400-\u9fff]/.test(value[0]) && typeof value[1] === 'string') {
    assert.ok(Object.hasOwn(traditional,value[0]), `Traditional: ${value[0]}`);
    assert.ok(east[value[0]]?.every(Boolean), `Japanese/Korean: ${value[0]}`);
  } else if (value && typeof value === 'object') for (const item of Object.values(value)) validatePairs(item);
}
test('world-building and articles have translations in all five languages', () => {
  for (const page of pages) validatePairs(page);
  assert.equal(localized(['虫族女皇','THE QUEEN'],'ja'),'虫族の女王');
  assert.equal(phrase('找到 3 项结果','Found 3 results','ko'),'3개의 결과');
});
test('all literal interface translations exist and searches recognize localized names', async () => {
  for (const file of ['views.js','app.js']) {
    const source=await readFile(new URL(`../src/${file}`,import.meta.url),'utf8');
    for (const match of source.matchAll(/\bL\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g)) {
      const sourceText=match[1]; if (!/[\u3400-\u9fff]/.test(sourceText)) continue;
      assert.ok(traditional[sourceText], `Traditional: ${sourceText}`);
      assert.ok(east[sourceText]?.every(Boolean), `Japanese/Korean: ${sourceText}`);
    }
  }
  for (const term of ['虫族女皇','蟲族女皇','THE SWARM QUEEN','虫族の女王','군단의 여왕']) assert.ok(searchPages(term).some(p=>p.path==='/queen/'),term);
  for(const locale of locales) assert.ok(renderPage(pages[0],locale,'/swarmera/').includes('data-action="language"'));
});
