(() => {
  'use strict';
  const body=document.body,stage=document.querySelector('#scene-stage'),canvas=document.querySelector('#world');
  const motionButton=document.querySelector('.motion-toggle'),spectrumButton=document.querySelector('.spectrum-toggle');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)'),coarse=window.matchMedia('(pointer: coarse)');
  const announcement=document.querySelector('.interaction-status'),status=document.querySelector('[data-engine-status]'),fps=document.querySelector('[data-fps]');
  const tooltip=document.querySelector('.unit-tooltip'),marker=document.querySelector('.target-marker'),cursor=document.querySelector('.galaxy-cursor');
  const release=document.querySelector('.release-target'),reset=document.querySelector('.reset-view');
  const types={ship:'星际巡航飞船',mecha:'重装钢铁机甲',robot:'赛博探索机器人',all:'全部银河舰队'};
  const state={model:'all',time:0,yaw:0,pitch:0,warp:0,pulse:0,violet:false,hovered:-1,selected:-1,pointerX:0,pointerY:0};
  let renderer=null,paused=reduced.matches,manualMotion=false,visible=true,raf=0,last=0,lastRender=0,dirty=true;
  let targetYaw=0,targetPitch=0,drag=null,pointer=null,warpStarted=0,pulseStarted=0,warpTimer=0,frames=0,fpsStart=0,keyboardIndex=-1;
  try{state.violet=localStorage.getItem('strgo-spectrum')==='violet';}catch(_){}
  function requestFrame(){if(!raf&&!document.hidden)raf=requestAnimationFrame(frame);}
  function setSpectrum(){body.dataset.spectrum=state.violet?'violet':'cyan';spectrumButton.setAttribute('aria-label',state.violet?'切换为青色光谱':'切换为紫色光谱');spectrumButton.setAttribute('aria-pressed',String(state.violet));spectrumButton.title=spectrumButton.getAttribute('aria-label');dirty=true;requestFrame();}
  function motion(){body.classList.toggle('motion-paused',paused);motionButton.setAttribute('aria-label',paused?'播放动态效果':'暂停动态效果');motionButton.setAttribute('aria-pressed',String(paused));motionButton.title=motionButton.getAttribute('aria-label');motionButton.querySelector('.motion-icon').textContent=paused?'▷':'Ⅱ';if(paused){warpStarted=0;pulseStarted=0;state.warp=state.pulse=0;body.classList.remove('is-warping');clearTimeout(warpTimer);fps.textContent='—';}status.textContent=paused?'轨道已暂停':renderer?'舰队巡航中':'银河投影';dirty=true;requestFrame();}
  function initialize(){if(renderer)renderer.destroy();renderer=null;try{renderer=window.StrgoGalaxy?.create(canvas)||null;if(renderer)renderer.render(state);}catch(error){if(renderer)renderer.destroy();renderer=null;console.warn('STRGO illustrated galaxy fallback:',error);}stage.classList.toggle('scene-active',Boolean(renderer));fps.parentElement.hidden=!renderer;status.textContent=paused?'轨道已暂停':renderer?'舰队巡航中':'银河投影';dirty=true;requestFrame();}
  canvas.addEventListener('scene-unavailable',()=>{if(renderer)renderer.destroy();renderer=null;stage.classList.remove('scene-active');tooltip.hidden=marker.hidden=true;fps.parentElement.hidden=true;status.textContent='银河投影';});
  canvas.addEventListener('webglcontextrestored',initialize);
  function units(){return renderer?.getUnits?.()||[];}
  function hud(){
    const unit=units().find(u=>u.id===(state.hovered>=0?state.hovered:state.selected));
    document.querySelector('[data-lock-status]').textContent=state.selected>=0?'信号已锁定':unit?'目标侦测中':'舰队巡航';
    document.querySelector('[data-unit-id]').textContent=unit?.name||'GALACTIC FIELD';
    document.querySelector('[data-unit-class]').textContent=unit?types[unit.model]:'15 个单位 · 3 条轨道';
    release.hidden=state.selected<0;stage.classList.toggle('is-hovering',state.hovered>=0);
    tooltip.hidden=marker.hidden=!unit;
    if(unit){
      const rect=stage.getBoundingClientRect(),x=(unit.x+1)*.5*rect.width,y=(1-unit.y)*.5*rect.height;
      marker.style.left=x+'px';marker.style.top=y+'px';marker.style.width=Math.max(44,unit.hitX*rect.width)+'px';marker.style.height=Math.max(44,unit.hitY*rect.height)+'px';
      marker.classList.toggle('is-locked',state.selected===unit.id);
      tooltip.style.left=Math.max(12,Math.min(rect.width-172,x+24))+'px';tooltip.style.top=Math.max(90,Math.min(rect.height-155,y-50))+'px';
      document.querySelector('[data-target-name]').textContent=unit.name;document.querySelector('[data-target-type]').textContent=types[unit.model]+(unit.id===state.selected?' / 已锁定':' / 点击锁定');
    }
  }
  function detect(){if(!renderer?.pick||!pointer||drag){state.hovered=-1;return;}const unit=renderer.pick(pointer.x,pointer.y);state.hovered=unit?unit.id:-1;}
  function frame(now){
    raf=0;if(document.hidden){last=0;return;}
    const dt=last?Math.min(.05,(now-last)/1000):0;last=now;
    if(!paused&&visible)state.time+=dt;
    state.yaw+=(targetYaw-state.yaw)*(paused?1:.09);state.pitch+=(targetPitch-state.pitch)*(paused?1:.09);
    if(pointer){state.pointerX+=(pointer.x-state.pointerX)*.1;state.pointerY+=(pointer.y-state.pointerY)*.1;}
    if(warpStarted&&!paused){const progress=(now-warpStarted)/3300;state.warp=progress<1?Math.sin(progress*Math.PI):0;if(progress>=1)warpStarted=0;}else state.warp=0;
    if(pulseStarted&&!paused){state.pulse=Math.min(1,(now-pulseStarted)/1600);if(state.pulse>=1){pulseStarted=0;state.pulse=0;}}else state.pulse=0;
    const limit=coarse.matches?32:16;
    if(renderer&&visible&&(!paused||dirty)&&(dirty||now-lastRender>=limit)){
      detect();
      try{renderer.render(state);hud();}catch(error){console.warn('Galaxy renderer fallback:',error);renderer.destroy();renderer=null;stage.classList.remove('scene-active');fps.parentElement.hidden=true;status.textContent='银河投影';tooltip.hidden=marker.hidden=true;}
      lastRender=now;dirty=false;frames++;if(!fpsStart)fpsStart=now;
      if(now-fpsStart>1000){fps.textContent=String(Math.round(frames*1000/(now-fpsStart)));frames=0;fpsStart=now;}
    }
    if(!paused&&visible)requestFrame();
  }
  function pulse(){if(!paused)pulseStarted=performance.now();dirty=true;requestFrame();}
  function lock(unit){state.selected=unit?unit.id:-1;body.classList.toggle('has-selection',state.selected>=0);announcement.textContent=unit?`已锁定${types[unit.model]} ${unit.name}。`:'已解除目标锁定。';pulse();hud();}
  function warp(){if(paused){announcement.textContent='轨道已暂停，播放后可启动跃迁。';return;}if(warpStarted)return;document.querySelector('#hangar').scrollIntoView({behavior:reduced.matches?'auto':'smooth'});warpStarted=performance.now();body.classList.remove('is-warping');void body.offsetWidth;body.classList.add('is-warping');status.textContent='跃迁中';announcement.textContent='银河跃迁启动。';clearTimeout(warpTimer);warpTimer=setTimeout(()=>{body.classList.remove('is-warping');status.textContent=paused?'轨道已暂停':renderer?'舰队巡航中':'银河投影';announcement.textContent='跃迁完成。';},3400);requestFrame();}
  function pointerPosition(event){const r=stage.getBoundingClientRect();return {x:(event.clientX-r.left)/r.width*2-1,y:1-(event.clientY-r.top)/r.height*2};}
  stage.addEventListener('pointermove',event=>{
    pointer=pointerPosition(event);
    if(drag&&drag.id===event.pointerId){drag.distance=Math.max(drag.distance,Math.hypot(event.clientX-drag.x,event.clientY-drag.y));targetYaw=drag.yaw+(event.clientX-drag.x)*.009;targetPitch=Math.max(-.85,Math.min(.85,drag.pitch+(event.clientY-drag.y)*.006));}
    else{detect();hud();}
    const rect=stage.getBoundingClientRect();cursor.hidden=coarse.matches;cursor.style.left=(event.clientX-rect.left)+'px';cursor.style.top=(event.clientY-rect.top)+'px';dirty=true;requestFrame();
  });
  stage.addEventListener('pointerdown',event=>{if(event.button!==0)return;pointer=pointerPosition(event);drag={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:targetYaw,pitch:targetPitch,distance:0};stage.setPointerCapture(event.pointerId);stage.classList.add('is-dragging');});
  stage.addEventListener('pointerup',event=>{if(!drag||drag.id!==event.pointerId)return;const click=drag.distance<6;drag=null;stage.classList.remove('is-dragging');if(click){const p=pointerPosition(event),unit=renderer?.pick?.(p.x,p.y)||null;lock(unit);}dirty=true;requestFrame();});
  function endDrag(){drag=null;stage.classList.remove('is-dragging');}
  stage.addEventListener('pointercancel',endDrag);stage.addEventListener('lostpointercapture',endDrag);stage.addEventListener('pointerleave',()=>{pointer=null;state.hovered=-1;cursor.hidden=true;hud();dirty=true;requestFrame();});stage.addEventListener('dblclick',warp);
  stage.addEventListener('keydown',event=>{
    const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' ','Escape'];if(!keys.includes(event.key))return;event.preventDefault();
    if(event.key==='ArrowLeft')targetYaw-=.2;if(event.key==='ArrowRight')targetYaw+=.2;if(event.key==='ArrowUp')targetPitch=Math.max(-.85,targetPitch-.12);if(event.key==='ArrowDown')targetPitch=Math.min(.85,targetPitch+.12);
    if(event.key===' '){const list=units().filter(u=>state.model==='all'||u.model===state.model);if(list.length){keyboardIndex=(keyboardIndex+1)%list.length;pointer=null;state.hovered=-1;lock(list[keyboardIndex]);}}
    if(event.key==='Enter')pulse();if(event.key==='Escape')lock(null);dirty=true;requestFrame();
  });
  release.hidden=true;release.addEventListener('click',()=>lock(null));
  reset.hidden=false;reset.addEventListener('click',()=>{targetYaw=targetPitch=0;pointer=null;state.hovered=-1;lock(null);announcement.textContent='银河视角已重置。';});
  document.querySelectorAll('.model-button').forEach(button=>button.addEventListener('click',()=>{const model=button.dataset.model;if(!types[model])return;state.model=model;body.dataset.model=model;document.querySelectorAll('.model-button').forEach(b=>{b.classList.toggle('is-active',b===button);b.setAttribute('aria-pressed',String(b===button));});announcement.textContent=`已高亮${types[model]}。所有单位继续环绕银河。`;dirty=true;requestFrame();}));
  document.querySelectorAll('[data-warp]').forEach(button=>{button.hidden=false;button.addEventListener('click',warp);});
  spectrumButton.hidden=motionButton.hidden=false;
  spectrumButton.addEventListener('click',()=>{state.violet=!state.violet;setSpectrum();try{localStorage.setItem('strgo-spectrum',state.violet?'violet':'cyan');}catch(_){}announcement.textContent=state.violet?'已切换为紫色星云。':'已切换为蓝色星云。';});
  motionButton.addEventListener('click',()=>{paused=!paused;manualMotion=true;motion();});reduced.addEventListener('change',event=>{if(!manualMotion){paused=event.matches;motion();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;last=0;}else{dirty=true;fpsStart=0;frames=0;requestFrame();}});
  if('IntersectionObserver'in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible){cancelAnimationFrame(raf);raf=0;last=0;}else{dirty=true;lastRender=0;requestFrame();}},{rootMargin:'60px'}).observe(stage);
  if('ResizeObserver'in window)new ResizeObserver(()=>{dirty=true;requestFrame();}).observe(stage);window.addEventListener('resize',()=>{dirty=true;requestFrame();},{passive:true});
  document.querySelectorAll('[data-tilt]').forEach(card=>{card.addEventListener('pointermove',event=>{if(paused||coarse.matches)return;const r=card.getBoundingClientRect(),x=(event.clientX-r.left)/r.width-.5,y=(event.clientY-r.top)/r.height-.5;card.style.transform=`rotateX(${-y*8}deg) rotateY(${x*10}deg)`;});card.addEventListener('pointerleave',()=>{card.style.transform='';});});
  const progress=document.querySelector('.scroll-progress');function updateScroll(){const range=document.documentElement.scrollHeight-window.innerHeight;progress.style.transform=`scaleX(${range>0?Math.max(0,Math.min(1,window.scrollY/range)):0})`;}
  window.addEventListener('scroll',updateScroll,{passive:true});window.addEventListener('resize',updateScroll,{passive:true});updateScroll();
  const copy=document.querySelector('.copy-button'),copyStatus=document.querySelector('.copy-status');copy.hidden=false;copy.addEventListener('click',async()=>{const url=copy.dataset.url;let copied=false;if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(url);copied=true;}catch(_){}}if(!copied){const field=document.createElement('textarea');field.value=url;field.setAttribute('readonly','');field.setAttribute('aria-label','小站地址');field.className='clipboard-field';document.body.appendChild(field);field.select();try{copied=document.execCommand('copy');}catch(_){}field.remove();copy.focus();}copyStatus.textContent=copied?'宇宙坐标已复制。':`可以手动复制：${url}`;});
  const clock=document.querySelector('[data-clock]'),year=document.querySelector('[data-year]');const timeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}),yearFormat=new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric'});function updateClock(){const now=new Date();clock.textContent=timeFormat.format(now);year.textContent=yearFormat.format(now);}updateClock();clock.parentElement.hidden=false;window.setInterval(updateClock,30000);
  setSpectrum();motion();initialize();
})();
