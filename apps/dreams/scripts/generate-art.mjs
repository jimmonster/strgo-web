import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let canvasModule;
try{canvasModule=require('@napi-rs/canvas');}catch{canvasModule=require('/usr/lib/node_modules/openclaw/node_modules/@napi-rs/canvas');}
const {createCanvas}=canvasModule;
const painting={};new Function('window',await readFile('scripts/paintings.js','utf8'))(painting);
await mkdir('assets/art',{recursive:true});
 const jobs=[['hero',2400,720,false],['hero-mobile',720,1240,false],['themes',2400,640,false],['paper',512,512,false],...Array.from({length:8},(_,i)=>[String(i+1),640,840,false]),...Array.from({length:8},(_,i)=>[String(i+1),640,840,true])];
 for(const [kind,w,h,film]of jobs){const canvas=createCanvas(w,h);painting.paintDream(canvas,kind,4217+Number(kind)*107||4217,film);const name=/^\d+$/.test(kind)?`${film?'film':'dream'}-${kind.padStart(2,'0')}`:kind;await writeFile(`assets/art/${name}.webp`,await canvas.encode('webp',91));console.log('Painted '+name);}
