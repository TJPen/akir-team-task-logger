import {readFile,writeFile,readdir} from 'node:fs/promises';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
const assets={};
for(const name of await readdir(new URL('./public/',import.meta.url))){const ext=name.slice(name.lastIndexOf('.'));const data=await readFile(new URL('./public/'+name,import.meta.url));assets[name==='index.html'?'/':'/'+name]={type:types[ext]||'application/octet-stream',body:['.png','.jpg','.woff2'].includes(ext)?data.toString('base64'):data.toString(),...(['.png','.jpg','.woff2'].includes(ext)?{base64:true}:{})};}
await writeFile(new URL('./assets.mjs',import.meta.url),'export const ASSETS = '+JSON.stringify(assets)+';\n');
console.log('Built '+Object.keys(assets).length+' static assets.');
