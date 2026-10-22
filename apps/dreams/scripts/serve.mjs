import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve(process.env.DREAMS_ROOT||'.');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.ttf':'font/ttf','.webm':'video/webm'};
http.createServer(async(req,res)=>{
 try{
  let path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(path!==root&&!path.startsWith(root+sep))throw Error('Path');
  if((await stat(path)).isDirectory())path=resolve(path,'index.html');
  const body=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(body);
 }catch{res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="en"><title>Dream not found</title><body style="background:#183e48;color:#f4ecdf;font:20px Georgia;padding:12vw"><h1>This dream is still unwritten.</h1><p>夢は、まだ終わっていない。</p><a href="/" style="color:inherit">Return to the garden →</a></body></html>');}
}).listen(Number(process.env.PORT||5173),'0.0.0.0',()=>console.log('Dreams · http://localhost:'+(process.env.PORT||5173)));
