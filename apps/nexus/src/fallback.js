import {seededRandom} from './scene-config.js';
// Explicit emergency path; the normal renderer is the WebGL lensing composite.
export class FallbackScene {
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');const r=seededRandom();this.stars=Array.from({length:500},()=>({x:r(),y:r(),r:r()*1.2+.2,p:r()*6}));}
  resize(w,h){this.w=w;this.h=h;this.canvas.width=w;this.canvas.height=h;}
  render(t,approach=0,fade=0){
    const c=this.ctx,w=this.w,h=this.h;c.fillStyle='#030711';c.fillRect(0,0,w,h);
    const cloud=c.createRadialGradient(w*.7,h*.3,0,w*.7,h*.3,w*.65);cloud.addColorStop(0,'#231a42');cloud.addColorStop(.5,'#0c1730');cloud.addColorStop(1,'#030711');c.fillStyle=cloud;c.fillRect(0,0,w,h);
    for(const s of this.stars){c.fillStyle=`rgba(186,218,255,${.25+.35*(.5+.5*Math.sin(t*.6+s.p))})`;c.beginPath();c.arc((s.x*w+t*.4)%w,s.y*h,s.r,0,Math.PI*2);c.fill();}
    const pr=h*.44,px=w*.21,py=h*.4;const planet=c.createRadialGradient(px+pr*.4,py-pr*.4,0,px,py,pr);planet.addColorStop(0,'#244763');planet.addColorStop(.75,'#0b2137');planet.addColorStop(1,'#030a16');c.fillStyle=planet;c.beginPath();c.arc(px,py,pr,0,Math.PI*2);c.fill();c.strokeStyle='#5187b961';c.lineWidth=2;c.stroke();
    const x=w*(w<768?.65:.69),y=h*(w<768?.26:.31),r=(w<768?w*.125:h*.11)*(1+approach*approach*16);
    c.save();c.translate(x,y);c.rotate(-.24);
    for(let side=0;side<2;side++){
      for(let i=35;i>=0;i--){const rad=r*(1.04+i*.06);c.beginPath();c.ellipse(0,0,rad*1.8,rad*.28,0,side?0:Math.PI,side?Math.PI:Math.PI*2);c.strokeStyle=`rgba(${150+i*2},${125+i*2},255,${.16+i*.003})`;c.lineWidth=1.2+Math.sin(t*(.15+i*.002)+i)*.3;c.stroke();}
      if(!side){c.fillStyle='#000005';c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.fill();}
    }
    c.fillStyle='#000005';c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.fill();c.strokeStyle='#c2c7ff';c.lineWidth=2;c.stroke();
    for(let i=0;i<45;i++){const a=i*.618*6.28+t*(.06+i%3*.013);const rr=r*(1.25+(i%8)*.18);c.fillStyle='#bda1e8';c.beginPath();c.arc(Math.cos(a)*rr*1.5,Math.sin(a)*rr*.3,Math.max(.4,1.4-i%4*.3),0,Math.PI*2);c.fill();}
    c.restore();if(fade){c.fillStyle=`rgba(0,3,9,${fade})`;c.fillRect(0,0,w,h);}
  }
}
