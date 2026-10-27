export const defaults={schemaVersion:1,sceneId:'descent',seed:16026,selectedUnit:'breaker',cameraPreset:'battlefield',effects:{swarm:true,lightning:true,trails:true,smoke:true,bloom:true,dust:true,portal:true,embers:true},quality:'auto',locale:'zh-CN'};
export const sceneIds=['descent','advance','rift'];
export const unitIds=['queen','breaker','bulwark','siege','razorwing'];
export function validateConfig(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid configuration');
 if(input.schemaVersion!==undefined&&input.schemaVersion!==1)throw Error('Unsupported schema version');
 const d=structuredClone(defaults);
 for(const [k,list]of Object.entries({sceneId:sceneIds,selectedUnit:unitIds,cameraPreset:['battlefield','front','side','back','core','face','armor','wing'],quality:['auto','low','high'],locale:['zh-CN','zh-TW','en','ja','ko']}))if(list.includes(input[k]))d[k]=input[k];
 if(Number.isSafeInteger(input.seed)&&input.seed>=0&&input.seed<=2147483647)d.seed=input.seed;
 if(input.effects&&typeof input.effects==='object')for(const k of Object.keys(d.effects))if(typeof input.effects[k]==='boolean')d.effects[k]=input.effects[k];
 return d;
}
export function fromQuery(q){const p=new URLSearchParams(q);return validateConfig({sceneId:p.get('preset')||p.get('scene'),selectedUnit:p.get('unit'),locale:p.get('lang'),seed:p.has('seed')?Number(p.get('seed')):undefined});}
export function parseConfig(text){if(text.length>16000)throw Error('Configuration exceeds 16 KB');return validateConfig(JSON.parse(text));}
export function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
export function read(key,fallback){try{const v=JSON.parse(localStorage.getItem('swarmera:'+key));return v===null?fallback:v;}catch{return fallback;}}
export function save(key,value){try{localStorage.setItem('swarmera:'+key,JSON.stringify(value));return true;}catch{return false;}}
export function remove(key){try{localStorage.removeItem('swarmera:'+key);return true;}catch{return false;}}
export class Simulation{
 constructor(seed=16026){this.seed=seed;this.reset();}
 reset(){this.tick=0;this.time=0;this.accumulator=0;this.cooldown=0;this.projectiles=[];this.events=[];this.hits=0;this.shots=0;this.move=null;this.position={x:0,z:0};this.action=null;this.actions={};this.summonUntil=0;}
 advance(dt){if(!Number.isFinite(dt)||dt<0)return;this.accumulator+=Math.min(dt,.1);while(this.accumulator>=1/60-1e-9){this.step();this.accumulator-=1/60;}}
 step(){this.tick++;this.time=this.tick/60;
  if(this.move){const m=this.move,p=Math.min(1,(this.time-m.start)/m.duration);this.position={x:m.from.x+(m.to.x-m.from.x)*p,z:m.from.z+(m.to.z-m.from.z)*p};if(p===1)this.move=null;}
  for(const p of this.projectiles){const previous={...p.position};p.progress=(this.time-p.start)/p.duration;const u=Math.max(0,Math.min(1,p.progress));for(const axis of ['x','y','z'])p.position[axis]=p.from[axis]+(p.to[axis]-p.from[axis])*u;
   if(!p.hit&&p.progress>=0){const delta={x:p.position.x-previous.x,y:p.position.y-previous.y,z:p.position.z-previous.z},len=delta.x**2+delta.y**2+delta.z**2,projection=len?Math.max(0,Math.min(1,((p.target.x-previous.x)*delta.x+(p.target.y-previous.y)*delta.y+(p.target.z-previous.z)*delta.z)/len)):0;const distance=Math.hypot(previous.x+delta.x*projection-p.target.x,previous.y+delta.y*projection-p.target.y,previous.z+delta.z*projection-p.target.z);if(distance<=p.radius){p.hit=true;this.hits++;this.events.push({type:'hit',time:this.time,target:p.target});}}
  }
  this.projectiles=this.projectiles.filter(p=>p.progress<1.65);this.events=this.events.filter(e=>this.time-e.time<2);
 }
 moveTo(x,z){if(!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>7||Math.abs(z)>5|| (x>3.5&&z>2.5))return false;const from={...this.position},distance=Math.hypot(x-from.x,z-from.z);this.move={from,to:{x,z},start:this.time,duration:Math.max(.4,distance/1.8)};return true;}
 fire(from={x:0,y:2,z:0},to={x:4,y:1,z:-5}){if(this.time<this.cooldown||this.projectiles.length>=8)return false;this.cooldown=this.time+2.5;this.shots++;this.action={id:'fire',start:this.time};this.actions.fire=this.time;this.projectiles.push({from:{...from},to:{...to},start:this.time+1.1,duration:.8,progress:-1,hit:false,position:{...from},target:{...to},radius:.55});return true;}
 trigger(id){if(id==='summon'){if(this.time<this.summonUntil)return false;this.summonUntil=this.time+6;}this.action={id,start:this.time};this.actions[id]=this.time;return true;}
 seek(seconds){const target=Math.max(0,Math.min(42,Number(seconds)||0));this.reset();for(let i=0;i<Math.round(target*60);i++)this.step();}
 snapshot(){return {tick:this.tick,hits:this.hits,shots:this.shots,position:this.position,projectiles:this.projectiles.length,events:this.events.length};}
}
