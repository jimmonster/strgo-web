"""Preview assets from actual procedural geometry. Diagnostic EGL lighting, not browser screenshots."""
import ctypes as C, json, base64, array, sys
from pathlib import Path
from egl_context import *
import struct,zlib
def png(path,pixels,w,h):
 def chunk(t,b):return struct.pack('!I',len(b))+t+b+struct.pack('!I',zlib.crc32(t+b)&0xffffffff)
 stride=w*4;rows=b''.join(b'\0'+pixels[y*stride:(y+1)*stride]for y in range(h-1,-1,-1));path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows,6))+chunk(b'IEND',b''))

vs='''attribute vec3 position;attribute vec3 normal;attribute vec3 vertexColor;uniform mat4 model;uniform mat4 vp;uniform mat3 normalMatrix;varying vec3 N;varying vec3 V;varying vec3 W;void main(){vec4 p=model*vec4(position,1.);gl_Position=vp*p;N=normalize(normalMatrix*normal);V=vertexColor;W=p.xyz;}'''
fs='''precision highp float;varying vec3 N;varying vec3 V;varying vec3 W;uniform vec3 color;uniform float unlit;vec3 aces(vec3 c){return clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);}void main(){vec3 n=normalize(N);float d=max(dot(n,normalize(vec3(-3.,5.,6.))),0.);float rim=max(dot(n,normalize(vec3(4.,2.,-3.))),0.);vec3 c=color*V*(vec3(.55,.42,.5)+d*vec3(1.45,1.32,1.2)+rim*vec3(.46,.19,.3));c=mix(c,color*V,unlit);gl_FragColor=vec4(pow(aces(c),vec3(1./2.2)),1.);}'''
program=g('glCreateProgram',U)();g('glAttachShader',None,U,U)(program,shader(0x8b31,vs));g('glAttachShader',None,U,U)(program,shader(0x8b30,fs))
for i,name in enumerate(['position','normal','vertexColor']):g('glBindAttribLocation',None,U,U,C.c_char_p)(program,i,name.encode())
g('glLinkProgram',None,U)(program);g('glUseProgram',None,U)(program)
loc={n:g('glGetUniformLocation',I,U,C.c_char_p)(program,n.encode())for n in ['model','vp','normalMatrix','color','unlit']}
def buffer(data,target=0x8892):
 h=U();g('glGenBuffers',None,I,PU)(1,C.byref(h));g('glBindBuffer',None,U,U)(target,h.value);blob=C.create_string_buffer(data);g('glBufferData',None,U,C.c_ssize_t,P,U)(target,len(data),blob,0x88e4);return h.value
def attr(slot,handle):
 if handle:g('glEnableVertexAttribArray',None,U)(slot);g('glBindBuffer',None,U,U)(0x8892,handle);g('glVertexAttribPointer',None,U,I,U,B,I,P)(slot,3,0x1406,False,0,None)
 else:g('glDisableVertexAttribArray',None,U)(slot);g('glVertexAttrib3f',None,U,F,F,F)(slot,1,1,1)
g('glEnable',None,U)(0x0b71)
for path in sorted(Path('artifacts/render').glob('*.json')):
 if len(sys.argv)>1 and sys.argv[1] not in path.stem:continue
 d=json.loads(path.read_text());w,h=d['width'],d['height'];geos=[];allocated=[]
 for geo in d['geometries']:
  handles=[buffer(base64.b64decode(geo[n]))if geo.get(n)else 0 for n in ['position','normal','color']];idx=buffer(array.array('I',geo['index']).tobytes(),0x8893)if geo['index']else 0;geos.append((*handles,idx,len(geo['index'])if geo['index']else geo['count']));allocated+=handles+[idx]
 g('glViewport',None,I,I,I,I)(0,0,w,h);g('glClearColor',None,F,F,F,F)(0,0,0,0);g('glClear',None,U)(0x4100);g('glUniformMatrix4fv',None,I,I,B,PF)(loc['vp'],1,False,(F*16)(*d['view']))
 for obj in d['objects']:
  pos,norm,col,idx,num=geos[obj['geometry']];attr(0,pos);attr(1,norm);attr(2,col if obj['vertexColors']else 0)
  g('glUniformMatrix4fv',None,I,I,B,PF)(loc['model'],1,False,(F*16)(*obj['transform'][:16]));g('glUniformMatrix3fv',None,I,I,B,PF)(loc['normalMatrix'],1,False,(F*9)(*obj['transform'][16:]));g('glUniform3f',None,I,F,F,F)(loc['color'],*obj['color']);g('glUniform1f',None,I,F)(loc['unlit'],obj['unlit'])
  if idx:g('glBindBuffer',None,U,U)(0x8893,idx);g('glDrawElements',None,U,I,U,P)(4,num,0x1405,None)
  else:g('glDrawArrays',None,U,I,I)(4,0,num)
 pixels=(B*(w*h*4))();g('glReadPixels',None,I,I,I,I,U,U,P)(0,0,w,h,0x1908,0x1401,pixels);assert not g('glGetError',U)()
 target=Path('artifacts')/(path.stem+'.png')if path.stem.startswith('gray-')else Path('assets/previews')/(path.stem+'.png');png(target,bytes(pixels),w,h)
 for handle in allocated:
  if handle:g('glDeleteBuffers',None,I,PU)(1,C.byref(U(handle)))
 print('Rendered',target,flush=True)
