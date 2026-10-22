import * as THREE from '../assets/three.module.js';
import { seededRandom } from './scene-config.js';
import { floorVertex, floorFragment } from './shaders.js';

export class ForegroundScene {
  constructor(){
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(46,1,.1,200);
    this.camera.position.set(0,7,24);this.camera.lookAt(0,4,-10);
    this.random=seededRandom();this.moving=[];this.lights=[];this.disposables=[];
    this.scene.add(new THREE.AmbientLight(0x7397ca,1.25));
    const blue=new THREE.DirectionalLight(0x88cfff,2.7);blue.position.set(8,15,8);this.scene.add(blue);
    const purple=new THREE.DirectionalLight(0xa58aff,2.6);purple.position.set(14,7,-10);this.scene.add(purple);
    const fill=new THREE.DirectionalLight(0x2f668c,.8);fill.position.set(-10,4,5);this.scene.add(fill);
    this.mat={
      hull:new THREE.MeshStandardMaterial({color:0x182438,metalness:.85,roughness:.5}),
      dark:new THREE.MeshStandardMaterial({color:0x090f1b,metalness:.8,roughness:.65}),
      edge:new THREE.MeshStandardMaterial({color:0x40546b,metalness:.78,roughness:.37}),
      suit:new THREE.MeshStandardMaterial({color:0xa1acb9,metalness:.32,roughness:.65}),
      suitShadow:new THREE.MeshStandardMaterial({color:0x445468,metalness:.4,roughness:.65}),
      visor:new THREE.MeshStandardMaterial({color:0x101b32,metalness:.96,roughness:.14}),
      cyan:new THREE.MeshBasicMaterial({color:0x6cd8ff}),
      blue:new THREE.MeshBasicMaterial({color:0x357dad}),
      purple:new THREE.MeshBasicMaterial({color:0xb69cff}),
      glass:new THREE.MeshPhysicalMaterial({color:0x235470,metalness:.5,roughness:.2,transparent:true,opacity:.20,depthWrite:false,side:THREE.DoubleSide})
    };
    this.buildDeck();this.buildStation();this.buildAstronaut();this.buildShips();this.buildDebris();
    this.ships.forEach(s=>this.mergeStatic(s.object,new Set(this.moving.filter(m=>m.type==='engine').map(m=>m.object))));
    this.mergeStatic(this.astronautBody);
    this.mergeStatic(this.astronaut,new Set([this.astronautBody]));
    this.mergeStatic(this.stationRing,new Set([this.stationWindows]));
    this.mergeStatic(this.scene,new Set([this.astronaut,this.stationRing,...this.ships.map(s=>s.object),this.debris]));
  }
  mergeStatic(root,excluded=new Set()){
    root.updateWorldMatrix(true,true);
    const inverse=root.matrixWorld.clone().invert();const batches=new Map();const old=[];
    const visit=o=>{
      if(excluded.has(o))return;
      if(o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && !o.material.isShaderMaterial){
        const geometry=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld));
        if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material).push(geometry);old.push(o);
      }
      [...o.children].forEach(visit);
    };[...root.children].forEach(visit);
    old.forEach(m=>{m.removeFromParent();m.geometry.dispose();});
    batches.forEach((geos,mat)=>{
      const merged=new THREE.BufferGeometry();
      for(const name of ['position','normal','uv']){
        const size=name==='uv'?2:3;const len=geos.reduce((n,g)=>n+(g.getAttribute(name)?.array.length||0),0);if(!len)continue;
        const array=new Float32Array(len);let offset=0;geos.forEach(g=>{const a=g.getAttribute(name);if(a){array.set(a.array,offset);offset+=a.array.length;}});merged.setAttribute(name,new THREE.BufferAttribute(array,size));
      }
      merged.computeBoundingSphere();root.add(new THREE.Mesh(merged,mat));geos.forEach(g=>g.dispose());
    });
  }
  mesh(geometry,material,parent=this.scene,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);parent.add(m);return m;}
  box(w,h,d,mat,parent,x,y,z){return this.mesh(new THREE.BoxGeometry(w,h,d),mat,parent,x,y,z);}
  cylinder(r1,r2,h,mat,parent,x,y,z,sides=12){return this.mesh(new THREE.CylinderGeometry(r1,r2,h,sides),mat,parent,x,y,z);}
  beam(a,b,r,mat,parent){const d=new THREE.Vector3().subVectors(b,a);const m=this.cylinder(r,r,d.length(),mat,parent,...new THREE.Vector3().addVectors(a,b).multiplyScalar(.5).toArray(),6);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return m;}
  buildDeck(){
    this.floorMaterial=new THREE.ShaderMaterial({vertexShader:floorVertex,fragmentShader:floorFragment,uniforms:{uTime:{value:0}}});
    const floor=this.mesh(new THREE.PlaneGeometry(160,55),this.floorMaterial,this.scene,0,-1,9);floor.rotation.x=-Math.PI/2;
    // Faceted deck plates have individual brushed edges and inset luminous strips.
    for(let i=-12;i<=12;i++){
      const x=i*3.8;
      this.box(.035,.02,55,this.mat.edge,this.scene,x,-.98,9);
      if(i%3===0)this.box(.045,.025,18,this.mat.blue,this.scene,x+.12,-.96,7);
    }
    for(let z=-18;z<30;z+=5){this.box(110,.025,.022,this.mat.edge,this.scene,0,-.97,z);}
    // Railing with two independent height runs and offset structural supports.
    for(const y of [.45,1.48]){
      this.box(60,.10,.16,this.mat.edge,this.scene,0,y,-12);
      this.box(60,.027,.19,this.mat.blue,this.scene,0,y+.045,-11.98);
    }
    this.box(60,.65,.35,this.mat.dark,this.scene,0,-.55,-11.9);
    for(let x=-28;x<29;x+=2.9){
      this.box(.14,2.55,.18,this.mat.edge,this.scene,x,.15,-12);
      this.box(2.7,.85,.025,this.mat.glass,this.scene,x+1.45,.65,-11.98);
      this.box(.04,.5,.05,this.mat.cyan,this.scene,x+.10,-.12,-11.79);
      this.beam(new THREE.Vector3(x,-.9,-11.9),new THREE.Vector3(x+.7,.65,-11.9),.045,this.mat.hull,this.scene);
    }
    // Foreground portal structures are asymmetric, with long inset seams.
    for(const side of [-1,1]){
      const g=new THREE.Group();this.scene.add(g);g.position.set(side*20,-.2,0);
      const p=this.box(7,2.0,12,this.mat.hull,g,0,0,0);p.rotation.z=side*.09;
      this.box(7,.12,11.5,this.mat.edge,g,0,1.04,0);
      for(let j=0;j<11;j++){
        this.box(.12,1.25,.6,this.mat.dark,g,-2.5+j*.5,.25,5.8);
        this.box(.15,.026,7,this.mat.blue,g,-2.5+j*.5,1.12,0);
      }
      const arm=this.box(1.1,15,1.7,this.mat.dark,g,side*2.5,6,-7);arm.rotation.z=-side*.1;
      this.box(.09,14,.04,this.mat.blue,g,side*2.1,6.1,-6.1);
      for(let k=0;k<5;k++)this.box(1.9,.18,2.2,this.mat.edge,g,side*2.3,2+k*2.4,-7);
    }
    // Upper-left angled observation portal.
    const beam=this.box(11,1.5,2.8,this.mat.dark,this.scene,-18,18,-6);beam.rotation.z=-.32;
    const stripe=this.box(12,.04,2.85,this.mat.blue,this.scene,-18,17.42,-6);stripe.rotation.z=-.32;
  }
  buildStation(){
    const station=new THREE.Group();station.position.set(29,13,-24);station.rotation.set(.35,-.28,-.2);this.scene.add(station);this.station=station;
    const ring=new THREE.Group();ring.rotation.x=1.06;station.add(ring);this.stationRing=ring;
    this.mesh(new THREE.TorusGeometry(9.1,.72,8,128),this.mat.hull,ring);
    this.mesh(new THREE.TorusGeometry(9.83,.075,5,160),this.mat.edge,ring);
    this.mesh(new THREE.TorusGeometry(8.46,.045,5,160),this.mat.cyan,ring);
    this.mesh(new THREE.TorusGeometry(9.15,.89,4,112),new THREE.MeshBasicMaterial({color:0x23455d,wireframe:true,transparent:true,opacity:.45}),ring);
    const windowCount=560;const geo=new THREE.BoxGeometry(.09,.21,.04);const lights=new THREE.InstancedMesh(geo,this.mat.cyan,windowCount);let index=0;const dummy=new THREE.Object3D();
    for(let row=0;row<4;row++)for(let i=0;i<140;i++){
      const a=i/140*Math.PI*2;dummy.position.set(Math.cos(a)*(8.9+row*.15),Math.sin(a)*(8.9+row*.15),.55+row*.055);dummy.rotation.set(0,0,a-Math.PI/2);dummy.updateMatrix();lights.setMatrixAt(index,dummy.matrix);lights.setColorAt(index,new THREE.Color().setRGB(.12+this.random()*.35,.35+this.random()*.5,.65+this.random()*.35));index++;
    }ring.add(lights);this.stationWindows=lights;this.stationColors=lights.instanceColor.array.slice();this.windowColor=new THREE.Color();
    for(let i=0;i<36;i++){
      const a=i/36*Math.PI*2;const x=Math.cos(a),y=Math.sin(a);
      const plate=this.box(.45,1.85,.4,this.mat.edge,ring,x*9.2,y*9.2,.35);plate.rotation.z=a-Math.PI/2;
      this.box(.18,.05,.12,this.mat.blue,plate,0,.55,.25);
      if(i%6===0){
        this.beam(new THREE.Vector3(x*2,y*2,0),new THREE.Vector3(x*8.5,y*8.5,0),.18,this.mat.edge,ring);
        this.beam(new THREE.Vector3(x*2.2,y*2.2,.4),new THREE.Vector3(x*8.5,y*8.5,.45),.035,this.mat.blue,ring);
      }
    }
    this.cylinder(1.3,1.8,5,this.mat.hull,station,0,0,0,12);
    // Large modular tower under the orbital ring.
    const tower=new THREE.Group();this.scene.add(tower);tower.position.set(21,-.5,-19);tower.rotation.y=-.34;
    this.box(5.7,23,5.2,this.mat.dark,tower,0,10,0);
    for(let level=0;level<20;level++){
      const y=level*1.05;
      this.box(6.1,.20,5.7,this.mat.edge,tower,0,y,0);
      this.box(6.2,.027,5.8,this.mat.blue,tower,0,y+.11,0);
      for(let col=0;col<8;col++){
        this.box(.38,.22,.025,level%5===0?this.mat.purple:this.mat.cyan,tower,-2.55+col*.73,y+.44,2.61);
        this.box(.025,.24,.38,this.mat.blue,tower,-2.88,y+.44,-2.1+col*.6);
      }
      if(level%4===0){
        this.box(8.5,.8,6.5,this.mat.hull,tower,.8,y-.12,0);
        this.box(8.5,.05,6.6,this.mat.blue,tower,.8,y+.3,0);
      }
    }
    for(let j=-1;j<=1;j+=2){
      this.box(.5,24,.7,this.mat.edge,tower,j*2.6,10,3);
      this.box(.035,24,.1,this.mat.cyan,tower,j*2.3,10,3.2);
    }
    this.beam(new THREE.Vector3(18,-1,-17),new THREE.Vector3(14,7,-17),.24,this.mat.edge,this.scene);
    this.beam(new THREE.Vector3(20,-1,-15),new THREE.Vector3(15,5,-15),.14,this.mat.hull,this.scene);
    // Docking gantry reaching into the right foreground.
    const gantry=this.box(13,.8,3.5,this.mat.hull,this.scene,19,2.3,-9);gantry.rotation.y=-.22;
    this.box(13,.055,.04,this.mat.cyan,gantry,0,.42,1.77);
    for(let i=-5;i<7;i++)this.box(.2,.8,3.7,this.mat.edge,gantry,i,0,0);
  }
  capsule(radius,length,material,parent,x,y,z){return this.mesh(new THREE.CapsuleGeometry(radius,length,5,10),material,parent,x,y,z);}
  buildAstronaut(){
    const g=new THREE.Group();g.position.set(-3.8,-1,-4.2);g.rotation.y=-.13;g.scale.setScalar(1.23);this.scene.add(g);this.astronaut=g;
    const body=new THREE.Group();g.add(body);this.astronautBody=body;
    this.capsule(.57,.87,this.mat.suit,body,0,2.23,0);
    this.cylinder(.52,.54,.16,this.mat.suitShadow,body,0,1.64,0);
    const helmet=this.mesh(new THREE.SphereGeometry(.56,24,16),this.mat.suit,body,0,3.25,0);helmet.scale.set(1,1.07,1);
    const visor=this.mesh(new THREE.SphereGeometry(.533,24,16),this.mat.visor,body,0,3.29,-.065);visor.scale.set(1,.78,1.02);
    this.mesh(new THREE.TorusGeometry(.54,.025,6,32),this.mat.edge,body,0,3.26,.0).rotation.x=Math.PI/2;
    this.cylinder(.37,.42,.13,this.mat.suitShadow,body,0,2.83,0);
    // Rear backpack: panelled shell, carrying rails and independent life-support ring.
    this.box(.98,1.24,.46,this.mat.suitShadow,body,0,2.22,.53);
    this.box(.78,1.08,.13,this.mat.suit,body,0,2.23,.80);
    this.box(.55,.60,.035,this.mat.hull,body,0,2.31,.883);
    this.mesh(new THREE.TorusGeometry(.19,.035,6,32),this.mat.cyan,body,0,2.35,.92);
    this.mesh(new THREE.CircleGeometry(.14,24),this.mat.visor,body,0,2.35,.921);
    this.box(.36,.06,.02,this.mat.blue,body,0,1.87,.89);
    this.box(.32,.035,.03,this.mat.edge,body,0,2.71,.89);
    for(const side of [-1,1]){
      this.cylinder(.10,.10,.94,this.mat.edge,body,side*.47,2.18,.58,10);
      this.capsule(.22,.64,this.mat.suit,body,side*.71,2.21,.02).rotation.z=side*.12;
      this.capsule(.19,.56,this.mat.suit,body,side*.85,1.54,.09).rotation.z=side*.09;
      this.cylinder(.2,.2,.15,this.mat.suitShadow,body,side*.84,1.64,.09);
      this.capsule(.19,.14,this.mat.suitShadow,body,side*.89,1.12,.12);
      this.box(.27,.07,.06,this.mat.cyan,body,side*.72,2.60,.18);
      this.capsule(.25,.61,this.mat.suit,g,side*.30,1.18,0);
      this.capsule(.235,.62,this.mat.suit,g,side*.34,.51,.04);
      this.cylinder(.24,.24,.15,this.mat.suitShadow,g,side*.33,.8,.03);
      this.box(.3,.22,.10,this.mat.suitShadow,g,side*.34,.68,.24);
      this.box(.45,.22,.76,this.mat.suitShadow,g,side*.35,.105,-.1);
      this.box(.46,.06,.78,this.mat.dark,g,side*.35,.02,-.1);
      for(let j=0;j<3;j++)this.box(.35,.025,.02,this.mat.edge,g,side*.34,.25+j*.1,.285);
    }
    // A fine life-support hose curls around one side.
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(.4,2.3,.7),new THREE.Vector3(.64,1.7,.6),new THREE.Vector3(.65,1.5,.15),new THREE.Vector3(.46,1.7,-.1)]);
    this.mesh(new THREE.TubeGeometry(curve,24,.046,6,false),this.mat.edge,body);
    const shadowMat=new THREE.MeshBasicMaterial({color:0x01050b,transparent:true,opacity:.8,depthWrite:false});
    const shadow=this.mesh(new THREE.CircleGeometry(.8,24),shadowMat,this.scene,-3.8,-.97,-4.2);shadow.rotation.x=-Math.PI/2;shadow.scale.set(1,1.5,1);this.astronautShadow=shadow;
  }
  makeShip(scale=1){
    const g=new THREE.Group();
    const shape=new THREE.Shape();shape.moveTo(-2.4,-.28);shape.lineTo(-1.9,.26);shape.lineTo(.9,.28);shape.lineTo(2.8,-.03);shape.lineTo(1.6,-.2);shape.lineTo(-2.4,-.28);
    const geom=new THREE.ExtrudeGeometry(shape,{depth:.52,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.08,bevelThickness:.08});
    this.mesh(geom,this.mat.hull,g,0,0,-.26);
    this.box(2.6,.18,.72,this.mat.edge,g,-.45,.33,0);
    this.box(1.3,.21,.45,this.mat.dark,g,.15,.49,0);
    for(let j=0;j<14;j++){
      this.box(.08,.06,.025,this.mat.cyan,g,-1.85+j*.26,.18,.36);
      this.box(.04,.28,.76,this.mat.dark,g,-1.8+j*.25,-.04,0);
    }
    const wing=this.box(1.6,.10,2.6,this.mat.hull,g,-.95,-.1,0);wing.rotation.y=-.20;
    for(const z of [-.85,.85]){
      const engine=this.cylinder(.22,.18,1.4,this.mat.edge,g,-1.2,-.12,z,8);engine.rotation.z=Math.PI/2;
      const core=this.mesh(new THREE.CircleGeometry(.16,12),this.mat.purple,g,-1.92,-.12,z);core.rotation.y=-Math.PI/2;
      const trailMat=new THREE.MeshBasicMaterial({color:0x9889ff,transparent:true,opacity:.2,depthWrite:false,side:THREE.DoubleSide});
      const trail=this.mesh(new THREE.ConeGeometry(.16,6,8,1,true),trailMat,g,-4.9,-.12,z);trail.rotation.z=-Math.PI/2;
      this.moving.push({type:'engine',object:trail,phase:this.random()*6});
    }
    g.scale.setScalar(scale);return g;
  }
  buildShips(){
    this.ships=[];
    const paths=[[-5.5,5.4,-20,1.15],[8,7,-36,.46],[-15,8.2,-39,.35],[12,3.7,-21,.4],[-5,12,-55,.28]];
    paths.forEach((p,i)=>{const ship=this.makeShip(p[3]);this.scene.add(ship);ship.position.set(...p.slice(0,3));ship.rotation.set(.02,-.12,i===0?.035:-.04);this.ships.push({object:ship,baseX:p[0],baseY:p[1],speed:.25+i*.08,phase:i*1.7});});
  }
  buildDebris(){
    // World-space orbital fragments complement the lensing pass.
    const geom=new THREE.IcosahedronGeometry(.06,0);const mat=new THREE.MeshStandardMaterial({color:0x62708b,roughness:.9,metalness:.5});
    this.debris=new THREE.InstancedMesh(geom,mat,70);this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.scene.add(this.debris);this.dummy=new THREE.Object3D();
  }
  resize(w,h){this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.mobile=w<768;this.astronaut.visible=true;this.astronaut.scale.setScalar(this.mobile?.72:1.23);this.astronaut.position.x=this.mobile?3.3:-3.8;this.astronautShadow.position.x=this.astronaut.position.x;}
  update(t,mouse,approach,quality,blackHole=null){
    const holeX=blackHole?.x??(this.mobile?.65:.69),holeY=blackHole?.y??(this.mobile?.74:.69),holeRadius=blackHole?.core??(this.mobile?this.camera.aspect*.125:.11);
    this.floorMaterial.uniforms.uTime.value=t;
    this.camera.position.x=mouse.x*.19;this.camera.position.y=7+mouse.y*.10;
    this.camera.lookAt(mouse.x*.03,4,-10);this.camera.updateMatrixWorld();
    this.astronautBody.position.y=Math.sin(t*1.04)*.018;
    this.mat.cyan.color.setRGB(.36+.04*Math.sin(t*1.8),.76+.045*Math.sin(t*.8),1.);
    this.mat.purple.color.setRGB(.60+.1*Math.sin(t*2.8),.43+.08*Math.sin(t*1.9),1.);
    this.stationRing.rotation.z=Math.sin(t*.015)*.025;
    for(let i=0;i<this.stationWindows.count;i++){
      const energy=.70+.28*Math.sin(t*.72+Math.floor(i/18)*.8);
      this.windowColor.setRGB(this.stationColors[i*3]*energy,this.stationColors[i*3+1]*energy,this.stationColors[i*3+2]*energy);
      this.stationWindows.setColorAt(i,this.windowColor);
    }this.stationWindows.instanceColor.needsUpdate=true;
    this.ships.forEach((ship,i)=>{
      ship.object.visible=i<(quality==='low'?3:5);
      ship.object.position.x=ship.baseX+((t*ship.speed+ship.phase)%32)-5;
      ship.object.position.y=ship.baseY+Math.sin(t*.07+ship.phase)*.35;
      const projected=ship.object.position.clone().project(this.camera);
      if(Math.hypot((projected.x*.5-(holeX-.5))*this.camera.aspect,projected.y*.5-(holeY-.5))<holeRadius+.05)ship.object.visible=false;
    });
    this.moving.forEach(v=>{v.object.scale.y=.9+.12*Math.sin(t*2.7+v.phase);v.object.material.opacity=.13+.05*Math.sin(t*3.+v.phase);});
    const count=quality==='low'?25:70;this.debris.count=count;
    for(let i=0;i<count;i++){
      const phase=(i*.618+t*(.03+(i%5)*.009))%1;
      const a=phase*Math.PI*2.8+i*.23;
      const r=6.5-phase*3.2+(i%3)*.3;
      const mobileScale=this.mobile?.5:1;
      const centerX=12.5*this.camera.aspect/(1920/1080)*(this.mobile?.15/.19:1);
      this.dummy.position.set(centerX+Math.cos(a)*r*1.65*mobileScale,(this.mobile?12.:10.1)+Math.sin(a)*r*.48*mobileScale,-20-Math.sin(a)*1.3);

      const screenPosition=this.dummy.position.clone().project(this.camera);
      const coreDistance=Math.hypot((screenPosition.x*.5-(holeX-.5))*this.camera.aspect,screenPosition.y*.5-(holeY-.5));
      const fragmentScale=coreDistance<holeRadius+.006?0:1;
      this.dummy.rotation.set(t*.3+i,t*.2+i,0);
      this.dummy.scale.setScalar((.2+(i%5)*.27)*fragmentScale*(1-phase)*Math.sin(phase*Math.PI));this.dummy.updateMatrix();this.debris.setMatrixAt(i,this.dummy.matrix);
    }this.debris.instanceMatrix.needsUpdate=true;
    this.scene.visible=approach<.75;
  }
  dispose(){
    const geometries=new Set(),materials=new Set();this.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.scene.clear();
  }
}
