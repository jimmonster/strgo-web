/** Shared navigation for standalone worlds; does not alter their scene UI. */
import { cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function integrateStrgo(directory, base) {
  const output = directory instanceof URL ? fileURLToPath(directory) : directory;
  const shared = path.join(output, '_strgo');
  await cp(path.join(root, 'src/shared'), shared, { recursive: true });
  const registry = JSON.parse(await readFile(path.join(root, 'content/app-registry.json'), 'utf8'));
  const config = JSON.parse(await readFile(path.join(root, 'site.json'), 'utf8'));
  for (const entry of registry.entries) {
    if (entry.route.startsWith('/#')) entry.route = '/classic/' + entry.route.slice(1);
    if (entry.id === 'N07') entry.route = '/classic/';
    if (entry.id === 'C05') entry.route = (config.WORKFLOW_ORIGIN || 'https://workflow.strgo.com').replace(/\/$/, '') + '/';
    if (entry.id === 'C04') entry.route = config.TERMINAL_TARGET_URL || '/terminal/';
  }
  const tokens = Object.entries(registry.tokens).map(([key, value]) => `--strgo-${key}:${typeof value === 'number' ? value + 'px' : value}`).join(';');
  await writeFile(path.join(shared, 'tokens.css'), `:root{${tokens}}\n`);
  await writeFile(path.join(shared, 'registry.json'), JSON.stringify(registry));
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '_strgo') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.name.endsWith('.html')) {
        let html = await readFile(file, 'utf8');
        html = html.replace('<html ', '<html data-strgo-ui="experience" ');
        html = html.replace('</head>', `<link rel="stylesheet" href="${base}_strgo/tokens.css"><link rel="stylesheet" href="${base}_strgo/design-system.css"></head>`);
        html = html.replace('</body>', `<script type="module" src="${base}_strgo/experience-navigation.js"></script></body>`);
        await writeFile(file, html);
      }
    }
  }
  await visit(output);
}
