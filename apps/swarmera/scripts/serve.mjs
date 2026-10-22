import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
const root=path.resolve(new URL('../dist',import.meta.url).pathname);if(!existsSync(path.join(root,'index.html')))await import('./build.mjs');
const build=JSON.parse(await readFile(path.join(root,'build-info.json'),'utf8')),mount=build.base;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain'};
const port=Number(process.env.PORT||4176);
http.createServer(async(req,res)=>{try{let pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);if(mount!=='/'&&pathname===mount.slice(0,-1)){res.writeHead(302,{Location:mount});res.end();return;}if(!pathname.startsWith(mount))throw Error('Outside mount');pathname=pathname.slice(mount.length);let file=path.resolve(root,pathname);if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}if((await stat(file)).isDirectory())file=path.join(file,'index.html');const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);}catch{res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(path.join(root,'404.html')));}}).listen(port,'0.0.0.0',()=>console.log(`SWARMERA → http://localhost:${port}${mount}`));
