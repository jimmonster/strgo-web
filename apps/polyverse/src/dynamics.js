const copy=b=>b.map(x=>({...x,p:x.p.slice(),v:x.v.slice(),a:[0,0,0],trail:[]}));
export function initialBodies(orbital=false){
 if(orbital)return [{id:0,m:20,p:[0,0,0],v:[0,0,0]},{id:1,m:0.12,p:[3,0,0],v:[0,0.8,2.43]},{id:2,m:0.18,p:[-5,0,0],v:[0,0.8,-1.82]},{id:3,m:0.08,p:[0,0,7],v:[1.65,0.33,0]}];
 return [{id:0,m:6,p:[0,0,0],v:[0,-0.02,-0.08]},{id:1,m:0.8,p:[3.2,0,0],v:[0,0.18,1.25]},{id:2,m:0.4,p:[-5,0.8,0],v:[0,0.1,-1.12]}];
}
export function accelerations(bodies,G=1,epsilon=0.18){const a=bodies.map(()=>[0,0,0]);for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){const r=bodies[j].p.map((x,k)=>x-bodies[i].p[k]),s2=r.reduce((s,x)=>s+x*x,epsilon*epsilon),f=G/s2**1.5;for(let k=0;k<3;k++){a[i][k]+=r[k]*f*bodies[j].m;a[j][k]-=r[k]*f*bodies[i].m;}}return a;}
export function energy(b,G=1,e=0.18){let K=0,U=0;for(let i=0;i<b.length;i++){K+=0.5*b[i].m*b[i].v.reduce((s,x)=>s+x*x,0);for(let j=i+1;j<b.length;j++)U-=G*b[i].m*b[j].m/Math.sqrt(b[i].p.reduce((s,x,k)=>s+(x-b[j].p[k])**2,e*e));}return {K,U,total:K+U};}
export class Dynamics {
 constructor(initial=initialBodies(),settings={}){this.dt=1/120;this.settings={G:1,epsilon:0.18,speed:1,...settings};this.initial=copy(initial);this.reset();}
 reset(){this.bodies=copy(this.initial);this.time=0;this.tick=0;this.accumulator=0;this.rebaseline();}
 rebaseline(){const a=accelerations(this.bodies,this.settings.G,this.settings.epsilon);this.bodies.forEach((b,i)=>{b.a=a[i];b.trail=[];});this.baseline=energy(this.bodies,this.settings.G,this.settings.epsilon).total;this.accumulator=0;}
 step(){const dt=this.dt;for(const b of this.bodies)for(let k=0;k<3;k++){b.v[k]+=b.a[k]*dt/2;b.p[k]+=b.v[k]*dt;}const a=accelerations(this.bodies,this.settings.G,this.settings.epsilon);this.bodies.forEach((b,i)=>{for(let k=0;k<3;k++)b.v[k]+=a[i][k]*dt/2;b.a=a[i];});this.tick++;this.time=this.tick*dt;if(this.tick%4===0)for(const b of this.bodies){b.trail.push(b.p.slice());if(b.trail.length>1024)b.trail.shift();}}
 advance(realSeconds){this.accumulator+=Math.min(realSeconds,1/15)*this.settings.speed;let steps=0;while(this.accumulator+1e-12>=this.dt&&steps<16){this.step();this.accumulator-=this.dt;steps++;}this.slow=this.accumulator>=this.dt;if(this.slow)this.accumulator=0;return steps;}
 stats(){const e=energy(this.bodies,this.settings.G,this.settings.epsilon);return {...e,error:Math.abs(this.baseline)<1e-8?e.total-this.baseline:(e.total-this.baseline)/Math.abs(this.baseline),absolute:Math.abs(this.baseline)<1e-8,time:this.time};}
}
