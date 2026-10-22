#!/usr/bin/env python3
"""Diagnostic EGL views: actual water GLSL/cameras and exported surface textures.
Geometry lighting is approximate; this is not a Three.js/browser screenshot.
"""
from egl_context import *

def program(vertex, fragment, attributes):
    handle=g('glCreateProgram',U)()
    for kind,code in [(0x8b31,vertex),(0x8b30,fragment)]:
        g('glAttachShader',None,U,U)(handle,shader(kind,code))
    for slot,name in enumerate(attributes):
        g('glBindAttribLocation',None,U,U,C.c_char_p)(handle,slot,name.encode())
    g('glLinkProgram',None,U)(handle)
    ok=I();g('glGetProgramiv',None,U,U,PI)(handle,0x8b82,C.byref(ok))
    assert ok.value, 'Diagnostic shader link failed'
    return handle

def location(handle,name):return g('glGetUniformLocation',I,U,C.c_char_p)(handle,name.encode())
def scalar(handle,name,value):g('glUniform1f',None,I,F)(location(handle,name),value)
def integer(handle,name,value):g('glUniform1i',None,I,I)(location(handle,name),value)
def vec3(handle,name,values):g('glUniform3f',None,I,F,F,F)(location(handle,name),*values)
def mat4(handle,name,values):g('glUniformMatrix4fv',None,I,I,B,PF)(location(handle,name),1,False,(F*16)(*values))
def buffer(data,target=0x8892):
    handle=U();g('glGenBuffers',None,I,PU)(1,C.byref(handle));g('glBindBuffer',None,U,U)(target,handle.value)
    g('glBufferData',None,U,C.c_ssize_t,P,U)(target,len(data),C.create_string_buffer(data),0x88e4)
    return handle.value
def attr(slot,handle,size=3):
    if handle:
        g('glEnableVertexAttribArray',None,U)(slot);g('glBindBuffer',None,U,U)(0x8892,handle)
        g('glVertexAttribPointer',None,U,I,U,B,I,P)(slot,size,0x1406,False,0,None)
    else:
        g('glDisableVertexAttribArray',None,U)(slot);g('glVertexAttrib3f',None,U,F,F,F)(slot,1,1,1)
def texture(width,height,pixels=None,repeat=False):
    handle=U();g('glGenTextures',None,I,PU)(1,C.byref(handle));g('glBindTexture',None,U,U)(0x0de1,handle.value)
    for name,value in [(0x2801,0x2601),(0x2800,0x2601),(0x2802,0x2901 if repeat else 0x812f),(0x2803,0x2901 if repeat else 0x812f)]:
        g('glTexParameteri',None,U,U,I)(0x0de1,name,value)
    blob=C.create_string_buffer(pixels) if pixels else None
    g('glTexImage2D',None,U,I,I,I,I,I,U,U,P)(0x0de1,0,0x1908,width,height,0,0x1908,0x1401,blob)
    return handle.value
def png(path,pixels,width,height):
    def chunk(tag,data):return struct.pack('!I',len(data))+tag+data+struct.pack('!I',zlib.crc32(tag+data)&0xffffffff)
    stride=width*4;rows=b''.join(b'\0'+pixels[y*stride:(y+1)*stride] for y in range(height-1,-1,-1))
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b''))

vertex='''attribute vec3 position;attribute vec3 normal;attribute vec3 vertexColor;attribute vec2 uv;
uniform mat4 model;uniform mat4 vp;uniform mat3 normalMatrix;
varying vec3 vNormal;varying vec3 vColor;varying vec2 vUv;varying float depth;
void main(){vec4 p=vp*model*vec4(position,1.);gl_Position=p;vNormal=normalMatrix*normal;vColor=vertexColor;vUv=uv;depth=p.w;}'''
fragment='''precision highp float;varying vec3 vNormal;varying vec3 vColor;varying vec2 vUv;varying float depth;
uniform vec3 color;uniform vec3 fog;uniform float opacity;uniform float unlit;uniform float outputTransfer;
uniform sampler2D image;uniform float hasMap;uniform float mapSrgb;uniform vec2 repeatUv;
vec3 transfer(vec3 c){return mix(c*12.92,1.055*pow(max(c,0.),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
void main(){vec3 pigment=vec3(1.);float alpha=1.;if(hasMap>.5){vec4 texel=texture2D(image,vUv*repeatUv);vec3 s=texel.rgb;alpha=texel.a;pigment=mapSrgb>.5?mix(s/12.92,pow((s+.055)/1.055,vec3(2.4)),step(vec3(.04045),s)):s;}
float diffuse=max(0.,dot(normalize(vNormal),normalize(vec3(.4,.7,-.8))));
vec3 c=color*vColor*pigment*(.85+diffuse*.65);if(unlit>.5)c=color*vColor*pigment;
if(unlit<.5)c=mix(c,fog,1.-exp(-pow(max(depth,0.)*.009,2.)));
if(outputTransfer>.5)c=transfer(c/(c+vec3(.6)));
gl_FragColor=vec4(c,opacity*alpha);}'''
sceneProgram=program(vertex,fragment,['position','normal','vertexColor','uv'])
waterSource=json.loads((OUT/'water-shader.json').read_text())
waterProgram=program(waterSource['vertex'],waterSource['fragment'],['position','uv'])
waterPosition=buffer(array.array('f',[-.5,-.5,0,.5,-.5,0,-.5,.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0]).tobytes())
waterUv=buffer(array.array('f',[0,0,1,0,0,1,1,0,1,1,0,1]).tobytes())
g('glEnable',None,U)(0x0b71);g('glBlendFunc',None,U,U)(0x0302,0x0303)
rendered=[]
for sceneId in ['00','02','03','06','08','09']:
    path=OUT/f'scene-{sceneId}.json'
    if not path.exists():continue
    data=json.loads(path.read_text());width,height=data['size'];geometries=[];buffers=[];textures=[]
    for geo in data['geometries']:
        handles=[buffer(base64.b64decode(geo[key])) if geo.get(key) else 0 for key in ['position','normal','color','uv']]
        idx=geo['index'];ib=buffer(array.array('I',idx).tobytes(),0x8893) if idx else 0
        geometries.append((*handles,ib,len(idx) if idx else geo['count']));buffers.extend([x for x in handles+[ib] if x])
    for imageData in data['textures']:
        w,h=imageData['width'],imageData['height'];pixels=base64.b64decode(imageData['pixels']);stride=w*4
        pixels=b''.join(pixels[y*stride:(y+1)*stride] for y in range(h-1,-1,-1))
        textures.append(texture(w,h,pixels,True))
    reflectionTexture=texture(512,512);fbo=U();depth=U()
    g('glGenFramebuffers',None,I,PU)(1,C.byref(fbo));g('glBindFramebuffer',None,U,U)(0x8d40,fbo.value)
    g('glFramebufferTexture2D',None,U,U,U,U,I)(0x8d40,0x8ce0,0x0de1,reflectionTexture,0)
    g('glGenRenderbuffers',None,I,PU)(1,C.byref(depth));g('glBindRenderbuffer',None,U,U)(0x8d41,depth.value)
    g('glRenderbufferStorage',None,U,U,I,I)(0x8d41,0x81a5,512,512)
    g('glFramebufferRenderbuffer',None,U,U,U,U)(0x8d40,0x8d00,0x8d41,depth.value)
    assert g('glCheckFramebufferStatus',U,U)(0x8d40)==0x8cd5
    def drawScene(vp,output,transparent):
        g('glUseProgram',None,U)(sceneProgram);mat4(sceneProgram,'vp',vp);vec3(sceneProgram,'fog',data['fog']);scalar(sceneProgram,'outputTransfer',output)
        g('glEnable' if transparent else 'glDisable',None,U)(0x0be2);g('glDepthMask',None,B)(not transparent)
        for obj in data['objects']:
            if obj['water'] or (obj['opacity']<1)!=transparent:continue
            pos,norm,col,uv,idx,count=geometries[obj['geometry']]
            attr(0,pos);attr(1,norm);attr(2,col if obj['vertexColors'] else 0);attr(3,uv,2)
            mat4(sceneProgram,'model',obj['transform'][:16]);g('glUniformMatrix3fv',None,I,I,B,PF)(location(sceneProgram,'normalMatrix'),1,False,(F*9)(*obj['transform'][16:]))
            vec3(sceneProgram,'color',obj['rawColor']);scalar(sceneProgram,'opacity',obj['opacity']);scalar(sceneProgram,'unlit',obj['unlit'])
            texId=obj['texture'];scalar(sceneProgram,'hasMap',texId is not None)
            if texId is not None:
                g('glActiveTexture',None,U)(0x84c0);g('glBindTexture',None,U,U)(0x0de1,textures[texId]);integer(sceneProgram,'image',0)
                g('glUniform2f',None,I,F,F)(location(sceneProgram,'repeatUv'),*data['textures'][texId]['repeat'])
                scalar(sceneProgram,'mapSrgb',data['textures'][texId]['srgb'])
            if idx:g('glBindBuffer',None,U,U)(0x8893,idx);g('glDrawElements',None,U,I,U,P)(4,count,0x1405,None)
            else:g('glDrawArrays',None,U,I,I)(4,0,count)
        g('glDepthMask',None,B)(True)
    for view,water in enumerate(data['waterData']):
        g('glBindFramebuffer',None,U,U)(0x8d40,fbo.value);g('glViewport',None,I,I,I,I)(0,0,512,512)
        g('glClearColor',None,F,F,F,F)(*data['background'],1);g('glClear',None,U)(0x4100)
        drawScene(water['vp'],0,False);drawScene(water['vp'],0,True)
        g('glBindFramebuffer',None,U,U)(0x8d40,0);g('glViewport',None,I,I,I,I)(0,0,width,height);g('glClear',None,U)(0x4100)
        drawScene(data['views'][view],1,False)
        g('glUseProgram',None,U)(waterProgram);g('glDisable',None,U)(0x0be2)
        attr(0,waterPosition);attr(1,waterUv,2);g('glDisableVertexAttribArray',None,U)(2);g('glDisableVertexAttribArray',None,U)(3)
        # The exported plane matrices include its actual dimensions below.
        model=list(water['model']);mv=list(water['modelView'])
        for k in range(4):model[k]*=water['width'];mv[k]*=water['width'];model[k+4]*=water['depth'];mv[k+4]*=water['depth']
        tm=list(water['textureMatrix'])
        for k in range(4):tm[k]*=water['width'];tm[k+4]*=water['depth']
        for name,value in [('modelMatrix',model),('modelViewMatrix',mv),('projectionMatrix',water['projection']),('textureMatrix',tm)]:mat4(waterProgram,name,value)
        vec3(waterProgram,'cameraPosition',water['camera']);vec3(waterProgram,'uSun',water['sun']);vec3(waterProgram,'color',water['color'])
        scalar(waterProgram,'uTime',3.2);scalar(waterProgram,'uAmplitude',2);scalar(waterProgram,'toneMappingExposure',1.02)
        g('glUniform2f',None,I,F,F)(location(waterProgram,'uInvViewport'),1/width,1/height)
        integer(waterProgram,'uPuddleCount',len(water['puddles']))
        for k,p in enumerate(water['puddles']):g('glUniform4f',None,I,F,F,F,F)(location(waterProgram,f'uPuddles[{k}]'),p['x'],p['z'],p['rx'],p['rz'])
        g('glActiveTexture',None,U)(0x84c0);g('glBindTexture',None,U,U)(0x0de1,reflectionTexture);integer(waterProgram,'tDiffuse',0)
        g('glDrawArrays',None,U,I,I)(4,0,6);drawScene(data['views'][view],1,True)
        pixels=(B*(width*height*4))();g('glReadPixels',None,I,I,I,I,U,U,P)(0,0,width,height,0x1908,0x1401,pixels)
        assert not g('glGetError',U)()
        target=OUT/f'reflection-{sceneId}-view-{view+1}.png';png(target,bytes(pixels),width,height);rendered.append(target.name);print('Rendered',target.name,flush=True)
    for handle in buffers:g('glDeleteBuffers',None,I,PU)(1,C.byref(U(handle)))
    for handle in textures+[reflectionTexture]:g('glDeleteTextures',None,I,PU)(1,C.byref(U(handle)))
    g('glDeleteFramebuffers',None,I,PU)(1,C.byref(fbo));g('glDeleteRenderbuffers',None,I,PU)(1,C.byref(depth))
(OUT/'reflection-method.json').write_text(json.dumps({'status':'rendered','method':'EGL diagnostic with actual runtime water shader, actual Reflector camera/projection and projective texture matrix, actual geometry and brush textures.','views':[path.name for path in sorted(OUT.glob('reflection-*-view-*.png'))],'limits':['Approximate scene lighting, no Three.js shadow maps','No browser DOM, CSS, or interaction acceptance','Not a browser screenshot or full visual acceptance']},indent=2))
