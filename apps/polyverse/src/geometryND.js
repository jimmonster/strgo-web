export const axisNames = ['X','Y','Z','W','V','U'];
export function hypercube(n) {
 const vertices = Array.from({length:2**n},(_,id)=>Array.from({length:n},(_,i)=>(id>>i&1)?1:-1));
 const edges=[];for(let i=0;i<vertices.length;i++)for(let a=0;a<n;a++){const j=i^(1<<a);if(i<j)edges.push([i,j]);}
 return {vertices,edges};
}
export function planes(n){const p=[];for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)p.push(axisNames[a]+axisNames[b]);return p;}
export function rotate(vertices,angles){return vertices.map(original=>{const v=original.slice();for(const [plane,angle] of Object.entries(angles)){const a=axisNames.indexOf(plane[0]),b=axisNames.indexOf(plane[1]);if(a<0||b<0||a>=v.length||b>=v.length)continue;const x=v[a],y=v[b],c=Math.cos(angle),s=Math.sin(angle);v[a]=x*c-y*s;v[b]=x*s+y*c;}return v;});}
export function project(vertices,n,mode='perspective'){
 return vertices.map(v=>{let p=v.slice(),bound=Math.sqrt(n);while(p.length>3){const d=3*bound;const factor=mode==='orthographic'?1:d/Math.max(0.001,d-p.at(-1));p=p.slice(0,-1).map(x=>x*factor);bound=bound*d/(d-bound);}while(p.length<3)p.push(0);return p;});
}
export function slice4(vertices,edges,c){
 const points=[],eps=1e-8;const add=p=>{if(!points.some(q=>q.every((x,i)=>Math.abs(x-p[i])<eps)))points.push(p.slice(0,3));};
 for(const [ia,ib] of edges){const a=vertices[ia],b=vertices[ib],da=a[3]-c,db=b[3]-c;if(Math.abs(da)<eps)add(a);if(Math.abs(db)<eps)add(b);if(da*db< -eps*eps){const t=-da/(db-da);add(a.map((x,i)=>x+t*(b[i]-x)));}}
 if(!points.length)return {points,rank:-1};let rank=0;const basis=[];for(const p of points.slice(1)){let v=p.map((x,i)=>x-points[0][i]);for(const b of basis){const d=v.reduce((s,x,i)=>s+x*b[i],0);v=v.map((x,i)=>x-d*b[i]);}const l=Math.hypot(...v);if(l>eps){basis.push(v.map(x=>x/l));rank++;}if(rank===3)break;}
 return {points,rank};
}
export function fractalInstances(type,level){
 const t=[[1,1,1],[-1,-1,1],[-1,1,-1],[1,-1,-1]];let instances=[{position:[0,0,0],scale:1}];
 for(let k=0;k<level;k++){const next=[];for(const node of instances){if(type==='sierpinski'){for(const v of t)next.push({position:v.map((x,i)=>node.position[i]+x*node.scale/2),scale:node.scale/2});}else{for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){if([x,y,z].filter(a=>a===0).length>=2)continue;next.push({position:[x,y,z].map((a,i)=>node.position[i]+a*node.scale*2/3),scale:node.scale/3});}}}instances=next;}
 return instances;
}
