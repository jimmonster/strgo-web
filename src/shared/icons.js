const paths = {
  hub: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1Z"/>',
  catalog: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 16 5-5 5 5 4-4 4 4"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V6a3 3 0 0 1 3-3h7a8 8 0 0 1 8 8Z"/><path d="M7 8h9M7 13h5"/>',
  music: '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3m7 0h5"/>',
  spaces: '<ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="6"/>',
  tasks: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  assets: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 5V3h10v2M3 11h18m-11 0v3h4v-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m10 2-1 3-3 1-3-1-2 4 3 2v3l-3 2 2 4 3-1 3 1 1 3h4l1-3 3-1 3 1 2-4-3-2v-3l3-2-2-4-3 1-3-1-1-3Z" transform="translate(1 0) scale(.92)"/>',
  admin: '<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5Z"/><path d="m8 12 3 3 5-6"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  star: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',
  arrow: '<path d="M5 19 19 5M5 5h14v14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  mark: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/><path d="M5 4 19 20"/>',
};
const aliases = { studio:'image', overview:'catalog', workflow:'tasks', login:'arrow', classic:'hub', room:'hub', dance:'music', dreams:'spaces', nexus:'spaces', polyverse:'spaces', meow:'spaces', swarmera:'spaces', archive:'spaces', forum:'chat', projects:'assets', updates:'tasks', about:'hub', lab:'spaces', contact:'arrow' };
export function icon(name, className = '') {
  return `<svg class="strgo-icon ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[aliases[name] || name] || paths.catalog}</svg>`;
}
