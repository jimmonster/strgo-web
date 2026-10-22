#!/usr/bin/env python3
"""Offscreen EGL geometry previews, NOT browser screenshots or a browser recording.

Uses actual Three.js scene meshes and animation transforms, with a small validation
shader (approximate lighting, no canvas labels/PBR). No third-party Python packages.
"""
import array
import ctypes as c
import json
import math
import os
from pathlib import Path
import struct
import sys
import zlib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/scenes'
data = json.loads((OUT / 'render-input.json').read_text())
os.environ['VK_ICD_FILENAMES'] = '/opt/google/chrome/vk_swiftshader_icd.json'
egl = c.CDLL('/opt/google/chrome/libEGL.so'); gl = c.CDLL('/opt/google/chrome/libGLESv2.so')
V, U, N, F, B = c.c_void_p, c.c_uint, c.c_int, c.c_float, c.c_ubyte
PI, PU, PF = c.POINTER(N), c.POINTER(U), c.POINTER(F)
def fn(lib, name, result, *args):
    f = getattr(lib, name); f.restype = result; f.argtypes = list(args); return f
proc = fn(egl, 'eglGetProcAddress', V, c.c_char_p)
get_display = c.CFUNCTYPE(V, U, V, PI)(proc(b'eglGetPlatformDisplayEXT'))
display = get_display(0x3202, None, (N * 5)(0x3203, 0x3450, 0x3209, 0x3487, 0x3038))
major, minor, config, count = N(), N(), V(), N()
assert fn(egl, 'eglInitialize', U, V, PI, PI)(display, c.byref(major), c.byref(minor))
assert fn(egl, 'eglChooseConfig', U, V, PI, c.POINTER(V), N, PI)(display, (N * 15)(0x3033, 1, 0x3040, 4, 0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3025, 24, 0x3038), c.byref(config), 1, c.byref(count)) and count.value
fn(egl, 'eglBindAPI', U, U)(0x30a0)
surface = fn(egl, 'eglCreatePbufferSurface', V, V, V, PI)(display, config, (N * 5)(0x3057, 1200, 0x3056, 800, 0x3038))
context = fn(egl, 'eglCreateContext', V, V, V, V, PI)(display, config, None, (N * 3)(0x3098, 2, 0x3038))
assert surface and context and fn(egl, 'eglMakeCurrent', U, V, V, V, V)(display, surface, surface, context)
def g(name, result, *args): return fn(gl, name, result, *args)
uniform1f = g('glUniform1f', None, N, F); uniform1i = g('glUniform1i', None, N, N)
uniform3f = g('glUniform3f', None, N, F, F, F)
uniform4f = g('glUniform4f', None, N, F, F, F, F)
matrix4 = g('glUniformMatrix4fv', None, N, N, B, PF); matrix3 = g('glUniformMatrix3fv', None, N, N, B, PF)
bind_buffer = g('glBindBuffer', None, U, U); pointer = g('glVertexAttribPointer', None, U, N, U, B, N, V)
enable = g('glEnable', None, U); disable = g('glDisable', None, U)
draw_arrays = g('glDrawArrays', None, U, N, N); draw_elements = g('glDrawElements', None, U, N, U, V)
use = g('glUseProgram', None, U); viewport = g('glViewport', None, N, N, N, N)
clear = g('glClear', None, U); clear_color = g('glClearColor', None, F, F, F, F)
bind_fb = g('glBindFramebuffer', None, U, U)
def shader(source, kind):
    handle = g('glCreateShader', U, U)(kind); code = c.c_char_p(source.encode())
    g('glShaderSource', None, U, N, c.POINTER(c.c_char_p), PI)(handle, 1, c.byref(code), None)
    g('glCompileShader', None, U)(handle); success = N(); g('glGetShaderiv', None, U, U, PI)(handle, 0x8b81, c.byref(success))
    if not success.value:
        log = c.create_string_buffer(8192); g('glGetShaderInfoLog', None, U, N, PI, c.c_char_p)(handle, 8192, None, log); raise RuntimeError(log.value.decode())
    return handle
def program(vertex, fragment):
    result = g('glCreateProgram', U)()
    for handle in [shader(vertex, 0x8b31), shader(fragment, 0x8b30)]: g('glAttachShader', None, U, U)(result, handle)
    g('glBindAttribLocation', None, U, U, c.c_char_p)(result, 0, b'position'); g('glBindAttribLocation', None, U, U, c.c_char_p)(result, 1, b'normal')
    g('glLinkProgram', None, U)(result); success = N(); g('glGetProgramiv', None, U, U, PI)(result, 0x8b82, c.byref(success)); assert success.value
    return result
vertex = '''precision highp float;
attribute vec3 position; attribute vec3 normal;
uniform mat4 model, vp, lightVP; uniform mat3 normalMatrix;
varying vec3 vNormal; varying vec3 vWorld; varying vec4 vShadow;
void main(){vec4 p=model*vec4(position,1.);vWorld=p.xyz;vNormal=normalize(normalMatrix*normal);vShadow=lightVP*p;gl_Position=vp*p;}
'''
fragment = '''precision highp float;
varying vec3 vNormal; varying vec3 vWorld; varying vec4 vShadow;
uniform vec3 color, emissive; uniform float opacity, unlit, night, exposure, receiveShadow;
uniform sampler2D shadowMap;
float unpackDepth(vec4 v){return dot(v,vec4(1.,1./255.,1./65025.,1./16581375.));}
vec3 aces(vec3 c){return clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);}
void main(){
 vec3 n=normalize(vNormal), l=normalize(mix(vec3(-3.,11.,-8.),vec3(0.,8.,6.),night));
 vec3 uv=vShadow.xyz/vShadow.w*.5+.5; float shadow=1.;
 if(uv.x>0.&&uv.x<1.&&uv.y>0.&&uv.y<1.&&uv.z>0.&&uv.z<1.&&receiveShadow>.5){
  float sum=0.;float bias=.0009+.0015*(1.-max(dot(n,l),0.));
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)sum+=uv.z-bias>unpackDepth(texture2D(shadowMap,uv.xy+vec2(float(x),float(y))/1024.))?.25:1.;shadow=sum/9.;
 }
 float diffuse=max(dot(n,l),0.);vec3 ambient=mix(vec3(.47,.48,.37),vec3(.21,.26,.38),night)*(.6+.4*(n.y*.5+.5));
 vec3 lit=ambient+mix(vec3(1.8,1.59,1.24),vec3(1.8,1.65,1.4),night)*diffuse*shadow;
 lit+=vec3(.23,.3,.5)*max(dot(n,normalize(vec3(-4.,5.,-5.))),0.)*night;
 vec3 c=mix(color*lit+emissive,color,unlit);c=aces(c*exposure);c=pow(c,vec3(1./2.2));gl_FragColor=vec4(c,opacity);
}
'''
depth_program = program('precision highp float;attribute vec3 position;uniform mat4 model,vp;void main(){gl_Position=vp*model*vec4(position,1.);}', '''precision highp float;void main(){vec4 v=fract(gl_FragCoord.z*vec4(1.,255.,65025.,16581375.));v-=v.yzww*vec4(1./255.,1./255.,1./255.,0.);gl_FragColor=v;}''')
main_program = program(vertex, fragment)
def uniforms(prog, names): return {name: g('glGetUniformLocation', N, U, c.c_char_p)(prog, name.encode()) for name in names.split()}
du = uniforms(depth_program, 'model vp'); u = uniforms(main_program, 'model vp lightVP normalMatrix color emissive opacity unlit night exposure receiveShadow shadowMap')
def buffer(values, kind, target=0x8892):
    handle = U(); g('glGenBuffers', None, N, PU)(1, c.byref(handle)); bind_buffer(target, handle.value)
    a = (kind * len(values))(*values); g('glBufferData', None, U, c.c_ssize_t, V, U)(target, c.sizeof(a), a, 0x88e4); return handle.value
geometries = []
for geo in data['geometries']:
    geometries.append((buffer(geo['position'], F), buffer(geo['normal'], F), buffer(geo['index'], c.c_ushort, 0x8893) if geo['index'] else None, len(geo['index']) if geo['index'] else len(geo['position']) // 3))
texture, framebuffer, depth = U(), U(), U()
g('glGenTextures', None, N, PU)(1, c.byref(texture)); g('glBindTexture', None, U, U)(0x0de1, texture.value)
g('glTexImage2D', None, U, N, N, N, N, N, U, U, V)(0x0de1, 0, 0x1908, 1024, 1024, 0, 0x1908, 0x1401, None)
for option, value in [(0x2801, 0x2600), (0x2800, 0x2600), (0x2802, 0x812f), (0x2803, 0x812f)]: g('glTexParameteri', None, U, U, N)(0x0de1, option, value)
g('glGenFramebuffers', None, N, PU)(1, c.byref(framebuffer)); bind_fb(0x8d40, framebuffer.value)
g('glFramebufferTexture2D', None, U, U, U, U, N)(0x8d40, 0x8ce0, 0x0de1, texture.value, 0)
g('glGenRenderbuffers', None, N, PU)(1, c.byref(depth)); g('glBindRenderbuffer', None, U, U)(0x8d41, depth.value)
g('glRenderbufferStorage', None, U, U, N, N)(0x8d41, 0x81a5, 1024, 1024)
g('glFramebufferRenderbuffer', None, U, U, U, U)(0x8d40, 0x8d00, 0x8d41, depth.value)
assert g('glCheckFramebufferStatus', U, U)(0x8d40) == 0x8cd5
enable(0x0b71); g('glEnableVertexAttribArray', None, U)(0)
g('glBlendFunc', None, U, U)(0x0302, 0x0303)
def draw(record, transform, shadow=False):
    p, n, index, count = geometries[record['geometry']]
    matrix4((du if shadow else u)['model'], 1, False, (F * 16)(*transform[:16]))
    if not shadow:
        matrix3(u['normalMatrix'], 1, False, (F * 9)(*transform[16:25])); uniform3f(u['color'], *record['color']); uniform3f(u['emissive'], *record['emissive'])
        uniform1f(u['opacity'], record['opacity']); uniform1f(u['unlit'], record['unlit']); uniform1f(u['receiveShadow'], record['shadow'])
        bind_buffer(0x8892, n); pointer(1, 3, 0x1406, False, 0, None)
    bind_buffer(0x8892, p); pointer(0, 3, 0x1406, False, 0, None)
    if index: bind_buffer(0x8893, index); draw_elements(4, count, 0x1403, None)
    else: draw_arrays(4, 0, count)
def render(objects, view, night=False, transforms=None, shadows=True):
    matrices = transforms if transforms is not None else [r['transform'] for r in objects]
    if shadows:
        bind_fb(0x8d40, framebuffer.value); viewport(0, 0, 1024, 1024); clear_color(1, 1, 1, 1); clear(0x4100); use(depth_program); disable(0x0be2)
        g('glDisableVertexAttribArray', None, U)(1); matrix4(du['vp'], 1, False, (F * 16)(*view['lightMatrix']))
        for record, transform in zip(objects, matrices):
            if record['shadow']: draw(record, transform, True)
    bind_fb(0x8d40, 0); viewport(0, 0, view['width'], view['height']); clear_color(*[pow(v, 1/2.2) for v in view['background']], 1); clear(0x4100)
    use(main_program); g('glEnableVertexAttribArray', None, U)(1)
    matrix4(u['vp'], 1, False, (F * 16)(*view['viewProjection'])); matrix4(u['lightVP'], 1, False, (F * 16)(*view['lightMatrix']))
    uniform1f(u['night'], night); uniform1f(u['exposure'], view['exposure']); uniform1i(u['shadowMap'], 0)
    disable(0x0be2)
    for record, transform in zip(objects, matrices):
        if record['opacity'] == 1: draw(record, transform)
    enable(0x0be2); g('glDepthMask', None, B)(False)
    for record, transform in zip(objects, matrices):
        if record['opacity'] < 1: draw(record, transform)
    g('glDepthMask', None, B)(True)
    width, height = view['width'], view['height']; pixels = (B * (width * height * 4))()
    g('glReadPixels', None, N, N, N, N, U, U, V)(0, 0, width, height, 0x1908, 0x1401, pixels)
    assert g('glGetError', U)() == 0
    return bytes(pixels)
def png(name, width, height, pixels):
    def chunk(tag, payload): return struct.pack('!I', len(payload)) + tag + payload + struct.pack('!I', zlib.crc32(tag + payload) & 0xffffffff)
    stride = width * 4; rows = b''.join(b'\0' + pixels[y * stride:(y + 1) * stride] for y in range(height - 1, -1, -1))
    (OUT / name).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
for name, scene, which in [('bedroom-offscreen.png', 'bedroom', 0), ('garden-offscreen.png', 'bedroom', 1), ('stage-offscreen.png', 'stage', 0)]:
    view = data[scene]['views'][which]; pixels = render(data[scene]['objects'], view, scene == 'stage')
    png(name, view['width'], view['height'], pixels); print(f'Wrote {name} (offscreen geometry preview)', flush=True)
if '--stills' in sys.argv: sys.exit(0)

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
animation = data['animation']; width, height = animation['width'], animation['height']; total = animation['frames']; count = animation['objects']
transforms = array.array('f'); transforms.frombytes((OUT / 'dance-transforms.bin').read_bytes())
with (OUT / 'dance-offscreen.gif').open('wb') as gif:
    gif.write(b'GIF89a' + struct.pack('<HHBBB', width, height, 0xf7, 0, 0))
    gif.write(bytes(v for i in range(256) for v in (round(((i >> 5) & 7) * 255 / 7), round(((i >> 2) & 7) * 255 / 7), round((i & 3) * 255 / 3))))
    gif.write(b'\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00')
    for frame in range(total):
        offset = frame * count * 25
        matrices = [transforms[offset + i * 25:offset + (i + 1) * 25] for i in range(count)]
        pixels = render(data['stage']['objects'], animation['view'], True, matrices)
        indexed = bytearray()
        for row in range(height - 1, -1, -1):
            for j in range(row * width * 4, (row + 1) * width * 4, 4): indexed.append((pixels[j] & 224) | ((pixels[j + 1] >> 3) & 28) | (pixels[j + 2] >> 6))
        gif.write(b'\x21\xf9\x04\x04' + struct.pack('<H', 17 if frame % 3 else 16) + b'\x00\x00')
        gif.write(b'\x2c' + struct.pack('<HHHHB', 0, 0, width, height, 0) + b'\x08')
        compressed = lzw(indexed)
        for j in range(0, len(compressed), 255): block = compressed[j:j + 255]; gif.write(bytes([len(block)]) + block)
        gif.write(b'\x00')
        if frame % 24 == 0: print(f'Animation {frame}/{total}', flush=True)
    gif.write(b'\x3b')
(OUT / 'offscreen-results.json').write_text(json.dumps({'method': 'EGL geometry validation shader, not browser', 'stills': 3, 'animationFrames': total, 'fps': animation['fps'], 'duration': total / animation['fps']}, indent=2))
print('Offscreen animation written. Browser material/layout/interaction acceptance remains pending.', flush=True)
