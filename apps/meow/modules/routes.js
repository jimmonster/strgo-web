export const base=typeof window==='undefined'?(process.env.MEOW_BASE||'/'):new URL('../',import.meta.url).pathname;
export const href=(route='')=>base+route.replace(/^\//,'');
export function parsePath(path=location.pathname){
  const relative=path.startsWith(base)?path.slice(base.length):'__unknown__';
  const [page='',id='',extra='']=relative.replace(/\/+$/,'').split('/');
  return {page:page==='index.html'?'':page,id,extra};
}
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
