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
surface=fn(egl,'eglCreatePbufferSurface',P,P,P,PI)(display,config,(I*5)(0x3057,1800,0x3056,1000,0x3038))
context=fn(egl,'eglCreateContext',P,P,P,P,PI)(display,config,None,(I*3)(0x3098,2,0x3038))
assert surface and context and fn(egl,'eglMakeCurrent',U,P,P,P,P)(display,surface,surface,context)
def g(name,result,*args):return fn(gl,name,result,*args)
def shader(kind,code):
 sh=g('glCreateShader',U,U)(kind);src=C.c_char_p(code.encode());g('glShaderSource',None,U,I,C.POINTER(C.c_char_p),PI)(sh,1,C.byref(src),None);g('glCompileShader',None,U)(sh);ok=I();g('glGetShaderiv',None,U,U,PI)(sh,0x8b81,C.byref(ok))
 if not ok.value:
  log=C.create_string_buffer(4096);g('glGetShaderInfoLog',None,U,I,PI,C.c_char_p)(sh,4096,None,log);raise RuntimeError(log.value)
 return sh
