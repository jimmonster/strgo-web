// Three.js is served locally after deploy.sh downloads the pinned distribution.
import * as THREE from './vendor/three.module.js';

export function create(canvas) {
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,premultipliedAlpha:false,powerPreference:'high-performance'});
  renderer.setClearColor(0x000000,0);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(38,1,.1,80);
  camera.position.set(0,-.03,9.2);camera.rotation.x=-.075;
  const accent=new THREE.Color(.28,.94,.94);
  const globals={uAccent:{value:accent},uTime:{value:0},uOpacity:{value:1}};
  const geometryVertex=`
    attribute vec3 materialColor;attribute float glow;
    varying vec3 vPosition;varying vec3 vNormal;varying vec3 vColor;varying float vGlow;
    void main(){vec4 p=modelMatrix*vec4(position,1.0);vPosition=p.xyz;vNormal=mat3(modelMatrix)*normal;vColor=materialColor;vGlow=glow;gl_Position=projectionMatrix*viewMatrix*p;}
  `;
  const material=new THREE.ShaderMaterial({vertexShader:geometryVertex,fragmentShader:window.StrgoScene.shaders.fragmentShader,uniforms:globals,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const edgeMaterial=material.clone();edgeMaterial.polygonOffset=false;
  const disposables=[material,edgeMaterial];
  function geometry(values){
    const result=new THREE.BufferGeometry();const data=new THREE.InterleavedBuffer(new Float32Array(values),10);
    result.setAttribute('position',new THREE.InterleavedBufferAttribute(data,3,0));
    result.setAttribute('normal',new THREE.InterleavedBufferAttribute(data,3,3));
    result.setAttribute('materialColor',new THREE.InterleavedBufferAttribute(data,3,6));
    result.setAttribute('glow',new THREE.InterleavedBufferAttribute(data,1,9));
    disposables.push(result);return result;
  }
  const holder=new THREE.Group();scene.add(holder);
  const models={};
  for(const [name,data] of Object.entries(window.StrgoScene.buildModels())){
    const group=new THREE.Group();group.add(new THREE.Mesh(geometry(data.vertices),material));
    group.add(new THREE.LineSegments(geometry(data.lines),edgeMaterial));group.visible=name==='mecha';holder.add(group);models[name]=group;
  }
  const orbitMaterial=new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.32,depthWrite:false,blending:THREE.AdditiveBlending});
  const orbitGeometry=new THREE.TorusGeometry(2.64,.008,6,120,Math.PI*2*.84);disposables.push(orbitMaterial,orbitGeometry);
  const orbit1=new THREE.Mesh(orbitGeometry,orbitMaterial);scene.add(orbit1);
  const orbitMaterial2=orbitMaterial.clone();orbitMaterial2.opacity=.15;disposables.push(orbitMaterial2);
  const orbit2=new THREE.Mesh(orbitGeometry,orbitMaterial2);orbit2.scale.setScalar(1.07);scene.add(orbit2);
  const grid=new THREE.GridHelper(8,14,0x184554,0x163c49);grid.position.y=-2.58;grid.material.transparent=true;grid.material.opacity=.35;scene.add(grid);disposables.push(grid.geometry,grid.material);

  const screenScene=new THREE.Scene(),screenCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const screenGeometry=new THREE.PlaneGeometry(2,2);disposables.push(screenGeometry);
  const screenVertex='varying vec2 vUV;void main(){vUV=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
  const blurMaterial=new THREE.ShaderMaterial({vertexShader:screenVertex,fragmentShader:window.StrgoScene.shaders.blurFragment,uniforms:{uImage:{value:null},uStep:{value:new THREE.Vector2()}},depthTest:false,depthWrite:false});
  const compositeMaterial=new THREE.ShaderMaterial({vertexShader:screenVertex,fragmentShader:window.StrgoScene.shaders.compositeFragment,uniforms:{uImage:{value:null},uBloom:{value:null},uWarp:{value:0}},depthTest:false,depthWrite:false});
  disposables.push(blurMaterial,compositeMaterial);
  const screenQuad=new THREE.Mesh(screenGeometry,blurMaterial);screenQuad.frustumCulled=false;screenScene.add(screenQuad);
  const targets=[new THREE.WebGLRenderTarget(1,1),new THREE.WebGLRenderTarget(1,1,{depthBuffer:false}),new THREE.WebGLRenderTarget(1,1,{depthBuffer:false})];disposables.push(...targets);
  let width=0,height=0;
  function resize(){
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,rect.width<600?1.25:1.6);
    const w=Math.max(1,Math.min(1600,Math.round(rect.width*dpr))),h=Math.max(1,Math.min(1300,Math.round(rect.height*dpr)));
    if(w===width && h===height)return;width=w;height=h;
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    targets[0].setSize(width,height);targets[1].setSize(Math.max(1,width>>1),Math.max(1,height>>1));targets[2].setSize(Math.max(1,width>>1),Math.max(1,height>>1));
  }
  function render(state){
    resize();const t=state.time,ship=state.model==='ship',warp=state.warp||0;
    accent.setRGB(...(state.violet?[.72,.43,1]:[.28,.94,.94]));globals.uTime.value=t;edgeMaterial.uniforms.uAccent.value.copy(accent);edgeMaterial.uniforms.uTime.value=t;
    for(const [key,group] of Object.entries(models))group.visible=key===state.model;
    holder.position.set(.17,Math.sin(t*.85)*.065,0);
    holder.rotation.set((ship?.4:0)+state.pitch+Math.sin(t*.4)*.025,(ship?-.68:.38)+state.yaw+Math.sin(t*.23)*.14,ship?-.1:Math.sin(t*.3)*.018,'ZYX');
    holder.scale.setScalar((ship?1.03:1)*(1-Math.sin(Math.min(1,state.transition||0)*Math.PI)*.08));
    orbit1.position.set(.17,.1,0);orbit2.position.copy(orbit1.position);
    orbit1.rotation.set(1.15+.12*Math.sin(t*.17),.2,t*.15,'ZYX');orbit2.rotation.set(.45,1.03,-t*.1,'ZYX');
    orbitMaterial.color.copy(accent);orbitMaterial.opacity=.32+warp*.3;orbitMaterial2.color.copy(accent);orbitMaterial2.opacity=.15+warp*.2;grid.rotation.y=t*.025;
    renderer.setRenderTarget(targets[0]);renderer.clear();renderer.render(scene,camera);
    screenQuad.material=blurMaterial;blurMaterial.uniforms.uImage.value=targets[0].texture;blurMaterial.uniforms.uStep.value.set(2.8/width,0);
    renderer.setRenderTarget(targets[1]);renderer.clear();renderer.render(screenScene,screenCamera);
    blurMaterial.uniforms.uImage.value=targets[1].texture;blurMaterial.uniforms.uStep.value.set(0,2.8/targets[1].height);
    renderer.setRenderTarget(targets[2]);renderer.clear();renderer.render(screenScene,screenCamera);
    screenQuad.material=compositeMaterial;compositeMaterial.uniforms.uImage.value=targets[0].texture;compositeMaterial.uniforms.uBloom.value=targets[2].texture;compositeMaterial.uniforms.uWarp.value=warp;
    renderer.setRenderTarget(null);renderer.clear();renderer.render(screenScene,screenCamera);
  }
  return {render,destroy(){disposables.forEach(item=>item.dispose());renderer.dispose();}};
}
