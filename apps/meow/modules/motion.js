export class Motion{
  constructor(store){this.store=store;this.system=matchMedia('(prefers-reduced-motion: reduce)');this.listeners=new Set();this.system.addEventListener('change',()=>this.apply());this.unsubscribe=store.subscribe(()=>this.apply());this.apply();}
  get paused(){return this.store.data.settings.paused;}
  get reduced(){return this.system.matches||this.store.data.settings.reduced;}
  get frozen(){return this.paused||this.reduced||document.hidden;}
  apply(){document.documentElement.classList.toggle('motion-paused',this.paused);document.documentElement.classList.toggle('motion-reduced',this.reduced);this.listeners.forEach(fn=>fn());}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
}
