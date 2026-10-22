import * as T from '../assets/three.module.js';
const pink='#ff90b7',cream='#fff3ee';
export function createProp(id,option=''){
  const root=new T.Group(),geometries=new Set(),materials=new Set();
  const mat=(color,roughness=.8)=>{const m=new T.MeshStandardMaterial({color,roughness});materials.add(m);return m;};
  const sphere=new T.SphereGeometry(1,24,16);geometries.add(sphere);
  const add=(geo,m,pos=[0,0,0],scale=[1,1,1])=>{geometries.add(geo);const o=new T.Mesh(geo,m);o.position.set(...pos);o.scale.set(...scale);root.add(o);return o;};
  const color=option.includes('绿')?'#b9cbb0':option.includes('蓝')?'#b8cce9':option.includes('黄')?'#f6da8d':option.includes('棕')?'#bf977b':option.includes('白')?cream:option.includes('灰')?'#bcc5d7':option.includes('红')?'#d96786':pink;
  const cloth=mat(color,.95),white=mat(cream,.92),edge=mat('#f2689c',.67);
  let animated=null;
  if(id==='cloud-bed'||id==='clouds'){
    add(sphere,white,[0,.25,0],[1.4,.3,1]);const rim=add(new T.TorusGeometry(.93,.24,16,48),cloth,[0,.45,0],[1.25,1,.9]);rim.rotation.x=Math.PI/2;
    for(let i=0;i<7;i++){const a=i/7*Math.PI*2;add(sphere,white,[Math.cos(a)*1.08,.26,Math.sin(a)*.76],[.37,.3,.34]);}
  }else if(id==='paw-mug'){
    const points=[[.01,0],[.64,0],[.71,.08],[.72,1.3],[.65,1.4],[.58,1.35],[.58,.16],[.01,.16]].map(p=>new T.Vector2(...p));add(new T.LatheGeometry(points,40),mat(color,.35),[0,.1,0]);const handle=add(new T.TorusGeometry(.38,.105,12,32),edge,[.82,.85,0],[.9,1.2,1]);handle.rotation.y=.04;
    add(sphere,edge,[0,.63,.71],[.19,.17,.035]);for(let i=0;i<3;i++)add(sphere,edge,[(i-1)*.19,.94,.705],[.08,.095,.035]);
  }else if(id==='bow-tote'){
    add(new T.BoxGeometry(1.65,1.55,.5,4,4,2),cloth,[0,.9,0]);for(let i of [-1,1]){const h=add(new T.TorusGeometry(.45,.055,8,28,Math.PI),edge,[0,1.6,i*.17],[.95,1.4,1]);}
    for(let sign of [-1,1]){const bow=add(sphere,edge,[sign*.25,1.04,.3],[.32,.21,.11]);bow.rotation.z=sign*.2;}add(sphere,edge,[0,1.04,.4],[.13,.13,.08]);
  }else if(id==='fish-toy'){
    const body=add(sphere,cloth,[0,.7,0],[.88,.37,.3]);const tail=add(new T.ConeGeometry(.43,.6,3),edge,[-.96,.7,0]);tail.rotation.z=Math.PI/2;
    add(sphere,mat('#4a4255'),[.47,.82,.25],[.045,.045,.025]);add(new T.ConeGeometry(.22,.3,3),edge,[.05,1.07,0]);animated=body;
  }else if(id==='yarn-ball'){
    add(sphere,cloth,[0,.82,0],[.8,.8,.8]);const thread=mat('#fff0f3');for(let i=0;i<15;i++){const ring=add(new T.TorusGeometry(.804,.014,4,72),thread,[0,.82,0]);ring.rotation.set(i*.42,i*.31,i*.13);}
    const curve=new T.CatmullRomCurve3([[.7,.13,0],[1.13,.05,.3],[1.34,.05,.75],[.83,.05,1.16],[.4,.05,1.3]].map(p=>new T.Vector3(...p)));add(new T.TubeGeometry(curve,32,.035,6,false),cloth);animated=root;
  }else if(id==='bow-hoodie'){
    add(sphere,cloth,[0,1,0],[.75,.87,.45]);const hood=add(new T.TorusGeometry(.48,.16,12,36),cloth,[0,1.72,.02]);hood.rotation.x=.25;for(let sign of [-1,1]){const arm=add(new T.CapsuleGeometry(.2,.58,8,16),cloth,[sign*.76,1.12,0]);arm.rotation.z=sign*.6;}add(sphere,edge,[0,1.02,.46],[.24,.15,.055]);
  }else{
    add(sphere,white,[0,.7,0],[.63,.7,.56]);add(sphere,white,[0,1.6,.05],[.7,.62,.58]);for(let sign of [-1,1]){add(new T.ConeGeometry(.24,.45,3),white,[sign*.43,2.16,0]);add(sphere,mat('#504457'),[sign*.23,1.63,.59],[.07,.08,.03]);}add(sphere,edge,[0,1.43,.65],[.09,.06,.035]);
  }
  return {group:root,update(t,play=false){if(play&&animated){animated.rotation.z=Math.sin(t*4)*.2;if(id==='yarn-ball')animated.rotation.x=t*.65;}else if(play)root.rotation.y=Math.sin(t*1.8)*.4;else {root.rotation.y=0;if(animated)animated.rotation.z=0;}},dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());root.removeFromParent();}};
}
