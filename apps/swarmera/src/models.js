import * as T from '../assets/vendor/three.module.js';
import {mergeGeometries} from '../assets/vendor/BufferGeometryUtils.js';
const V=(x,y,z)=>new T.Vector3(x,y,z);
export function materials(){const palette={
 armor:new T.MeshStandardMaterial({color:0x242b32,metalness:.78,roughness:.43}),
 edge:new T.MeshStandardMaterial({color:0x535965,metalness:.85,roughness:.32}),
 dark:new T.MeshStandardMaterial({color:0x0b1017,metalness:.58,roughness:.58}),
 flesh:new T.MeshStandardMaterial({color:0x352937,metalness:.38,roughness:.54}),
 purple:new T.MeshStandardMaterial({color:0xa64af6,emissive:0x9d26ee,emissiveIntensity:2.1,metalness:.4,roughness:.22}),
 green:new T.MeshStandardMaterial({color:0xd8ff9a,emissive:0x80df25,emissiveIntensity:1.8,roughness:.26,metalness:.3}),
 orange:new T.MeshStandardMaterial({color:0xffd5a4,emissive:0xff762d,emissiveIntensity:2,roughness:.35}),
 cyan:new T.MeshStandardMaterial({color:0xa1eee7,emissive:0x29bfb8,emissiveIntensity:1.5,roughness:.3}),
 stone:new T.MeshStandardMaterial({color:0x33323b,roughness:.92,metalness:.1}),
 glass:new T.MeshBasicMaterial({color:0xac70ff,transparent:true,opacity:.12,side:T.DoubleSide,depthWrite:false,blending:T.AdditiveBlending})
};
 for(const mat of [palette.armor,palette.edge,palette.flesh,palette.stone]){
  mat.onBeforeCompile=shader=>{
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSurface;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSurface=position;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vSurface;').replace('#include <color_fragment>','#include <color_fragment>\nfloat grain=fract(sin(dot(floor(vSurface*150.),vec3(12.9898,78.233,39.425)))*43758.5453);float scratch=pow(abs(sin(vSurface.y*95.+sin(vSurface.z*12.)*.7)),45.);diffuseColor.rgb*=.87+grain*.18+scratch*.14;');
  };
 }
 return palette;
}
export function mesh(parent,geo,mat,pos=[0,0,0],scale=[1,1,1]){const m=new T.Mesh(geo,mat);m.position.set(...pos);m.scale.set(...scale);parent.add(m);return m;}
const sphere=new T.SphereGeometry(1,16,10),ico=new T.IcosahedronGeometry(1,1),box=new T.BoxGeometry(1,1,1),oct=new T.OctahedronGeometry(1),cylinder=new T.CylinderGeometry(1,1,1,8);
export const orb=(p,m,pos,s)=>mesh(p,sphere,m,pos,s);
export const plate=(p,m,pos,s)=>mesh(p,ico,m,pos,s);
export const block=(p,m,pos,s)=>mesh(p,box,m,pos,s);
export function link(p,a,b,r1,r2,mat){const av=V(...a),bv=V(...b),m=mesh(p,new T.CylinderGeometry(r2,r1,av.distanceTo(bv),7),mat);m.position.copy(av.add(bv).multiplyScalar(.5));m.quaternion.setFromUnitVectors(V(0,1,0),V(...b).sub(V(...a)).normalize());return m;}
export function curve(p,points,r,mat){return mesh(p,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(a=>V(...a))),20,r,6,false),mat);}
function dynamic(p,pos=[0,0,0]){const g=new T.Group();g.position.set(...pos);g.userData.dynamic=true;p.add(g);return g;}
export function batch(root){for(const child of [...root.children])if(child.isGroup)batch(child);
 const groups=new Map();for(const child of [...root.children])if(child.isMesh&&!child.isInstancedMesh&&!child.userData.dynamic&&!Array.isArray(child.material)){child.updateMatrix();const arr=groups.get(child.material)||[];arr.push(child);groups.set(child.material,arr);}
 for(const [mat,children]of groups){if(children.length<2)continue;const geometries=children.map(c=>(c.geometry.index?c.geometry.toNonIndexed():c.geometry.clone()).applyMatrix4(c.matrix)),merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!merged)continue;for(const c of children)root.remove(c);root.add(new T.Mesh(merged,mat));}
}
function glow(parent,color,size,pos){const g=mesh(parent,new T.SphereGeometry(size,16,8),new T.MeshBasicMaterial({color,transparent:true,opacity:.095,depthWrite:false,blending:T.AdditiveBlending}),pos);g.userData.dynamic=true;return g;}
export function queenFactory(m){const root=new T.Group(),body=dynamic(root),head=dynamic(body,[0,6.65,0]);
 // A complete armored humanoid, visible from every side.
 orb(body,m.flesh,[0,4.7,0],[.75,1.9,.48]);
 for(let i=0;i<6;i++){const y=3.1+i*.51;plate(body,i%2?m.armor:m.dark,[0,y,.1],[.68+Math.sin(i*.5)*.35,.4,.53]);plate(body,m.edge,[0,y,.52],[.21,.25,.08]);}
 for(const s of [-1,1]){
  for(let i=0;i<3;i++)plate(body,m.armor,[s*(.47+i*.16),5.55-i*.28,.24],[.56,.47,.38]);
  const shoulder=dynamic(body,[s*1.05,5.85,0]);plate(shoulder,m.armor,[s*.25,0,0],[.85,.52,.65]);
  for(let i=0;i<4;i++)link(shoulder,[s*(.1+i*.2),.1,-.1],[s*(.5+i*.28),.65+i*.17,-.35],.16,.01,m.edge);
  link(body,[s*1.37,5.57,0],[s*1.75,4.4,.15],.24,.2,m.armor);orb(body,m.edge,[s*1.75,4.4,.15],[.22,.22,.22]);
  link(body,[s*1.75,4.4,.15],[s*1.6,3.43,.38],.2,.13,m.armor);
  for(let i=0;i<4;i++)curve(body,[[s*(1.57+i*.07),3.5,.42],[s*(1.73+i*.08),3.1,.48],[s*(1.65+i*.08),2.88,.65]],.035,m.edge);
  // Solid overlapping thigh and shin armor.
  link(body,[s*.39,3.15,0],[s*.52,1.85,.1],.34,.25,m.armor);plate(body,m.dark,[s*.49,2.5,.17],[.38,.73,.34]);
  plate(body,m.edge,[s*.52,1.8,.26],[.26,.29,.16]);link(body,[s*.52,1.72,.1],[s*.48,.25,.23],.22,.08,m.armor);
  plate(body,m.armor,[s*.49,.18,.46],[.18,.16,.49]);
  curve(body,[[s*.45,3.25,-.2],[s*.95,2.7,-.3],[s*.65,2.1,-.18]],.07,m.edge);
 }
 // Layered mask, crown and distinct purple eyes.
 orb(head,m.flesh,[0,.2,0],[.4,.59,.34]);plate(head,m.armor,[0,.45,-.06],[.5,.64,.37]);plate(head,m.armor,[0,.05,.29],[.16,.3,.15]);
 for(const s of [-1,1]){plate(head,m.armor,[s*.26,.23,.26],[.27,.28,.12]);const eye=orb(head,m.purple,[s*.19,.22,.365],[.14,.045,.035]);eye.rotation.z=s*-.16;
  curve(head,[[s*.25,.6,0],[s*.5,1.04,-.08],[s*.67,1.65,-.25],[s*.49,2.02,-.4]],.12,m.armor);
  curve(head,[[s*.13,.65,-.2],[s*.21,1.18,-.3],[s*.14,1.8,-.39]],.065,m.edge);
 }
 link(head,[0,.65,-.1],[0,1.78,-.15],.12,.005,m.edge);
 const core=dynamic(body,[0,5.35,.69]);mesh(core,oct,m.purple,[0,0,0],[.25,.47,.17]);for(const s of [-1,1])link(body,[s*.3,5.7,.58],[s*.28,4.98,.63],.045,.03,m.edge);const halo=glow(core,0xb246ff,.64,[0,0,0]);
 // Four independently articulated three-segment bone wings on each side.
 const wings=[];for(const s of [-1,1])for(let i=0;i<4;i++){
  const wing=dynamic(body,[s*.58,5.5-i*.29,-.36]),mid=dynamic(wing,[s*1.55,.78-i*.48,-.12]),tip=dynamic(mid,[s*1.6,.7-i*.25,-.15]);
  link(wing,[0,0,0],[s*1.55,.78-i*.48,-.12],.19,.12,m.armor);orb(wing,m.edge,[0,0,0],[.22,.22,.22]);
  link(mid,[0,0,0],[s*1.6,.7-i*.25,-.15],.12,.055,m.edge);
  curve(tip,[[0,0,0],[s*.7,.32-i*.08,-.12],[s*1.3,.95-i*.36,-.34],[s*1.45,1.6-i*.53,-.4]],.06,m.armor);
  for(let j=0;j<4;j++)link(mid,[s*j*.35,j*(.16-i*.04),-.02],[s*(j*.35+.34),.53+j*.12-i*.16,-.05],.075,.002,m.armor);
  curve(wing,[[0,0,.05],[s*.7,.38-i*.2,.02],[s*1.54,.78-i*.48,.0]],.025,m.purple);wings.push({wing,mid,tip,s,i});
 }
 for(let i=0;i<9;i++)plate(body,m.armor,[0,5.85-i*.35,-.56],[.25,.25,.2]);
 // Fine overlapping chitin ribs, vents, crown fins and swept wing vanes.
 for(const s of [-1,1]){
  for(let i=0;i<9;i++){
   const y=3.7+i*.22,x=s*(.49+Math.sin(i*.25)*.27);
   const rib=plate(body,i%3?m.armor:m.edge,[x,y,.42],[.34,.095,.16]);rib.rotation.z=s*-.28;
   curve(body,[[s*.45,y,-.37],[s*.72,y-.09,-.3],[s*.8,y-.12,.1]],.025,m.edge);
  }
  for(let i=0;i<7;i++){
   const fin=plate(head,m.armor,[s*(.13+i*.065),.6+i*.055,-.15-i*.025],[.055,.42+i*.035,.16]);fin.rotation.z=s*-.3;
  }
  plate(head,m.dark,[s*.2,.06,.31],[.16,.22,.11]);
  curve(head,[[s*.36,.4,.15],[s*.28,.19,.38],[s*.07,.13,.42]],.028,m.edge);
  for(let i=0;i<4;i++)plate(body,m.armor,[s*.68,2.5-i*.45,.15],[.2,.35,.32]);
 }
 for(const w of wings){for(let i=0;i<5;i++){
  const x=w.s*(.25+i*.24),y=(.7-w.i*.25)*(i*.24/1.6);
  const vane=plate(w.mid,m.armor,[x,y-.12,-.04],[.34,.18,.14]);vane.rotation.z=w.s*.35;
 }}
 root.userData={type:'queen' ,hotspots:{face:head,core,armor:body,wing:wings[0].mid}};batch(root);
 return {root,core,wings,update(t,state={}){const breath=Math.sin(t*1.5)*.035;body.position.y=breath;head.rotation.y=Math.sin(t*.3)*.055;
  const pulse=state.pulse||0;core.scale.setScalar(1+Math.sin(t*2)*.06+pulse*.24);halo.visible=state.bloom!==false;
  for(const w of wings){const spread=state.spread??1;w.wing.rotation.z=w.s*((1-spread)*-.75+Math.sin(t*.8+w.i*.6)*.025);w.mid.rotation.y=w.s*(Math.sin(t*.72-w.i*.5)*.035+(1-spread)*.45);w.tip.rotation.z=w.s*Math.sin(t*.9-w.i*.7)*.045;}
 }};
}
function scythe(parent,mat,s){const shape=new T.Shape();shape.moveTo(0,0);shape.bezierCurveTo(s*.9,.8,s*1.6,.2,s*1.15,-.9);shape.bezierCurveTo(s*1,-1.3,s*.1,-1.65,s*-.3,-1.6);shape.bezierCurveTo(s*.8,-.9,s*.9,-.1,0,0);const geo=new T.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:true,bevelSize:.035,bevelThickness:.04,bevelSegments:1,steps:1,curveSegments:10});return mesh(parent,geo,mat,[s*.5,.65,1.6]);}
function bone(parent,mat,r=.12){return mesh(parent,cylinder,mat,[0,0,0],[r,1,r]);}
function align(m,a,b){m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(V(0,1,0),b.clone().sub(a).normalize());m.scale.y=a.distanceTo(b);}
export function mechFactory(type,m){const root=new T.Group(),body=dynamic(root,[0,1.48,0]),legs=[],arms=[];
 const heavy=type==='bulwark',siege=type==='siege',fly=type==='razorwing',energy=siege?m.orange:fly?m.purple:heavy?m.cyan:m.green;
 orb(body,m.dark,[0,0,0],[heavy?1.5:1.1,.56,1.7]);
 for(let i=0;i<5;i++){const z=-1.25+i*.57;plate(body,i%2?m.armor:m.dark,[0,.2,z],[heavy?1.45:1.1,.57, .63]);for(const s of [-1,1])plate(body,m.edge,[s*.86,.22,z],[.18,.19,.3]);}
 const head=dynamic(body,[0,-.05,1.4]);plate(head,m.armor,[0,0,0],[.76,.54,.77]);orb(head,energy,[0,.05,.62],[.39,.2,.19]);
 for(const s of [-1,1]){curve(body,[[s*.7,.38,-1.3],[s*.78,.61,0],[s*.52,.3,1.4]],.055,energy);for(let j=0;j<4;j++)link(body,[s*.7,.45,-1.3+j*.55],[s*1.2,.85,-1.5+j*.5],.12,.005,m.armor);}
 if(!fly)for(const s of [-1,1])for(let i=0;i<3;i++){
  const hip=V(s*.85,1.45,-1.05+i*1.0),toe=V(s*(2.15+(i===1?.3:0)),0,-1.65+i*1.6),g=dynamic(root);
  const up=bone(g,m.armor,.15),low=bone(g,m.edge,.085);orb(g,m.armor,hip.toArray(),[.23,.23,.23]);const joint=orb(g,m.dark,[0,0,0],[.23,.2,.23]),foot=plate(g,m.armor,toe.toArray(),[.19,.12,.37]);
  legs.push({hip,toe,up,low,joint,foot,phase:(i+(s===1?1:0))%2*.5,s});
 }
 if(type==='breaker')for(const s of [-1,1]){const arm=dynamic(body,[s*.9,.32,.88]);link(arm,[0,0,0],[s*.65,.65,1],.25,.18,m.armor);curve(arm,[[s*.65,.65,1],[s*1.2,.75,1.8],[s*1.25,-.1,2.6],[s*.45,-.66,2.95]],.12,m.edge);curve(arm,[[s*.65,.7,1],[s*1.1,.7,1.8],[s*1.15,0,2.5]],.04,energy);plate(arm,m.armor,[s*.65,.55,1],[.25,.3,.4]);scythe(arm,m.armor,s);arms.push(arm);}
 let shield,cannon,wings=[],organs=[];
 if(heavy){plate(body,m.armor,[0,.55,0],[1.45,.75,1.5]);for(const s of [-1,1])for(const z of [-.8,.8]){const g=dynamic(body,[s*.95,.68,z]);plate(g,m.armor,[s*.25,0,0],[.65,.25,.5]);orb(g,energy,[s*.45,.15,0],[.24,.11,.26]);organs.push({g,s});}
  shield=mesh(root,new T.SphereGeometry(3,32,16,0,Math.PI*2,0,Math.PI/2),new T.MeshBasicMaterial({color:0x8edaff,transparent:true,opacity:.13,wireframe:true,depthWrite:false}));shield.userData.dynamic=true;shield.visible=false;
 }
 if(siege){cannon=dynamic(body,[0,.65,-.45]);plate(cannon,m.armor,[0,0,0],[.7,.45,1]);link(cannon,[0,.1,-.3],[0,.45,2.3],.36,.22,m.armor);link(cannon,[0,.45,2.2],[0,.52,2.72],.28,.25,m.edge);orb(cannon,energy,[0,.52,2.78],[.2,.2,.08]);for(const s of [-1,1])curve(body,[[s*.8,.35,-1.1],[s*.65,.9,-.8],[s*.42,.95,.15]],.08,energy);}
 if(fly){body.position.y=2.8;for(const s of [-1,1]){const wing=dynamic(body,[s*.6,.25,0]);plate(wing,m.armor,[s*1.2,0,0],[1.5,.18,1.1]);curve(wing,[[s*.4,0,1],[s*2,0,.7],[s*3,0,-1.6],[s*1.2,0,-.55]],.09,m.edge);curve(wing,[[s*.4,.12,1],[s*1.8,.1,.6],[s*2.7,.0,-1.3]],.04,energy);wings.push({wing,s});}curve(body,[[0,0,-1.4],[0,-.2,-2.2],[0,.2,-3.2]],.17,m.armor);orb(body,energy,[0,0,-2],[.3,.3,.5]);}
 for(const s of [-1,1]){
  for(let i=0;i<8;i++){
   const z=-1.45+i*.39,rib=plate(body,m.armor,[s*.8,.27,z],[.38,.31,.26]);rib.rotation.z=s*-.25;
   orb(body,m.edge,[s*.98,.37,z],[.055,.055,.055]);
   block(body,m.dark,[s*.45,.71,z],[.16,.035,.12]);
  }
  for(let i=0;i<3;i++)link(head,[s*.28,-.1,.55],[s*(.37+i*.12),-.5,.95+i*.13],.09,.005,m.armor);
 }
 root.userData={type,hotspots:{face:head,core:head,armor:body,wing:arms[0]||wings[0]?.wing||cannon||body}};batch(root);
 return {root,type,legs,shield,cannon,update(t,state={}){
  const moving=!!state.moving,phase=(state.gaitTime??t)*1.25;body.position.y=(fly?2.8:1.48)+(moving?Math.sin(phase*Math.PI*4)*.065:Math.sin(t)*.022);
  const age=state.actionAge??99,perform=age>=0&&age<4,action=Math.sin(Math.min(1,Math.max(0,age/1.2))*Math.PI/2);
  for(const l of legs){const f=(phase+l.phase)%1,swing=f<.38,foot=l.toe.clone();if(moving){foot.z+=(swing?-.5+f/.38: .5-(f-.38)/.62);foot.y=swing?Math.sin(f/.38*Math.PI)*.52:0;}
   if(siege&&perform){foot.x+=l.s*.6*action;foot.z+=Math.sign(foot.z)*.35*action;}const hip=l.hip.clone(),knee=hip.clone().lerp(foot,.5);knee.x+=l.s*.46;knee.y=1.2+foot.y*.42;align(l.up,hip,knee);align(l.low,knee,foot);l.joint.position.copy(knee);l.foot.position.copy(foot);}
  for(let i=0;i<arms.length;i++){arms[i].rotation.x=moving?Math.sin(t*3.5+i)*.27:perform?Math.sin(age*3)*.4:Math.sin(t)*.025;}
  if(shield){shield.visible=!!state.shield;shield.rotation.y=t*.18;shield.scale.setScalar(.97+Math.sin(t*2)*.02);for(const o of organs)o.g.rotation.z=o.s*(state.shield?.8:0);}
  if(cannon){cannon.rotation.x=perform?-.2*action:0;cannon.position.z=-.45+(age>1.1&&age<1.5?-.25*(1-(age-1.1)/.4):0);}
  for(const w of wings)w.wing.rotation.z=w.s*(Math.sin(t*2)*.1+(perform?Math.sin(age*1.5)*.45:0));
  if(fly){root.position.y=perform?-Math.sin(Math.min(age/4,1)*Math.PI)*1.6:Math.sin(t*.7)*.18;root.rotation.z=perform?Math.sin(age*1.5)*.24:Math.sin(t*.7)*.04;}
 }};
}
export function defenderFactory(m){const root=new T.Group();block(root,m.armor,[0,.5,0],[2,.7,3]);for(const s of [-1,1]){block(root,m.dark,[s*1,.4,0],[.45,.55,3.3]);for(let i=0;i<5;i++)orb(root,m.edge,[s*1.25,.4,-1.2+i*.6],[.06,.25,.25]);}const turret=dynamic(root,[0,1,0]);plate(turret,m.edge,[0,0,0],[.8,.4,.8]);link(turret,[0,.15,.25],[0,.2,2],.15,.12,m.armor);orb(turret,m.orange,[0,.2,2.01],[.1,.1,.04]);root.userData={type:'defender'};const shield=mesh(root,new T.SphereGeometry(2,24,12,0,Math.PI*2,0,Math.PI/2),new T.MeshBasicMaterial({color:0x8ad2f0,transparent:true,opacity:.16,wireframe:true,depthWrite:false}));shield.userData.dynamic=true;shield.visible=false;batch(root);return {root,shield,update(t,state={}){turret.rotation.y=Math.sin(t*.5)*.12;shield.visible=!!state.shield;shield.rotation.y=t*.15;}};}
export function hiveFactory(m){const root=new T.Group(),heart=dynamic(root,[0,2.4,0]),nodes=[];orb(heart,m.flesh,[0,0,0],[1.1,1.6,1.1]);mesh(heart,oct,m.purple,[0,0,1],[.45,.8,.3]);for(let i=0;i<6;i++){const a=i*Math.PI/3,x=Math.cos(a)*3,z=Math.sin(a)*3;plate(root,m.armor,[x,.7,z],[.8,1.2,.8]);const node=orb(root,i%2?m.cyan:m.green,[x,1.2,z],[.35,.6,.35]);node.userData.dynamic=true;curve(root,[[0,1.7,0],[x*.5,.4,z*.5],[x,.8,z]],.17,m.flesh);curve(root,[[0,1.8,0],[x*.5,.55,z*.5],[x,1,z]],.055,m.green);nodes.push(node);}for(let i=0;i<8;i++){const a=i*Math.PI/4;curve(heart,[[Math.cos(a)*.5,-1,Math.sin(a)*.5],[Math.cos(a)*1.3,0,Math.sin(a)*1.3],[Math.cos(a)*.75,1.7,Math.sin(a)*.75]],.12,m.armor);}batch(root);return {root,heart,nodes,update(t,state={}){heart.scale.setScalar(1+Math.sin(t*1.7)*.035);for(let i=0;i<nodes.length;i++)nodes[i].scale.setScalar(1+Math.max(0,Math.sin(t*3-i*.75))*(state.pulse?.3:.06));}};}
