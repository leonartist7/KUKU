// Single-page Expo exports bypass +html.tsx. Verify the real install artifact.
const fs=require('node:fs'), path=require('node:path');
const dir=path.resolve(__dirname,'../dist');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
if(manifest.name!=='KUKU'||manifest.short_name!=='KUKU'||manifest.start_url!=='/'||manifest.display!=='standalone')throw new Error('Invalid install manifest');
for(const icon of manifest.icons){
  if(!/^\/pwa-[a-z0-9-]+\.png$/.test(icon.src))throw new Error('Unexpected icon path');
  const bytes=fs.readFileSync(path.join(dir,icon.src.slice(1)));
  if(bytes.toString('hex',0,8)!=='89504e470d0a1a0a'||`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`!==icon.sizes)throw new Error('Invalid install icon');
}
for(const name of ['sw.js','register-sw.js'])fs.accessSync(path.join(dir,name));
const index=path.join(dir,'index.html');let html=fs.readFileSync(index,'utf8');
if(!html.includes('rel="manifest"'))html=html.replace('</head>','<link rel="manifest" href="/manifest.json">\n<link rel="apple-touch-icon" href="/pwa-192.png">\n<meta name="apple-mobile-web-app-title" content="KUKU">\n<meta name="apple-mobile-web-app-capable" content="yes">\n</head>');
if(!html.includes('src="/register-sw.js"'))html=html.replace('</body>','<script src="/register-sw.js" defer></script>\n</body>');
fs.writeFileSync(index,html);
console.log('Verified KUKU install manifest, icons and service-worker registration.');
