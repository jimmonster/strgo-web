import {ShaderChunk} from '../assets/vendor/three.module.js';
import {waterShader} from '../src/water.js';
import {mkdir,writeFile} from 'node:fs/promises';
const expand=s=>s.replace(/#include <(\w+)>/g,(_,key)=>expand(ShaderChunk[key]));
const vertex=`precision highp float;attribute vec3 position;attribute vec2 uv;uniform mat4 modelMatrix;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;\n`+expand(waterShader.vertexShader);
const fragment=`precision highp float;precision highp int;uniform vec3 cameraPosition;\n#define TONE_MAPPING\n`+ShaderChunk.tonemapping_pars_fragment+`\nvec3 toneMapping(vec3 color){return ACESFilmicToneMapping(color);}\n`+ShaderChunk.colorspace_pars_fragment+`\nvec4 linearToOutputTexel(vec4 color){return sRGBTransferOETF(color);}\n`+expand(waterShader.fragmentShader);
await mkdir('artifacts/offscreen',{recursive:true});await writeFile('artifacts/offscreen/water-shader.json',JSON.stringify({vertex,fragment}));
