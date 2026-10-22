import * as T from '../assets/vendor/three.module.js';

export function seeded(seed=4217){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
const v=(x,y,z)=>new T.Vector3(x,y,z);
function mergeColored(parts){
 const positions=[],normals=[],uvs=[],colors=[];
 for(const [geo,color,matrix]of parts){const g=(geo.index?geo.toNonIndexed():geo.clone());if(matrix)g.applyMatrix4(matrix);const p=g.attributes.position,n=g.attributes.normal,u=g.attributes.uv,c=new T.Color(color);for(let i=0;i<p.count;i++){positions.push(p.getX(i),p.getY(i),p.getZ(i));normals.push(n?.getX(i)||0,n?.getY(i)||1,n?.getZ(i)||0);uvs.push(u?.getX(i)||0,u?.getY(i)||0);colors.push(c.r,c.g,c.b);}g.dispose();}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));return g;
}
function transform(x,y,z,sx=1,sy=1,sz=1,rz=0){return new T.Matrix4().compose(v(x,y,z),new T.Quaternion().setFromEuler(new T.Euler(0,0,rz)),v(sx,sy,sz));}
export function makeDreamWorld({id='01',film=false,quality='high',canvasFactory,seed=4217,garden=false}={}){
 const r=seeded(seed+Number(id)*173),scene=new T.Scene(),root=new T.Group();scene.add(root);
 const updates=[],colliders=[],resources=new Set(),windUniform={value:0},i=Number(id);
 const snow=film&&i===3,red=film&&i===6,wheat=film&&i===5,waste=film&&i===7,forest=film&&i===1,mill=film&&i===8;
 const palette=i===5||red?{sky:0xc29283,fog:0xc0a394,grass:0x8a8558,light:0xffd4a1,water:0x738b8c}:i===3?{sky:snow?0xb9c8cc:0x8a9da4,fog:0xaabcbf,grass:snow?0xd6dbd8:0x6d8477,light:0xe1e5da,water:0x7b949a}:i===4?{sky:0x587879,fog:0x8aaca0,grass:0x6f8172,light:0xe4ddbd,water:0x658c8d}:{sky:0xb9cbd2,fog:0xccd4cf,grass:0x748c69,light:0xffe5b9,water:0x688f98};
 scene.background=new T.Color(palette.sky);scene.fog=new T.FogExp2(palette.fog,i===4?.017:.009);
 const hemi=new T.HemisphereLight(0xf4e4ca,0x607e91,1.65);scene.add(hemi);
 const sunlight=new T.DirectionalLight(palette.light,2.25);sunlight.position.set(33,29,-42);sunlight.castShadow=true;sunlight.shadow.mapSize.set(1024,1024);Object.assign(sunlight.shadow.camera,{left:-28,right:28,top:30,bottom:-28,near:1,far:90});sunlight.shadow.normalBias=.06;sunlight.shadow.bias=-.0004;sunlight.shadow.radius=4;scene.add(sunlight);
 const textureCache=new Map(),matCache=new Map();
 function brushTexture(base){
  if(textureCache.has(base))return textureCache.get(base);
  const canvas=canvasFactory(256,256),ctx=canvas.getContext('2d'),color=new T.Color(base);
  ctx.fillStyle='#'+color.getHexString();ctx.fillRect(0,0,256,256);
  // Broken tapered strokes with translucent bristle trails, fixed to each UV.
  for(let k=0;k<620;k++){
   const c=color.clone().offsetHSL((r()-.5)*.045,(r()-.5)*.14,(r()-.5)*.19);
   ctx.save();ctx.translate(r()*256,r()*256);ctx.rotate((r()-.5)*.85);
   const length=4+r()*25,width=1+r()*5;
   ctx.fillStyle='#'+c.getHexString();ctx.globalAlpha=.18+r()*.28;
   ctx.beginPath();ctx.moveTo(-length*.5,0);ctx.lineTo(length*.34,-width*.48);
   ctx.quadraticCurveTo(length*.65,0,length*.34,width*.3);ctx.lineTo(-length*.46,width*.4);ctx.fill();
   ctx.globalAlpha*=.4;ctx.fillRect(-length*.45,width*.65,length*.72,.45);ctx.restore();
  }
  ctx.globalAlpha=.055;ctx.fillStyle='#f4ebd9';
  for(let k=0;k<256;k+=3){ctx.fillRect(k,0,.5,256);ctx.fillRect(0,k,256,.5);}
  ctx.globalAlpha=1;
  const tex=new T.CanvasTexture(canvas);tex.wrapS=tex.wrapT=T.RepeatWrapping;
  tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;resources.add(tex);textureCache.set(base,tex);return tex;
 }
 function mat(color,opts={}){const key=color+JSON.stringify(opts);if(matCache.has(key))return matCache.get(key);const m=new T.MeshStandardMaterial({color:0xffffff,map:brushTexture(color),roughness:1,metalness:0,...opts});matCache.set(key,m);resources.add(m);return m;}
 function mesh(geo,material,parent=root){const m=new T.Mesh(geo,material);m.castShadow=true;m.receiveShadow=true;parent.add(m);resources.add(geo);return m;}
 function box(x,y,z,w,h,d,col,parent=root){const m=mesh(new T.BoxGeometry(w,h,d,2,2,2),mat(col),parent);m.position.set(x,y,z);return m;}
 function branch(a,b,r1,r2,col,parent=root){const dir=b.clone().sub(a),m=mesh(new T.CylinderGeometry(r2,r1,dir.length(),6,1),mat(col),parent);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(v(0,1,0),dir.normalize());return m;}
 const lake=garden?{x:22,z:-14,rx:23,rz:29}:{x:10,z:-14,rx:15,rz:24};
 const pond=(x,z)=>{if([1,3,4,5,7].includes(i))return false;return ((x-lake.x)/lake.rx)**2+((z-lake.z)/lake.rz)**2<1;};
 function shoreX(x,z){if(![2,6,8].includes(i))return x;const dz=(z-lake.z)/(lake.rz*1.12);if(Math.abs(dz)>=1)return x;const edge=lake.rx*1.12*Math.sqrt(1-dz*dz);return Math.abs(x-lake.x)<edge?lake.x+(x<lake.x?-1:1)*edge:x;}
 function height(x,z){const bumps=Math.sin(x*.16+z*.06)*.38+Math.cos(z*.12)*.28;if(i===3&&!snow){const road=1-T.MathUtils.smoothstep(Math.abs(x),2.9,4.7);return T.MathUtils.lerp(bumps+.15,0,road);}if([2,6,8].includes(i)){const radius=Math.hypot((x-lake.x)/lake.rx,(z-lake.z)/lake.rz);if(radius<1.1)return T.MathUtils.lerp(-.85,.12,T.MathUtils.smoothstep(radius,.93,1.1));}return bumps+.15;}
 function onPath(x,z){if(i===4)return Math.abs(x)<3;const center=Math.sin(z*.095)*2.2;return Math.abs(x-center)<1.65;}
 // A deformed mesh establishes real ground and a recessed lake bed.
 const groundGeo=new T.PlaneGeometry(110,125,74,74);groundGeo.rotateX(-Math.PI/2);const gp=groundGeo.attributes.position,groundColors=[];
 for(let n=0;n<gp.count;n++){const x=gp.getX(n),z=gp.getZ(n)-23;gp.setXYZ(n,x,height(x,z),z);const col=new T.Color(onPath(x,z)&&!pond(x,z)?snow?0xc8ccca:0xc0b393:palette.grass);col.offsetHSL((r()-.5)*.04,0,(r()-.5)*.13);groundColors.push(col.r,col.g,col.b);}groundGeo.setAttribute('color',new T.Float32BufferAttribute(groundColors,3));groundGeo.computeVertexNormals();const groundMat=mat(0xc5c6b2,{vertexColors:true});groundMat.map.repeat.set(18,18);mesh(groundGeo,groundMat);
 // Raised walking path, composed of an actual ribbon following the terrain.
 if(i!==4){const points=[];for(let k=0;k<80;k++){const z=26-k*.85,cx=Math.sin(z*.095)*2.2;points.push(v(cx,height(cx,z)+.055,z));}const pos=[],uv=[];for(let k=0;k<points.length-1;k++){const a=points[k],b=points[k+1];for(const q of [[a.x-1.4,a.y,a.z],[a.x+1.4,a.y,a.z],[b.x-1.4,b.y,b.z],[a.x+1.4,a.y,a.z],[b.x+1.4,b.y,b.z],[b.x-1.4,b.y,b.z]]){pos.push(...q);uv.push(q[0]*.2,q[2]*.2);}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();mesh(g,mat(snow?0xdce0dc:0xc1b79a));}
 function mountain(x,z,h=25,rad=24,redMountain=false){
  // Open sides avoid deforming a cone's bottom-cap centre into stray triangles.
  // A small summit radius preserves Fuji's quiet, slightly flattened silhouette.
  const geom=new T.CylinderGeometry(rad*.035,rad,h,80,30,true),p=geom.attributes.position,cols=[];
  for(let k=0;k<p.count;k++){
   const rawY=p.getY(k),t=T.MathUtils.clamp((rawY+h*.5)/h,0,1),angle=Math.atan2(p.getZ(k),p.getX(k));
   const profile=.035+.965*Math.pow(1-t,1.12),ridge=1+Math.sin(angle*7+.4)*.035+Math.sin(angle*13+t*4)*.019;
   const radius=rad*profile*ridge;
   const xx=Math.cos(angle)*radius,zz=Math.sin(angle)*radius*.78;
   p.setXYZ(k,xx,rawY,zz);
   const snowline=.72+Math.sin(angle*9)*.024+Math.sin(angle*17)*.012;
   const cap=t>snowline;
   const col=new T.Color(cap?0xe9e7db:redMountain?0xa46662:0x899db8);
   const face=Math.cos(angle-.7)*.045+Math.sin(angle*9+t*23)*.018;
   col.offsetHSL((r()-.5)*.018,0,face+(r()-.5)*.045);
   if(cap&&Math.cos(angle*5)>.45)col.lerp(new T.Color(0x99b1c5),.24*(1-t));
   cols.push(col.r,col.g,col.b);
  }
  geom.setAttribute('color',new T.Float32BufferAttribute(cols,3));geom.computeVertexNormals();
  const m=mesh(geom,mat(0xd2d7d8,{vertexColors:true}));m.position.set(x,h/2-1,z);m.castShadow=false;
  const summit=mesh(new T.CircleGeometry(rad*.036,40),mat(0xe9e7db));summit.rotation.x=-Math.PI/2;summit.position.set(x,h-1,z);summit.castShadow=false;return m;
 }
 if(i!==4&&i!==3){mountain(garden?40:i===6?1:15,-68,garden?32:i===6?34:26,garden?33:i===6?30:25,red);mountain(-35,-76,13,30);mountain(70,-81,16,29);}
 if(snow){mountain(-24,-44,28,26);mountain(24,-50,35,29);}
 const skyCanvas=canvasFactory(1024,512),skyContext=skyCanvas.getContext('2d'),skyColor=new T.Color(palette.sky);
 const skyGradient=skyContext.createLinearGradient(0,0,0,512);
 skyGradient.addColorStop(0,i===5||red?'#b78988':'#91aabb');skyGradient.addColorStop(.48,'#'+skyColor.getHexString());skyGradient.addColorStop(.63,i===3?'#c1c9c7':'#e9d6bb');skyGradient.addColorStop(1,'#a3b9ba');
 skyContext.fillStyle=skyGradient;skyContext.fillRect(0,0,1024,512);
 for(let k=0;k<10500;k++){
  const x=r()*1024,y=r()*512,col=skyColor.clone().offsetHSL((r()-.5)*.04,(r()-.5)*.12,(r()-.5)*.14);
  skyContext.fillStyle='#'+col.getHexString();skyContext.globalAlpha=.09+r()*.19;
  skyContext.save();skyContext.translate(x,y);skyContext.rotate((r()-.5)*.2);
  skyContext.beginPath();skyContext.ellipse(0,0,2+r()*17,.45+r()*2.8,0,0,Math.PI*2);skyContext.fill();skyContext.restore();
 }
 skyContext.globalAlpha=1;const skyMap=new T.CanvasTexture(skyCanvas);skyMap.colorSpace=T.SRGBColorSpace;
 const sky=mesh(new T.SphereGeometry(150,32,20),new T.MeshBasicMaterial({map:skyMap,side:T.BackSide,fog:false,depthWrite:false}));sky.position.y=20;sky.castShadow=false;resources.add(skyMap);
 const cloudMaterial=new T.MeshBasicMaterial({color:0xeee4d2,transparent:true,opacity:.22,depthWrite:false});resources.add(cloudMaterial);
 const cloudGroups=[];for(let k=0;k<7;k++){const group=new T.Group();for(let n=0;n<6;n++){const m=mesh(new T.SphereGeometry(1,12,7),cloudMaterial,group);m.position.set(n*3.8,r()*1.3,r()*2);m.scale.set(5+r()*4,.6+r()*.8,2.7);m.castShadow=false;}group.position.set(-58+k*18,22+r()*13,-40-r()*40);root.add(group);cloudGroups.push(group);}
 updates.push(t=>cloudGroups.forEach((g,k)=>{g.position.x=-58+k*18+Math.sin(t*.018+k)*5;}));
 // The soft disk is geometry; its mirrored position is captured by lake reflection.
 const sun=mesh(new T.SphereGeometry(3.6,28,16),new T.MeshBasicMaterial({color:i===5||red?0xf4c599:0xffe5b5}));sun.position.set(garden?72:33,29,-82);sun.visible=i!==3;sun.castShadow=false;sunlight.position.copy(sun.position).multiplyScalar(.55);sunlight.shadow.camera.far=150;if(garden){sunlight.shadow.camera.left=-55;sunlight.shadow.camera.right=65;}updates.push(t=>{sun.material.color.setHSL(.12,.58,.82+Math.sin(t*.18)*.012);});
 function flowerGeometry(type='iris'){
  const parts=[];const stem=new T.CylinderGeometry(.025,.036,.85,4);parts.push([stem,0x648357,transform(0,.425,0)]);const leaf=new T.SphereGeometry(1,4,3);parts.push([leaf,0x789360,transform(.12,.34,0,.2,.035,.075,.45)],[leaf,0x5d845c,transform(-.11,.51,0,.18,.035,.07,-.4)]);
  const petals=type==='sunflower'?10:5;for(let n=0;n<petals;n++){const a=n/petals*Math.PI*2,rr=type==='sunflower'?.16:.1;const color=type==='sunflower'?n%2?0xdcc073:0xe2b65f:type==='wheat'?0xd7c18c:n%2?0xa69abe:0x8178a6;parts.push([new T.SphereGeometry(1,6,3),color,transform(Math.cos(a)*rr,.94+Math.sin(a)*rr,0,.13,.075,.045,a)]);}parts.push([new T.SphereGeometry(.09,6,4),type==='sunflower'?0x756044:0xd8c28a,transform(0,.94,.025)]);return mergeColored(parts);
 }
 function instancedFlowers(count,type='iris',area=[48,60]){
  const geom=flowerGeometry(type),material=mat(0xd0c5b4,{vertexColors:true});const inst= new T.InstancedMesh(geom,material,count);const dummy=new T.Object3D();let n=0,tries=0;while(n<count&&tries<count*20){tries++;const x=(r()-.5)*area[0],z=(r()-.5)*area[1]-6;if(pond(x,z)||onPath(x,z)||i===3&&(Math.abs(x)>10&&z>-5))continue;dummy.position.set(x,height(x,z),z);const scale=type==='sunflower'?1.1+r()*.65:.5+r()*.8;dummy.scale.setScalar(scale);dummy.rotation.set(0,r()*Math.PI*2,(r()-.5)*.1);dummy.updateMatrix();inst.setMatrixAt(n++,dummy.matrix);}inst.count=n;inst.castShadow=true;inst.receiveShadow=true;root.add(inst);resources.add(geom);
  // Vertex motion is rooted at the stem. Surface brush marks move with the flower.
  const wm=material.clone();wm.onBeforeCompile=shader=>{shader.uniforms.uWindTime=windUniform;shader.vertexShader='uniform float uWindTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat phase=instanceMatrix[3].x*.3+instanceMatrix[3].z*.2;\ntransformed.x += sin(uWindTime*1.05+phase)*.065*position.y*position.y;\ntransformed.z += cos(uWindTime*.75+phase)*.035*position.y*position.y;\n#endif`);};inst.material=wm;resources.add(wm);return inst;
 }
 if(garden){instancedFlowers(quality==='low'?750:1800,'iris',[80,72]);instancedFlowers(quality==='low'?200:450,'sunflower',[75,60]);}
 else if(i===1&&!forest)instancedFlowers(quality==='low'?800:1800,'sunflower');else if(wheat)instancedFlowers(1400,'wheat');else if(![3,4,5].includes(i)&&!waste)instancedFlowers(quality==='low'?500:1000,'iris');
 const treeGroups=[];
 function tree(x,z,s=1,peach=false,bare=false){
  x=shoreX(x,z);const group=new T.Group();group.position.set(x,height(x,z),z);group.scale.setScalar(s);root.add(group);
  branch(v(0,0,0),v(.22,2.7,.05),.29,.14,0x59695f,group);
  branch(v(.22,2.7,.05),v(-.15,4.4,.13),.14,.035,0x687466,group);
  const leaves=[];
  for(let b=0;b<6;b++){
   const a=b/6*Math.PI*2+r()*.3,tip=v(Math.cos(a)*(1.6+r()*.5),3.4+r()*1.6,Math.sin(a)*1.8);
   branch(v(.14,1.9+b*.21,0),tip,.12,.022,0x697466,group);
   if(!bare)for(let k=0;k<18;k++){
    const color=peach?[0xd8a2ad,0xeac0bb,0xbc92a6,0xf0cdc1][~~(r()*4)]:[0x70896b,0x91a17b,0x58766c,0x829573][~~(r()*4)];
    const geom=new T.SphereGeometry(.24+r()*.29,8,5),p=geom.attributes.position;
    for(let n=0;n<p.count;n++){const bulge=1+Math.sin(p.getX(n)*17+p.getY(n)*11)*.08;p.setXYZ(n,p.getX(n)*bulge,p.getY(n),p.getZ(n)*bulge);}
    geom.computeVertexNormals();const leaf=mesh(geom,mat(color),group);
    leaf.position.copy(tip).add(v((r()-.5)*2.3,(r()-.5)*1.3,(r()-.5)*2));leaf.scale.set(1.15+r()*.3,.65+r()*.4,.9+r()*.5);leaves.push(leaf);
   }
  }
  colliders.push({x,z,r:.48*s});treeGroups.push({group,leaves,base:group.rotation.z,phase:r()*6});return group;
 }
 if(garden){tree(-24,17,4.2);tree(-36,0,3.4);for(let k=0;k<9;k++)tree(32+r()*16,-6-k*4,.9+r()*.5,true);}
 else if(i===2){for(let k=0;k<18;k++){const x=k%2===0?-6-r()*15:25+r()*9,z=16-k*3;tree(x,z,.8+r()*.5,true);}tree(-4,-6,1.4,true);tree(4,-27,1.1,true);}
 else if(forest){for(let k=0;k<45;k++)tree((k%2?-1:1)*(5+r()*28),22-r()*80,1.3+r()*1.1);}
 else if(i===7){tree(-4,-4,1.4,!waste,waste);tree(9,-19,.9,!waste,waste);}
 else if(i!==4&&i!==5&&i!==3){for(let k=0;k<10;k++){const x=(k%2?-1:1)*(11+r()*20),z=8-r()*55;if(!pond(x,z))tree(x,z,.65+r()*.5,k%3===0);}}
 const foliage=new Set(treeGroups.flatMap(t=>t.leaves));
 function house(x,z,s=1,ruin=false){x=shoreX(x,z);const g=new T.Group(),yy=height(x,z);g.position.set(x,yy,z);g.scale.setScalar(s);root.add(g);box(0,1.3,0,3.7,2.6,3,0xb4ac91,g);const roof=mesh(new T.ConeGeometry(3.4,1.7,4,1),mat(ruin?0x7e7a6b:0x697a72),g);roof.rotation.y=Math.PI*.25;roof.position.y=3.1;roof.scale.z=.95;if(ruin){roof.rotation.z=.28;roof.position.x=.5;}box(0,.95,1.52,.8,1.9,.05,0x536861,g);for(const wx of [-1.15,1.15])box(wx,1.5,1.53,.7,.8,.05,0x7b928c,g);for(let k=0;k<7;k++)box(-1.8+k*.6,1.3,1.56,.055,2.6,.06,0x817e67,g);colliders.push({x,z,box:[2.1*s,1.8*s]});return g;}
 if(i===3&&!snow){for(let k=0;k<9;k++)house(k%2?-6:6,-k*6+10,1.1+r()*.25);}
 if(i===5&&!wheat){for(let k=0;k<9;k++)house((k%2?-1:1)*(5+r()*18),5-k*5,.6+r()*.9,true);}
 if(garden){for(let k=0;k<5;k++)house(30+k*6,-29-k*3,.8+r()*.25);}
 else if(i===6||i===8){for(let k=0;k<4;k++)house(-17-k*4,-26-k*5,.75+r()*.3);}
 function bridge(x=10,z=6){const g=new T.Group();root.add(g);g.position.set(x,.05,z);const len=garden?50:22;for(let k=0;k<40;k++){const t=k/39,y=Math.sin(t*Math.PI)*1.35+.3;box((t-.5)*len,y,0,len/39+.02,.16,2.4,0xb0a080,g);if(k%3===0){for(const side of [-1,1])box((t-.5)*len,y+.6,side*1.1,.08,1.2,.08,0x958e73,g);}}for(const side of [-1,1]){for(let k=0;k<24;k++){const a=k/24,b=(k+1)/24;branch(v((a-.5)*len,Math.sin(a*Math.PI)*1.35+1.45,side*1.1),v((b-.5)*len,Math.sin(b*Math.PI)*1.35+1.45,side*1.1),.045,.045,0xa99b7a,g);}}return g;}
 if(i===2)bridge(garden?22:10,garden?-9:6);
 const people=[];
 function person(x,z,demon=false,s=1){x=shoreX(x,z);const g=new T.Group();g.position.set(x,height(x,z),z);g.scale.setScalar(s);root.add(g);
  if(demon){const robeGeometry=new T.CylinderGeometry(.23,.46,.92,16,7);const p=robeGeometry.attributes.position;for(let k=0;k<p.count;k++){const a=Math.atan2(p.getZ(k),p.getX(k)),crease=1+Math.sin(a*8)*.07;p.setX(k,p.getX(k)*crease);p.setZ(k,p.getZ(k)*crease);}robeGeometry.computeVertexNormals();const robe=mesh(robeGeometry,mat(0x81826f),g);robe.position.set(0,1.13,.03);robe.rotation.x=.13;branch(v(0,1.5,.08),v(0,1.7,.11),.09,.085,0xb3a48a,g);const head=mesh(new T.SphereGeometry(.21,14,10),mat(0xb0a28a),g);head.position.set(0,1.82,.12);for(const sign of [-1,1]){const horn=mesh(new T.ConeGeometry(.062,.35,7),mat(0xd0c5a2),g);horn.position.set(sign*.13,2.06,.11);horn.rotation.z=sign*-.18;branch(v(sign*.2,.79,.02),v(sign*.31,.61,.42),.19,.15,0x777d6a,g);branch(v(sign*.31,.61,.42),v(sign*.36,.14,.58),.14,.085,0x767c69,g);box(sign*.36,.1,.67,.22,.15,.37,0x687463,g);branch(v(sign*.24,1.47,.04),v(sign*.43,1.12,.24),.12,.09,0x858570,g);branch(v(sign*.43,1.12,.24),v(sign*.3,.73,.47),.09,.075,0x90907a,g);const hand=mesh(new T.SphereGeometry(.1,7,5),mat(0xb3a48a),g);hand.position.set(sign*.3,.73,.47);const eye=mesh(new T.SphereGeometry(.022,6,4),mat(0x4b625b),g);eye.position.set(sign*.072,1.84,.307);}people.push({g,robe,base:1,phase:r()*6});colliders.push({x,z,r:.8*s});return g;}
  const robe=mesh(new T.ConeGeometry(.35,1.3,9,4),mat(0x76918c),g);robe.position.y=.96;robe.rotation.y=.35;const head=mesh(new T.SphereGeometry(.17,10,7),mat(0xa5987c),g);head.position.y=1.85;branch(v(0,1.55,0),v(0,1.75,0),.07,.06,0xa5987c,g);for(const sign of [-1,1]){branch(v(sign*.12,.6,0),v(sign*.14,.15,.05),.09,.065,0x596b66,g);branch(v(sign*.15,1.45,0),v(sign*.35,1.05,.07),.09,.065,0x6c8279,g);box(sign*.14,.1,.1,.17,.14,.28,0x586961,g);}const hat=mesh(new T.ConeGeometry(.42,.18,18),mat(0xc6b88f),g);hat.position.y=2.03;branch(v(.35,1.1,.06),v(.4,.1,.16),.018,.018,0x8d886a,g);people.push({g,robe,base:1,phase:r()*6});colliders.push({x,z,r:.65*s});return g;}
 if(garden)person(-5,-3,false,1.65);
 if(!garden&&(i===1||i===3&&!snow||i===4||i===8))person(.5,-6,false,1.4);
 if(i===7){const demon=person(-1,-7,true,2.05);demon.rotation.y=.5;const stone=mesh(new T.DodecahedronGeometry(1.45,0),mat(0x8d9181));stone.position.set(-1,.1,-7);stone.scale.y=.5;}
 if(snow)for(let k=0;k<4;k++)person(k*.7-1,-6-k*1.2,false,1.15);
 updates.push(t=>people.forEach(({robe,phase,base})=>{robe.scale.y=base+Math.sin(t*.85+phase)*.006;}));
 if(i===4){
  // Open-ended, thickness-bearing arches have real occlusion all the way through.
  const radius=4.3,length=52,segs=40,depth=48,pos=[],uv=[];
  for(let a=0;a<segs;a++){for(let z=0;z<depth;z++){for(const [aa,zz]of [[a,z],[a+1,z],[a,z+1],[a+1,z],[a+1,z+1],[a,z+1]]){const angle=aa/segs*Math.PI;pos.push(Math.cos(angle)*radius,Math.sin(angle)*radius+1,-zz/depth*length+10);uv.push(aa/segs*6,zz/depth*16);}}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();mesh(g,mat(0x71847a,{side:T.DoubleSide}));for(let side of [-1,1])box(side*radius,.4,-16,.4,1.8,length,0x60776e);for(let z=10;z>=-42;z-=4){const arch=mesh(new T.TorusGeometry(radius,.11,6,36,Math.PI),mat(0x8a9681));arch.position.set(0,1,z);}
  box(0,-.02,-16,8.7,.12,54,0x718176);const exitLight=new T.PointLight(0xe7e1bd,45,42,2);exitLight.position.set(0,4,-43);scene.add(exitLight);for(let k=0;k<8;k++)tree((k%2?-1:1)*(7+r()*9),-46-r()*8,1);
 }
 let wheel;
 if(mill){house(-7,-9,1.35);wheel=new T.Group();wheel.position.set(-4,1.9,-6.9);root.add(wheel);const rim=mesh(new T.TorusGeometry(1.5,.12,6,24),mat(0xa59b78),wheel);for(let k=0;k<12;k++){const a=k/12*Math.PI*2;branch(v(0,0,0),v(Math.cos(a)*1.5,Math.sin(a)*1.5,0),.045,.045,0xaa9c75,wheel);const paddle=box(Math.cos(a)*1.5,Math.sin(a)*1.5,0,.18,.45,.6,0x9a9476,wheel);paddle.rotation.z=a;}updates.push(t=>{wheel.rotation.z=-t*.12;});}
 let rainbow;
 if(i===8&&!mill){rainbow=new T.Group();const colors=[0xd3a399,0xd6ba8b,0xd5ce9b,0x9cbca4,0x9badc4,0xaaa1c4];colors.forEach((color,k)=>{const material=new T.MeshBasicMaterial({color,transparent:true,opacity:.18,depthWrite:false});const m=mesh(new T.TorusGeometry(26-k*.17,.11,5,72,Math.PI),material,rainbow);m.castShadow=false;});rainbow.position.set(1,2,-61);root.add(rainbow);}
 function petalGeometry(){const shape=new T.Shape();shape.moveTo(0,-.11);shape.bezierCurveTo(-.095,-.015,-.065,.11,.015,.115);shape.bezierCurveTo(.09,.07,.065,-.055,0,-.11);const g=new T.ShapeGeometry(shape,5);const p=g.attributes.position;for(let n=0;n<p.count;n++)p.setZ(n,Math.sin(p.getY(n)*14)*.017);g.computeVertexNormals();return g;}
 // Lightweight shared particle pools: petals, rain/snow and birds.
 const petalCount=quality==='low'?38:100,petalGeo=petalGeometry(),petalMat=mat(i===5?0xaaa398:0xe8b6bd,{side:T.DoubleSide,transparent:true,opacity:.84});const petals=new T.InstancedMesh(petalGeo,petalMat,petalCount),petalSeeds=Array.from({length:petalCount},()=>({x:(r()-.5)*(garden?75:43),z:(r()-.5)*60-10,y:r()*13,p:r()*7,s:.5+r()*1.2})),dummy=new T.Object3D();root.add(petals);resources.add(petalGeo);petals.castShadow=false;
 const showPetals=[1,2,7,8].includes(i)&&!forest&&!waste;
 petals.visible=showPetals;
 updates.push(t=>{if(!showPetals)return;petalSeeds.forEach((p,k)=>{const y=((p.y-t*.25)%12+12)%12;dummy.position.set(p.x+Math.sin(t*.21+p.p)*2,y,p.z+Math.cos(t*.15+p.p));dummy.rotation.set(t*.6+p.p,t*.4+p.p,t*.28);dummy.scale.setScalar(p.s);dummy.updateMatrix();petals.setMatrixAt(k,dummy.matrix);});petals.instanceMatrix.needsUpdate=true;});
 let rain;
 if(i===3){const count=snow?1000:1600,arr=new Float32Array(count*6),geo=new T.BufferGeometry(),seeds=Array.from({length:count},()=>[r()*50-25,r()*25,r()*60-30]);geo.setAttribute('position',new T.BufferAttribute(arr,3));const material=new T.LineBasicMaterial({color:snow?0xe8eeee:0xc9dbdb,transparent:true,opacity:snow?.7:.4,depthWrite:false});rain=new T.LineSegments(geo,material);root.add(rain);updates.push(t=>{seeds.forEach(([x,y,z],k)=>{const yy=((y-t*(snow?1:11))%25+25)%25;arr.set([x+Math.sin(t+x)*.1,yy,z,x+.03,yy+(snow?.09:.6),z+.03],k*6);});geo.attributes.position.needsUpdate=true;});resources.add(geo);resources.add(material);}
 const birds=[];
 if(i===5){const wingGeo=new T.BufferGeometry();wingGeo.setAttribute('position',new T.Float32BufferAttribute([0,0,0,.6,.03,-.18,.1,0,.2],3));wingGeo.computeVertexNormals();for(let k=0;k<25;k++){const g=new T.Group();for(const sign of [-1,1]){const wing=mesh(wingGeo,mat(0x475954,{side:T.DoubleSide}),g);wing.scale.x=sign;}g.position.set((r()-.5)*40,7+r()*9,-r()*50);root.add(g);birds.push({g,p:r()*7,base:g.position.clone()});}updates.push(t=>birds.forEach(({g,p,base})=>{g.position.set(base.x+Math.sin(t*.15+p)*10,base.y+Math.cos(t*.4+p),base.z+Math.cos(t*.12+p)*7);g.rotation.y=Math.cos(t*.15+p)*.6;g.children.forEach((wing,k)=>{wing.rotation.z=Math.sin(t*4+p)*(k?1:-1)*.45;});}));}
 // Thin three-dimensional fog bands use translucent geometry between objects.
 const fogCanvas=canvasFactory(128,64),fc=fogCanvas.getContext('2d'),fg=fc.createRadialGradient(64,32,0,64,32,64);fg.addColorStop(0,'#ffffff');fg.addColorStop(.35,'#ffffffa0');fg.addColorStop(1,'#ffffff00');fc.fillStyle=fg;fc.fillRect(0,0,128,64);const fogMap=new T.CanvasTexture(fogCanvas);resources.add(fogMap);const fogBands=[];for(let k=0;k<3;k++){const fogMaterial=new T.MeshBasicMaterial({map:fogMap,color:palette.fog,transparent:true,opacity:i===4?.2:.1,depthWrite:false,side:T.DoubleSide});const fog=mesh(new T.PlaneGeometry(75,3),fogMaterial);fog.position.set(-8,1.8+k*1.4,-18-k*17);fog.castShadow=false;fogBands.push(fog);resources.add(fogMaterial);}updates.push(t=>fogBands.forEach((f,k)=>{f.position.x=Math.sin(t*.035+k)*5;}));
 const puddles=[];
 if(i===3&&!snow)for(let k=0;k<12;k++)puddles.push({x:(r()-.5)*3.6,z:16-k*4.2,rx:.42+r()*.55,rz:.65+r()*.8});
 // A bounded reusable ring pool is driven by actual falling petals/rain impacts.
 const ripplePool=[];
 if(i===2||puddles.length){
  const geometry=new T.RingGeometry(.955,1,40),count=i===2?18:24;
  resources.add(geometry);
  for(let n=0;n<count;n++){
   const material=new T.MeshBasicMaterial({color:i===2?0xd9d5c6:0xc5d4d2,transparent:true,opacity:0,depthWrite:false});resources.add(material);
   const ring=mesh(geometry,material);ring.rotation.x=-Math.PI/2;ring.castShadow=false;ring.visible=false;
   ripplePool.push({ring,born:-10,x:0,z:0});
  }
  let nextRipple=0,previousTime=0,lastRain=-1;
  const spawnRipple=(x,z,t)=>{const item=ripplePool[nextRipple++%ripplePool.length];Object.assign(item,{born:t,x,z});};
  updates.push(t=>{
   if(t>previousTime&&t-previousTime<.2&&showPetals){
    const period=12/.25;
    for(const p of petalSeeds){const cycle=Math.floor((t-p.y/.25)/period),impact=p.y/.25+cycle*period;
     if(impact>previousTime&&impact<=t){const x=p.x+Math.sin(impact*.21+p.p)*2,z=p.z+Math.cos(impact*.15+p.p);if(pond(x,z))spawnRipple(x,z,impact);}
    }
   }
   if(puddles.length&&Math.floor(t*7)!==lastRain){lastRain=Math.floor(t*7);const p=puddles[lastRain%puddles.length];if(p)spawnRipple(p.x+Math.sin(lastRain)*p.rx*.45,p.z+Math.cos(lastRain)*p.rz*.45,t);}
   for(const item of ripplePool){const age=t-item.born;item.ring.visible=age>=0&&age<2.2;if(item.ring.visible){item.ring.position.set(item.x,puddles.length?.095:.012,item.z);item.ring.scale.setScalar(.035+age*(puddles.length?.1:.23));item.ring.material.opacity=(1-age/2.2)*.19;}}
   previousTime=t;
  });
 }
 const rocks=[];for(let k=0;k<(i===7?28:12);k++){const x=(r()-.5)*65,z=10-r()*65;if(onPath(x,z)||pond(x,z))continue;const rock=mesh(new T.DodecahedronGeometry(.4+r()*.9,0),mat(waste?0x8b8871:0x92998a));rock.position.set(x,height(x,z)+.15,z);rock.scale.set(1,.55+r()*.5,1);rock.rotation.y=r()*6;rocks.push(rock);colliders.push({x,z,r:.65});}
 const lilyGroups=[];if([2,6,8].includes(i)){for(let k=0;k<22;k++){const x=lake.x-lake.rx*.6+r()*lake.rx*1.2,z=lake.z+lake.rz*.65-r()*lake.rz*1.3;if(!pond(x,z))continue;const group=new T.Group();group.position.set(x,.035,z);const leaf=mesh(new T.CircleGeometry(.3+r()*.28,14,0,Math.PI*1.88),mat(0x638b79,{side:T.DoubleSide}),group);leaf.rotation.x=-Math.PI/2;leaf.castShadow=false;if(k%4===0){for(let p=0;p<7;p++){const a=p/7*Math.PI*2,m=mesh(new T.SphereGeometry(.12,5,4),mat(0xe6b9c0),group);m.position.set(Math.cos(a)*.09,.08,Math.sin(a)*.09);m.scale.set(1,.5,1);}}root.add(group);lilyGroups.push({group,base:group.position.clone(),p:r()*7});}updates.push(t=>lilyGroups.forEach(({group,base,p})=>{group.position.set(base.x+Math.sin(t*.4+p)*.025,base.y+Math.sin(t*.35+p)*.012,base.z+Math.cos(t*.33+p)*.02);group.rotation.y=Math.sin(t*.2+p)*.025;}));}
 // Bake static objects by material. Dynamic actors remain independently animated.
 const dynamicRoots=new Set([sky,sun,petals,...cloudGroups,...people.map(p=>p.g),...fogBands,...birds.map(b=>b.g),...lilyGroups.map(l=>l.group),...ripplePool.map(p=>p.ring),wheel].filter(Boolean));
 const staticGroups=new Map();root.updateMatrixWorld(true);
 root.traverse(o=>{if(!o.isMesh||o.isInstancedMesh)return;let ancestor=o;while(ancestor&&ancestor!==root){if(dynamicRoots.has(ancestor))return;ancestor=ancestor.parent;}const key=o.material.uuid+(foliage.has(o)?'-leaves':'');if(!staticGroups.has(key))staticGroups.set(key,[]);staticGroups.get(key).push(o);});
 for(const objects of staticGroups.values()){
  const arrays={position:[],normal:[],uv:[],color:[]};let material=objects[0].material;
  for(const object of objects){const geo=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();geo.applyMatrix4(object.matrixWorld);for(const name of Object.keys(arrays)){const attr=geo.attributes[name],count=geo.attributes.position.count,size=name==='uv'?2:3;for(let n=0;n<count;n++)for(let j=0;j<size;j++)arrays[name].push(attr?attr.array[n*size+j]:name==='color'?1:0);}geo.dispose();object.parent.remove(object);}
  const combined=new T.BufferGeometry();for(const [name,array]of Object.entries(arrays))combined.setAttribute(name,new T.Float32BufferAttribute(array,name==='uv'?2:3));
  if(foliage.has(objects[0])){material=material.clone();material.onBeforeCompile=shader=>{shader.uniforms.uWindTime=windUniform;shader.vertexShader='uniform float uWindTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x+=sin(uWindTime*.7+position.x*.25+position.z*.17)*.035;');};resources.add(material);}
  const batched=mesh(combined,material);batched.userData.batchedObjects=objects.length;
 }
 const spawn=i===3?v(1,3.5,24):i===4?v(.2,2.7,17):i===7?v(8,5,13):i===6?v(15,8,22):v(12,7.5,21);
 const target=i===3?v(0,1.8,-14):i===4?v(0,2,-12):i===7?v(-2,2,-7):i===6?v(1,9,-38):v(0,2,-9);
 let waterSpec=[2,6,8].includes(i)?{center:v(lake.x,-.01,lake.z),width:lake.rx*2,depth:lake.rz*2,ellipse:true,color:palette.water}:puddles.length?{center:v(0,.075,-8),width:8,depth:64,puddles,color:palette.water}:null;
 function onBridge(x,z){return i===2&&x>=-1&&x<=21&&Math.abs(z-6)<.83;}
 function walkHeight(x,z){return onBridge(x,z)?Math.sin((x+1)/22*Math.PI)*1.35+.43:height(x,z);}
 function isWalkable(x,z){if(x< -33||x>33||z< -46||z>27)return false;if(i===4&&z<=10&&z>=-42&&Math.abs(x)>3.45)return false;if(pond(x,z)&&!onBridge(x,z))return false;return !colliders.some(o=>o.box?Math.abs(x-o.x)<o.box[0]+.35&&Math.abs(z-o.z)<o.box[1]+.35:Math.hypot(x-o.x,z-o.z)<o.r+.28);}
 return {scene,root,id,film,garden,sunPosition:sun.position,updates,windUniform,waterSpec,height,walkHeight,onPath,isWalkable,spawn,target,colliders,palette,resources,
  update(time,delta){windUniform.value=time;for(const f of updates)f(time,delta);},
  dispose(){const geos=new Set(),mats=new Set(),textures=new Set();scene.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);});for(const m of mats)for(const value of Object.values(m))if(value?.isTexture)textures.add(value);textures.forEach(t=>t.dispose());geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());resources.forEach(r=>r.dispose?.());scene.clear();}
 };
}
