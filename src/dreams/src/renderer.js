import * as T from '../assets/vendor/three.module.js';
import {PainterlyWater} from './water.js';
import {OrbitControls} from '../assets/vendor/OrbitControls.js';
import {makeDreamWorld} from './world.js';
import {CONFIG} from './config.js';
import {makeThemePond} from './pond.js';

const ROOT=new URL('../',import.meta.url);
const createCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const clamp=(a,lo,hi)=>Math.min(hi,Math.max(lo,a));

export class MotionClock{
 constructor(state){this.state=state;this.time=0;this.last=0;this.delta=0;}
 tick(now){this.delta=this.last?Math.min(.05,(now-this.last)/1000):0;this.last=now;if(!document.hidden&&!this.state.paused&&!this.state.reduced)this.time+=this.delta*CONFIG.motion.intensity;else this.delta=0;return this.time;}
}
export class QualityManager{
 constructor(renderer,state){this.renderer=renderer;this.state=state;this.frames=[];this.lastChange=0;this.level=state.quality==='low'||innerWidth<768?'low':'high';this.apply();}
 apply(){this.onChange?.(this.level);this.renderer.setPixelRatio(this.level==='low'?Math.min(devicePixelRatio,1):Math.min(devicePixelRatio,1.5));}
 update(delta,now){if(this.state.quality!=='auto'||delta<=0||now-this.lastChange<12000)return;this.frames.push(delta);if(this.frames.length<120)return;const avg=this.frames.reduce((a,b)=>a+b,0)/this.frames.length;this.frames.length=0;if(avg>.036&&this.level!=='low'){this.level='low';this.lastChange=now;this.apply();}}
 set(value){this.state.quality=value;this.level=value==='auto'?(innerWidth<768?'low':'high'):value;this.apply();this.lastChange=performance.now();}
}

export class PaintedGarden{
 constructor(state){
  this.state=state;this.canvas=document.querySelector('#garden-canvas');this.clock=new MotionClock(state);
  this.pointer=new T.Vector2();this.targetPointer=new T.Vector2();this.progress=0;
  this.dead=false;this.ready=false;this.drawCount=0;this.entries=[];
  try{
   this.renderer=new T.WebGLRenderer({canvas:this.canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
   this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;
   this.renderer.toneMappingExposure=1.02;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
   this.quality=new QualityManager(this.renderer,state);this.mode='real-time 3D garden';
   for(const name of ['hero','themes']){
    const element=document.querySelector('.'+name);if(!element)continue;
    const world=name==='hero'?makeDreamWorld({id:'02',garden:true,canvasFactory:createCanvas,quality:this.quality.level,seed:CONFIG.seed}):makeThemePond({canvasFactory:createCanvas,seed:CONFIG.seed});
    const camera=new T.PerspectiveCamera(40,1,.2,260);
    const water=new PainterlyWater(world.waterSpec,{quality:this.quality.level,sun:world.sunPosition,amplitude:CONFIG.water.amplitudePx});world.scene.add(water);world.update(0,0);
    this.entries.push({name,element,world,camera,water});
   }
  }catch(error){this.entries.forEach(e=>{e.water.removeFromParent();e.water.dispose();e.world.dispose();});this.entries=[];this.renderer?.dispose();this.fallback();this.ready=true;return;}
  this.quality.onChange=level=>{this.entries.forEach(e=>{e.water.setQuality(level);e.world.scene.traverse(o=>{if(o.isInstancedMesh){o.userData.fullCount??=o.count;o.count=Math.floor(o.userData.fullCount*(level==='low'?.65:1));}});});this.force=true;};
  this.quality.onChange(this.quality.level);
  this.onPointer=e=>this.targetPointer.set(e.clientX/innerWidth-.5,.5-e.clientY/innerHeight);
  window.addEventListener('pointermove',this.onPointer,{passive:true});
  this.resize=()=>{this.renderer.setSize(innerWidth,innerHeight,false);this.force=true;};
  window.addEventListener('resize',this.resize);this.resize();
  this.onScroll=()=>{this.force=true;};window.addEventListener('scroll',this.onScroll,{passive:true});
  this.lost=e=>{e.preventDefault();this.fallback();};
  this.restored=()=>{for(const e of this.entries){e.water.removeFromParent();e.water.dispose();e.water=new PainterlyWater(e.world.waterSpec,{quality:this.quality.level,sun:e.world.sunPosition,amplitude:CONFIG.water.amplitudePx});e.world.scene.add(e.water);}this.canvas.style.display='';document.querySelector('.scene-fallback-note')?.remove();this.mode='real-time 3D garden';this.resize();};
  this.canvas.addEventListener('webglcontextlost',this.lost);this.canvas.addEventListener('webglcontextrestored',this.restored);
  this.ready=true;this.frame=this.frame.bind(this);this.frameId=requestAnimationFrame(this.frame);
 }
 fallback(){
  this.canvas.style.display='none';this.mode='painted fallback';
  if(!document.querySelector('.scene-fallback-note')){
   const note=document.createElement('span');note.className='scene-fallback-note';note.dataset.i18n='simple';
   note.textContent=this.state.locale==='ja'?'簡易画境 · WebGL を利用できません':'Simplified painted scene · WebGL is unavailable';
   document.querySelector('.hero')?.append(note);
  }
 }
 frame(now){
  if(this.dead)return;this.frameId=requestAnimationFrame(this.frame);const time=this.clock.tick(now);
  if(document.hidden||this.mode==='painted fallback'||((this.state.paused||this.state.reduced)&&this.drawCount>0&&!this.force))return;
  this.force=false;this.quality.update(this.clock.delta,now);
  this.pointer.lerp(this.state.reduced?new T.Vector2():this.targetPointer,1-Math.exp(-this.clock.delta/.8));
  const renderer=this.renderer;renderer.setScissorTest(false);renderer.setClearColor(0x000000,0);renderer.clear();renderer.setScissorTest(true);
  for(const entry of this.entries){
   const rect=entry.element.getBoundingClientRect();if(rect.bottom<=0||rect.top>=innerHeight)continue;
   const {camera,world,water}=entry;camera.aspect=rect.width/rect.height;
   if(entry.name==='hero'){
    const mobile=rect.width<768;camera.fov=mobile?57:40;
    camera.position.set((mobile?6:0)+this.pointer.x*.28,11+this.pointer.y*.1,31-this.progress*8);
    camera.lookAt(mobile?12:0, mobile?12:10,-28-this.progress*4);
   }else{camera.fov=34;camera.position.set(0,24,21);camera.lookAt(0,0,-10);}
   camera.updateProjectionMatrix();world.update(time,this.clock.delta);water.update(time,rect.width,rect.height);
   renderer.setViewport(rect.left,innerHeight-rect.bottom,rect.width,rect.height);
   renderer.setScissor(Math.max(0,rect.left),Math.max(0,innerHeight-rect.bottom),Math.min(innerWidth,rect.right)-Math.max(0,rect.left),Math.min(innerHeight,rect.bottom)-Math.max(0,rect.top));
   renderer.render(world.scene,camera);
  }
  renderer.setScissorTest(false);this.drawCount++;
 }
 refresh(){this.force=true;}
 dispose(){
  this.dead=true;cancelAnimationFrame(this.frameId);window.removeEventListener('resize',this.resize);window.removeEventListener('pointermove',this.onPointer);window.removeEventListener('scroll',this.onScroll);
  this.canvas?.removeEventListener('webglcontextlost',this.lost);this.canvas?.removeEventListener('webglcontextrestored',this.restored);
  this.entries.forEach(e=>{e.water.removeFromParent();e.water.dispose();e.world.dispose();});this.renderer?.dispose();
 }
 diagnostics(){return{mode:this.mode,time:this.clock.time,frames:this.drawCount,quality:this.quality?.level,reflections:this.entries.map(e=>({region:e.name,...e.water.diagnostics()})),...this.renderer?.info.memory};}
}

export class CameraController{
 constructor(camera,canvas,world,onChange){
  Object.assign(this,{camera,canvas,world,onChange,roaming:false,touring:false,yaw:0,pitch:0,keys:new Set(),velocity:new T.Vector2(),joystick:new T.Vector2(),drag:null});
  this.controls=new OrbitControls(camera,canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.075;this.controls.enablePan=false;this.controls.minDistance=4;this.controls.maxDistance=42;this.controls.minPolarAngle=.18;this.controls.maxPolarAngle=Math.PI*.48;this.controls.target.copy(world.target);camera.position.copy(world.spawn);this.controls.update();
  this.handlers={down:e=>{if(!this.roaming||e.target!==canvas)return;this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});},move:e=>{if(!this.roaming||!this.drag||e.pointerId!==this.drag.id)return;this.yaw-=(e.clientX-this.drag.x)*.003;this.pitch=clamp(this.pitch-(e.clientY-this.drag.y)*.003,-1.1,1.1);this.drag.x=e.clientX;this.drag.y=e.clientY;},up:e=>{if(this.drag?.id===e.pointerId)this.drag=null;},keydown:e=>{if(!this.roaming||document.querySelector('dialog[open]')||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(e.key==='Escape'){this.setRoam(false);return;}if(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();this.keys.add(e.key);}},keyup:e=>this.keys.delete(e.key),blur:()=>{this.keys.clear();this.velocity.set(0,0);}};
  canvas.addEventListener('pointerdown',this.handlers.down);canvas.addEventListener('pointermove',this.handlers.move);canvas.addEventListener('pointerup',this.handlers.up);canvas.addEventListener('pointercancel',this.handlers.up);window.addEventListener('keydown',this.handlers.keydown);window.addEventListener('keyup',this.handlers.keyup);window.addEventListener('blur',this.handlers.blur);
  this.joy=document.querySelector('#joystick');if(this.joy){this.joyDown=e=>{e.preventDefault();this.joy.setPointerCapture(e.pointerId);this.joyMove(e);};this.joyMove=e=>{if(e.type==='pointermove'&&!this.joy.hasPointerCapture(e.pointerId))return;const b=this.joy.getBoundingClientRect();this.joystick.set(clamp((e.clientX-b.left-b.width/2)/30,-1,1),clamp((e.clientY-b.top-b.height/2)/30,-1,1));this.joy.firstElementChild.style.transform=`translate(${this.joystick.x*24}px,${this.joystick.y*24}px)`;};this.joyUp=()=>{this.joystick.set(0,0);this.joy.firstElementChild.style.transform='';};this.joy.addEventListener('pointerdown',this.joyDown);this.joy.addEventListener('pointermove',this.joyMove);this.joy.addEventListener('pointerup',this.joyUp);this.joy.addEventListener('pointercancel',this.joyUp);}
 }
 setRoam(value){this.roaming=value;this.touring=false;this.controls.enabled=!value;this.keys.clear();this.velocity.set(0,0);this.drag=null;if(value){this.camera.position.set(0,this.world.height(0,18)+1.8,18);this.yaw=0;this.pitch=0;this.canvas.focus({preventScroll:true});}else{this.camera.position.copy(this.world.spawn);this.controls.target.copy(this.world.target);this.controls.update();}if(this.joy)this.joy.hidden=!value||!matchMedia('(pointer: coarse)').matches;this.onChange?.();}
 reset(){this.setRoam(false);this.controls.reset();this.camera.position.copy(this.world.spawn);this.controls.target.copy(this.world.target);this.controls.update();this.onChange?.();}
 setTour(value){if(this.roaming)this.setRoam(false);this.touring=value;this.onChange?.();}
 update(delta,time){
  if(this.roaming){const forward=(this.keys.has('w')||this.keys.has('ArrowUp')?1:0)-(this.keys.has('s')||this.keys.has('ArrowDown')?1:0)-this.joystick.y;const side=(this.keys.has('d')||this.keys.has('ArrowRight')?1:0)-(this.keys.has('a')||this.keys.has('ArrowLeft')?1:0)+this.joystick.x;const input=new T.Vector2(side,forward);if(input.length()>1)input.normalize();this.velocity.lerp(input,1-Math.exp(-delta*8));const speed=delta*3.3,dx=(-Math.sin(this.yaw)*this.velocity.y+Math.cos(this.yaw)*this.velocity.x)*speed,dz=(-Math.cos(this.yaw)*this.velocity.y-Math.sin(this.yaw)*this.velocity.x)*speed;let x=this.camera.position.x,z=this.camera.position.z;if(this.world.isWalkable(x+dx,z))x+=dx;if(this.world.isWalkable(x,z+dz))z+=dz;this.camera.position.set(x,(this.world.walkHeight?.(x,z)??this.world.height(x,z))+1.8,z);this.camera.lookAt(this.camera.position.clone().add(new T.Vector3(-Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),-Math.cos(this.yaw)*Math.cos(this.pitch))));}
  else if(this.touring){const a=time*.065;this.camera.position.set(this.world.spawn.x+Math.sin(a)*6,this.world.spawn.y+Math.sin(a*.7),this.world.spawn.z+Math.cos(a)*3);this.camera.lookAt(this.world.target);}else this.controls.update();
 }
 dispose(){this.controls.dispose();this.canvas.removeEventListener('pointerdown',this.handlers.down);this.canvas.removeEventListener('pointermove',this.handlers.move);this.canvas.removeEventListener('pointerup',this.handlers.up);this.canvas.removeEventListener('pointercancel',this.handlers.up);window.removeEventListener('keydown',this.handlers.keydown);window.removeEventListener('keyup',this.handlers.keyup);window.removeEventListener('blur',this.handlers.blur);if(this.joy){this.joy.removeEventListener('pointerdown',this.joyDown);this.joy.removeEventListener('pointermove',this.joyMove);this.joy.removeEventListener('pointerup',this.joyUp);this.joy.removeEventListener('pointercancel',this.joyUp);}}
}

export class DreamRenderer{
 constructor(state,id,onCameraChange){this.state=state;this.id=id;this.clock=new MotionClock(state);this.canvas=document.querySelector('#dream-canvas');this.host=this.canvas.parentElement;this.dead=false;this.mode='loading';this.frames=0;this.onCameraChange=onCameraChange;
  try{this.renderer=new T.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:false,powerPreference:'high-performance'});}catch{this.fallback();return;}
  this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.quality=new QualityManager(this.renderer,state);this.world=makeDreamWorld({id,film:CONFIG.contentMode==='film',quality:this.quality.level,canvasFactory:createCanvas,seed:CONFIG.seed});this.world.update(0,0);this.camera=new T.PerspectiveCamera(49,1,.1,190);this.controller=new CameraController(this.camera,this.canvas,this.world,onCameraChange);this.controller.controls.addEventListener('change',()=>{this.force=true;});this.mode='real-time 3D';
  if(this.world.waterSpec)this.makeWater();
  this.quality.onChange=level=>{this.world.scene.traverse(o=>{if(o.isInstancedMesh){if(!o.userData.fullCount)o.userData.fullCount=o.count;o.count=Math.floor(o.userData.fullCount*(level==='low'?.65:1));}});this.water?.setQuality(level);this.force=true;};
  this.resize=()=>{const b=this.host.getBoundingClientRect();this.renderer.setSize(b.width,b.height,false);this.camera.aspect=b.width/b.height;this.camera.fov=b.width<768?62:49;this.camera.updateProjectionMatrix();this.force=true;};this.observer=new ResizeObserver(this.resize);this.observer.observe(this.host);this.resize();
  this.lost=e=>{e.preventDefault();this.fallback();};this.restore=()=>{if(this.water){this.water.removeFromParent();this.water.dispose();this.makeWater();}this.canvas.style.display='';this.mode='real-time 3D';this.force=true;const status=document.querySelector('#render-status');status.textContent='';delete status.dataset.i18n;document.querySelectorAll('#reset-view,#roam-view,#tour-view').forEach(b=>b.disabled=false);this.resize();};this.canvas.addEventListener('webglcontextlost',this.lost);this.canvas.addEventListener('webglcontextrestored',this.restore);
  this.visibility=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;if(!this.visible&&this.controller.roaming)this.controller.setRoam(false);this.clock.last=0;},{threshold:.05});this.visibility.observe(this.host);this.visible=true;this.frame=this.frame.bind(this);this.frameId=requestAnimationFrame(this.frame);
 }
 makeWater(){
  this.water=new PainterlyWater(this.world.waterSpec,{quality:this.quality.level,sun:this.world.sunPosition,amplitude:CONFIG.water.amplitudePx});
  this.world.scene.add(this.water);
 }
 fallback(){this.mode='simplified painting';if(this.canvas)this.canvas.style.display='none';document.querySelector('#render-status').dataset.i18n='simple';document.querySelector('#render-status').textContent=this.state.locale==='ja'?'簡易画境 · WebGL を利用できません':'Simplified painted scene · WebGL is unavailable';document.querySelectorAll('#reset-view,#roam-view,#tour-view').forEach(b=>b.disabled=true);}
 frame(now){if(this.dead)return;this.frameId=requestAnimationFrame(this.frame);const t=this.clock.tick(now);if(document.hidden||!this.visible||this.mode!=='real-time 3D')return;const stopped=this.state.paused||this.state.reduced;if(stopped&&this.frames>0&&!this.force)return;this.force=false;this.quality.update(this.clock.delta,now);if(!stopped)this.world.update(t,this.clock.delta);this.controller.update(stopped?0:this.clock.delta,t);this.water?.update(t,this.host.clientWidth,this.host.clientHeight);this.renderer.render(this.world.scene,this.camera);this.frames++;
 }
 refresh(){this.force=true;}
 dispose(){this.dead=true;cancelAnimationFrame(this.frameId);this.observer?.disconnect();this.visibility?.disconnect();this.canvas?.removeEventListener('webglcontextlost',this.lost);this.canvas?.removeEventListener('webglcontextrestored',this.restore);this.controller?.dispose();this.water?.removeFromParent();this.water?.dispose();this.world?.dispose();this.renderer?.dispose();}
 diagnostics(){return{mode:this.mode,id:this.id,time:this.clock.time,quality:this.quality?.level,frames:this.frames,roaming:this.controller?.roaming,reflection:this.water?.diagnostics(),...this.renderer?.info.memory,calls:this.renderer?.info.render.calls,triangles:this.renderer?.info.render.triangles};}
}
