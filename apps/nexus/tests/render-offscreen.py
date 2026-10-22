#!/usr/bin/env python3
"""Real GLSL / EGL scene preview, not a browser DOM screenshot. No Python dependencies."""
import ctypes as c, json, math, os, struct, zlib, time, sys, array
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'artifacts'
data=json.loads((OUT/'render-input.json').read_text())
os.environ['VK_ICD_FILENAMES']='/opt/google/chrome/vk_swiftshader_icd.json'
egl=c.CDLL('/opt/google/chrome/libEGL.so');gl=c.CDLL('/opt/google/chrome/libGLESv2.so')
V,U,N,F,B=c.c_void_p,c.c_uint,c.c_int,c.c_float,c.c_ubyte
PI,PU,PF=c.POINTER(N),c.POINTER(U),c.POINTER(F)
def fn(lib,name,result,*args):
 f=getattr(lib,name);f.restype=result;f.argtypes=list(args);return f
proc=fn(egl,'eglGetProcAddress',V,c.c_char_p)
get_display=c.CFUNCTYPE(V,U,V,PI)(proc(b'eglGetPlatformDisplayEXT'))
display=get_display(0x3202,None,(N*5)(0x3203,0x3450,0x3209,0x3487,0x3038))
major,minor,config,count=N(),N(),V(),N()
assert fn(egl,'eglInitialize',U,V,PI,PI)(display,c.byref(major),c.byref(minor))
assert fn(egl,'eglChooseConfig',U,V,PI,c.POINTER(V),N,PI)(display,(N*15)(0x3033,1,0x3040,4,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3025,24,0x3038),c.byref(config),1,c.byref(count)) and count.value
fn(egl,'eglBindAPI',U,U)(0x30a0)
W,H=1920,1080
surface=fn(egl,'eglCreatePbufferSurface',V,V,V,PI)(display,config,(N*5)(0x3057,W,0x3056,H,0x3038))
context=fn(egl,'eglCreateContext',V,V,V,V,PI)(display,config,None,(N*3)(0x3098,2,0x3038))
assert surface and context and fn(egl,'eglMakeCurrent',U,V,V,V,V)(display,surface,surface,context)
def g(name,res,*args):return fn(gl,name,res,*args)
use=g('glUseProgram',None,U);uniform1f=g('glUniform1f',None,N,F);uniform1i=g('glUniform1i',None,N,N);uniform2f=g('glUniform2f',None,N,F,F);uniform3f=g('glUniform3f',None,N,F,F,F);matrix4=g('glUniformMatrix4fv',None,N,N,B,PF);matrix3=g('glUniformMatrix3fv',None,N,N,B,PF)
bind_buffer=g('glBindBuffer',None,U,U);pointer=g('glVertexAttribPointer',None,U,N,U,B,N,V);enable=g('glEnable',None,U);disable=g('glDisable',None,U);draw_arrays=g('glDrawArrays',None,U,N,N);draw_elements=g('glDrawElements',None,U,N,U,V);viewport=g('glViewport',None,N,N,N,N);clear=g('glClear',None,U);clear_color=g('glClearColor',None,F,F,F,F);bind_fb=g('glBindFramebuffer',None,U,U)
def shader(source,kind):
 handle=g('glCreateShader',U,U)(kind);code=c.c_char_p(source.encode());g('glShaderSource',None,U,N,c.POINTER(c.c_char_p),PI)(handle,1,c.byref(code),None);g('glCompileShader',None,U)(handle);ok=N();g('glGetShaderiv',None,U,U,PI)(handle,0x8b81,c.byref(ok))
 if not ok.value:
  log=c.create_string_buffer(8192);g('glGetShaderInfoLog',None,U,N,PI,c.c_char_p)(handle,8192,None,log);raise RuntimeError(log.value.decode())
 return handle
def program(vertex,fragment):
 p=g('glCreateProgram',U)()
 for s in [shader(vertex,0x8b31),shader(fragment,0x8b30)]:g('glAttachShader',None,U,U)(p,s)
 for i,name in enumerate([b'position',b'normal',b'uv']):g('glBindAttribLocation',None,U,U,c.c_char_p)(p,i,name)
 g('glLinkProgram',None,U)(p);ok=N();g('glGetProgramiv',None,U,U,PI)(p,0x8b82,c.byref(ok));assert ok.value
 return p
def location(p,name):return g('glGetUniformLocation',N,U,c.c_char_p)(p,name.encode())
def values(p,vals):
 use(p)
 for name,value in vals.items():
  loc=location(p,name)
  if isinstance(value,(tuple,list)):
   if len(value)==2:uniform2f(loc,*value)
   elif len(value)==3:uniform3f(loc,*value)
  elif isinstance(value,int):uniform1i(loc,value)
  else:uniform1f(loc,value)
def buffer(a,kind,target=0x8892):
 h=U();g('glGenBuffers',None,N,PU)(1,c.byref(h));bind_buffer(target,h.value);a=(kind*len(a))(*a);g('glBufferData',None,U,c.c_ssize_t,V,U)(target,c.sizeof(a),a,0x88e4);return h.value
screen_vs='precision highp float;attribute vec3 position;attribute vec2 uv;'+data['shaders']['fullscreenVertex']
bgp=program(screen_vs,data['shaders']['backgroundFragment']);bhp=program(screen_vs,data['shaders']['blackHoleFragment'])
vp='''precision highp float;attribute vec3 position;attribute vec3 normal;attribute vec2 uv;uniform mat4 model,viewProjection;uniform mat3 normalMatrix;varying vec3 vNormal;varying vec3 vWorld;varying vec2 vUv;void main(){vUv=uv;vec4 w=model*vec4(position,1.);vWorld=w.xyz;vNormal=normalize(normalMatrix*normal);gl_Position=viewProjection*w;}'''
fp='''precision highp float;varying vec3 vNormal;varying vec3 vWorld;uniform vec3 color;uniform float opacity,unlit;void main(){vec3 n=normalize(vNormal);vec3 a=normalize(vec3(8,15,8));vec3 b=normalize(vec3(14,7,-10));float d=max(0.,dot(n,a));float e=max(0.,dot(n,b));vec3 lit=vec3(.15,.22,.34)+vec3(.50,.78,1.)*d*1.3+vec3(.62,.42,1.)*e*.9;vec3 rgb=mix(color*lit,color,unlit);rgb=vec3(1.)-exp(-rgb*1.1);gl_FragColor=vec4(rgb,opacity);}'''
fgp=program(vp,fp)
floorfp=data['shaders']['floorFragment'];floorp=program(vp,floorfp)
quad=buffer([-1,-1,0,1,-1,0,-1,1,0,1,1,0],F);quad_uv=buffer([0,0,1,0,0,1,1,1],F)
geometries=[]
for geo in data['geometries']:
 geometries.append((buffer(geo['position'],F),buffer(geo['normal'],F),buffer(geo['uv'] or [0.]*(len(geo['position'])//3*2),F),buffer(geo['index'],c.c_ushort,0x8893) if geo['index'] else None,len(geo['index']) if geo['index'] else len(geo['position'])//3))
texture,fb=U(),U();g('glGenTextures',None,N,PU)(1,c.byref(texture));g('glBindTexture',None,U,U)(0x0de1,texture.value)
g('glTexImage2D',None,U,N,N,N,N,N,U,U,V)(0x0de1,0,0x1908,W,H,0,0x1908,0x1401,None)
for opt,val in [(0x2801,0x2601),(0x2800,0x2601),(0x2802,0x812f),(0x2803,0x812f)]:g('glTexParameteri',None,U,U,N)(0x0de1,opt,val)
g('glGenFramebuffers',None,N,PU)(1,c.byref(fb));bind_fb(0x8d40,fb.value);g('glFramebufferTexture2D',None,U,U,U,U,N)(0x8d40,0x8ce0,0x0de1,texture.value,0);assert g('glCheckFramebufferStatus',U,U)(0x8d40)==0x8cd5
for i in [0,2]:g('glEnableVertexAttribArray',None,U)(i)
def quad_draw():
 g('glDisableVertexAttribArray',None,U)(1);bind_buffer(0x8892,quad);pointer(0,3,0x1406,False,0,None);bind_buffer(0x8892,quad_uv);pointer(2,2,0x1406,False,0,None);draw_arrays(5,0,4)
texture_size=[W,H]
def render(t=7.,approach=0.,fade=0.,w=W,h=H,foreground=True,transforms=None):
 if texture_size!=[w,h]:
  g('glBindTexture',None,U,U)(0x0de1,texture.value);g('glTexImage2D',None,U,N,N,N,N,N,U,U,V)(0x0de1,0,0x1908,w,h,0,0x1908,0x1401,None);texture_size[:]=[w,h]
 viewport(0,0,w,h);disable(0x0b71);disable(0x0be2);bind_fb(0x8d40,fb.value);clear_color(0,0,0,1);clear(0x4100)
 mobile=w<768
 values(bgp,{'uTime':float(t),'uAspect':float(w/h),'uMobile':float(mobile),'uIntensity':1.,'uMouse':[0.,0.],'uResolution':[float(w),float(h)],'uHue':0.});quad_draw()
 bind_fb(0x8d40,0);clear(0x4100)
 # Small preview viewport samples the relevant portion of the full-size target.
 values(bhp,{'uBackground':0,'uResolution':[float(w),float(h)],'uTime':float(t),'uCenter':[.65,.74] if mobile else [.69,.69],'uMouse':[0.,0.],'uCore':w/h*.125 if mobile else .11,'uDiskSpan':.78 if mobile else .42,'uTilt':math.radians(14.),'uLens':.03,'uPulse':.06,'uAspect':float(w/h),'uApproach':float(approach),'uIntensity':1.,'uExposure':1.,'uFade':float(fade),'uFlows':[.018,.042,.080],'uEnvelope':.6,'uInward':.045,'uFlowBoost':1.})
 # Resize target texture for the preview dimensions, so UVs stay correct.
 quad_draw()
 if foreground and not mobile and approach<.4:
  enable(0x0b71);enable(0x0be2);g('glBlendFunc',None,U,U)(0x0302,0x0303);g('glEnableVertexAttribArray',None,U)(1)
  for original_index,record in sorted(enumerate(data['objects']),key=lambda item:item[1]['opacity']<1):
   if transforms is not None:
    transform=transforms[original_index*29:original_index*29+29];record={**record,'transform':transform[:25],'color':transform[25:28],'opacity':transform[28]}
   if record['opacity']<.001:continue
   p=floorp if record['floor'] else fgp;use(p)
   matrix4(location(p,'model'),1,False,(F*16)(*record['transform'][:16]));matrix4(location(p,'viewProjection'),1,False,(F*16)(*data['viewProjection']));matrix3(location(p,'normalMatrix'),1,False,(F*9)(*record['transform'][16:]));uniform3f(location(p,'color'),*record['color']);uniform1f(location(p,'opacity'),record['opacity']);uniform1f(location(p,'unlit'),record['unlit']);uniform1f(location(p,'uTime'),t)
   pb,nb,ub,ib,count=geometries[record['geometry']]
   for i,b,size in [(0,pb,3),(1,nb,3),(2,ub,2)]:bind_buffer(0x8892,b);pointer(i,size,0x1406,False,0,None)
   if ib:bind_buffer(0x8893,ib);draw_elements(4,count,0x1403,None)
   else:draw_arrays(4,0,count)
 pixels=(B*(w*h*4))();g('glReadPixels',None,N,N,N,N,U,U,V)(0,0,w,h,0x1908,0x1401,pixels);assert g('glGetError',U)()==0
 return bytes(pixels)
def png(name,w,h,pixels):
 def chunk(tag,a):return struct.pack('!I',len(a))+tag+a+struct.pack('!I',zlib.crc32(tag+a)&0xffffffff)
 stride=w*4;rows=b''.join(b'\0'+pixels[y*stride:(y+1)*stride] for y in range(h-1,-1,-1))
 (OUT/name).write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b''))
start=time.time();pixels=render();png('scene-offscreen-1920.png',W,H,pixels)
second=render(8.)
grid_changes=[]
for gy in range(3):
 for gx in range(3):
  total=0;different=0;delta=0
  for y in range(gy*H//3,(gy+1)*H//3,4):
   for x in range(gx*W//3,(gx+1)*W//3,4):
    j=(y*W+x)*4;d=sum(abs(pixels[j+k]-second[j+k]) for k in range(3));total+=1;delta+=d;different+=d>1
  grid_changes.append({'cell':[gx+1,3-gy],'changedPixelFraction':round(different/total,4),'meanChannelChange':round(delta/total/3,4)})
cx,cy=W*.69,H*.69;radius=H*.11
values_core=[]
for y in range(round(cy-radius*.7),round(cy+radius*.7),3):
 for x in range(round(cx-radius*.7),round(cx+radius*.7),3):
  if math.hypot(x-cx,y-cy)<radius*.7:
   j=(y*W+x)*4;values_core.append(sum(pixels[j:j+3])/3)
(OUT/'pixel-checks.json').write_text(json.dumps({'method':'1920x1080 offscreen actual shader frames t=7 and t=8; not browser acceptance','coreDiameterCSS':radius*2,'meanCoreRGBByte':sum(values_core)/len(values_core),'nineGridTemporalDifferences':grid_changes},indent=2))
assert max(values_core)<8,'Core unexpectedly filled with light'
assert all(c['changedPixelFraction']>0 for c in grid_changes),'A grid region has no independent motion'
print('Core blackness and all nine temporal grid regions passed (offscreen).',flush=True)

print('Actual shaders compiled. Offscreen scene rendered in %.2fs.'%(time.time()-start),flush=True)
(OUT/'shader-report.json').write_text(json.dumps({'method':'EGL actual background, black-hole and floor shaders; approximate foreground lighting. Not a browser screenshot.','viewport':[W,H],'shadersCompiled':4,'error':g('glGetError',U)(),'renderSeconds':time.time()-start},indent=2))

def lzw(indices):
    table = {}; next_code = 258; bits = 9; accumulator = 0; bit_count = 0; output = bytearray()
    def emit(code, size):
        nonlocal accumulator, bit_count
        accumulator |= code << bit_count; bit_count += size
        while bit_count >= 8: output.append(accumulator & 255); accumulator >>= 8; bit_count -= 8
    emit(256, bits); prefix = indices[0]
    for value in indices[1:]:
        key = (prefix << 8) | value
        if key in table: prefix = table[key]; continue
        emit(prefix, bits)
        if next_code >= (1 << bits) and bits < 12: bits += 1
        if next_code < 4096: table[key] = next_code; next_code += 1
        else: emit(256, bits); table.clear(); next_code = 258; bits = 9
        prefix = value
    emit(prefix, bits)
    if next_code >= (1 << bits) and bits < 12: bits += 1
    emit(257, bits)
    if bit_count: output.append(accumulator & 255)
    return output

if '--animate' in sys.argv:
 transforms=array.array('f');transforms.frombytes((OUT/'animation-transforms.bin').read_bytes())
 def gif(name,seconds,fps=6,journey=False):
  width,height=640,360;total=round(seconds*fps)
  with (OUT/name).open('wb') as gif:
   gif.write(b'GIF89a'+struct.pack('<HHBBB',width,height,0xf7,0,0))
   gif.write(bytes(v for i in range(256) for v in (round(((i>>5)&7)*255/7),round(((i>>2)&7)*255/7),round((i&3)*255/3))))
   gif.write(b'\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00')
   for frame in range(total):
    t=frame/fps
    approach=min(1,max(0,(t-.5)/2.2)**1.7) if journey else 0
    fade=min(1,max(0,(t-2.6)/.5)) if journey else 0
    f=min(59,frame);count=len(data['objects']);matrices=transforms[f*count*29:(f+1)*count*29]
    pixels=render(t,approach,fade,width,height,True,matrices)
    indexed=bytearray()
    for row in range(height-1,-1,-1):
     for j in range(row*width*4,(row+1)*width*4,4):indexed.append((pixels[j]&224)|((pixels[j+1]>>3)&28)|(pixels[j+2]>>6))
    gif.write(b'\x21\xf9\x04\x04'+struct.pack('<H',round(100/fps))+b'\x00\x00')
    gif.write(b'\x2c'+struct.pack('<HHHHB',0,0,width,height,0)+b'\x08')
    compressed=lzw(indexed)
    for j in range(0,len(compressed),255):block=compressed[j:j+255];gif.write(bytes([len(block)])+block)
    gif.write(b'\x00')
   gif.write(b'\x3b')
  print('Wrote '+name+' (offscreen scene preview, no DOM).',flush=True)
 gif('steady-offscreen-10s.gif',10)
 gif('approach-offscreen.gif',3.5,journey=True)
