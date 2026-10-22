#!/usr/bin/env python3
"""EGL geometry previews using actual exported meshes. Approximate lighting only.
These are NOT browser screenshots; Three.js materials/reflection/DOM are not captured.
No third-party Python modules are required.
"""
import ctypes as C, os, json, array, base64, zlib, struct
from pathlib import Path
OUT=Path(__file__).resolve().parents[1]/'artifacts/offscreen'
os.environ['VK_ICD_FILENAMES']='/opt/google/chrome/vk_swiftshader_icd.json'
egl=C.CDLL('/opt/google/chrome/libEGL.so');gl=C.CDLL('/opt/google/chrome/libGLESv2.so')
P,U,I,F,B=C.c_void_p,C.c_uint,C.c_int,C.c_float,C.c_ubyte
PI,PU,PF=C.POINTER(I),C.POINTER(U),C.POINTER(F)
def fn(lib,name,result,*args):
 f=getattr(lib,name);f.restype=result;f.argtypes=list(args);return f
proc=fn(egl,'eglGetProcAddress',P,C.c_char_p)
platform=C.CFUNCTYPE(P,U,P,PI)(proc(b'eglGetPlatformDisplayEXT'))
display=platform(0x3202,None,(I*5)(0x3203,0x3450,0x3209,0x3487,0x3038))
major,minor,config,count=I(),I(),P(),I()
assert fn(egl,'eglInitialize',U,P,PI,PI)(display,C.byref(major),C.byref(minor))
assert fn(egl,'eglChooseConfig',U,P,PI,C.POINTER(P),I,PI)(display,(I*15)(0x3033,1,0x3040,4,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3025,24,0x3038),C.byref(config),1,C.byref(count)) and count.value
fn(egl,'eglBindAPI',U,U)(0x30a0)
surface=fn(egl,'eglCreatePbufferSurface',P,P,P,PI)(display,config,(I*5)(0x3057,1200,0x3056,750,0x3038))
context=fn(egl,'eglCreateContext',P,P,P,P,PI)(display,config,None,(I*3)(0x3098,2,0x3038))
assert surface and context and fn(egl,'eglMakeCurrent',U,P,P,P,P)(display,surface,surface,context)
def g(name,result,*args):return fn(gl,name,result,*args)
def shader(kind,code):
 sh=g('glCreateShader',U,U)(kind);src=C.c_char_p(code.encode());g('glShaderSource',None,U,I,C.POINTER(C.c_char_p),PI)(sh,1,C.byref(src),None);g('glCompileShader',None,U)(sh);ok=I();g('glGetShaderiv',None,U,U,PI)(sh,0x8b81,C.byref(ok))
 if not ok.value:
  log=C.create_string_buffer(4096);g('glGetShaderInfoLog',None,U,I,PI,C.c_char_p)(sh,4096,None,log);raise RuntimeError(log.value)
 return sh
vs='''attribute vec3 position;attribute vec3 normal;attribute vec3 vertexColor;uniform mat4 model;uniform mat4 vp;uniform mat3 normalMatrix;varying vec3 vN;varying vec3 vColor;varying float depth;void main(){vec4 world=model*vec4(position,1.);vec4 p=vp*world;gl_Position=p;vN=normalize(normalMatrix*normal);vColor=vertexColor;depth=p.w;}'''
fs='''precision highp float;varying vec3 vN;varying vec3 vColor;varying float depth;uniform vec3 color;uniform vec3 fog;uniform float opacity;uniform float unlit;void main(){float diffuse=max(0.,dot(normalize(vN),normalize(vec3(-.4,.9,.3))));vec3 c=color*vColor*(.68+diffuse*.62);if(unlit>.5)c=color*vColor;c=mix(c,fog,1.-exp(-pow(depth*.008,2.)));gl_FragColor=vec4(pow(c,vec3(1./2.2)),opacity);}'''
program=g('glCreateProgram',U)();g('glAttachShader',None,U,U)(program,shader(0x8b31,vs));g('glAttachShader',None,U,U)(program,shader(0x8b30,fs))
for i,name in enumerate(['position','normal','vertexColor']):g('glBindAttribLocation',None,U,U,C.c_char_p)(program,i,name.encode())
g('glLinkProgram',None,U)(program);g('glUseProgram',None,U)(program)
uniform={name:g('glGetUniformLocation',I,U,C.c_char_p)(program,name.encode()) for name in ['model','vp','normalMatrix','color','fog','opacity','unlit']}
def buffer(data,target=0x8892):
 handle=U();g('glGenBuffers',None,I,PU)(1,C.byref(handle));g('glBindBuffer',None,U,U)(target,handle.value);blob=C.create_string_buffer(data);g('glBufferData',None,U,C.c_ssize_t,P,U)(target,len(data),blob,0x88e4);return handle.value
def attr(slot,handle):
 if handle:g('glEnableVertexAttribArray',None,U)(slot);g('glBindBuffer',None,U,U)(0x8892,handle);g('glVertexAttribPointer',None,U,I,U,B,I,P)(slot,3,0x1406,False,0,None)
 else:g('glDisableVertexAttribArray',None,U)(slot);g('glVertexAttrib3f',None,U,F,F,F)(slot,1,1,1)
def png(path,pixels,w=1200,h=750):
 def chunk(t,b):return struct.pack('!I',len(b))+t+b+struct.pack('!I',zlib.crc32(t+b)&0xffffffff)
 stride=w*4;rows=b''.join(b'\0'+pixels[y*stride:(y+1)*stride] for y in range(h-1,-1,-1))
 path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b''))
g('glEnable',None,U)(0x0b71);g('glBlendFunc',None,U,U)(0x0302,0x0303)
for path in sorted(OUT.glob('scene-*.json')):
 data=json.loads(path.read_text());w,h=data.get('size',[1200,750]);geometries=[];allocated=[]
 for geo in data['geometries']:
  handles=[buffer(base64.b64decode(geo[n])) if geo.get(n) else 0 for n in ['position','normal','color']];index=geo['index'];ib=buffer(array.array('I',index).tobytes(),0x8893) if index else 0;geometries.append((*handles,ib,len(index) if index else geo['count']));allocated.extend([x for x in handles+[ib] if x])
 for view_index,vp in enumerate(data['views']):
  if view_index==1 and data['id'] not in ['01','02','04','06','07']:continue
  g('glViewport',None,I,I,I,I)(0,0,w,h);g('glClearColor',None,F,F,F,F)(*[v**(1/2.2) for v in data['background']],1);g('glClear',None,U)(0x4100)
  g('glUniformMatrix4fv',None,I,I,B,PF)(uniform['vp'],1,False,(F*16)(*vp));g('glUniform3f',None,I,F,F,F)(uniform['fog'],*data['fog'])
  for transparent in [False,True]:
   g('glEnable' if transparent else 'glDisable',None,U)(0x0be2);g('glDepthMask',None,B)(not transparent)
   for obj in data['objects']:
    if (obj['opacity']<1)!=transparent:continue
    pos,norm,col,idx,num=geometries[obj['geometry']];attr(0,pos);attr(1,norm);attr(2,col if obj['vertexColors'] else 0)
    g('glUniformMatrix4fv',None,I,I,B,PF)(uniform['model'],1,False,(F*16)(*obj['transform'][:16]));g('glUniformMatrix3fv',None,I,I,B,PF)(uniform['normalMatrix'],1,False,(F*9)(*obj['transform'][16:]));g('glUniform3f',None,I,F,F,F)(uniform['color'],*obj['color']);g('glUniform1f',None,I,F)(uniform['opacity'],obj['opacity']);g('glUniform1f',None,I,F)(uniform['unlit'],obj['unlit'])
    if idx:g('glBindBuffer',None,U,U)(0x8893,idx);g('glDrawElements',None,U,I,U,P)(4,num,0x1405,None)
    else:g('glDrawArrays',None,U,I,I)(4,0,num)
  g('glDepthMask',None,B)(True);pixels=(B*(w*h*4))();g('glReadPixels',None,I,I,I,I,U,U,P)(0,0,w,h,0x1908,0x1401,pixels);assert not g('glGetError',U)();target=OUT/f'dream-{data["id"]}-view-{view_index+1}.png';png(target,bytes(pixels),w,h);print('Rendered',target.name,flush=True)
 for handle in allocated:g('glDeleteBuffers',None,I,PU)(1,C.byref(U(handle)))
 path.unlink()
(OUT/'method.json').write_text(json.dumps({'method':'Actual Three.js mesh geometry rendered through EGL with a diagnostic shader. NOT browser screenshots.','width':1200,'height':750,'limits':['Approximate matte lighting','No DOM or CSS layout','No browser water reflection or texture shading'],'views':15},indent=2))
