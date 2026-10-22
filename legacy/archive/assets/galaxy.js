/* STRGO / Galaxy Fleet. GPU fluid fields, 3D stars and simultaneous orbiting units. */
(() => {
  'use strict';
  const TAU=Math.PI*2;
  const core=typeof module!=='undefined'&&module.exports?require('./scene.js'):window.StrgoScene;
  const {multiply,transform,point,perspective}=core;
  const units=Array.from({length:15},(_,id)=>({
    id,model:['ship','mecha','robot'][id%3],name:['VOID RUNNER','ATLAS','NOVA'][id%3]+' / '+String(id+1).padStart(2,'0'),
    radius:4.35+(id%3)*1.04,phase:id/15*TAU+id%3*.46,speed:(id%2?-1:1)*(.095+(id%4)*.011),
    height:Math.sin(id*2.4)*.7,scale:id%5===0?.39:id%3===0?.28:.245,
  }));
  function unitPose(unit,time){
    const a=unit.phase+time*unit.speed,r=unit.radius;
    return {position:[Math.cos(a)*r,unit.height+Math.sin(a*2+unit.id)*.18,Math.sin(a)*r*.76],rotation:unit.model==='ship'?[.18,-a-Math.PI/2,Math.sin(a)*.11]:[0,-a+Math.PI/2,Math.sin(time*.8+unit.id)*.065]};
  }
  function random(seed){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
  function galaxyStars(count=14000){
    const data=[],rand=random(4471);
    for(let i=0;i<count;i++){
      const r=.2+Math.pow(rand(),.6)*4.2,arm=i%5,spread=(rand()-.5)*(.36+.38/(r+.2));
      const a=arm/5*TAU+r*.91+spread,x=Math.cos(a)*r,z=Math.sin(a)*r;
      const y=(rand()-.5)*(.06+Math.exp(-r)*.46);
      const hot=rand(),size=.65+rand()*1.7;
      data.push(x,y,z,0,1,0,hot>.9?1:.3+hot*.25,hot>.9?.81:.48+hot*.38,1,size);
    }return data;
  }
  function project(matrix,p){const x=matrix[0]*p[0]+matrix[4]*p[1]+matrix[8]*p[2]+matrix[12],y=matrix[1]*p[0]+matrix[5]*p[1]+matrix[9]*p[2]+matrix[13],z=matrix[2]*p[0]+matrix[6]*p[1]+matrix[10]*p[2]+matrix[14],w=matrix[3]*p[0]+matrix[7]*p[1]+matrix[11]*p[2]+matrix[15];return {x:x/w,y:y/w,z:z/w,w};}
  const fluidVertex=`attribute vec3 aPosition;uniform mat4 uModel;uniform mat4 uViewProjection;varying vec2 vUV;void main(){vUV=aPosition.xy;gl_Position=uViewProjection*uModel*vec4(aPosition,1.0);}`;
  const fragmentPrecision=`
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
  `;
  const fluidFragment=`
    ${fragmentPrecision}varying vec2 vUV;uniform float uTime;uniform vec3 uAccent;uniform vec2 uPointer;uniform float uPulse;uniform float uWarp;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float n=0.0,a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=.5;}return n;}
    void main(){
      vec2 p=vUV;float r=length(p);float a=atan(p.y,p.x);float t=uTime*.12;
      vec2 q=vec2(fbm(p*3.0+vec2(t,-t)),fbm(p*3.0+vec2(-t,5.2+t)));
      vec2 warped=p+(q-.5)*.36;
      float swirl=atan(warped.y,warped.x)-length(warped)*4.8+t;
      float arms=pow(.5+.5*cos(swirl*5.0),3.0);
      float strands=fbm(vec2(swirl*2.1,length(warped)*14.0-t*2.0)+q*3.0);
      float disk=(arms*.65+strands*.45)*exp(-r*2.6)*smoothstep(.04,.13,r)*(1.0-smoothstep(.69,.95,r));
      float center=exp(-r*15.0);float halo=exp(-abs(r-.085)*65.0);
      vec3 cold=mix(vec3(.16,.16,.55),uAccent,.36+.6*strands);
      vec3 color=cold*disk*3.8+vec3(1.0,.72,.39)*(halo*.85+center*.6);
      float wisps=pow(fbm(warped*5.0-q*2.0+t),3.0)*(1.0-smoothstep(.2,.96,r));
      color+=mix(vec3(.38,.09,.8),uAccent,.3)*wisps*1.6;
      float hover=exp(-length(p-uPointer*.72)*9.0)*.1;
      color+=uAccent*hover*(.45+strands);
      float shock=exp(-abs(r-uPulse*.85)*48.0)*(1.0-uPulse)*step(.001,uPulse);
      color+=uAccent*shock*1.5+uAccent*center*uWarp;
      float hole=1.0-smoothstep(.035,.057,r);color*=1.0-hole*.94;
      float alpha=clamp(disk*3.0+center*.9+halo*.8+wisps*1.2+shock*.7+hover,0.0,.9);
      gl_FragColor=vec4(color,alpha);
    }
  `;
  const starVertex=`
    attribute vec3 aPosition;attribute vec3 aColor;attribute float aGlow;
    uniform mat4 uModel;uniform mat4 uViewProjection;uniform float uTime;uniform float uPixelRatio;uniform float uWarp;
    varying vec3 vColor;
    void main(){float r=length(aPosition.xz),a=atan(aPosition.z,aPosition.x)+uTime*.11/(.5+r);vec3 p=vec3(cos(a)*r,aPosition.y+sin(uTime*.4+r*2.0)*.025,sin(a)*r);vec4 clip=uViewProjection*uModel*vec4(p,1.0);gl_Position=clip;gl_PointSize=clamp(aGlow*uPixelRatio*38.0/clip.w,1.0,6.0);vColor=aColor*(.8+uWarp*.5);}
  `;
  const starFragment=`precision mediump float;varying vec3 vColor;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;float alpha=pow(1.0-d*2.0,1.6);gl_FragColor=vec4(vColor,alpha*.82);}`;
  const modelFragment=core.shaders.fragmentShader.replace('uniform vec3 uAccent;','uniform vec3 uAccent; uniform float uFocus;').replace('gl_FragColor=vec4(color,uOpacity);','color+=uAccent*(rim*.65+.12)*uFocus;gl_FragColor=vec4(color,uOpacity);');
  const screenVertex=core.shaders.screenVertex;
  const compositeFragment=`
    ${fragmentPrecision}varying vec2 vUV;uniform sampler2D uImage;uniform sampler2D uBloom;uniform float uWarp;uniform float uTime;uniform vec2 uPointer;uniform vec3 uAccent;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float n=0.0,a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=.5;}return n;}
    void main(){
      vec2 p=vUV-.5;float t=uTime*.018;
      vec2 domain=p*3.0+vec2(fbm(p*4.0+t),fbm(p*4.0-t+4.0));
      float gas=fbm(domain*2.2-t);float filaments=pow(1.0-abs(gas*2.0-1.0),8.0);
      float nebula=filaments*pow(fbm(domain+t),2.0);
      vec3 fog=mix(vec3(.14,.03,.28),uAccent*.16,vUV.x)*nebula*.45;
      vec2 cursor=(uPointer+1.0)*.5;float wake=exp(-length(vUV-cursor)*7.0);
      fog+=uAccent*wake*nebula*.17;
      vec2 offset=p*uWarp*.012;vec4 base=texture2D(uImage,vUV);base.r=texture2D(uImage,vUV+offset).r;base.b=texture2D(uImage,vUV-offset).b;
      vec3 glow=texture2D(uBloom,vUV).rgb;
      vec3 color=base.rgb+glow*.8+fog+vec3(.009,.012,.024);
      float vignette=1.0-smoothstep(.2,.85,length(p))*.45;
      gl_FragColor=vec4(color*vignette,1.0);
    }
  `;
  function create(canvas){
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,powerPreference:'high-performance'});
    if(!gl)return null;
    const resources=[];let targets=[],width=0,height=0,lost=false,picks=[];
    function shader(kind,source){const s=gl.createShader(kind);resources.push(['Shader',s]);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
    function program(v,f,names,attrs){const p=gl.createProgram();resources.push(['Program',p]);gl.attachShader(p,shader(gl.VERTEX_SHADER,v));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return {p,u:Object.fromEntries(names.map(n=>[n,gl.getUniformLocation(p,n)])),a:attrs.map(n=>gl.getAttribLocation(p,n))};}
    function buffer(data){const b=gl.createBuffer();resources.push(['Buffer',b]);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return {b,count:data.length/10};}
    let modelProgram,fluidProgram,starProgram,blurProgram,compositeProgram,models,starData,backgroundData,plane,arc,reticle,quad;
    try{
      modelProgram=program(core.shaders.vertexShader,modelFragment,['uModel','uViewProjection','uAccent','uTime','uOpacity','uFocus'],['aPosition','aNormal','aColor','aGlow']);
      fluidProgram=program(fluidVertex,fluidFragment,['uModel','uViewProjection','uTime','uAccent','uPointer','uPulse','uWarp'],['aPosition']);
      starProgram=program(starVertex,starFragment,['uModel','uViewProjection','uTime','uPixelRatio','uWarp'],['aPosition','aColor','aGlow']);
      blurProgram=program(screenVertex,core.shaders.blurFragment,['uImage','uStep'],['aPosition']);
      compositeProgram=program(screenVertex,compositeFragment,['uImage','uBloom','uWarp','uTime','uPointer','uAccent'],['aPosition']);
      models=Object.fromEntries(Object.entries(core.buildModels()).map(([name,m])=>[name,{solid:buffer(m.vertices),lines:buffer(m.lines)}]));
      starData=buffer(galaxyStars());
      const field=[],rand=random(91234);for(let i=0;i<1600;i++)field.push((rand()-.5)*42,(rand()-.5)*24,(rand()-.5)*18,0,1,0,.45+rand()*.3,.57+rand()*.3,1,.15+rand()*.35);backgroundData=buffer(field);
      const data=[];for(const p of [[-1,-1,0],[1,-1,0],[-1,1,0],[-1,1,0],[1,-1,0],[1,1,0]])data.push(...p,0,0,1,1,1,1,0);plane=buffer(data);
      const orbit=core.mesh();core.ring(orbit,[0,0,0],1,.0018,[.3,.8,1],1,[0,0,0],TAU*.92);arc={solid:buffer(orbit.vertices),lines:buffer(orbit.lines)};
      const ring=core.mesh();core.ring(ring,[0,0,0],1,.012,[.3,1,1],1,[0,0,0],TAU*.78);reticle={solid:buffer(ring.vertices),lines:buffer(ring.lines)};
      quad=gl.createBuffer();resources.push(['Buffer',quad]);gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    }catch(error){resources.forEach(([kind,value])=>gl['delete'+kind](value));throw error;}
    function target(w,h,depth){const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);const t={texture,framebuffer,w,h};targets.push(t);if(depth){t.depth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,t.depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,t.depth);}if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Galaxy framebuffer incomplete');}
    function destroyTargets(){for(const t of targets){gl.deleteTexture(t.texture);gl.deleteFramebuffer(t.framebuffer);if(t.depth)gl.deleteRenderbuffer(t.depth);}targets=[];}
    function resize(){const rect=canvas.getBoundingClientRect(),mobile=rect.width<700,dpr=Math.min(window.devicePixelRatio||1,mobile?1.15:1.35,1920/Math.max(1,rect.width),1200/Math.max(1,rect.height));const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));if(w===width&&h===height)return;width=w;height=h;canvas.width=w;canvas.height=h;destroyTargets();target(w,h,true);target(Math.max(1,w>>1),Math.max(1,h>>1));target(Math.max(1,w>>1),Math.max(1,h>>1));}
    function activate(p){gl.useProgram(p.p);for(let j=0;j<4;j++)gl.disableVertexAttribArray(j);}
    function geometry(p,b,mode,layout){gl.bindBuffer(gl.ARRAY_BUFFER,b.b);p.a.forEach((l,i)=>{if(l<0)return;const [size,offset]=layout[i];gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,size,gl.FLOAT,false,40,offset);});gl.drawArrays(mode,0,b.count);}
    const modelLayout=[[3,0],[3,12],[3,24],[1,36]];
    function drawModel(item,matrix,opacity=1,focus=0){gl.uniformMatrix4fv(modelProgram.u.uModel,false,matrix);gl.uniform1f(modelProgram.u.uOpacity,opacity);gl.uniform1f(modelProgram.u.uFocus,focus);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);geometry(modelProgram,item.solid,gl.TRIANGLES,modelLayout);gl.disable(gl.POLYGON_OFFSET_FILL);geometry(modelProgram,item.lines,gl.LINES,modelLayout);}
    function screen(p){activate(p);gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.enableVertexAttribArray(p.a[0]);gl.vertexAttribPointer(p.a[0],2,gl.FLOAT,false,0,0);}
    function texture(unit,value){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,value);}
    function render(state){
      if(lost)return;resize();const [base,a,b]=targets,t=state.time||0,mobile=canvas.getBoundingClientRect().width<700,warp=state.warp||0;
      const accent=state.violet?[.8,.43,1]:[.28,.86,1];
      const view=transform([0,mobile?-2.0:0,mobile?-Math.max(22.5,20.1*height/width):-19.6],[(mobile?.72:.57)+(state.pitch||0)*.14,0,0]);
      const vp=multiply(perspective(width/height),view),world=transform([mobile?0:.9,.1,0],[.05,(state.yaw||0)*.36,-.07]);
      gl.bindFramebuffer(gl.FRAMEBUFFER,base.framebuffer);gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(true);
      gl.depthMask(false);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);activate(starProgram);gl.uniformMatrix4fv(starProgram.u.uModel,false,transform());gl.uniformMatrix4fv(starProgram.u.uViewProjection,false,vp);gl.uniform1f(starProgram.u.uTime,t*.04);gl.uniform1f(starProgram.u.uPixelRatio,1);gl.uniform1f(starProgram.u.uWarp,warp);geometry(starProgram,backgroundData,gl.POINTS,[[3,0],[3,24],[1,36]]);gl.depthMask(true);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      activate(modelProgram);gl.uniformMatrix4fv(modelProgram.u.uViewProjection,false,vp);gl.uniform3fv(modelProgram.u.uAccent,accent);gl.uniform1f(modelProgram.u.uTime,t);
      picks=[];const fleet=units;
      for(const unit of fleet){const pose=unitPose(unit,t),hover=unit.id===state.hovered,selected=unit.id===state.selected,focus=hover?1:selected?.65:0,scale=unit.scale*(hover?1.13:1);const matrix=multiply(world,transform(pose.position,pose.rotation,[scale,scale,scale]));const filtered=state.model&&state.model!=='all'&&unit.model!==state.model;
        drawModel(models[unit.model],matrix,filtered?.55:1,focus);
        const center=point(world,pose.position),pos=project(vp,center);const screenRadius=Math.max(mobile?.065:.027,scale*2*2.75/pos.w);
        picks.push({...unit,x:pos.x,y:pos.y,z:pos.z,hitX:screenRadius*height/width,hitY:screenRadius,position:center});
      }
      gl.depthMask(false);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
      activate(fluidProgram);gl.uniformMatrix4fv(fluidProgram.u.uModel,false,multiply(world,transform([0,-.19,0],[-Math.PI/2,0,0],[5.1,5.1,5.1])));gl.uniformMatrix4fv(fluidProgram.u.uViewProjection,false,vp);gl.uniform3fv(fluidProgram.u.uAccent,accent);gl.uniform1f(fluidProgram.u.uTime,t);gl.uniform2f(fluidProgram.u.uPointer,state.pointerX||0,state.pointerY||0);gl.uniform1f(fluidProgram.u.uPulse,state.pulse||0);gl.uniform1f(fluidProgram.u.uWarp,warp);geometry(fluidProgram,plane,gl.TRIANGLES,[[3,0]]);
      activate(starProgram);gl.uniformMatrix4fv(starProgram.u.uModel,false,world);gl.uniformMatrix4fv(starProgram.u.uViewProjection,false,vp);gl.uniform1f(starProgram.u.uTime,t);gl.uniform1f(starProgram.u.uPixelRatio,Math.min(window.devicePixelRatio||1,1.6));gl.uniform1f(starProgram.u.uWarp,warp);geometry(starProgram,starData,gl.POINTS,[[3,0],[3,24],[1,36]]);
      activate(modelProgram);gl.uniform1f(modelProgram.u.uFocus,0);
      for(let j=0;j<3;j++){const r=4.35+j*1.04;drawModel(arc,multiply(world,transform([0,j*.11-.2,0],[-Math.PI/2,.04*j,t*(j%2?.04:-.025)],[r,r*.76,r])),.15);}
      for(const id of [state.hovered,state.selected]){const unit=picks.find(u=>u.id===id);if(!unit)continue;const r=unit.scale*3.1;drawModel(reticle,transform(unit.position,[0,0,t*.7],[r,r,r]),id===state.hovered?.8:.45,0);}
      gl.depthMask(true);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
      screen(blurProgram);gl.uniform1i(blurProgram.u.uImage,0);gl.bindFramebuffer(gl.FRAMEBUFFER,a.framebuffer);gl.viewport(0,0,a.w,a.h);texture(0,base.texture);gl.uniform2f(blurProgram.u.uStep,4/width,0);gl.drawArrays(gl.TRIANGLES,0,6);gl.bindFramebuffer(gl.FRAMEBUFFER,b.framebuffer);texture(0,a.texture);gl.uniform2f(blurProgram.u.uStep,0,4/a.h);gl.drawArrays(gl.TRIANGLES,0,6);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);screen(compositeProgram);texture(0,base.texture);texture(1,b.texture);gl.uniform1i(compositeProgram.u.uImage,0);gl.uniform1i(compositeProgram.u.uBloom,1);gl.uniform1f(compositeProgram.u.uWarp,warp);gl.uniform1f(compositeProgram.u.uTime,t);gl.uniform2f(compositeProgram.u.uPointer,state.pointerX||0,state.pointerY||0);gl.uniform3fv(compositeProgram.u.uAccent,accent);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    function pick(x,y){let best=null,score=Infinity;for(const unit of picks){const d=((x-unit.x)/unit.hitX)**2+((y-unit.y)/unit.hitY)**2;if(d<=1&&d<score){best=unit;score=d;}}return best;}
    const onLost=event=>{event.preventDefault();lost=true;canvas.dispatchEvent(new CustomEvent('scene-unavailable'));};canvas.addEventListener('webglcontextlost',onLost);
    return {render,pick,getUnits:()=>picks,destroy(){canvas.removeEventListener('webglcontextlost',onLost);destroyTargets();resources.forEach(([kind,value])=>gl['delete'+kind](value));}};
  }
  const api={create,units,unitPose,galaxyStars,project,shaders:{fluidVertex,fluidFragment,starVertex,starFragment}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.StrgoGalaxy=api;
})();
