import {CATS, GALLERIES, PRODUCTS} from './data.js';

export const types = [
  ['british-shorthair','英国短毛猫','British Shorthair','英短'],
  ['american-shorthair','美国短毛猫','American Shorthair','美短'],
  ['ragdoll','布偶猫','Ragdoll','布偶'],['maine-coon','缅因猫','Maine Coon','缅因'],
  ['persian','波斯猫','Persian','波斯'],['exotic-shorthair','异国短毛猫','Exotic Shorthair','异短'],
  ['siamese','暹罗猫','Siamese','暹罗'],['bengal','孟加拉猫','Bengal','孟加拉'],
  ['russian-blue','俄罗斯蓝猫','Russian Blue','俄蓝'],['norwegian-forest','挪威森林猫','Norwegian Forest Cat','挪威森林'],
  ['sphynx','斯芬克斯猫','Sphynx','无毛猫'],['domestic','田园与混合家猫','Domestic & Mixed Cats','家猫']
].map(([id,name,en,alias])=>({id,name,en,alias}));
const colors={milk:'cream',mocha:'orange',boba:'gray',peach:'cream',luna:'cream',atlas:'brown',pearl:'white',milo:'cream',tiger:'brown',misty:'gray',fern:'brown',suki:'warm',sunny:'orange',clover:'mixed'};
export const cats=CATS.map(c=>({...c,baseColor:colors[c.id],route:`cats/${c.id}/`,actions:[...new Set(['pet','paw','wave','look','stretch','sleep',...c.actions])],accessory:c.id==='mocha'?'hoodie':c.id==='milk'?'bow':'collar',aliases:types.find(t=>t.id===c.typeId)}));
export const galleries=GALLERIES.map(g=>({...g,route:`gallery/${g.id}/`,action:{'bubble-wave':'wave','hoodie-peek':'look','cozy-roll':'roll','paw-party':'paw','cloud-nap':'sleep'}[g.id]}));
export const products=PRODUCTS.map(p=>({...p,route:`shop/${p.id}/`}));
export const pages=[
  ['about','关于 Meow','角色创作与资源说明'],['contact','联系与草稿','保存或导出消息草稿'],['account','本地体验档案','昵称与偏好'],
  ['adopt','云陪伴','数字纪念卡'],['care','健康照护主题','饮水、环境与玩耍'],['community','Meow 社区','示例故事与本地留言'],
  ['subscribe','订阅意向','本地保存与服务状态'],['favorites','收藏夹','猫咪、作品与商品'],['cart','购物清单','本地商品与规格']
].map(([id,name,description])=>({id,name,description,route:`${id}/`}));
export const findCat=id=>cats.find(c=>c.id===id);
export const findGallery=id=>galleries.find(c=>c.id===id);
export const findProduct=id=>products.find(c=>c.id===id);
export const coatNames={short:'短毛',long:'长毛','semi-long':'半长毛',hairless:'近乎无毛'};
export const colorNames={cream:'奶油色',orange:'橘色',gray:'灰色',brown:'棕色',white:'白色',warm:'暖肤色',mixed:'多色'};
export const patternNames={'cream':'奶白纯色','orange-tabby':'橘色虎斑','silver-white':'银灰白','cream-white':'奶油橘白','blue-bicolor-point':'蓝双色重点','brown-tabby-white':'棕虎斑白胸','seal-point':'海豹重点','rosette':'玫瑰斑','blue-solid':'蓝灰纯色','brown-white':'棕白双色','warm-skin':'暖肤色','calico':'三花'};
export function filterCats(params,favorites=[]){
  const read=key=>(params.get(key)||'').split(',').filter(Boolean);
  const selected={type:read('type'),coat:read('coat'),color:read('color'),pattern:read('pattern')};
  const q=(params.get('q')||'').trim().toLocaleLowerCase();
  return cats.filter(c=>Object.entries(selected).every(([key,values])=>!values.length||values.some(v=>key==='type'?c.typeId===v:key==='coat'?(v==='long'?['long','semi-long'].includes(c.coat):c.coat===v):key==='color'?c.baseColor===v:c.pattern===v))&&(!q||`${c.name} ${c.type} ${c.zh} ${c.aliases.en} ${c.aliases.alias} ${c.tags.join(' ')}`.toLocaleLowerCase().includes(q))&&(params.get('favorite')!=='1'||favorites.includes(`cat:${c.id}`)));
}
export const searchIndex=[
  ...cats.map(c=>({type:'cat',id:c.id,title:c.name,description:`${c.type} · ${c.personality}`,route:c.route,text:`${c.name} ${c.type} ${c.zh} ${c.aliases.en} ${c.aliases.alias} ${c.tags.join(' ')}`})),
  ...types.map(t=>({type:'type',id:t.id,title:t.name,description:`${t.en} · 品种与家猫类型`,route:`cats/?type=${t.id}`,text:`${t.name} ${t.en} ${t.alias}`})),
  ...galleries.map(g=>({type:'gallery',id:g.id,title:g.title,description:g.copy,route:g.route,text:`${g.title} ${g.copy} ${g.subtitle}`})),
  ...products.map(p=>({type:'product',id:p.id,title:p.title,description:p.copy,route:p.route,text:`${p.title} ${p.copy}`})),
  ...pages.map(p=>({type:'page',id:p.id,title:p.name,description:p.description,route:p.route,text:`${p.name} ${p.id} ${p.description}`}))
];
export const search=term=>term.trim()?searchIndex.filter(i=>i.text.toLocaleLowerCase().includes(term.trim().toLocaleLowerCase())):[];
