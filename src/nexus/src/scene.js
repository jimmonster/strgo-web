import * as THREE from '../assets/three.module.js';
import {sceneConfig} from './scene-config.js';
import {fullscreenVertex,backgroundFragment,blackHoleFragment} from './shaders.js';
import {ForegroundScene} from './foreground.js';
import {FallbackScene} from './fallback.js';

export class SceneManager {
  constructor(state,onQuality){
    this.state=state;this.onQuality=onQuality;this.time=0;this.mouse=new THREE.Vector2();this.targetMouse=new THREE.Vector2();
    this.approach=0;this.fade=0;this.flowBoost=1;this.last=0;this.frames=[];this.quality='medium';this.autoCooldown=0;this.hidden=document.hidden;this.running=true;this.mode='webgl';this.presetBlend=new THREE.Vector2();
    this.canvas=document.querySelector('#scene');
    this.resizeHandler=()=>this.resize();this.pointerHandler=e=>{this.targetMouse.set((e.clientX/innerWidth-.5)*2,(.5-e.clientY/innerHeight)*2);};
    this.visibilityHandler=()=>{this.hidden=document.hidden;this.last=0;if(!this.hidden&&this.running)this.frame(performance.now());};
    this.contextLost=e=>{e.preventDefault();this.fallbackMode('CONTEXT LOST');};
    this.contextRestored=()=>{this.rebuild();};
    window.addEventListener('resize',this.resizeHandler);window.addEventListener('pointermove',this.pointerHandler,{passive:true});document.addEventListener('visibilitychange',this.visibilityHandler);
    this.canvas.addEventListener('webglcontextlost',this.contextLost);this.canvas.addEventListener('webglcontextrestored',this.contextRestored);
    try{this.initWebGL();}catch(error){console.warn('WebGL unavailable: using Canvas 2D.',error.message);this.fallbackMode('CANVAS 2D');}
    this.resize();this.frame(performance.now());
  }
  initWebGL(){
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:false,powerPreference:'high-performance',alpha:false});
    this.renderer.debug.onShaderError=()=>queueMicrotask(()=>this.fallbackMode('SHADER ERROR'));
    this.renderer.autoClear=false;this.renderer.setClearColor(0x030711);this.renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
    this.screenCamera=new THREE.Camera();this.quadGeometry=new THREE.PlaneGeometry(2,2);
    this.background=new THREE.Scene();
    this.bgUniforms={uTime:{value:0},uAspect:{value:1},uMobile:{value:0},uIntensity:{value:1},uMouse:{value:new THREE.Vector2()},uResolution:{value:new THREE.Vector2()},uHue:{value:0}};
    this.bgMaterial=new THREE.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader:backgroundFragment,uniforms:this.bgUniforms,depthTest:false,depthWrite:false});this.background.add(new THREE.Mesh(this.quadGeometry,this.bgMaterial));
    this.target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,stencilBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
    const c=sceneConfig.blackHole;
    this.uniforms={uBackground:{value:this.target.texture},uResolution:{value:new THREE.Vector2()},uTime:{value:0},uCenter:{value:new THREE.Vector2(.69,.69)},uMouse:{value:new THREE.Vector2()},uCore:{value:c.coreRadiusVH},uDiskSpan:{value:c.diskSpanVW},uTilt:{value:-c.diskTiltDeg*Math.PI/180},uLens:{value:c.lensingStrength},uPulse:{value:c.pulseAmount},uAspect:{value:1},uApproach:{value:0},uIntensity:{value:1},uExposure:{value:c.exposure},uFade:{value:0},uFlows:{value:new THREE.Vector3(...c.flowCyclesPerSecond)},uEnvelope:{value:c.glowEnvelopeHeightVH},uInward:{value:c.inwardFlowSpeed},uFlowBoost:{value:1}};
    this.composite=new THREE.Scene();this.bhMaterial=new THREE.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader:blackHoleFragment,uniforms:this.uniforms,depthWrite:false,depthTest:false});this.composite.add(new THREE.Mesh(this.quadGeometry,this.bhMaterial));
    this.foreground=new ForegroundScene();this.renderer.compile(this.background,this.screenCamera);this.renderer.compile(this.composite,this.screenCamera);
  }
  resize(){
    this.width=innerWidth;this.height=innerHeight;this.mobile=this.width<768;
    this.quality=this.state.quality==='auto'?(this.mobile?'low':this.quality):this.state.quality;
    const scales={low:.65,medium:.9,high:1.35};this.scale=Math.min(devicePixelRatio||1,scales[this.quality]);
    if(this.mode==='webgl'){
      this.renderer.setPixelRatio(this.scale);this.renderer.setSize(this.width,this.height,false);
      const w=Math.floor(this.width*this.scale),h=Math.floor(this.height*this.scale);this.target.setSize(w,h);
      this.uniforms.uResolution.value.set(w,h);this.uniforms.uAspect.value=this.width/this.height;
      this.bgUniforms.uAspect.value=this.width/this.height;this.bgUniforms.uMobile.value=this.mobile?1:0;this.bgUniforms.uResolution.value.set(w,h);
      this.foreground.resize(this.width,this.height);
    }else this.fallback?.resize(this.width,this.height);
    this.onQuality?.(this.quality,this.mode);
  }
  setQuality(value){this.state.quality=value;this.quality=value==='auto'?(this.mobile?'low':'medium'):value;this.frames=[];this.autoCooldown=performance.now()+10000;this.resize();}
  fallbackMode(label){
    this.mode='canvas';this.canvas.style.display='none';document.querySelector('#fallback').style.display='block';
    if(!this.fallback)this.fallback=new FallbackScene(document.querySelector('#fallback'));
    this.resize();this.onQuality?.('low',label);
  }
  rebuild(){
    try{this.foreground?.dispose();this.bgMaterial?.dispose();this.bhMaterial?.dispose();this.target?.dispose();this.quadGeometry?.dispose();this.renderer?.dispose();this.initWebGL();this.mode='webgl';this.canvas.style.display='block';document.querySelector('#fallback').style.display='none';this.resize();}catch{this.fallbackMode('CANVAS 2D');}
  }
  frame(now){
    if(!this.running||this.hidden)return;
    cancelAnimationFrame(this.raf);
    const dt=this.last?Math.min((now-this.last)/1000,.05):0;this.last=now;
    const paused=this.state.motionPaused||this.state.reducedMotion;
    if(!paused)this.time+=dt*sceneConfig.motion.intensity;
    const follow=1.-Math.exp(-dt*5.);this.mouse.lerp(paused?new THREE.Vector2():this.targetMouse,follow);
    const target=sceneConfig.presets[this.state.scenePreset]?.offset||[0,0];this.presetBlend.lerp(new THREE.Vector2(...target),1-Math.exp(-dt*5.));
    // Keep paused frames completely still. UI transitions redraw only when needed.
    const signature=[this.state.scenePreset,this.quality,this.approach.toFixed(4),this.fade.toFixed(4),this.width,this.height].join('|');
    if(!paused || signature!==this.lastSignature || !this.drawn){this.render();this.lastSignature=signature;this.drawn=true;}
    this.evaluateQuality(dt,now);
    this.raf=requestAnimationFrame(t=>this.frame(t));
  }
  render(){
    const t=this.time;
    if(this.mode==='canvas'){this.fallback.render(t,this.approach,this.fade);return;}
    const c=sceneConfig.blackHole;
    const u=this.uniforms;u.uTime.value=t;u.uFlowBoost.value=this.flowBoost;u.uMouse.value.copy(this.mouse);u.uApproach.value=this.approach;u.uFade.value=this.fade;
    const center=this.mobile?[.65,.26]:c.centerScreen;
    u.uCenter.value.set(center[0]+this.presetBlend.x,1.-center[1]-this.presetBlend.y);
    u.uCore.value=this.mobile?(.125*this.width/this.height):c.coreRadiusVH;
    u.uDiskSpan.value=this.mobile?.78:c.diskSpanVW;
    u.uTilt.value=-c.diskTiltDeg*Math.PI/180;u.uLens.value=c.lensingStrength;u.uExposure.value=c.exposure;
    u.uFlows.value.set(...c.flowCyclesPerSecond);u.uInward.value=c.inwardFlowSpeed;u.uPulse.value=c.pulseAmount;
    this.bgUniforms.uTime.value=t;this.bgUniforms.uMouse.value.copy(this.mouse);this.bgUniforms.uHue.value=sceneConfig.presets[this.state.scenePreset].hue;
    this.renderer.setRenderTarget(this.target);this.renderer.clear();this.renderer.render(this.background,this.screenCamera);
    this.renderer.setRenderTarget(null);this.renderer.clear();this.renderer.render(this.composite,this.screenCamera);
    this.renderer.clearDepth();this.foreground.update(t,this.mouse,this.approach,this.quality,{x:u.uCenter.value.x,y:u.uCenter.value.y,core:u.uCore.value});
    if(this.fade<.9 && this.approach<.4)this.renderer.render(this.foreground.scene,this.foreground.camera);
  }
  evaluateQuality(dt,now){
    if(!dt||this.state.motionPaused||this.state.reducedMotion||this.state.quality!=='auto')return;
    this.frames.push(dt);if(this.frames.length>600)this.frames.shift();
    if(now<this.autoCooldown||this.frames.length<180)return;
    const recent=this.frames.slice(-180),avg=recent.reduce((a,b)=>a+b,0)/recent.length;
    if(avg>.022&&this.quality!=='low'){this.quality=this.quality==='high'?'medium':'low';this.autoCooldown=now+12000;this.frames=[];this.resize();}
    else if(this.frames.length>=600&&avg<.014&&this.quality!=='high'&&!this.mobile){this.quality=this.quality==='low'?'medium':'high';this.autoCooldown=now+18000;this.frames=[];this.resize();}
  }
  getDiagnostics(){return {mode:this.mode,quality:this.quality,scale:this.scale,time:this.time,drawCalls:this.renderer?.info.render.calls,geometries:this.renderer?.info.memory.geometries,textures:this.renderer?.info.memory.textures,coreDiameterCSS:this.mobile?this.width*.25:this.height*sceneConfig.blackHole.coreRadiusVH*2};}
  dispose(){this.running=false;cancelAnimationFrame(this.raf);window.removeEventListener('resize',this.resizeHandler);window.removeEventListener('pointermove',this.pointerHandler);document.removeEventListener('visibilitychange',this.visibilityHandler);this.canvas.removeEventListener('webglcontextlost',this.contextLost);this.canvas.removeEventListener('webglcontextrestored',this.contextRestored);this.foreground?.dispose();this.target?.dispose();this.quadGeometry?.dispose();this.bgMaterial?.dispose();this.bhMaterial?.dispose();this.renderer?.dispose();}
}
