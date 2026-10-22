/* STRGO / Orbital Foundry. Local procedural models; no CDN or model downloads. */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const I = () => new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  function multiply(a,b) {
    const out = new Float32Array(16);
    for(let c=0;c<4;c++) for(let r=0;r<4;r++) for(let k=0;k<4;k++) out[c*4+r]+=a[k*4+r]*b[c*4+k];
    return out;
  }
  function transform(position=[0,0,0],rotation=[0,0,0],scale=[1,1,1]) {
    const [x,y,z]=rotation, cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
    const rx=new Float32Array([1,0,0,0,0,cx,sx,0,0,-sx,cx,0,0,0,0,1]);
    const ry=new Float32Array([cy,0,-sy,0,0,1,0,0,sy,0,cy,0,0,0,0,1]);
    const rz=new Float32Array([cz,sz,0,0,-sz,cz,0,0,0,0,1,0,0,0,0,1]);
    const m=multiply(rz,multiply(ry,rx));
    for(let c=0;c<3;c++) for(let r=0;r<3;r++) m[c*4+r]*=scale[c];
    m[12]=position[0];m[13]=position[1];m[14]=position[2];return m;
  }
  const point=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
  const normalize=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const subtract=(a,b)=>a.map((v,i)=>v-b[i]);
  function perspective(aspect) {
    const f=1/Math.tan(38*Math.PI/360),n=.1,far=80;
    return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+n)/(n-far),-1,0,0,2*far*n/(n-far),0]);
  }
  function mesh(){return {vertices:[],lines:[]};}
  // Vertices carry position, face normal, material colour and emissive channel.
  function polyhedron(out,vertices,faces,matrix,color,glow=0,edges=true) {
    const center=[0,0,0];vertices.forEach(p=>p.forEach((v,i)=>{center[i]+=v/vertices.length;}));
    const world=vertices.map(p=>point(matrix,p));
    faces.forEach(face=>{
      let indices=face.slice();
      const localNormal=cross(subtract(vertices[indices[1]],vertices[indices[0]]),subtract(vertices[indices[2]],vertices[indices[0]]));
      if(localNormal.reduce((sum,v,i)=>sum+v*(vertices[indices[0]][i]-center[i]),0)<0) indices.reverse();
      const normal=normalize(cross(subtract(world[indices[1]],world[indices[0]]),subtract(world[indices[2]],world[indices[0]])));
      for(let j=1;j<indices.length-1;j++) for(const index of [indices[0],indices[j],indices[j+1]]) out.vertices.push(...world[index],...normal,...color,glow);
      if(edges && glow===0) for(let j=0;j<indices.length;j++) for(const index of [indices[j],indices[(j+1)%indices.length]]) out.lines.push(...world[index],...normal,.09,.19,.24,.12);
    });
  }
  const BOX_FACES=[[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[1,5,6,2],[0,3,7,4]];
  function armor(out,p,s,color,rotation=[0,0,0],taper=.86,glow=0) {
    const [w,h,d]=s.map(v=>v/2);
    const vertices=[[-w*taper,h,-d], [w*taper,h,-d],[w,h,d],[-w,h,d],[-w,-h,-d*taper],[w,-h,-d*taper],[w*taper,-h,d],[-w*taper,-h,d]];
    polyhedron(out,vertices,BOX_FACES,transform(p,rotation),color,glow);
  }
  function sphere(out,p,s,color,glow=0) {
    const vertices=[],faces=[],segments=18,rows=12;
    for(let y=0;y<=rows;y++) for(let x=0;x<=segments;x++) {
      const a=x/segments*TAU,b=y/rows*Math.PI;
      vertices.push([Math.sin(b)*Math.cos(a),Math.cos(b),Math.sin(b)*Math.sin(a)]);
    }
    for(let y=0;y<rows;y++) for(let x=0;x<segments;x++){
      const a=y*(segments+1)+x,b=a+segments+1;faces.push([a,a+1,b+1],[a,b+1,b]);
    }
    polyhedron(out,vertices,faces,transform(p,[0,0,0],s),color,glow,false);
  }
  function cylinder(out,p,r,depth,color,glow=0,rotation=[0,0,0]) {
    const vertices=[],faces=[],n=24;
    for(let side=0;side<2;side++) for(let j=0;j<n;j++) vertices.push([Math.cos(j/n*TAU)*r,Math.sin(j/n*TAU)*r,(side-.5)*depth]);
    for(let j=0;j<n;j++) faces.push([j,(j+1)%n,(j+1)%n+n,j+n]);
    faces.push(Array.from({length:n},(_,i)=>i),Array.from({length:n},(_,i)=>i+n));
    polyhedron(out,vertices,faces,transform(p,rotation),color,glow,false);
  }
  function ring(out,p,r,tube,color,glow=1,rotation=[0,0,0],arc=TAU) {
    const vertices=[],faces=[],segments=72,sides=6;
    for(let i=0;i<=segments;i++) for(let j=0;j<sides;j++){
      const a=i/segments*arc,b=j/sides*TAU;
      vertices.push([(r+Math.cos(b)*tube)*Math.cos(a),(r+Math.cos(b)*tube)*Math.sin(a),Math.sin(b)*tube]);
    }
    for(let i=0;i<segments;i++) for(let j=0;j<sides;j++){
      const a=i*sides+j,b=i*sides+(j+1)%sides;faces.push([a,b,b+sides,a+sides]);
    }
    polyhedron(out,vertices,faces,transform(p,rotation),color,glow,false);
  }
  const STEEL=[.24,.34,.43],SILVER=[.55,.64,.7],DARK=[.045,.07,.105],WHITE=[.71,.78,.81],NEON=[.3,1,.95],ORANGE=[1,.26,.06];
  function makeMecha() {
    const m=mesh();
    // Layered chest, abdominal mechanism and segmented hip plates.
    armor(m,[0,.55,0],[1.38,1.12,.7],STEEL,[0,0,0],.7);
    armor(m,[0,.77,.38],[1.05,.37,.17],SILVER,[.16,0,0],.7);
    armor(m,[0,-.15,0],[.7,.44,.55],DARK);
    for(let j=0;j<3;j++) armor(m,[0,-.04-j*.11,.3],[.48,.045,.06],STEEL);
    armor(m,[0,-.51,.02],[1.02,.46,.65],STEEL,[0,0,0],.78);
    cylinder(m,[0,.44,.47],.32,.18,DARK);
    ring(m,[0,.44,.58],.255,.032,NEON);
    cylinder(m,[0,.44,.58],.16,.03,NEON,1);
    armor(m,[0,.1,.39],[.18,.07,.06],ORANGE,[0,0,0],1,2);
    // Helmet with luminous visor, chin, ear assemblies and swept antennae.
    cylinder(m,[0,1.22,0],.17,.34,DARK,0,[Math.PI/2,0,0]);
    armor(m,[0,1.63,.035],[.7,.64,.6],SILVER,[0,0,0],.7);
    armor(m,[0,1.68,.36],[.62,.19,.06],DARK);
    armor(m,[0,1.69,.402],[.53,.055,.035],NEON,[0,0,0],1,1);
    armor(m,[0,1.41,.33],[.34,.18,.17],STEEL,[.1,0,0],.5);
    for(const side of [-1,1]) {
      armor(m,[side*.39,1.56,0],[.13,.35,.35],DARK);
      armor(m,[side*.3,2.02,-.03],[.08,.49,.16],SILVER,[0,0,side*-.28],.55);
      armor(m,[side*.32,2.12,.06],[.04,.15,.03],NEON,[0,0,side*-.28],1,1);
      // Broad shoulder pauldrons, joint hubs, forearm plates and articulated hands.
      armor(m,[side*1.0,.91,-.02],[.74,.61,.8],SILVER,[0,0,side*-.22],.65);
      armor(m,[side*1.12,.78,.43],[.38,.07,.035],NEON,[0,0,side*-.22],1,1);
      sphere(m,[side*.84,.49,0],[.22,.22,.22],DARK);
      armor(m,[side*1.05,.26,0],[.41,.74,.45],STEEL,[0,0,side*.11]);
      cylinder(m,[side*1.11,-.16,.07],.18,.3,DARK);
      armor(m,[side*1.15,-.49,.12],[.52,.7,.62],SILVER,[.06,0,side*.05],.75);
      armor(m,[side*1.15,-.49,.45],[.27,.36,.07],DARK);
      armor(m,[side*1.15,-.47,.5],[.04,.24,.025],NEON,[0,0,0],1,1);
      armor(m,[side*1.17,-.94,.18],[.35,.26,.34],DARK);
      for(let f=0;f<3;f++) armor(m,[side*1.17+(f-1)*.105,-1.1,.22],[.08,.15,.19],STEEL);
      // Thigh, exposed knee mechanism, large shin guards and grounded boots.
      armor(m,[side*.37,-.99,0],[.54,.66,.57],SILVER,[0,0,side*-.04],.78);
      cylinder(m,[side*.39,-1.35,.04],.17,.42,DARK);
      armor(m,[side*.39,-1.34,.29],[.37,.27,.25],STEEL,[.14,0,0],.6);
      armor(m,[side*.42,-1.83,-.01],[.61,.76,.68],SILVER,[.06,0,side*-.04],.64);
      armor(m,[side*.42,-1.65,.365],[.32,.07,.025],NEON,[0,0,0],1,1);
      armor(m,[side*.42,-2.27,.19],[.65,.27,.99],DARK,[0,0,0],.75);
      armor(m,[side*.42,-2.25,.63],[.47,.12,.12],STEEL);
      // Backpack thrusters, rear fins and small orange caution lights.
      armor(m,[side*.5,.55,-.57],[.43,.94,.48],DARK);
      cylinder(m,[side*.5,.15,-.75],.16,.5,STEEL,0,[Math.PI/2,0,0]);
      ring(m,[side*.5,-.11,-.75],.115,.024,NEON,1,[Math.PI/2,0,0]);
      armor(m,[side*.68,1.19,-.62],[.2,1.34,.38],STEEL,[.18,0,side*-.23],.35);
      armor(m,[side*1.27,1.02,.35],[.07,.13,.03],ORANGE,[0,0,0],1,2);
    }
    return m;
  }
  function makeShip() {
    const m=mesh();
    const hull=[[-.07,.02,2.4],[.07,.02,2.4],[.65,.28,-1.4],[-.65,.28,-1.4],[-.035,-.09,2.4],[.035,-.09,2.4],[.47,-.28,-1.4],[-.47,-.28,-1.4]];
    polyhedron(m,hull,BOX_FACES,I(),SILVER);
    armor(m,[0,.31,.25],[.47,.19,1.53],DARK,[-.07,0,0],.52);
    armor(m,[0,.42,.68],[.27,.065,.55],NEON,[-.07,0,0],.55,1);
    armor(m,[0,.35,-.69],[.43,.19,1.08],STEEL);
    for(const side of [-1,1]){
      const v=[[side*.4,.12,.37],[side*2.8,-.06,-1.38],[side*2.61,-.08,-1.84],[side*.52,.12,-1.23],[side*.4,.02,.37],[side*2.8,-.16,-1.38],[side*2.61,-.18,-1.84],[side*.52,.02,-1.23]];
      polyhedron(m,v,BOX_FACES,I(),STEEL);
      armor(m,[side*1.17,.09,-.76],[.5,.14,1.45],SILVER,[0,side*-.29,0],.75);
      armor(m,[side*2.02,.04,-1.38],[.8,.025,.05],NEON,[0,side*.5,0],1,1);
      cylinder(m,[side*.85,-.08,-1.13],.31,1.39,DARK);
      cylinder(m,[side*.85,-.08,-1.71],.27,.26,STEEL);
      ring(m,[side*.85,-.08,-1.855],.205,.032,NEON);
      cylinder(m,[side*.85,-.08,-1.86],.135,.02,NEON,1);
      for(let j=0;j<5;j++) ring(m,[side*.85,-.08,-1.94-j*.17],.14-j*.018,.013,NEON,1);
      armor(m,[side*.58,.53,-1.15],[.12,.85,.86],STEEL,[0,0,side*-.28],.4);
      armor(m,[side*1.5,-.18,-1.2],[.09,.12,.91],DARK);
      armor(m,[side*1.5,-.18,-.72],[.055,.06,.08],ORANGE,[0,0,0],1,2);
      armor(m,[side*.41,.3,-.49],[.07,.03,.4],NEON,[0,0,0],1,1);
    }
    return m;
  }
  function makeRobot() {
    const m=mesh();
    sphere(m,[0,1.45,0],[.62,.52,.47],WHITE);
    armor(m,[0,1.47,.425],[.93,.26,.085],DARK,[0,0,0],.83);
    for(const side of [-1,1]){
      armor(m,[side*.23,1.49,.48],[.23,.06,.025],NEON,[0,0,0],.8,1);
      cylinder(m,[side*.61,1.46,-.01],.15,.14,DARK,0,[0,Math.PI/2,0]);
      ring(m,[side*.69,1.46,-.01],.09,.014,NEON,1,[0,Math.PI/2,0]);
    }
    armor(m,[0,1.2,.455],[.24,.035,.03],STEEL);
    armor(m,[0,2.07,0],[.035,.35,.035],DARK);
    sphere(m,[0,2.26,0],[.055,.055,.055],NEON,1);
    cylinder(m,[0,.9,0],.15,.37,DARK,0,[Math.PI/2,0,0]);
    armor(m,[0,.38,0],[1.09,.94,.64],WHITE,[0,0,0],.75);
    armor(m,[0,.52,.36],[.72,.44,.1],DARK,[0,0,0],.7);
    ring(m,[0,.47,.44],.17,.026,NEON);
    cylinder(m,[0,.47,.455],.085,.03,NEON,1);
    for(let j=0;j<3;j++) armor(m,[0,.08-j*.055,.34],[.3,.022,.025],STEEL);
    cylinder(m,[0,-.27,0],.27,.35,DARK,0,[Math.PI/2,0,0]);
    armor(m,[0,-.48,0],[.82,.3,.5],STEEL);
    for(const side of [-1,1]){
      sphere(m,[side*.65,.6,0],[.2,.2,.2],DARK);
      armor(m,[side*.82,.25,0],[.29,.65,.33],WHITE,[0,0,side*.25],.86);
      sphere(m,[side*.91,-.1,0],[.14,.14,.14],DARK);
      armor(m,[side*.98,-.47,.07],[.34,.61,.36],WHITE,[.08,0,side*.1],.74);
      armor(m,[side*.98,-.44,.26],[.04,.27,.02],NEON,[0,0,0],1,1);
      sphere(m,[side*1.01,-.83,.07],[.16,.16,.16],DARK);
      for(let j=0;j<3;j++) armor(m,[side*1.01+(j-1)*.085,-1.03,.12],[.065,.23,.12],STEEL);
      armor(m,[side*.26,-.87,0],[.34,.63,.41],WHITE,[0,0,side*.02],.85);
      sphere(m,[side*.27,-1.24,.02],[.14,.14,.14],DARK);
      ring(m,[side*.27,-1.24,.165],.085,.015,NEON);
      armor(m,[side*.28,-1.65,-.025],[.38,.68,.41],WHITE,[.03,0,side*-.04],.72);
      armor(m,[side*.28,-2.04,.16],[.43,.22,.73],DARK);
      armor(m,[side*.28,-2.04,.53],[.3,.045,.02],NEON,[0,0,0],1,1);
      armor(m,[side*.49,.34,-.39],[.2,.64,.24],DARK);
    }
    return m;
  }
  function buildModels(){return {mecha:makeMecha(),ship:makeShip(),robot:makeRobot()};}

  const vertexShader=`
    attribute vec3 aPosition; attribute vec3 aNormal; attribute vec3 aColor; attribute float aGlow;
    uniform mat4 uModel; uniform mat4 uViewProjection;
    varying vec3 vPosition; varying vec3 vNormal; varying vec3 vColor; varying float vGlow;
    void main(){vec4 p=uModel*vec4(aPosition,1.0);vPosition=p.xyz;vNormal=mat3(uModel)*aNormal;vColor=aColor;vGlow=aGlow;gl_Position=uViewProjection*p;}
  `;
  const fragmentShader=`
    precision mediump float;
    uniform vec3 uAccent; uniform float uTime; uniform float uOpacity;
    varying vec3 vPosition; varying vec3 vNormal; varying vec3 vColor; varying float vGlow;
    void main(){
      vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;
      vec3 eye=normalize(vec3(0.0,0.25,9.0)-vPosition);
      vec3 light=normalize(vec3(-0.7,1.2,2.0));
      float diffuse=max(dot(n,light),0.0);
      float fill=max(dot(n,normalize(vec3(1.2,0.3,-0.5))),0.0);
      float spec=pow(max(dot(n,normalize(light+eye)),0.0),48.0);
      float rim=pow(1.0-max(dot(n,eye),0.0),2.8);
      vec3 color=vColor*(0.25+diffuse*1.05+fill*0.18)+vec3(0.55,0.7,0.9)*spec*0.7;
      color+=uAccent*rim*0.26;
      color+=uAccent*max(0.0,sin(vPosition.y*5.0-uTime*.7))*0.012;
      if(vGlow>0.5){vec3 emission=vGlow>1.5?vec3(1.0,0.29,0.08):uAccent;color=emission*(1.0+0.13*sin(uTime*1.8+vPosition.y*4.0));}
      else if(vGlow>0.05){color=mix(vColor,uAccent,0.28)*0.7;}
      gl_FragColor=vec4(color,uOpacity);
    }
  `;
  const screenVertex=`attribute vec2 aPosition;varying vec2 vUV;void main(){vUV=aPosition*.5+.5;gl_Position=vec4(aPosition,0.0,1.0);}`;
  const blurFragment=`precision mediump float;varying vec2 vUV;uniform sampler2D uImage;uniform vec2 uStep;
    void main(){vec4 c=texture2D(uImage,vUV)*.227027;c+=texture2D(uImage,vUV+uStep*1.384615)*.316216;c+=texture2D(uImage,vUV-uStep*1.384615)*.316216;c+=texture2D(uImage,vUV+uStep*3.230769)*.070270;c+=texture2D(uImage,vUV-uStep*3.230769)*.070270;gl_FragColor=c;}`;
  const compositeFragment=`precision mediump float;varying vec2 vUV;uniform sampler2D uImage;uniform sampler2D uBloom;uniform float uWarp;
    void main(){vec2 offset=(vUV-.5)*uWarp*.009;vec4 base=texture2D(uImage,vUV);base.r=texture2D(uImage,vUV+offset).r;base.b=texture2D(uImage,vUV-offset).b;vec3 glow=texture2D(uBloom,vUV).rgb;vec3 c=base.rgb+glow*.42;float a=max(base.a,max(glow.r,max(glow.g,glow.b))*.7);gl_FragColor=vec4(c,a);}`;

  function create(canvas) {
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,powerPreference:'high-performance'});
    if(!gl) return null;
    const resources=[];
    function compile(type,source){const s=gl.createShader(type);resources.push(['Shader',s]);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
    function program(v,f){const p=gl.createProgram();resources.push(['Program',p]);gl.attachShader(p,compile(gl.VERTEX_SHADER,v));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}
    function buffer(values){const b=gl.createBuffer();resources.push(['Buffer',b]);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);return {buffer:b,count:values.length/10};}
    function upload(m){return {solid:buffer(m.vertices),lines:buffer(m.lines)};}
    function uniforms(p,names){const result={};names.forEach(n=>{result[n]=gl.getUniformLocation(p,n);});return result;}
    let sceneProgram,blurProgram,compositeProgram,models,orbit,grid,quad;
    try {
      sceneProgram=program(vertexShader,fragmentShader);blurProgram=program(screenVertex,blurFragment);compositeProgram=program(screenVertex,compositeFragment);
      models=Object.fromEntries(Object.entries(buildModels()).map(([key,value])=>[key,upload(value)]));
      const o=mesh();ring(o,[0,0,0],2.64,.008,NEON,1,[0,0,0],TAU*.84);orbit=upload(o);
      const g=mesh();for(let j=-7;j<=7;j++){
        for(const p of [[j*.55,-2.58,-4],[j*.55,-2.58,4],[-4,-2.58,j*.55],[4,-2.58,j*.55]])g.lines.push(...p,0,1,0,.055,.16,.19,.12);
      }grid=upload(g);
      quad=gl.createBuffer();resources.push(['Buffer',quad]);gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    } catch(error) { resources.forEach(([kind,value])=>gl['delete'+kind](value));throw error; }
    const sceneU=uniforms(sceneProgram,['uModel','uViewProjection','uAccent','uTime','uOpacity']);
    const blurU=uniforms(blurProgram,['uImage','uStep']);const compU=uniforms(compositeProgram,['uImage','uBloom','uWarp']);
    const attributes=['aPosition','aNormal','aColor','aGlow'].map(n=>gl.getAttribLocation(sceneProgram,n));
    const screenAttributes=[blurProgram,compositeProgram].map(p=>gl.getAttribLocation(p,'aPosition'));
    let targets=[],width=0,height=0,lost=false;
    function destroyTargets(){targets.forEach(t=>{gl.deleteTexture(t.texture);gl.deleteFramebuffer(t.framebuffer);if(t.depth)gl.deleteRenderbuffer(t.depth);});targets=[];}
    function target(w,h,depth=false){
      const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      const result={texture,framebuffer,w,h};targets.push(result);
      if(depth){result.depth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,result.depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,result.depth);}
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Incomplete scene framebuffer');
      return result;
    }
    function resize() {
      const rect=canvas.getBoundingClientRect(),mobile=rect.width<600,dpr=Math.min(window.devicePixelRatio||1,mobile?1.25:1.6);
      const nextW=Math.max(1,Math.min(1600,Math.round(rect.width*dpr))),nextH=Math.max(1,Math.min(1300,Math.round(rect.height*dpr)));
      if(nextW===width && nextH===height)return;
      width=nextW;height=nextH;canvas.width=width;canvas.height=height;destroyTargets();
      target(width,height,true);target(Math.max(1,width>>1),Math.max(1,height>>1));target(Math.max(1,width>>1),Math.max(1,height>>1));
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
    function geometry(item,mode) {
      gl.bindBuffer(gl.ARRAY_BUFFER,item.buffer);
      attributes.forEach((location,i)=>{if(location<0)return;gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,i===3?1:3,gl.FLOAT,false,40,[0,12,24,36][i]);});
      gl.drawArrays(mode,0,item.count);
    }
    function drawModel(item,matrix,opacity=1){
      gl.uniformMatrix4fv(sceneU.uModel,false,matrix);gl.uniform1f(sceneU.uOpacity,opacity);
      gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);geometry(item.solid,gl.TRIANGLES);gl.disable(gl.POLYGON_OFFSET_FILL);
      geometry(item.lines,gl.LINES);
    }
    function screen(p,index){gl.useProgram(p);attributes.forEach(l=>{if(l>=0)gl.disableVertexAttribArray(l);});gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.enableVertexAttribArray(screenAttributes[index]);gl.vertexAttribPointer(screenAttributes[index],2,gl.FLOAT,false,0,0);}
    function bindTexture(unit,texture){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);}
    function render(state) {
      if(lost)return;
      resize();const [base,a,b]=targets,t=state.time,warp=state.warp||0;
      gl.bindFramebuffer(gl.FRAMEBUFFER,base.framebuffer);gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(true);gl.useProgram(sceneProgram);
      const view=transform([0,.03,-9.2],[.075,0,0]);gl.uniformMatrix4fv(sceneU.uViewProjection,false,multiply(perspective(width/height),view));
      gl.uniform3fv(sceneU.uAccent,state.violet?[.72,.43,1]:[.28,.94,.94]);gl.uniform1f(sceneU.uTime,t);
      drawModel(grid,transform([0,0,0],[0,t*.025,0]),.65);
      const ship=state.model==='ship',angle=(ship?-.68:.38)+state.yaw+Math.sin(t*.23)*.14;
      const pitch=(ship?.4:0)+state.pitch+Math.sin(t*.4)*.025;
      const scale=ship?1.03:1.0;const pop=1-Math.sin(Math.min(1,state.transition||0)*Math.PI)*.08;
      const model=transform([.17,Math.sin(t*.85)*.065,0],[pitch,angle,ship?-.1:Math.sin(t*.3)*.018],[scale*pop,scale*pop,scale*pop]);
      drawModel(models[state.model]||models.mecha,model);
      // Orbital arcs are depth-tested against the model, revealing actual depth.
      gl.depthMask(false);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
      drawModel(orbit,transform([.17,.1,0],[1.15+.12*Math.sin(t*.17),.2,t*.15]),.32+warp*.3);
      drawModel(orbit,transform([.17,.1,0],[.45,1.03,-t*.1],[1.07,1.07,1.07]),.15+warp*.2);
      gl.depthMask(true);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
      screen(blurProgram,0);gl.uniform1i(blurU.uImage,0);
      gl.bindFramebuffer(gl.FRAMEBUFFER,a.framebuffer);gl.viewport(0,0,a.w,a.h);bindTexture(0,base.texture);gl.uniform2f(blurU.uStep,2.8/width,0);gl.drawArrays(gl.TRIANGLES,0,6);
      gl.bindFramebuffer(gl.FRAMEBUFFER,b.framebuffer);bindTexture(0,a.texture);gl.uniform2f(blurU.uStep,0,2.8/a.h);gl.drawArrays(gl.TRIANGLES,0,6);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);screen(compositeProgram,1);bindTexture(0,base.texture);bindTexture(1,b.texture);gl.uniform1i(compU.uImage,0);gl.uniform1i(compU.uBloom,1);gl.uniform1f(compU.uWarp,warp);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    const onLost=event=>{event.preventDefault();lost=true;canvas.dispatchEvent(new CustomEvent('scene-unavailable'));};
    canvas.addEventListener('webglcontextlost',onLost);
    // Reloading restores all GPU objects safely after the browser restores a context.
    const onRestored=()=>canvas.dispatchEvent(new CustomEvent('scene-restored'));
    canvas.addEventListener('webglcontextrestored',onRestored);
    function destroy(){canvas.removeEventListener('webglcontextlost',onLost);canvas.removeEventListener('webglcontextrestored',onRestored);destroyTargets();resources.forEach(([kind,value])=>gl['delete'+kind](value));}
    return {render,destroy};
  }
  const api={create,buildModels,multiply,transform,point,perspective,mesh,ring,shaders:{vertexShader,fragmentShader,screenVertex,blurFragment,compositeFragment}};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else window.StrgoScene=api;
})();
