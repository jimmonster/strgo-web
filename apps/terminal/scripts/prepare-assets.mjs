import { syncTerminalTheme } from '../../../scripts/sync-terminal-theme.mjs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = [['@xterm/xterm', '5.5.0'], ['@xterm/addon-fit', '0.10.0']];
for (const [name, version] of packages) {
  const info = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
  if (info.version !== version) throw new Error(`${name}: expected ${version}, found ${info.version}`);
}
await mkdir(path.join(root, 'web/vendor'), { recursive: true });
for (const [source, destination] of [
  ['@xterm/xterm/lib/xterm.js', 'xterm.js'],
  ['@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['@xterm/xterm/LICENSE', 'XTERM-LICENSE.txt'],
  ['@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js'],
  ['@xterm/addon-fit/LICENSE', 'ADDON-FIT-LICENSE.txt'],
]) await copyFile(path.join(root, 'node_modules', source), path.join(root, 'web/vendor', destination));
console.log('Terminal assets prepared locally; runtime does not use a CDN.');


await syncTerminalTheme();
