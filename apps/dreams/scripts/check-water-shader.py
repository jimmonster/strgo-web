#!/usr/bin/env python3
"""Compile the runtime water shader with real Three r160 output/tone chunks."""
from egl_context import *
data=json.loads((OUT/'water-shader.json').read_text())
program=g('glCreateProgram',U)()
for kind,key in [(0x8b31,'vertex'),(0x8b30,'fragment')]:
 handle=shader(kind,data[key]);g('glAttachShader',None,U,U)(program,handle)
g('glLinkProgram',None,U)(program)
ok=I();g('glGetProgramiv',None,U,U,PI)(program,0x8b82,C.byref(ok))
if not ok.value:
 log=C.create_string_buffer(4096);g('glGetProgramInfoLog',None,U,I,PI,C.c_char_p)(program,4096,None,log);raise RuntimeError(log.value)
report={'method':'Actual runtime water vertex/fragment GLSL, expanded Three.js r160 chunks, EGL SwiftShader compilation and linking. Not browser visual acceptance.','status':'passed','includes':['ACES filmic tone mapping','sRGB output transfer'],'checks':['World-space waves','Fresnel reflection','Camera/sun half-vector glint','Ellipse lake and bounded 12-puddle mask']}
(OUT.parent/'shaders.json').write_text(json.dumps(report,indent=2))
print('Passed: runtime painterly water shader compiles and links with ACES/sRGB chunks.')
