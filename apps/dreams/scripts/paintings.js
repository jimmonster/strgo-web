/* Original deterministic Canvas paintings. No source photographs or AI images. */
window.paintDream = function(canvas, kind='hero', seed=4217, film=false) {
 const c=canvas.getContext('2d'), W=canvas.width,H=canvas.height;
 let state=seed>>>0;const r=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
 const mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
 const rgb=(a,alpha=1)=>`rgba(${a.map(v=>Math.max(0,Math.min(255,Math.round(v)))).join(',')},${alpha})`;
 const jitter=(a,n=20)=>a.map(v=>v+(r()-.5)*n);
 const path=(points,fill,stroke,lw=1)=>{c.beginPath();points.forEach((p,i)=>i?c.lineTo(p[0]*W,p[1]*H):c.moveTo(p[0]*W,p[1]*H));if(fill){c.closePath();c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke();}};
 const dab=(x,y,w,h,col,a=1,rot=0)=>{c.save();c.translate(x,y);c.rotate(rot);c.fillStyle=typeof col==='string'?col:rgb(col,a);c.beginPath();c.moveTo(-w*.5,-h*.35);c.lineTo(-w*.1,-h*.53);c.lineTo(w*.5,-h*.28);c.lineTo(w*.42,h*.33);c.lineTo(-w*.4,h*.48);c.closePath();c.fill();c.restore();};
 const ellipse=(x,y,rx,ry,col,rot=0)=>{c.fillStyle=col;c.beginPath();c.ellipse(x,y,rx,ry,rot,0,Math.PI*2);c.fill();};
 const gradient=(stops)=>{const g=c.createLinearGradient(0,0,0,H);for(const [s,col]of stops)g.addColorStop(s,col);c.fillStyle=g;c.fillRect(0,0,W,H);};
 function sky(warm=false,storm=false){
  gradient(storm?[[0,'#5c7681'],[.55,'#b1b5ad'],[1,'#63847e']]:warm?[[0,'#777e9c'],[.3,'#d59a89'],[.56,'#f1c995'],[1,'#6e9294']]:[[0,'#a8becb'],[.28,'#d9c8be'],[.55,'#efd8b2'],[1,'#527f7e']]);
  for(let i=0;i<11000;i++){const x=r()*W,y=r()*H*.68;const t=y/H;const p=storm?[mix([98,124,135],[202,196,179],t),[128,153,164],[164,172,168]]:warm?[[221,156,133],[239,193,156],[134,147,170],[181,165,174]]:[[205,202,194],[240,218,184],[170,189,202],[187,177,187],[152,173,190]];dab(x,y,(8+r()*40)*W/2000,(2+r()*9)*H/760,jitter(p[Math.floor(r()*p.length)]),.18+r()*.24,(r()-.5)*.3);}
 }
 function sun(x=.83,y=.2){const rad=Math.min(W,H)*.073;const glow=c.createRadialGradient(W*x,H*y,0,W*x,H*y,rad*3.9);glow.addColorStop(0,'#fff1c7c0');glow.addColorStop(.3,'#f8ddb46a');glow.addColorStop(1,'#f2d8ad00');c.fillStyle=glow;c.fillRect(0,0,W,H);ellipse(W*x,H*y,rad,rad,'#f8e8bf');for(let i=0;i<120;i++)dab(W*x+(r()-.5)*rad*2,H*y+(r()-.5)*rad*1.8,4+r()*12,2+r()*4,[255,241,200],.25);}
 function mountain(cx=.66,top=.13,base=.64,red=false){
  const pts=[[cx-.26,base],[cx-.19,base-.12],[cx-.12,base-.23],[cx-.032,top+.017],[cx+.008,top],[cx+.035,top+.012],[cx+.13,base-.22],[cx+.23,base-.08],[cx+.3,base]];
  path(pts,red?'#ad625b':'#899bb6');c.save();c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p[0]*W,p[1]*H):c.moveTo(p[0]*W,p[1]*H));c.closePath();c.clip();
  for(let i=0;i<6500;i++){const x=(cx-.28+r()*.57)*W,y=(top+r()*(base-top))*H;const light=x/W<cx;dab(x,y,4+r()*15,2+r()*8,jitter(red?(light?[199,117,89]:[125,76,98]):(light?[180,189,204]:[117,142,170]),15),.38,(light?-.8:.8)+(r()-.5));}
  path([[cx-.072,top+.15],[cx-.032,top+.017],[cx+.008,top],[cx+.035,top+.012],[cx+.082,top+.15],[cx+.049,top+.115],[cx+.023,top+.17],[cx+.008,top+.11],[cx-.024,top+.16],[cx-.042,top+.10]],red?'#e4c8ba':'#e7e4dd');
  for(let i=0;i<280;i++){let x=cx-.07+r()*.15,y=top+r()*.17;dab(x*W,y*H,2+r()*14,1+r()*5,red?[218,162,145]:[234,233,226],.4,-.6);}
  c.restore();
 }
 function hills(){
  for(let layer=0;layer<3;layer++){const y=.49+layer*.063;const col=['#98aab2','#7d999f','#547e80'][layer];let points=[[0,y+.15]];for(let i=0;i<=40;i++)points.push([i/40,y+Math.sin(i*.38+layer)*.035+(r()-.5)*.02]);points.push([1,.8],[0,.8]);path(points,col);for(let i=0;i<1700;i++){const x=r()*W,yy=(y+.04+r()*.13)*H;dab(x,yy,4+r()*16,2+r()*5,jitter(layer===2?[81,124,121]:[142,164,169]),.4);}}
 }
 function water(y=.61,dark=false){
  const g=c.createLinearGradient(0,H*y,0,H);g.addColorStop(0,dark?'#345d70':'#94b0ad');g.addColorStop(.4,dark?'#214958':'#698f98');g.addColorStop(1,dark?'#173d4a':'#336d7a');c.fillStyle=g;c.fillRect(0,H*y,W,H*(1-y));
  for(let i=0;i<16000;i++){const xx=r()*W,yy=(y+r()*(1-y))*H;const t=(yy/H-y)/(1-y);const p=dark?[[40,82,100],[65,106,119],[32,70,89],[86,123,138],[111,132,144],[55,96,111]]:[[139,166,172],[184,185,170],[63,117,135],[110,142,164],[77,129,144],[149,155,167]];dab(xx,yy,(4+r()*28)*(0.4+t*1.6)*W/1600,(1+r()*4)*H/720,jitter(p[~~(r()*p.length)],18),.45+r()*.35,(r()-.5)*.12);}
  if(!dark){for(let i=0;i<850;i++){const t=r();const xx=(.82+(r()-.5)*(.015+t*.14))*W,yy=(y+t*(1-y))*H;dab(xx,yy,(3+r()*18)*(1+t),1+r()*3,jitter([238,206,147],20),.35+r()*.5);}}
 }
 function meadow(y=.7,autumn=false){
  path([[0,y],[.17,y-.045],[.31,y-.015],[.45,y+.035],[.56,y+.1],[.42,1],[0,1]],autumn?'#9b8957':'#54765e');
  for(let i=0;i<10000;i++){const xx=r()*.56, yy=y+r()*(1-y);if(xx>.53-(yy-y)*.3)continue;const size=(.2+(yy-y)*4);const p=autumn?[[197,156,72],[220,181,89],[132,130,70]]:[[91,126,77],[138,156,90],[172,167,91],[67,111,90],[112,137,99]];dab(xx*W,yy*H,(2+r()*9)*size,(2+r()*7)*size,jitter(p[~~(r()*p.length)]),.7,-.4+r()*.9);}
 }
 function flower(x,y,s,type='iris'){
  const px=x*W,py=y*H,scale=s*W/1800;
  c.strokeStyle=rgb([61+r()*35,102+r()*30,76+r()*25]);c.lineWidth=Math.max(.7,scale*1.2);c.beginPath();c.moveTo(px,py+scale*19);c.quadraticCurveTo(px-scale*3,py+scale*8,px,py);c.stroke();
  dab(px-3*scale,py+9*scale,scale*9,scale*2,[90,136,93],1,-.8);dab(px+3*scale,py+11*scale,scale*8,scale*2,[112,146,96],1,.7);
  const color=type==='yellow'?[220,187,89]:type==='pink'?[225,171,175]:[133,120,168];
  if(type==='sunflower'){
   for(let p=0;p<9;p++){const a=p/9*Math.PI*2;ellipse(px+Math.cos(a)*scale*5,py+Math.sin(a)*scale*5,scale*5,scale*2.6,rgb(jitter([230,186,73],34)),a);}ellipse(px,py,scale*3.7,scale*3.7,'#73613b');
  }else{for(let p=0;p<4;p++)dab(px+(r()-.5)*scale*7,py+(r()-.5)*scale*8,scale*(4+r()*5),scale*(4+r()*4),jitter(color,32),1,r()*2);dab(px,py,scale*1.6,scale*3,[234,209,139]);}
 }
 function flowers(y=.77,type='mix',count=1000){for(let i=0;i<count;i++){const yy=y+r()*(1-y),xx=r()*.54;if(xx>.52-(yy-y)*.35)continue;const s=(.3+(yy-y)*7)*(r()*.6+.5);flower(xx,yy,s,type==='mix'?(r()<.35?'yellow':'iris'):type);}}
 function tree(x=.06,y=.7,size=1,sakura=false){
  const trunk=sakura?'#6c685e':'#314c4d';
  function branch(bx,by,len,angle,width,depth){if(depth<0)return;const ex=bx+Math.cos(angle)*len,ey=by+Math.sin(angle)*len;c.strokeStyle=trunk;c.lineWidth=width;c.lineCap='round';c.beginPath();c.moveTo(bx,by);c.quadraticCurveTo((bx+ex)/2+len*.09,(by+ey)/2,ex,ey);c.stroke();if(depth){branch(ex,ey,len*(.62+r()*.12),angle-.4-r()*.32,width*.62,depth-1);branch(ex,ey,len*(.6+r()*.12),angle+.45+r()*.3,width*.6,depth-1);}else{for(let k=0;k<70;k++){const xx=ex+(r()-.5)*W*.075*size,yy=ey+(r()-.5)*H*.15*size;const palette=sakura?[[219,166,172],[237,192,187],[188,139,158],[246,212,198],[205,164,182]]:[[34,72,69],[47,83,72],[64,100,79],[91,117,86],[57,94,87]];dab(xx,yy,(3+r()*11)*W/1800*size,(2+r()*7)*H/720*size,jitter(palette[~~(r()*palette.length)],20),.85,(r()-.5)*1.3);}}}
  branch(x*W,y*H,H*.27*size,-1.62,W*.013*size,5);
 }
 function house(x,y,s=1){const ww=W*.037*s,hh=H*.073*s;const px=x*W,py=y*H;path([[x,y],[x+ww/W,y],[x+ww/W,y+hh/H],[x,y+hh/H]],'#aaa38a');path([[x-.012*s,y+.003*s],[x+.018*s,y-.05*s],[x+.05*s,y+.006*s]],'#4a6060');for(let i=0;i<60;i++)dab(px+r()*ww,py+r()*hh,ww*.16,hh*.09,[166,159,136],.7);c.fillStyle='#53676a';c.fillRect(px+ww*.5,py+hh*.17,ww*.23,hh*.83);}
 function bridge(x=.66,y=.67,s=1){
  const start=x-.12*s,end=x+.14*s;for(let k=0;k<2;k++){c.strokeStyle=k?'#bdac88':'#64746b';c.lineWidth=(k?2:6)*W/1800;c.beginPath();c.moveTo(start*W,(y+.03*k)*H);c.quadraticCurveTo(x*W,(y-.13*s+.03*k)*H,end*W,(y+.03*k)*H);c.stroke();}
  for(let i=0;i<22;i++){const t=i/21,xx=start+(end-start)*t,yy=y-Math.sin(t*Math.PI)*.062*s;c.strokeStyle='#8b8c72';c.lineWidth=2*W/1800;c.beginPath();c.moveTo(xx*W,(yy-.044*s)*H);c.lineTo(xx*W,(yy+.035*s)*H);c.stroke();}for(let i=0;i<4;i++){const t=i/3,xx=start+(end-start)*t;c.strokeStyle='#637d78';c.lineWidth=5*W/1800;c.beginPath();c.moveTo(xx*W,(y-.01)*H);c.lineTo(xx*W,(y+.09)*H);c.stroke();}
 }
 function traveler(x=.32,y=.84,s=1,demon=false){const px=x*W,py=y*H,k=W/1800*s;c.strokeStyle='#3f5653';c.lineWidth=3*k;c.beginPath();c.moveTo(px-3*k,py);c.lineTo(px-5*k,py+21*k);c.moveTo(px+4*k,py);c.lineTo(px+7*k,py+20*k);c.stroke();path([[x-10*k/W,y-27*k/H],[x+7*k/W,y-27*k/H],[x+13*k/W,y+4*k/H],[x-13*k/W,y+4*k/H]],demon?'#777b65':'#718b85');ellipse(px,py-32*k,6*k,7*k,'#796e5f');path([[x-17*k/W,y-34*k/H],[x,y-44*k/H],[x+18*k/W,y-33*k/H]],'#c6b88e');c.strokeStyle='#5d6a58';c.lineWidth=1.4*k;c.beginPath();c.moveTo(px+15*k,py-8*k);c.lineTo(px+20*k,py+22*k);c.stroke();if(demon){path([[x-6*k/W,y-35*k/H],[x-6*k/W,y-50*k/H],[x,y-38*k/H]],'#b9b38e');}}
 function lilies(){water(0,true);for(let i=0;i<135;i++){const x=r()*W,y=r()*H,rr=(12+r()*45)*W/2400*(.6+y/H);c.save();c.translate(x,y);c.rotate((r()-.5)*.35);c.fillStyle=rgb(jitter(r()<.5?[73,116,106]:[61,103,100],20));c.beginPath();c.ellipse(0,0,rr,rr*.35,0,.12,Math.PI*2-.1);c.lineTo(0,0);c.fill();for(let j=0;j<8;j++)dab((r()-.5)*rr*1.3,(r()-.5)*rr*.4,rr*.4,rr*.05,jitter([109,142,119],20),.45);c.restore();if(i%5===0){for(let p=0;p<7;p++){let a=p/7*Math.PI*2;ellipse(x+Math.cos(a)*rr*.22,y-rr*.12+Math.sin(a)*rr*.07,rr*.24,rr*.09,rgb(jitter([226,182,190],26)),a*.4);}ellipse(x,y-rr*.12,rr*.08,rr*.045,'#e4cb91');}}}
 if(kind==='themes'){lilies();}
 else if(kind==='paper'){c.fillStyle='#eee9df';c.fillRect(0,0,W,H);for(let i=0;i<80000;i++)dab(r()*W,r()*H,.3+r(),.3+r(),r()<.5?[110,100,86]:[255,255,245],.1);}
 else if(kind==='hero'||kind==='hero-mobile'){
  sky();sun();if(kind==='hero-mobile')mountain(.63,.21,.56);else mountain();hills();water(.65);meadow(.67);house(.84,.57,.9);house(.9,.54,.8);house(.95,.59,.7);tree(.9,.67,.59,true);tree(.99,.64,.58,true);bridge();flowers(.7,'mix',1500);traveler(kind==='hero-mobile'?.45:.335,.85,kind==='hero-mobile'?3.3:1.55);tree(.035,.73,1.75);tree(-.04,.68,2.1);
  for(let k=0;k<10500;k++){const x=r()*.31,y=r()*.48;if(((x-.045)/.26)**2+((y+.035)/.45)**2>1)continue;const p=[[38,73,68],[48,88,75],[72,106,82],[91,118,90],[58,93,83]];dab(x*W,y*H,4+r()*18,2+r()*7,jitter(p[~~(r()*p.length)],16),.82,(r()-.5)*1.4);}
  const shade=c.createLinearGradient(0,0,W*.57,0);shade.addColorStop(0,'#123d4c87');shade.addColorStop(.58,'#183c4850');shade.addColorStop(1,'#183c4800');c.fillStyle=shade;c.fillRect(0,0,W,H);
 }else{
  const id=Number(kind);sky(id===5||id===6&&film,id===3);if(id!==4)sun(.76,.24);
  if(id===1){mountain(.65,.23,.59);hills();water(.71);meadow(.45);if(film){tree(.12,.8,1.2);tree(.83,.8,1.35);for(let i=0;i<160;i++){c.strokeStyle='#c8dcda65';c.beginPath();c.moveTo(r()*W,r()*H);c.lineTo(r()*W+3,r()*H+10);c.stroke();}}else{flowers(.45,'sunflower',1800);}traveler(.47,.69,4.5);}
  if(id===2){hills();water(.59);meadow(.79);tree(.18,.82,1.2,true);tree(.83,.8,1.1,true);tree(.52,.65,.7,true);bridge(.6,.73,.9);for(let i=0;i<80;i++)dab(r()*W,r()*H,3,6,[241,185,192],.8,r()*4);}
  if(id===3){mountain(.52,.16,.64);hills();water(.65);if(film){path([[0,.59],[.34,.49],[.65,.61],[1,.55],[1,1],[0,1]],'#cbd2d3');for(let i=0;i<5000;i++)dab(r()*W,r()*H,3+r()*12,1+r()*2,[235,235,226],.5,-.5);}else{house(.06,.57,6);house(.77,.51,3.5);path([[.25,1],[.47,.64],[.57,.64],[.9,1]],'#829491');}traveler(.54,.86,3.1);for(let i=0;i<1600;i++){let x=r()*W,y=r()*H;c.strokeStyle='#cfdae077';c.lineWidth=.5+r();c.beginPath();c.moveTo(x,y);c.lineTo(x-4,y+16+r()*20);c.stroke();}}
  if(id===4){gradient([[0,'#2c484c'],[.6,'#54766d'],[1,'#435c5d']]);const g=c.createRadialGradient(W*.53,H*.49,0,W*.53,H*.49,W*.35);g.addColorStop(0,'#d3d0a4');g.addColorStop(.2,'#75958d');g.addColorStop(.8,'#1f3c3e');g.addColorStop(1,'#263f40');c.fillStyle=g;c.fillRect(0,0,W,H);for(let j=0;j<15;j++){let rr=(.1+j*.065)*W;c.strokeStyle=rgb(jitter([69,94,89],24),.85);c.lineWidth=W*.024;c.beginPath();c.ellipse(W*.53,H*.62,rr,rr*1.3,0,Math.PI,Math.PI*2);c.moveTo(W*.53-rr,H*.62);c.lineTo(W*.53-rr,H);c.moveTo(W*.53+rr,H*.62);c.lineTo(W*.53+rr,H);c.stroke();}path([[.46,.59],[.6,.59],[1,1],[0,1]],'#687a71');for(let i=0;i<2500;i++)dab(r()*W,(.63+r()*.37)*H,4+r()*15,1+r()*3,[105,125,115],.4);traveler(.49,.81,2.3);}
  if(id===5){hills();if(film){meadow(.54,true);flowers(.56,'yellow',1000);}else{water(.67);meadow(.69,true);for(let i=0;i<9;i++)house(r(),.55+r()*.14,1+r()*2);}for(let i=0;i<45;i++){let x=r()*W,y=(.2+r()*.36)*H,s=3+r()*8;c.strokeStyle='#3c4745';c.lineWidth=1.6;c.beginPath();c.moveTo(x-s,y);c.quadraticCurveTo(x-s*.6,y-s*.6,x,y);c.quadraticCurveTo(x+s*.5,y-s*.7,x+s,y-2);c.stroke();}}
  if(id===6){mountain(.5,.17,.7,film);hills();water(.65);meadow(.88);tree(.04,.84,.8);flowers(.88,'iris',180);}
  if(id===7){hills();water(.73);meadow(.64,film);tree(.2,.84,1.3,!film);traveler(.55,.69,8,true);if(film){for(let i=0;i<50;i++){let x=r(),y=.72+r()*.28;ellipse(x*W,y*H,10+r()*20,6+r()*8,'#717d6b');}}else flowers(.84,'pink',210);}
  if(id===8){mountain(.65,.32,.65);hills();water(.67);meadow(.66);flowers(.7,'mix',370);tree(.08,.8,.9);if(film){house(.59,.63,3);const x=W*.57,y=H*.75,rr=W*.07;c.strokeStyle='#b5a07a';c.lineWidth=W*.015;c.beginPath();c.arc(x,y,rr,0,7);c.stroke();for(let i=0;i<12;i++){const a=i*Math.PI/6;c.lineWidth=2;c.beginPath();c.moveTo(x,y);c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);c.stroke();}}else{c.save();c.globalAlpha=.22;['#e4a79d','#e3c691','#d9d59b','#91b7a3','#93abc5'].forEach((col,i)=>{c.strokeStyle=col;c.lineWidth=5;c.beginPath();c.arc(W*.59,H*.56,W*.4-i*5,Math.PI,Math.PI*2);c.stroke();});c.restore();}traveler(.38,.82,2.5);}
 }
 // Static woven grain; stays attached to each painting rather than flickering.
 for(let i=0;i<W*H/26;i++){c.fillStyle=r()<.5?'#fff2df0b':'#183a4a0a';c.fillRect(r()*W,r()*H,1+r()*2,.4+r()*.5);}
 for(let y=0;y<H;y+=3){c.fillStyle=y%6?'#fff5dc04':'#203c4804';c.fillRect(0,y,W,1);}
};
