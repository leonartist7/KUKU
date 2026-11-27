// Small-size mark from vector geometry: white/transparent Android badge and crisp favicon.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const bird='M 12 80 L 18 69 C 11 61 16 54 22 47 C 26 42 24 31 30 23 C 34 17 42 17 45 24 L 47 30 L 54 34 L 46 38 C 45 44 36 43 35 50 C 33 57 44 60 48 65 C 52 74 39 81 28 78 Z';
function polygon(d){const t=d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g);const points=[];let i=0,x=0,y=0;while(i<t.length){const c=t[i++];if(c==='M'||c==='L'){x=+t[i++];y=+t[i++];points.push([x,y]);}else if(c==='C'){const a=[+t[i++],+t[i++]],b=[+t[i++],+t[i++]],end=[+t[i++],+t[i++]];for(let k=1;k<=12;k++){const u=k/12,v=1-u;points.push([v*v*v*x+3*v*v*u*a[0]+3*v*u*u*b[0]+u*u*u*end[0],v*v*v*y+3*v*v*u*a[1]+3*v*u*u*b[1]+u*u*u*end[1]]);} [x,y]=end;}else if(c!=='Z')throw Error('Unsupported vector command');}return points;}
const points=polygon(bird);
function inside(x,y){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [a,b]=points[i],[c,d]=points[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)yes=!yes;}return yes;}
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(t,d){const name=Buffer.from(t),n=Buffer.alloc(4),check=Buffer.alloc(4);n.writeUInt32BE(d.length);check.writeUInt32BE(crc(Buffer.concat([name,d])));return Buffer.concat([n,name,d,check]);}
function png(n,mono){const raw=Buffer.alloc((n*4+1)*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){let sums=[0,0,0,0];for(let sy=0;sy<3;sy++)for(let sx=0;sx<3;sx++){const px=(x+(sx+.5)/3)*100/n,py=(y+(sy+.5)/3)*100/n;let color=mono?[0,0,0,0]:[251,249,246,255];const left=inside(px,py),right=inside(100-px,py);if(left||right)color=mono?[255,255,255,255]:left?[90,111,76,255]:[184,104,69,255];for(let c=0;c<4;c++)sums[c]+=color[c];}const out=y*(n*4+1)+1+x*4;for(let c=0;c<4;c++)raw[out+c]=Math.round(sums[c]/9);if(mono&&raw[out+3]>0)raw.fill(255,out,out+3);}
const ih=Buffer.alloc(13);ih.writeUInt32BE(n,0);ih.writeUInt32BE(n,4);ih[8]=8;ih[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
const svg=(mono)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${mono?'':'<rect width="100" height="100" rx="22" fill="#fbf9f6"/>'}<path d="${bird}" fill="${mono?'white':'#5a6f4c'}"/><path d="${bird}" transform="translate(100 0) scale(-1 1)" fill="${mono?'white':'#b86845'}"/></svg>\n`;
fs.writeFileSync(path.join(root,'public/notification-badge.svg'),svg(true));
fs.writeFileSync(path.join(root,'public/favicon.svg'),svg(false));
fs.writeFileSync(path.join(root,'public/notification-badge.png'),png(96,true));
fs.writeFileSync(path.join(root,'assets/images/notification-icon.png'),png(96,true));
fs.writeFileSync(path.join(root,'public/notification-icon.png'),png(192,false));
fs.writeFileSync(path.join(root,'assets/images/favicon.png'),png(64,false));
const tiny=png(32,false),head=Buffer.alloc(22);head.writeUInt16LE(1,2);head.writeUInt16LE(1,4);head[6]=32;head[7]=32;head.writeUInt16LE(1,10);head.writeUInt16LE(32,12);head.writeUInt32LE(tiny.length,14);head.writeUInt32LE(22,18);fs.writeFileSync(path.join(root,'public/favicon.ico'),Buffer.concat([head,tiny]));
console.log('Generated crisp KUKU favicon and white transparent notification badge.');
