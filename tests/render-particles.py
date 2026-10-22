#!/usr/bin/env python3
"""Validate production particle shaders using local EGL/GLES, without a browser.

Only the particle renderer is tested here; this is not a CSS or browser screenshot.
"""
import ctypes as c
import json
import os
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
os.environ['VK_ICD_FILENAMES'] = '/opt/google/chrome/vk_swiftshader_icd.json'
egl = c.CDLL('/opt/google/chrome/libEGL.so'); gl = c.CDLL('/opt/google/chrome/libGLESv2.so')
V, U, N, F, B = c.c_void_p, c.c_uint, c.c_int, c.c_float, c.c_ubyte
PI, PU, PF = c.POINTER(N), c.POINTER(U), c.POINTER(F)
def fn(lib, name, result, *args):
    function = getattr(lib, name); function.restype = result; function.argtypes = list(args); return function
proc = fn(egl, 'eglGetProcAddress', V, c.c_char_p)
get_display = c.CFUNCTYPE(V, U, V, PI)(proc(b'eglGetPlatformDisplayEXT'))
display = get_display(0x3202, None, (N * 5)(0x3203, 0x3450, 0x3209, 0x3487, 0x3038))
major, minor, config, count = N(), N(), V(), N()
assert fn(egl, 'eglInitialize', U, V, PI, PI)(display, c.byref(major), c.byref(minor)), 'EGL init failed'
assert fn(egl, 'eglChooseConfig', U, V, PI, c.POINTER(V), N, PI)(display, (N * 13)(0x3033, 1, 0x3040, 4, 0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3038), c.byref(config), 1, c.byref(count)) and count.value
fn(egl, 'eglBindAPI', U, U)(0x30a0)
surface = fn(egl, 'eglCreatePbufferSurface', V, V, V, PI)(display, config, (N * 5)(0x3057, 1440, 0x3056, 900, 0x3038))
context = fn(egl, 'eglCreateContext', V, V, V, V, PI)(display, config, None, (N * 3)(0x3098, 2, 0x3038))
assert surface and context
assert fn(egl, 'eglMakeCurrent', U, V, V, V, V)(display, surface, surface, context)
data = json.loads((ROOT / 'artifacts/particle-input.json').read_text())
def shader(source, kind):
    handle = fn(gl, 'glCreateShader', U, U)(kind)
    code = c.c_char_p(source.encode()); fn(gl, 'glShaderSource', None, U, N, c.POINTER(c.c_char_p), PI)(handle, 1, c.byref(code), None)
    fn(gl, 'glCompileShader', None, U)(handle); success = N()
    fn(gl, 'glGetShaderiv', None, U, U, PI)(handle, 0x8b81, c.byref(success))
    if not success.value:
        log = c.create_string_buffer(8192); fn(gl, 'glGetShaderInfoLog', None, U, N, PI, c.c_char_p)(handle, 8192, None, log); raise AssertionError(log.value.decode())
    return handle
vertex, fragment = shader(data['vertex'], 0x8b31), shader(data['fragment'], 0x8b30)
program = fn(gl, 'glCreateProgram', U)()
for handle in (vertex, fragment): fn(gl, 'glAttachShader', None, U, U)(program, handle)
fn(gl, 'glLinkProgram', None, U)(program); success = N()
fn(gl, 'glGetProgramiv', None, U, U, PI)(program, 0x8b82, c.byref(success)); assert success.value, 'Particle shader linking failed'
fn(gl, 'glUseProgram', None, U)(program)
buffers = []
for attribute, values, components in [('position', data['positions'], 3), ('color', data['colors'], 3), ('aSize', data['sizes'], 1)]:
    buffer = U(); fn(gl, 'glGenBuffers', None, N, PU)(1, c.byref(buffer)); buffers.append(buffer)
    fn(gl, 'glBindBuffer', None, U, U)(0x8892, buffer.value)
    array = (F * len(values))(*values); fn(gl, 'glBufferData', None, U, c.c_ssize_t, V, U)(0x8892, c.sizeof(array), array, 0x88e4)
    location = fn(gl, 'glGetAttribLocation', N, U, c.c_char_p)(program, attribute.encode()); assert location >= 0
    fn(gl, 'glEnableVertexAttribArray', None, U)(location); fn(gl, 'glVertexAttribPointer', None, U, N, U, B, N, V)(location, components, 0x1406, False, 0, None)
def uniform(name): return fn(gl, 'glGetUniformLocation', N, U, c.c_char_p)(program, name.encode())
fn(gl, 'glEnable', None, U)(0x0be2); fn(gl, 'glBlendFunc', None, U, U)(0x0302, 1)
fn(gl, 'glUniform1f', None, N, F)(uniform('uDpr'), 1)
def render(view, mouse_active):
    width, height = view['width'], view['height']
    fn(gl, 'glViewport', None, N, N, N, N)(0, 0, width, height)
    fn(gl, 'glClearColor', None, F, F, F, F)(4 / 255, 4 / 255, 7 / 255, 1); fn(gl, 'glClear', None, U)(0x4000)
    for name, matrix in [('projectionMatrix', view['projection']), ('modelViewMatrix', view['view'])]:
        fn(gl, 'glUniformMatrix4fv', None, N, N, B, PF)(uniform(name), 1, False, (F * 16)(*matrix))
    fn(gl, 'glUniform2f', None, N, F, F)(uniform('uResolution'), width, height)
    fn(gl, 'glUniform2f', None, N, F, F)(uniform('uMouse'), .5, .5)
    fn(gl, 'glUniform1f', None, N, F)(uniform('uMouseActive'), mouse_active)
    fn(gl, 'glDrawArrays', None, U, N, N)(0, 0, view['count'])
    pixels = (B * (width * height * 4))(); fn(gl, 'glReadPixels', None, N, N, N, N, U, U, V)(0, 0, width, height, 0x1908, 0x1401, pixels)
    assert fn(gl, 'glGetError', U)() == 0, 'GL error during particle render'
    return bytes(pixels)
def png(destination, width, height, pixels):
    def chunk(tag, payload): return struct.pack('!I', len(payload)) + tag + payload + struct.pack('!I', zlib.crc32(tag + payload) & 0xffffffff)
    stride = width * 4; rows = b''.join(b'\0' + pixels[y * stride:(y + 1) * stride] for y in range(height - 1, -1, -1))
    destination.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
results = []
for view in data['views']:
    normal, repelled = render(view, 0), render(view, 1)
    visible = sum(max(normal[i:i + 3]) > 15 for i in range(0, len(normal), 4))
    changed = sum(normal[i:i + 3] != repelled[i:i + 3] for i in range(0, len(normal), 4))
    assert visible > view['count'] // 4, 'Particle field is unexpectedly blank'
    assert changed > 20, 'Mouse repulsion/highlighting has no visible effect'
    for name, pixels in [('normal', normal), ('repelled', repelled)]: png(ROOT / f'artifacts/particles-{view["width"]}-{name}.png', view['width'], view['height'], pixels)
    results.append({'width': view['width'], 'height': view['height'], 'particles': view['count'], 'visiblePixels': visible, 'mouseChangedPixels': changed})
    print(f'PASS: {view["width"]}×{view["height"]}, {view["count"]} particles; {visible} lit pixels, {changed} changed by mouse repulsion')
for buffer in buffers: fn(gl, 'glDeleteBuffers', None, N, PU)(1, c.byref(buffer))
for handle in (vertex, fragment): fn(gl, 'glDeleteShader', None, U)(handle)
fn(gl, 'glDeleteProgram', None, U)(program)
fn(egl, 'eglMakeCurrent', U, V, V, V, V)(display, None, None, None)
fn(egl, 'eglDestroyContext', U, V, V)(display, context); fn(egl, 'eglDestroySurface', U, V, V)(display, surface); fn(egl, 'eglTerminate', U, V)(display)
(ROOT / 'artifacts/particle-results.json').write_text(json.dumps(results, indent=2))
print('PASS: production particle GLSL compiled and rendered without GL errors.')
