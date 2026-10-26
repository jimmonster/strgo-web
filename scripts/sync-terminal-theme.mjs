/** Embed the same tokens in the independently served terminal CSS. */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = new URL('../', import.meta.url);
export async function syncTerminalTheme(check = false) {
  const { tokens } = JSON.parse(await readFile(new URL('content/app-registry.json', root), 'utf8'));
  const block = '/* strgo-tokens:start */\n:root{' + Object.entries(tokens).map(([name, value]) => `--strgo-${name}:${typeof value === 'number' ? value + 'px' : value}`).join(';') + '}\n/* strgo-tokens:end */\n';
  for (const name of ['workspace.css', 'style.css']) {
    const file = new URL('apps/terminal/web/' + name, root);
    const source = await readFile(file, 'utf8');
    const expected = block + source.replace(/\/\* strgo-tokens:start \*\/[\s\S]*?\/\* strgo-tokens:end \*\/\n?/, '');
    if (check && expected !== source) throw new Error('Terminal theme is stale. Run node scripts/sync-terminal-theme.mjs');
    if (!check) await writeFile(file, expected);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await syncTerminalTheme(process.argv.includes('--check'));
