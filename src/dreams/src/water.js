import * as T from '../assets/vendor/three.module.js';
import {Reflector} from '../assets/vendor/Reflector.js';

// All positions and wave phases are world-space. The reflection texture remains
// projective, so orbiting the camera moves the reflected bridge, sky and trees.
export const waterShader = {
 name:'PainterlyPlanarWater',
 uniforms:{
  color:{value:new T.Color()},tDiffuse:{value:null},textureMatrix:{value:new T.Matrix4()},
  uTime:{value:0},uSun:{value:new T.Vector3(33,29,-82)},
  uInvViewport:{value:new T.Vector2(1/1920,1/1080)},uAmplitude:{value:2},
  uPuddleCount:{value:0},uPuddles:{value:Array.from({length:12},()=>new T.Vector4())}
 },
 vertexShader:`
 uniform mat4 textureMatrix;
 varying vec4 vReflection;
 varying vec3 vWorld;
 varying vec2 vWaterUv;
 void main(){
  vWaterUv=uv;
  vWorld=(modelMatrix*vec4(position,1.)).xyz;
  vReflection=textureMatrix*vec4(position,1.);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
 }`,
 fragmentShader:`
 uniform vec3 color;
 uniform sampler2D tDiffuse;
 uniform float uTime;
 uniform vec3 uSun;
 uniform vec2 uInvViewport;
 uniform float uAmplitude;
 uniform int uPuddleCount;
 uniform vec4 uPuddles[12];
 varying vec4 vReflection;
 varying vec3 vWorld;
 varying vec2 vWaterUv;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float waterEdge(){
  if(uPuddleCount==0)return 1.-length((vWaterUv-.5)*2.);
  float edge=-1.;
  for(int i=0;i<12;i++){
   if(i<uPuddleCount){vec4 p=uPuddles[i];vec2 q=(vWorld.xz-p.xy)/p.zw;
    float angle=atan(q.y,q.x);
    float ragged=1.+sin(angle*7.+float(i))*.045+sin(angle*13.)*.02;
    edge=max(edge,1.-length(q)/ragged);
   }
  }
  return edge;
 }
 void main(){
  float edge=waterEdge();if(edge<=0.)discard;
  float shore=smoothstep(0.,.14,edge);
  vec2 p=vWorld.xz;
  float a=dot(p,vec2(.72,1.65))-uTime*.83;
  float b=dot(p,vec2(-1.15,2.8))+uTime*.57;
  float wave=sin(a)*.64+sin(b)*.36;
  vec2 slope=vec2(cos(a)*.025+cos(b)*-.014,cos(a)*.035+cos(b)*.021)*shore;
  vec3 normal=normalize(vec3(-slope.x,1.,-slope.y));
  vec3 eye=normalize(cameraPosition-vWorld);
  vec3 light=normalize(uSun-vWorld);
  vec2 projective=vReflection.xy/vReflection.w;
  vec2 offset=vec2(wave,cos(a*.7+b)*.55)*uInvViewport*uAmplitude*shore;
  vec2 uv=clamp(projective+offset,vec2(.001),vec2(.999));
  vec3 reflection=texture2D(tDiffuse,uv).rgb;
  float fresnel=.28+.64*pow(1.-clamp(dot(normal,eye),0.,1.),3.);
  vec3 deep=color*(.64+.08*sin(p.y*.25));
  vec3 paint=mix(deep,reflection,fresnel);
  // The half vector follows the actual sun and camera. Never a fixed UV stripe.
  vec3 halfDirection=normalize(light+eye);
  float sun=pow(max(dot(normal,halfDirection),0.),220.);
  vec2 stroke=floor(p*vec2(4.,19.));
  float pigment=hash(stroke);
  float broken=mix(.35,1.,smoothstep(.3,.7,pigment+sin(uTime*.7+stroke.y)*.15));
  paint+=vec3(1.,.76,.41)*sun*broken*.48*shore;
  float smallLight=pow(max(sin(p.y*31.+p.x*.7+uTime*.9),0.),24.);
  paint+=vec3(.075,.09,.084)*smallLight*smoothstep(.76,.97,pigment)*shore;
  paint*=.985+pigment*.03;
  gl_FragColor=vec4(paint,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`
};

// Reflector r160 restores the render target but does not restore a caller's
// scissor or logical viewport. Save these explicitly for the two homepage views.
// Hiding sibling reflectors also prevents nested captures and feedback sampling.
export function isolatedCapture(surface,capture,renderer,scene,camera){
 const viewport=renderer.getViewport(new T.Vector4());
 const scissor=renderer.getScissor(new T.Vector4());
 const scissorTest=renderer.getScissorTest(),autoClear=renderer.autoClear;
 const target=renderer.getRenderTarget(),xr=renderer.xr.enabled;
 const shadow=renderer.shadowMap.autoUpdate;
 const surfaces=[];
 scene.traverse(object=>{if(object.isReflector){surfaces.push([object,object.visible]);object.visible=false;}});
 try{renderer.setScissorTest(false);renderer.autoClear=true;capture.call(surface,renderer,scene,camera);}
 finally{
  for(const [object,visible]of surfaces)object.visible=visible;
  renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadow;
  renderer.setRenderTarget(target);renderer.setViewport(viewport);
  renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.autoClear=autoClear;
 }
}

export class PainterlyWater extends Reflector{
 constructor(spec,{quality='high',sun=new T.Vector3(33,29,-82),amplitude=2}={}){
  const resolution=quality==='low'?256:512;
  super(new T.PlaneGeometry(spec.width,spec.depth),{shader:waterShader,color:spec.color,
   clipBias:.003,textureWidth:resolution,textureHeight:resolution,multisample:0});
  this.name=spec.puddles?'Rain puddles — shared planar reflection':'Lake — planar reflection';
  this.rotation.x=-Math.PI/2;this.position.copy(spec.center);
  this.material.uniforms.uSun.value.copy(sun);
  this.material.uniforms.uAmplitude.value=amplitude;
  const puddles=spec.puddles||[];
  this.material.uniforms.uPuddleCount.value=Math.min(puddles.length,12);
  puddles.slice(0,12).forEach((p,i)=>this.material.uniforms.uPuddles.value[i].set(p.x,p.z,p.rx,p.rz));
  this.captureCount=0;const capture=this.onBeforeRender;
  this.onBeforeRender=(renderer,scene,camera)=>{
   isolatedCapture(this,capture,renderer,scene,camera);this.captureCount++;
  };
  this.userData.realTimeReflection=true;this.userData.shoreProtected=true;
  // Reflector installs dispose as an own property; wrap it here so the plane
  // geometry is released too. A subclass prototype method is shadowed by it.
  const disposeReflection=this.dispose;
  this.dispose=()=>{disposeReflection.call(this);this.geometry.dispose();};
 }
 update(time,width,height){this.material.uniforms.uTime.value=time;this.material.uniforms.uInvViewport.value.set(1/Math.max(1,width),1/Math.max(1,height));}
 setQuality(level){const size=level==='low'?256:512;this.getRenderTarget().setSize(size,size);}
 diagnostics(){return{type:'planar scene capture',captures:this.captureCount,resolution:this.getRenderTarget().width,puddles:this.material.uniforms.uPuddleCount.value};}
}
