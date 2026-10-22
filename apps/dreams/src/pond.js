import * as T from '../assets/vendor/three.module.js';
import {seeded} from './world.js';

// A separate low-cost 3D lily pond shares the homepage renderer, never a second
// WebGL context. Plants and their flowers move together above the water plane.
export function makeThemePond({canvasFactory,seed=4217}={}){
 const scene=new T.Scene(),random=seeded(seed+97),resources=new Set(),groups=[];
 scene.background=new T.Color(0x254b5d);scene.fog=new T.FogExp2(0x2e5364,.012);
 scene.add(new T.HemisphereLight(0xc8d9d4,0x294753,1.6));
 const light=new T.DirectionalLight(0xeed5ba,1.8);light.position.set(20,30,-30);scene.add(light);
 const canvas=canvasFactory(256,256),ctx=canvas.getContext('2d');ctx.fillStyle='#516e79';ctx.fillRect(0,0,256,256);
 for(let k=0;k<1000;k++){ctx.globalAlpha=.08+random()*.15;ctx.fillStyle=['#bcc6c2','#486175','#698c89','#d1bfa4'][k%4];ctx.fillRect(random()*256,random()*256,3+random()*24,.5+random()*3);}
 const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.set(5,5);resources.add(map);
 const sky=new T.Mesh(new T.SphereGeometry(170,24,12),new T.MeshBasicMaterial({map,side:T.BackSide,fog:false}));scene.add(sky);
 const leafMaterial=new T.MeshStandardMaterial({color:0x72977d,roughness:1,map});
 const flowerMaterial=new T.MeshStandardMaterial({color:0xe8bcc5,roughness:1});
 const heartMaterial=new T.MeshStandardMaterial({color:0xd9bb72,roughness:1});
 const leafGeo=new T.CircleGeometry(1,32,.13,Math.PI*1.89),petalGeo=new T.SphereGeometry(1,7,5),heartGeo=new T.SphereGeometry(.12,8,5);
 leafGeo.rotateX(-Math.PI/2);resources.add(leafGeo);resources.add(petalGeo);resources.add(heartGeo);
 for(let k=0;k<50;k++){
  const group=new T.Group(),size=.75+random()*1.65;
  group.position.set((random()-.5)*96,.04,-random()*54+12);group.rotation.y=random()*6.28;
  const leaf=new T.Mesh(leafGeo,leafMaterial);leaf.scale.set(size,1,size*.73);group.add(leaf);
  if(k%3===0){const flower=new T.Group();flower.position.set(size*.32,.09,0);group.add(flower);
   for(let layer=0;layer<2;layer++)for(let n=0;n<9;n++){
    const angle=n/9*Math.PI*2+layer*.28,petal=new T.Mesh(petalGeo,flowerMaterial);
    petal.position.set(Math.cos(angle)*(.19-layer*.06),layer*.09,Math.sin(angle)*(.19-layer*.06));
    petal.scale.set(.22-layer*.05,.055+layer*.04,.085);petal.rotation.set(Math.sin(angle)*.12,-angle,Math.cos(angle)*.12);flower.add(petal);
   }
   const heart=new T.Mesh(heartGeo,heartMaterial);heart.scale.y=.45;heart.position.y=.13;flower.add(heart);
  }
  scene.add(group);groups.push({group,base:group.position.clone(),phase:random()*7});
 }
 // Out-of-frame branches create vertical, recognizable reflections among the
 // horizontal brush marks. They are geometry and obey the reflected camera.
 const branchMaterial=new T.MeshStandardMaterial({color:0x294c51,roughness:1});
 for(let k=0;k<9;k++){
  const trunk=new T.Mesh(new T.CylinderGeometry(.18,.45,14,7),branchMaterial);
  trunk.position.set(-44+k*11,7,-47);trunk.rotation.z=(random()-.5)*.25;scene.add(trunk);
 }
 return{scene,sunPosition:new T.Vector3(20,30,-30),waterSpec:{center:new T.Vector3(0,-.01,-13),width:300,depth:240,color:0x355e70},
  update(t){for(const {group,base,phase}of groups){group.position.set(base.x+Math.sin(t*.22+phase)*.04,base.y+Math.sin(t*.3+phase)*.008,base.z+Math.cos(t*.19+phase)*.04);group.rotation.z=Math.sin(t*.2+phase)*.008;}},
  dispose(){const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());resources.forEach(r=>r.dispose());scene.clear();}
 };
}
