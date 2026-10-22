import * as T from '../assets/three.module.js';

export const presets={
  'round-short':{head:[.83,.73,.66],body:[.73,.96,.58],ear:[.3,.42],muzzle:.17,legs:.75,tail:.15},
  'natural-short':{head:[.72,.69,.62],body:[.64,.97,.59],ear:[.32,.5],muzzle:.28,legs:.83,tail:.13},
  'round-long':{head:[.83,.7,.66],body:[.78,.91,.64],ear:[.3,.43],muzzle:.13,legs:.6,tail:.24},
  'round-flat':{head:[.84,.71,.65],body:[.74,.9,.62],ear:[.28,.39],muzzle:.07,legs:.63,tail:.15},
  'ragdoll-long':{head:[.72,.72,.65],body:[.66,1.04,.67],ear:[.33,.53],muzzle:.22,legs:.8,tail:.25},
  'large-long':{head:[.72,.77,.64],body:[.73,1.18,.73],ear:[.38,.7],muzzle:.39,legs:.96,tail:.27,square:true},
  'slender-wedge':{head:[.59,.71,.61],body:[.49,1.04,.57],ear:[.43,.8],muzzle:.37,legs:1.0,tail:.1,wedge:true},
  'athletic-spotted':{head:[.65,.67,.61],body:[.58,1.1,.69],ear:[.3,.49],muzzle:.32,legs:.99,tail:.14},
  'slender-blue':{head:[.64,.7,.61],body:[.53,1.02,.58],ear:[.34,.59],muzzle:.3,legs:.91,tail:.12,wedge:true},
  'triangular-forest':{head:[.66,.8,.63],body:[.7,1.16,.72],ear:[.35,.66],muzzle:.27,legs:.86,tail:.28,wedge:true},
  hairless:{head:[.63,.72,.58],body:[.54,.92,.57],ear:[.47,.86],muzzle:.31,legs:.91,tail:.08,wedge:true}
};
export const rhythms={gentle:[.85,.55,.8,.035],playful:[1.5,1.7,1.2,.055],lazy:[.7,.45,.65,.02],knead:[1.1,.9,.9,.055],'gentle-tail':[.8,.68,.72,.03],'big-step':[1.05,1.15,.85,.045],groom:[.9,.6,.76,.028],nimble:[1.35,1.6,1.24,.06],pounce:[1.55,1.85,1.15,.05],observant:[.92,.75,1.02,.06],'forest-walk':[.78,.52,.78,.038],sphynx:[1.22,1.35,1.1,.065],sunny:[.72,.48,.68,.025],quick:[1.4,1.65,1.3,.06]};
const clamp=T.MathUtils.clamp;
function random(seed){let value=seed>>>0;return()=>{value=(value*1664525+1013904223)>>>0;return value/4294967296;};}
const seed=id=>[...id].reduce((n,c)=>n*31+c.charCodeAt(0)>>>0,3);
function material(color,roughness=.84){return new T.MeshStandardMaterial({color,roughness,metalness:0});}
function tube(points,radius,segments=14){return new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),segments,radius,5,false);}
function pattern(c,p,part){
  const base=new T.Color(c.color),white=new T.Color('#fff8f2'),dark=new T.Color(c.ink);
  if(c.pattern==='calico'){const mark=Math.sin(p.x*6.5+p.z*4)+Math.cos(p.y*5-p.x*3);return mark>.6?new T.Color('#a65e36'):mark<-.45?new T.Color('#302c37'):white;}
  if(c.pattern.includes('point')){if(part==='ear'||part==='tail'||part==='leg')return dark.clone().lerp(base,.18);if(part==='head'){const mask=1-clamp(Math.abs(p.x)*1.5,0,1);if(p.z>.35&&p.y<.45)return dark.clone().lerp(base,c.id==='luna'?clamp((.37-Math.abs(p.x))*5,0,1):.15);return base;}return base;}
  if(c.pattern==='rosette'){const x=p.x*13,y=p.y*11,z=p.z*13;const rings=Math.sin(x+Math.sin(y*.7))*Math.cos(z+Math.sin(x*.6));return rings>.5&&rings<.84?dark.clone().lerp(base,.2):base;}
  if(c.pattern.includes('tabby')){if(part==='body'&&p.z>.35&&Math.abs(p.x)<.25&&c.id!=='sunny')return white;const stripe=Math.sin((p.x*3+p.y*1.3+p.z*2)*9);return stripe>.73?base.clone().lerp(dark,.52):base;}
  if(c.pattern.includes('white')&&part==='body'&&p.z>.2&&Math.abs(p.x)<.7)return white;
  if(c.id==='boba'&&part==='head'&&p.y<-.08)return white;
  return base;
}

export function createCat(c,{quality='high',gray=false,accessory=c.accessory||'collar'}={}){
  const params=structuredClone(presets[c.build]||presets['natural-short']),long=['long','semi-long'].includes(c.coat),hairless=c.coat==='hairless';
  if(c.typeId==='persian'){params.head=[.9,.73,.67];params.body=[.82,.8,.67];params.ear=[.27,.36];params.muzzle=.06;params.legs=.53;}
  if(c.id==='milk'){params.head=[.8,.76,.69];params.muzzle=.23;params.ear=[.34,.49];}
  const root=new T.Group();root.name=`cat:${c.id}`;root.userData.catId=c.id;
  const rnd=random(seed(c.id)),rig={},bases=new Map(),geometries=new Set(),materials=new Set();
  const addMat=m=>(materials.add(m),m),addGeo=g=>(geometries.add(g),g);
  const furMat=addMat(new T.MeshStandardMaterial({vertexColors:true,roughness:hairless?.92:.94}));
  const white=addMat(material('#fffaf4')),pink=addMat(material(hairless?'#bd7978':'#f7a5bc')),dark=addMat(material('#4b3441'));
  function add(parent,geo,mat,position=[0,0,0],scale=[1,1,1],name=''){materials.add(mat);const mesh=new T.Mesh(addGeo(geo),mat);mesh.position.set(...position);mesh.scale.set(...scale);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  function group(parent,name,position=[0,0,0]){const g=new T.Group();g.name=name;g.position.set(...position);parent.add(g);rig[name]=g;return g;}
  function surface(parent,center,radii,part='body',fuzz=1){
    const segments=quality==='low'?14:28;const geo=new T.SphereGeometry(1,segments,Math.round(segments*.72));const positions=geo.attributes.position;
    const colors=new Float32Array(positions.count*3);
    for(let i=0;i<positions.count;i++){
      const p=new T.Vector3().fromBufferAttribute(positions,i);if(part==='head'&&params.wedge)p.x*=.69+.31*(p.y+1)*.5;
      if(part==='head'&&params.square&&p.y<0)p.x*=1.08;
      if(!hairless){const ripple=(Math.sin(p.x*55+p.z*17)*Math.sin(p.y*49+p.x*13))*(long?.008:.003);p.multiplyScalar(1+ripple);}
      positions.setXYZ(i,p.x,p.y,p.z);const col=gray?new T.Color('#b5b0b4'):pattern(c,p,part);col.toArray(colors,i*3);
    }
    geo.setAttribute('color',new T.BufferAttribute(colors,3));geo.computeVertexNormals();const obj=add(parent,geo,furMat,center,radii,part);
    if(!hairless&&fuzz&&(quality!=='low'||part==='body'||part==='head')){const count=Math.floor((long?(part==='head'?540:part==='body'?430:part==='tail'?110:75):100)*fuzz*(quality==='low'?.25:1));const length=(long?.065:.023)*fuzz;const fluffGeo=addGeo(new T.ConeGeometry(long?.011:.006,length,4,1));fluffGeo.translate(0,length*.2,0);const fluffMat=addMat(material(gray?'#b5b0b4':'#ffffff',.98));const inst=new T.InstancedMesh(fluffGeo,fluffMat,count);const dummy=new T.Object3D();
      for(let i=0;i<count;i++){const z=rnd()*2-1,a=rnd()*Math.PI*2,r=Math.sqrt(1-z*z);const unit=new T.Vector3(r*Math.cos(a),z,r*Math.sin(a));if(part==='head'&&unit.z>.67&&unit.y>-.5&&unit.y<.5)unit.z=-unit.z;const point=unit.clone().multiply(new T.Vector3(...radii));dummy.position.copy(point).add(new T.Vector3(...center));const n=unit.clone().divide(new T.Vector3(...radii)).normalize();dummy.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),n);dummy.scale.setScalar(.6+rnd()*.8);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);inst.setColorAt(i,gray?new T.Color('#b5b0b4'):pattern(c,unit,part));}inst.instanceMatrix.needsUpdate=true;inst.frustumCulled=false;parent.add(inst);}
    return obj;
  }
  const hips=group(root,'hips',[0,1.03,0]);
  surface(hips,[0,.08,-.09],params.body,'body',long?1.3:1);
  const spine=group(hips,'spine',[0,.43,.04]);
  if(long)surface(spine,[0,.4,.13],[params.body[0]*1.02,.67,.54],'body',1.55);
  const head=group(spine,'head',[0,.94,.13]);
  surface(head,[0,0,0],params.head,'head',long?1.2:1);
  if(params.square){surface(head,[0,-.28,.52],[.42,.29,.25],'head',.6);}
  else{[-1,1].forEach(sign=>surface(head,[sign*.23,-.22,.48],[params.wedge?.25:.34,.26,.26],'head',.6));}
  for(const sign of [-1,1]){
    const ear=group(head,sign<0?'earL':'earR',[sign*params.head[0]*.67,params.head[1]*.66,-.04]);ear.rotation.z=sign*-.24;
    const [width,height]=params.ear;const shape=new T.Shape();shape.moveTo(-width,0);shape.quadraticCurveTo(-width*.88,height*.55,0,height);shape.quadraticCurveTo(width*.88,height*.6,width,0);shape.quadraticCurveTo(0,-.13,-width,0);
    const earGeo=new T.ExtrudeGeometry(shape,{steps:1,depth:.12,bevelEnabled:true,bevelSize:.04,bevelThickness:.05,bevelSegments:2,curveSegments:7});const earMat=addMat(material(gray?'#b5b0b4':pattern(c,new T.Vector3(sign,.7,-.3),'ear')));add(ear,earGeo,earMat,[0,0,-.12]);
    const innerShape=shape.clone();add(ear,new T.ShapeGeometry(innerShape,8),pink,[0,.055,.067],[.62,.69,1]);
    if(['large-long','triangular-forest'].includes(c.build)){for(let i=0;i<3;i++)add(ear,new T.ConeGeometry(.025,.19+i*.025,4),earMat,[(i-1)*.035,height+.035,0]);}
    const eyeGroup=group(head,sign<0?'eyeL':'eyeR',[sign*params.head[0]*.45,.045,params.head[2]*.82]);eyeGroup.rotation.y=sign*.13;
    add(eyeGroup,new T.SphereGeometry(1,24,18),addMat(material('#2b2330',.13)),[0,0,0],[.225,.255,.095]);
    add(eyeGroup,new T.SphereGeometry(1,24,18),addMat(material(c.eyes,.19)),[0,-.005,.066],[.173,.199,.055]);
    add(eyeGroup,new T.SphereGeometry(1,20,16),addMat(material('#171a27',.08)),[0,0,.103],[.095,.162,.037]);
    add(eyeGroup,new T.SphereGeometry(1,12,10),addMat(new T.MeshBasicMaterial({color:'#ffffff'})),[-.06,.09,.13],[.06,.07,.03]);
    add(eyeGroup,new T.SphereGeometry(1,10,8),white,[.066,-.07,.124],[.024,.027,.019]);
    add(head,new T.SphereGeometry(1,14,10),addMat(material('#eeafbe',.96)),[sign*.49,-.23,.56],[.14,.06,.022]);
  }
  const noseShape=new T.Shape();noseShape.moveTo(-.12,.02);noseShape.quadraticCurveTo(0,-.15,.12,.02);noseShape.quadraticCurveTo(0,.075,-.12,.02);
  add(head,new T.ExtrudeGeometry(noseShape,{depth:.045,bevelEnabled:true,bevelSize:.014,bevelThickness:.014,bevelSegments:2,steps:1}),pink,[0,-.18,.79+params.muzzle*.25]);
  for(const sign of [-1,1]){add(head,tube([[0,-.27,.8],[sign*.06,-.33,.81],[sign*.14,-.29,.77]],.012,8),dark);for(let i=0;i<3;i++)add(head,tube([[sign*.32,-.27-i*.028,.68],[sign*.67,-.2-i*.07,.7],[sign*(1.0-i*.03),-.17-i*.11,.59]],.0065,8),addMat(material('#d1bcc7')));}
  for(const sign of [-1,1]){
    const hind=group(hips,sign<0?'backL':'backR',[sign*params.body[0]*.65,-.48,-.12]);surface(hind,[0,0,0],[.36,.49,.41],'body',.7);surface(hind,[sign*.06,-.36,.26],[.32,.21,.43],'leg',.5);
    const shoulder=group(spine,sign<0?'armL':'armR',[sign*.39,-.25,.45]);const elbow=group(shoulder,sign<0?'elbowL':'elbowR',[0,-.44,.03]);
    surface(shoulder,[0,-.22,0],[.19,.4,.2],'leg',.6);surface(elbow,[0,-params.legs*.28,.015],[.185,params.legs*.37,.18],'leg',.5);
    const paw=group(elbow,sign<0?'pawL':'pawR',[0,-params.legs*.52,.12]);surface(paw,[0,0,0],[.255,.19,.3],'leg',.6);
    add(paw,new T.SphereGeometry(1,16,12),pink,[0,-.02,.274],[.1,.075,.025]);for(let i=-1;i<=1;i++)add(paw,new T.SphereGeometry(1,12,8),pink,[i*.092,.075,.251],[.044,.052,.03]);
    const proxy=add(shoulder,new T.SphereGeometry(.3,8,6),new T.MeshBasicMaterial({visible:false}),[0,-.65,.1]);proxy.userData.action='paw';
  }
  const tail=group(hips,'tail',[params.body[0]*.72,-.53,-.43]);tail.rotation.z=-.72;tail.rotation.x=-.5;let last=tail;
  for(let i=0;i<6;i++){const joint=group(last,`tail${i}`,[0,i? .32:0,0]);surface(joint,[0,.16,0],[params.tail*(1-i*.065),.24,params.tail*(1-i*.065)],'tail',long?1.2:.2);joint.rotation.z=.21;last=joint;}
  const headProxy=add(head,new T.SphereGeometry(.72,10,8),new T.MeshBasicMaterial({visible:false}));headProxy.userData.action='pet';
  const bodyProxy=add(hips,new T.SphereGeometry(.7,8,6),new T.MeshBasicMaterial({visible:false}),[0,.2,0]);bodyProxy.userData.action='stretch';
  const tailProxy=add(tail,new T.CapsuleGeometry(.25,1.1,4,6),new T.MeshBasicMaterial({visible:false}),[0,.7,0]);tailProxy.userData.action='stretch';
  const accessories=group(head,'accessories',[0,-.57,.34]);
  function setAccessory(kind){accessories.visible=kind!=='none';accessories.children.forEach(o=>o.visible=o.userData.accessory===kind);}
  const bowMat=addMat(material('#ff6398',.72));
  for(const sign of [-1,1]){const knot=add(accessories,new T.SphereGeometry(1,20,14),bowMat,[sign*.23,0,.14],[.29,.18,.105]);knot.rotation.z=sign*.3;knot.userData.accessory='bow';}
  const knot=add(accessories,new T.SphereGeometry(.105,16,10),bowMat,[0,0,.24]);knot.userData.accessory='bow';
  const collar=add(accessories,new T.TorusGeometry(.43,.045,8,32),bowMat,[0,-.04,-.17]);collar.rotation.x=Math.PI/2;collar.userData.accessory='collar';const bell=add(accessories,new T.SphereGeometry(.09,12,10),addMat(material('#edc668',.4)),[0,-.1,.27]);bell.userData.accessory='collar';
  const hoodie=add(accessories,new T.TorusGeometry(.66,.12,8,32),addMat(material('#ffa1c4',.97)),[0,.68,-.36],[1,1.15,.6]);hoodie.userData.accessory='hoodie';
  const hood=add(accessories,new T.SphereGeometry(1,24,16,0,Math.PI*2,0,Math.PI*.55),addMat(material('#ffb7d0',.98)),[0,.69,-.54],[.77,.88,.45]);hood.userData.accessory='hoodie';
  if(hairless){for(let i=0;i<4;i++){add(head,tube([[-.28,.38+i*.053,.44],[-.13,.42+i*.05,.51],[.13,.42+i*.05,.51],[.28,.38+i*.053,.44]],.012,12),addMat(material('#b8807e',.95)));}for(let i=0;i<4;i++)add(hips,tube([[-.32,.48+i*.07,.38],[0,.43+i*.065,.5],[.32,.48+i*.07,.38]],.013,12),addMat(material('#bf8885',.96)));}
  root.traverse(o=>{if(o.isGroup)bases.set(o,{position:o.position.clone(),rotation:o.rotation.clone(),scale:o.scale.clone()});});setAccessory(accessory);
  let pose='sit';
  const api={group:root,rig,params,id:c.id,proxy:[headProxy,bodyProxy,rig.armL.children.at(-1),rig.armR.children.at(-1),tailProxy],geometries,materials,setAccessory,setPose:p=>{pose=p;},
    update(time,action='idle',progress=0,look=[0,0]){
      for(const [o,b]of bases){if(o===root||o===accessories)continue;o.position.copy(b.position);o.rotation.copy(b.rotation);o.scale.copy(b.scale);}
      const phase=seed(c.id)%100*.13,t=time+phase;const [breathRate,tailRate,blinkRate,headRange]=rhythms[c.preset]||rhythms.gentle;const beat=Math.sin(t*breathRate);
      hips.scale.y=1+beat*.012;head.rotation.y=Math.sin(t*.55)*headRange+look[0]*.17;head.rotation.x=look[1]*.09;
      rig.earL.rotation.z+=Math.pow(Math.max(0,Math.sin(t*.7)),20)*.1;rig.earR.rotation.z-=Math.pow(Math.max(0,Math.sin(t*.71+1.2)),20)*.08;
      for(let i=0;i<6;i++)rig[`tail${i}`].rotation.z+=Math.sin(t*tailRate-i*.55)*(c.id==='luna'||c.id==='fern'?.1:.06);
      const blink=Math.sin((t+phase)*blinkRate);const open=blink>.992?.09:1;rig.eyeL.scale.y=open;rig.eyeR.scale.y=open;
      if(pose==='lie'||action==='sleep'||action==='roll'){hips.position.y=.64;hips.rotation.x=-.42;spine.rotation.x=.35;head.position.y=.76;rig.armL.rotation.x=-.7;rig.armR.rotation.x=-.7;rig.backL.rotation.x=.5;rig.backR.rotation.x=.5;}
      const envelope=Math.sin(Math.PI*clamp(progress,0,1)),wave=Math.sin(progress*Math.PI*6);
      if(action==='pet'){head.rotation.x=-.2*envelope;head.rotation.z=Math.sin(progress*Math.PI*2)*.15;rig.eyeL.scale.y=rig.eyeR.scale.y=1-envelope*.92;if(c.id==='pearl'){head.rotation.y=Math.sin(progress*Math.PI*3)*.25*envelope;rig.armL.rotation.x=-1.3*envelope;}}
      if(action==='paw'||action==='wave'){rig.armL.rotation.x=-1.5*envelope;rig.armL.rotation.z=action==='wave'?wave*.25*envelope:-.22*envelope;rig.elbowL.rotation.x=-.4*envelope;rig.pawL.rotation.x=-.35*envelope;}
      if(action==='knead'){rig.armL.position.y-=Math.max(0,wave)*.14;rig.armR.position.y-=Math.max(0,-wave)*.14;head.rotation.x=.12*envelope;}
      if(action==='play'){hips.rotation.x=-.25*envelope;hips.position.y+=Math.sin(progress*Math.PI)*(['tiger','mocha'].includes(c.id)?.58:.22);rig.armL.rotation.x=-envelope;rig.armR.rotation.x=-envelope*.8;head.rotation.y=Math.sin(progress*Math.PI*2)*.4;}
      if(action==='walk'){const stride=c.id==='atlas'?.36:.22;rig.armL.rotation.x=wave*stride*envelope;rig.armR.rotation.x=-wave*stride*envelope;rig.backL.rotation.x=-wave*.15*envelope;rig.backR.rotation.x=wave*.15*envelope;}
      if(action==='stretch'){spine.rotation.x=-.18*envelope;head.rotation.x=.2*envelope;rig.armL.rotation.x=-.7*envelope;rig.armR.rotation.x=-.7*envelope;hips.scale.y+=.09*envelope;}
      if(action==='look'){head.rotation.y=Math.sin(progress*Math.PI*2)*.3;head.rotation.z=Math.sin(progress*Math.PI)*.13;}
      if(action==='roll'){hips.rotation.z=Math.sin(progress*Math.PI)*1.5;rig.armL.rotation.x=-1;rig.armR.rotation.x=-1;}
      if(action==='sleep'){rig.eyeL.scale.y=rig.eyeR.scale.y=.06;head.rotation.z=.12;}
    },
    dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());root.removeFromParent();}
  };api.update(0);return api;
}
