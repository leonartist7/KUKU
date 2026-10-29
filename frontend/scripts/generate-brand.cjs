// Deterministic icon-size exports from the two generated master PNGs. No network or credentials.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
function readPng(file) {
  const b = fs.readFileSync(file);
  if (b.subarray(0,8).toString("hex") !== "89504e470d0a1a0a") throw Error("Expected PNG: " + file);
  let w,h,channels,parts=[];
  for (let p=8;p<b.length;) {
    const n=b.readUInt32BE(p), t=b.toString("ascii",p+4,p+8), d=b.subarray(p+8,p+8+n);
    if(t==="IHDR") {w=d.readUInt32BE(0);h=d.readUInt32BE(4);channels=d[9]===6?4:d[9]===2?3:0;if(d[8]!==8||!channels||d[12]!==0)throw Error("Expected non-interlaced 8-bit RGB(A) PNG");}
    if(t==="IDAT")parts.push(d);p+=12+n;
  }
  if(!w||!h||w*h>20000000)throw Error("Invalid artwork dimensions");
  const stride=w*channels, raw=zlib.inflateSync(Buffer.concat(parts)), pixels=Buffer.alloc(w*h*4);
  if(raw.length!==(stride+1)*h)throw Error("Unexpected PNG scanlines");
  let prev=Buffer.alloc(stride), cursor=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<h;y++) {
    const filter=raw[cursor++], row=Buffer.from(raw.subarray(cursor,cursor+stride));cursor+=stride;
    for(let x=0;x<stride;x++) {const a=x>=channels?row[x-channels]:0,b=prev[x],c=x>=channels?prev[x-channels]:0;
      const add=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):NaN;
      if(!Number.isFinite(add))throw Error("Invalid PNG filter");row[x]=(row[x]+add)&255;}
    for(let x=0;x<w;x++)for(let c=0;c<4;c++)pixels[(y*w+x)*4+c]=c===3&&channels===3?255:row[x*channels+c];
    prev=row;
  }
  return {w,h,pixels};
}
function crc(b) {let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(t,d) {const name=Buffer.from(t), n=Buffer.alloc(4), check=Buffer.alloc(4);n.writeUInt32BE(d.length);check.writeUInt32BE(crc(Buffer.concat([name,d])));return Buffer.concat([n,name,d,check]);}
function png(src,n,opaque=false) {
  const raw=Buffer.alloc((n*4+1)*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const sx=Math.max(0,Math.min(src.w-1,(x+0.5)*src.w/n-0.5)),sy=Math.max(0,Math.min(src.h-1,(y+0.5)*src.h/n-0.5));
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(src.w-1,x0+1),y1=Math.min(src.h-1,y0+1),fx=sx-x0,fy=sy-y0;
    const out=y*(n*4+1)+1+x*4;
    for(let c=0;c<4;c++){const at=(xx,yy)=>src.pixels[(yy*src.w+xx)*4+c];raw[out+c]=Math.round((at(x0,y0)*(1-fx)+at(x1,y0)*fx)*(1-fy)+(at(x0,y1)*(1-fx)+at(x1,y1)*fx)*fy);}
    if(opaque){const a=raw[out+3]/255;for(let c=0;c<3;c++)raw[out+c]=Math.round(raw[out+c]*a+[251,249,246][c]*(1-a));raw[out+3]=255;}
  }
  const ih=Buffer.alloc(13);ih.writeUInt32BE(n,0);ih.writeUInt32BE(n,4);ih[8]=8;ih[9]=6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),chunk("IHDR",ih),chunk("IDAT",zlib.deflateSync(raw,{level:9})),chunk("IEND",Buffer.alloc(0))]);
}
const root=path.resolve(__dirname,".."), images=path.join(root,"assets/images"), pub=path.join(root,"public");
fs.mkdirSync(images,{recursive:true});fs.mkdirSync(pub,{recursive:true});
const brand=readPng(path.join(root,"assets/brand/kuku-mark-master.png")), mail=readPng(path.join(root,"assets/brand/kuku-mail-master.png"));
for(const [name,n] of [["icon.png",1024],["adaptive-icon.png",1024],["splash-image.png",512],["favicon.png",64],["kuku-brand.png",512]])fs.writeFileSync(path.join(images,name),png(brand,n,true));
fs.writeFileSync(path.join(images,"kuku-mail.png"),png(mail,512));
for(const [name,n] of [["pwa-192.png",192],["pwa-512.png",512],["pwa-maskable-512.png",512]])fs.writeFileSync(path.join(pub,name),png(brand,n,true));
const tiny=png(brand,32,true), head=Buffer.alloc(22);head.writeUInt16LE(1,2);head.writeUInt16LE(1,4);head[6]=32;head[7]=32;head.writeUInt16LE(1,10);head.writeUInt16LE(32,12);head.writeUInt32LE(tiny.length,14);head.writeUInt32LE(22,18);fs.writeFileSync(path.join(pub,"favicon.ico"),Buffer.concat([head,tiny]));
console.log("Generated KUKU app, adaptive, favicon, PWA and in-app artwork assets.");
