import * as T from '../assets/three.module.js';
// Bake only rigid sibling geometry. Joints, picking proxies, eyes and accessories remain independent.
export function batchModel(model,quality='high'){
  const {group,rig,geometries,materials}=model;group.updateMatrixWorld(true);
  const batches=new Map(),inverse=new T.Matrix4(),world=new T.Matrix4(),normalMatrix=new T.Matrix3(),position=new T.Vector3(),normal=new T.Vector3();
  const isWithin=(object,ancestor)=>{for(let node=object;node;node=node.parent)if(node===ancestor)return true;return false;};
  function anchor(object){
    if(isWithin(object,rig.accessories))return rig.accessories;
    if(quality!=='low')return object.parent;
    for(const node of [rig.eyeL,rig.eyeR,rig.head,rig.armL,rig.armR,rig.tail])if(isWithin(object,node))return node;
    return rig.hips;
  }
  group.traverse(o=>{if(!o.isMesh||o.material.visible===false)return;const bone=anchor(o),variant=o.userData.accessory||'';const key=bone.uuid+variant;if(!batches.has(key))batches.set(key,{bone,variant,objects:[],count:0});const b=batches.get(key);b.objects.push(o);b.count+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)*(o.isInstancedMesh?o.count:1);});
  for(const batch of batches.values()){
    const positions=new Float32Array(batch.count*3),normals=new Float32Array(batch.count*3),colors=new Float32Array(batch.count*3);let offset=0;inverse.copy(batch.bone.matrixWorld).invert();
    for(const object of batch.objects){const geo=object.geometry,count=geo.index?geo.index.count:geo.attributes.position.count;for(let instance=0;instance<(object.isInstancedMesh?object.count:1);instance++){
      const color=object.material.color.clone();if(object.isInstancedMesh){object.getMatrixAt(instance,world);world.premultiply(object.matrixWorld);if(object.instanceColor){const tint=new T.Color();object.getColorAt(instance,tint);color.multiply(tint);}}else world.copy(object.matrixWorld);world.premultiply(inverse);normalMatrix.getNormalMatrix(world);
      for(let i=0;i<count;i++){const index=geo.index?geo.index.getX(i):i;position.fromBufferAttribute(geo.attributes.position,index).applyMatrix4(world);normal.fromBufferAttribute(geo.attributes.normal,index).applyNormalMatrix(normalMatrix);position.toArray(positions,offset);normal.toArray(normals,offset);if(object.material.vertexColors&&geo.attributes.color){colors[offset]=color.r*geo.attributes.color.getX(index);colors[offset+1]=color.g*geo.attributes.color.getY(index);colors[offset+2]=color.b*geo.attributes.color.getZ(index);}else color.toArray(colors,offset);offset+=3;}
    }object.removeFromParent();}
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));geometry.setAttribute('normal',new T.BufferAttribute(normals,3));geometry.setAttribute('color',new T.BufferAttribute(colors,3));geometry.computeBoundingSphere();const mat=new T.MeshStandardMaterial({vertexColors:true,roughness:[rig.eyeL,rig.eyeR].includes(batch.bone)?.18:.94});const mesh=new T.Mesh(geometry,mat);if(batch.variant){mesh.userData.accessory=batch.variant;mesh.visible=batch.objects.some(o=>o.visible);}batch.bone.add(mesh);geometries.add(geometry);materials.add(mat);
  }
  const usedG=new Set(),usedM=new Set();group.traverse(o=>{if(o.isMesh){usedG.add(o.geometry);usedM.add(o.material);}});for(const g of geometries)if(!usedG.has(g)){g.dispose();geometries.delete(g);}for(const m of materials)if(!usedM.has(m)){m.dispose();materials.delete(m);}return model;
}
