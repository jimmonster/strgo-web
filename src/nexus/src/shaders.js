export const fullscreenVertex = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }
`;
const noise = `
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(.8,-.6,.6,.8); for(int i=0;i<5;i++){ v+=a*noise(p);p=m*p*2.03+vec2(17.1,8.9);a*=.5;}return v; }
`;
export const backgroundFragment = `
precision highp float;
varying vec2 vUv;
uniform float uTime,uAspect,uMobile,uIntensity,uHue;
uniform vec2 uMouse,uResolution;
${noise}
vec3 stars(vec2 uv,float density,float speed){
  vec2 p=uv*vec2(uAspect,1.);p.x+=uTime*speed;
  vec2 grid=p*density,id=floor(grid),f=fract(grid)-.5;
  float h=hash(id),r=length(f-vec2(hash(id+4.),hash(id-5.))*.55);
  float twinkle=.7+.3*sin(uTime*(.6+h)+h*70.);
  float star=exp(-r*r/(.0006+.004*pow(h,12.)))*step(.965,h)*twinkle;
  return mix(vec3(.4,.63,1.),vec3(.94,.82,1.),hash(id+11.))*star;
}
void main(){
 vec2 uv=vUv+uMouse*.002;vec2 p=uv*vec2(uAspect,1.);
 float t=uTime*.005;
 float n=fbm(p*3.+vec2(t,-t*.3));
 float fil=pow(fbm(p*6.+vec2(n*3.+t,-t*.6)),3.5);
 vec3 col=vec3(.008,.018,.038);
 float band=exp(-pow((uv.y-.6+.13*sin(uv.x*5.))*3.,2.));
 col+=vec3(.045,.045,.14)*n*band;
 col+=mix(vec3(.055,.07,.21),vec3(.20,.058,.23),uv.x+uHue)*fil*.95;
 col+=vec3(.04,.12,.2)*pow(fbm(p*2.1+vec2(-t,t)),5.)*1.3;
 col+=stars(uv,160.,.00012)*.35+stars(uv,89.,-.0002)*.55+stars(uv,44.,.00035)*.7;
 // Spherical planet: independent surface, cloud advection, night city emission.
 vec2 center=mix(vec2(.235,.69),vec2(.13,.68),uMobile);
 vec2 q=(uv-center)*vec2(uAspect,1.);q+=uMouse*.002;
 float radius=mix(.46,.34,uMobile); float d=length(q)/radius;
 float atmosphere=exp(-abs(d-1.)*65.);
 col+=vec3(.08,.36,.8)*atmosphere*(.7+.1*sin(uTime*.3));
 if(d<1.){
   vec3 normal=vec3(q/radius,sqrt(max(0.,1.-d*d)));
   vec3 light=normalize(vec3(.8,.6,.65));
   float diffuse=max(0.,dot(normal,light));
   vec2 sphere=vec2(atan(normal.x,normal.z)*1.9+uTime*.012,asin(normal.y)*2.3);
   float terrain=fbm(sphere*3.+vec2(5.,1.));
   terrain+=.12*fbm(sphere*15.);
   float land=smoothstep(.48,.57,terrain);
   vec3 ocean=vec3(.012,.075,.15);
   vec3 continents=mix(vec3(.045,.10,.15),vec3(.11,.18,.20),fbm(sphere*12.));
   vec3 ground=mix(ocean,continents,land);
   float clouds=fbm((sphere+vec2(uTime*.008,0.))*5.+vec2(20.,1.));
   clouds=smoothstep(.49,.74,clouds+fbm(sphere*22.)*.2);
   ground=mix(ground,vec3(.42,.55,.66),clouds*.65);
   float cities=pow(noise(sphere*135.),24.)*land;
   float roads=pow(abs(sin(sphere.x*120.+fbm(sphere*25.)*9.)),45.)*pow(noise(sphere*46.),5.);
   vec3 citylight=vec3(.2,.65,1.)*(cities*1.6+roads*.18)*(1.-diffuse*.6);
   vec3 planet=ground*(.1+diffuse*1.2)+citylight;
   float rim=pow(1.-normal.z,5.);
   planet+=vec3(.12,.4,.8)*rim*diffuse*.65;
   float glint=pow(max(0.,dot(reflect(-light,normal),vec3(0,0,1))),35.);
   planet+=vec3(.25,.44,.65)*glint*.25;
   col=mix(planet,col,smoothstep(.996,1.,d));
 }
 // Two distant moons.
 vec2 moon=(uv-(vec2(.48,.84)+vec2(sin(uTime*.026)*.006,cos(uTime*.026)*.003)))*vec2(uAspect,1.);float md=length(moon)/.022;
 if(md<1.){vec3 nn=vec3(moon/.022,sqrt(1.-md*md));float li=max(0.,dot(nn,normalize(vec3(-.8,.3,.4))));col=vec3(.13,.16,.25)*(.09+li*.75)*(0.65+noise(moon*2400.+uTime*.001)*.4);}
 vec2 moon2=(uv-(vec2(.88,.69)+vec2(sin(uTime*.021)*.004,cos(uTime*.021)*.002)))*vec2(uAspect,1.);float m2=length(moon2)/.009;
 if(m2<1.)col=vec3(.13,.19,.26)*sqrt(1.-m2*m2);
 gl_FragColor=vec4(col,1.);
}
`;
export const blackHoleFragment = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uBackground;
uniform vec2 uResolution,uCenter,uMouse;
uniform float uTime,uCore,uDiskSpan,uTilt,uLens,uPulse,uAspect,uApproach,uIntensity,uExposure,uFade,uEnvelope,uInward,uFlowBoost;
uniform vec3 uFlows;
${noise}
float flow(vec2 polar,float speed,float scale){
 float a=polar.y;
 vec2 co=vec2(cos(a-speed*uTime*uFlowBoost+polar.x*1.9),sin(a-speed*uTime*uFlowBoost+polar.x*1.9));
 return fbm(co*scale+vec2(polar.x*38.+uTime*uInward*speed*uFlowBoost,polar.x*13.));
}
void main(){
 float zoom=1.+uApproach*uApproach*16.;
 vec2 base=(vUv-uCenter)*vec2(uAspect,1.);
 vec2 p=base/zoom + uMouse*.0015;
 float r=length(p), core=uCore;
 float ang=atan(p.y,p.x);
 if(r<core*.985){gl_FragColor=vec4(vec3(.0001,.0001,.0015)*(1.-uFade),1.);return;}
 float lens=pow(core/max(r,core*.5),2.)*uLens;
 lens*=1.-smoothstep(core*1.1,core*3.9,r);
 vec2 warped=vUv;
 vec2 bend=normalize(base+vec2(.00001))*lens;
 warped+=bend/vec2(uAspect,1.)*(1.+uApproach*1.8);
 float twist=lens*1.5;mat2 twistM=mat2(cos(twist),-sin(twist),sin(twist),cos(twist));
 warped=uCenter+twistM*((warped-uCenter)*vec2(uAspect,1.))/vec2(uAspect,1.);
 vec3 col=texture2D(uBackground,clamp(warped,vec2(.001),vec2(.999))).rgb;
 if(r>max(uDiskSpan*uAspect*.64,uEnvelope*.67)){
   col=vec3(1.)-exp(-col*uExposure*1.6);gl_FragColor=vec4(col*(1.-uFade),1.);return;
 }
 float c=cos(uTilt),s=sin(uTilt);vec2 q=mat2(c,-s,s,c)*p;
 // Far side disk and Einstein arch. Independent angular and radial flow at 3 rates.
 float ell=length(vec2(q.x,q.y/.20));
 float ea=atan(q.y/.20,q.x);
 float outer=uDiskSpan*uAspect*.5;
 float diskMask=(1.-smoothstep(outer*.7,outer,ell))*smoothstep(core*.65,core*1.04,ell);
 float diskRibbons=.38+.62*pow(.5+.5*sin(ell*1700.+flow(vec2(ell,ea),uFlows.y*6.283,8.)*9.-uTime*1.7),2.);
 float f1=flow(vec2(ell,ea),uFlows.x*6.283,3.);
 float f2=flow(vec2(ell,ea),uFlows.y*6.283,8.);
 float f3=flow(vec2(ell,ea),uFlows.z*6.283,18.);
 float textureFlow=(f1*.25+f2*.45+f3*.3);
 float beam=exp(-abs(q.y)*125.)*exp(-abs(q.x)*3.1)*(1.-smoothstep(outer*.9,outer*1.3,abs(q.x)));
 float thermal=pow(max(0.,1.-ell/outer),.7);
 float doppler=.58+.42*sin(ea-.8);
 vec3 diskColor=mix(vec3(.24,.14,.62),vec3(.73,.36,.95),thermal);
 diskColor=mix(diskColor,vec3(.75,.9,1.),pow(thermal,1.8)*.9);
 float disk=diskMask*textureFlow*diskRibbons*(1.2+doppler);
 vec3 accretion=diskColor*disk;
 accretion+=mix(vec3(.38,.25,.9),vec3(.7,.82,1.),thermal)*beam*.8;
 // Narrow multiple lensed arcs bend above and below the event horizon.
 float ar=length(vec2(q.x,q.y*.98));
 float arcRadius=core*(1.10+.07*sin(ang*2.+.5));
 float arch=exp(-abs(ar-arcRadius)*390.)*(.6+.4*sin(ang));
 float arch2=exp(-abs(ar-core*1.30)*210.)*(.28+.72*max(0.,sin(ang)));
 float archTexture=.4+.6*flow(vec2(r,ang),uFlows.z*6.283,6.);
 vec3 arcColor=mix(vec3(.48,.35,.95),vec3(.9,.82,1.),.5+.5*cos(ang+1.));
 accretion+=arcColor*(arch*2.2+arch2*.8)*archTexture;
 // Local analytic glow only; no full-frame bloom that could fill the core.
 float halo=exp(-abs(r-core*1.18)*38.)*.23;
 float envelope=exp(-pow(length(p/vec2(1.7,.85))/(uEnvelope*.52),2.)*2.1)*.07;
 float gasTexture=flow(vec2(r,ang),uFlows.x*6.283,4.);
 float gasSpiral=pow(.5+.5*sin(ang*3.+r*55.-uTime*.12+gasTexture*4.),5.);
 float gasVeil=gasSpiral*gasTexture*exp(-pow((r-core*1.8)/(core*1.1),2.))*.17;
 col+=vec3(.37,.16,.78)*(halo+envelope+gasVeil)*(1.-smoothstep(max(uDiskSpan*uAspect*.54,uEnvelope*.57),max(uDiskSpan*uAspect*.64,uEnvelope*.67),r));
 col+=accretion;
 // Stable opaque dark core occludes *all* background light and geometry.
 float coreMask=1.-smoothstep(core*.987,core*1.002,r);
 col=mix(col,vec3(.0001,.0001,.0015),coreMask);
 float ring=exp(-abs(r-core*1.012)*1900.);
 float ring2=exp(-abs(r-core*1.032)*650.)*.25;
 float angular=.7+.3*sin(ang*2.-.7);
 col+=mix(vec3(.76,.56,1.),vec3(.77,.93,1.),.5+.5*sin(ang+.9))*(ring*1.6+ring2)*angular;
 // Near-side luminous ribbons skirt the bottom edge; central silhouette remains clear.
 float frontY=q.y+core*.82;
 float frontCurve=core*.22*pow(q.x/(core*1.4),2.);
 float front=exp(-abs(frontY-frontCurve)*700.)*exp(-pow(q.x/(core*1.75),4.));
 front*=smoothstep(core*.92,core*1.1,r);
 col+=vec3(.85,.72,1.)*front*.4;
 float pulse=1.+uPulse*sin(uTime*.82);
 // During approach, radial starlight streaks appear outside the dark core.
 float speedline=pow(max(0.,sin(ang*174.+hash(vec2(floor(ang*31.)))*40.)),130.);
 col+=vec3(.24,.36,.72)*speedline*uApproach*.45*smoothstep(core*1.3,core*5.,r);
 col*=mix(1.,pulse,.2);
 col=vec3(1.)-exp(-col*uExposure*1.6);
 col*=1.-uFade;
 gl_FragColor=vec4(col,1.);
}
`;
export const floorVertex = `
varying vec2 vUv; varying vec3 vWorld;
void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}
`;
export const floorFragment = `
precision highp float;
varying vec2 vUv;varying vec3 vWorld;uniform float uTime;
${noise}
void main(){
 vec2 p=vWorld.xz;float seams=step(.985,fract(p.x*.35))+step(.986,fract((p.y+p.x*.18)*.23));
 float grain=noise(p*65.)*.4+.6;
 vec3 col=vec3(.013,.024,.042)*grain;
 float reflection=exp(-pow((p.x-7.+p.y*.20)*.15,2.))*exp(-abs(p.y+4.)*.035);
 float breaks=noise(vec2(p.x*7.,p.y*.7)+vec2(0,uTime*.09));
 col+=mix(vec3(.018,.07,.12),vec3(.12,.045,.22),noise(p*.25))*reflection*breaks*(.65+.1*sin(uTime*.8));
 col*=1.-seams*.85;
 float energy=pow(.5+.5*sin(p.y*.5+p.x*.24-uTime*.9),9.);
 col+=vec3(.025,.11,.22)*energy*seams*.6;
 float edge=exp(-abs(p.x+3.)*3.)*.15+exp(-abs(p.x-8.)*4.)*.12;
 col+=vec3(.08,.25,.48)*edge;
 gl_FragColor=vec4(col,1.);
}
`;
