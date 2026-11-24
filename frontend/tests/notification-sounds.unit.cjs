const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file,extra={}){
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Map,Set,Promise,JSON,Number,Array,Math,Error,Float32Array,Uint8Array,DataView,ArrayBuffer,atob,btoa,...extra});
  return exports;
}
const wav=()=>load('src/notificationWav.ts');
function audio(samples,rate=8000){return {duration:samples.length/rate,length:samples.length,sampleRate:rate,numberOfChannels:1,getChannelData:()=>samples};}
test('WAV import validates the actual container and duration before decode',()=>{
  const m=wav(),bytes=m.normalizedWav(audio(Float32Array.from({length:800},(_,i)=>Math.sin(i)*0.01)));
  assert.doesNotThrow(()=>m.validateWav(bytes.buffer));
  const fake=bytes.slice();fake[0]=0;
  assert.throws(()=>m.validateWav(fake.buffer),/valid WAV/);
  assert.throws(()=>m.validateWav(new ArrayBuffer(1024*1024+1)),/smaller than 1 MB/);
  const wrong=bytes.slice();new DataView(wrong.buffer).setUint16(32,8,true);
  assert.throws(()=>m.validateWav(wrong.buffer),/PCM WAV/);
  const long=bytes.slice();const v=new DataView(long.buffer);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint32(40,800000,true);
  assert.throws(()=>m.validateWav(long.buffer),/incomplete/);
});
test('quiet imported audio is normalized with headroom and click-free edges',()=>{
  const m=wav(),samples=Float32Array.from({length:8000},(_,i)=>Math.sin(i*.2)*0.08);
  const result=m.normalizedWav(audio(samples)),view=new DataView(result.buffer);
  let peak=0;for(let i=44;i<result.length;i+=2)peak=Math.max(peak,Math.abs(view.getInt16(i,true))/32767);
  assert.ok(peak>0.8&&peak<=0.821,peak);
  assert.equal(view.getInt16(44,true),0);assert.equal(view.getInt16(result.length-2,true),0);
  assert.equal(result.length,44+8000*2);assert.equal(view.getUint16(22,true),1);
});
test('silent, invalid and overlong decoded audio are rejected',()=>{
  const m=wav();
  assert.throws(()=>m.normalizedWav(audio(new Float32Array(800))),/silent/);
  assert.throws(()=>m.normalizedWav(audio(Float32Array.from([NaN,1]))),/invalid audio/);
  assert.throws(()=>m.normalizedWav({...audio(Float32Array.from([1,1])),duration:6}),/5 seconds/);
  assert.equal(m.soundName('C:\\private\\my\u0000bell.wav'),'mybell.wav');
});
test('imported audio stays per-account and can be removed independently',async()=>{
  const storage=new Map(),m=load('src/messageSounds.ts',{require:name=>name==='./notificationWav'?wav():{default:{getItem:async key=>storage.get(key)||null,setItem:async(key,value)=>storage.set(key,value),removeItem:async key=>storage.delete(key)}}});
  const clip={name:'bell.wav',duration:1,data:btoa('synthetic')};
  await m.saveCustomSound('alice',clip);
  assert.equal((await m.readCustomSound('alice')).name,'bell.wav');
  assert.equal(await m.readCustomSound('bob'),null);
  await m.saveCustomSound('bob',{...clip,name:'bob.wav'});
  await m.removeCustomSound('alice');assert.equal(await m.readCustomSound('alice'),null);
  assert.equal((await m.readCustomSound('bob')).name,'bob.wav');
});
test('a stopped custom decode never starts late playback',async()=>{
  const valid=wav().normalizedWav(audio(Float32Array.from({length:800},(_,i)=>Math.sin(i)*.1)));
  const record={name:'test.wav',duration:.1,data:Buffer.from(valid).toString('base64')};
  let finish,started=0;
  class Context{constructor(){this.state='running';this.currentTime=0;this.destination={};}decodeAudioData(){return new Promise(resolve=>finish=resolve);}createBufferSource(){return {connect(){},start(){started++;}};}}
  const m=load('src/messageSounds.ts',{window:{AudioContext:Context},require:name=>name==='./notificationWav'?wav():{default:{getItem:async()=>JSON.stringify(record)}}});
  const pending=m.playMessageSound({sound:'custom',volume:1},true,'alice');
  for(let i=0;i<8&&!finish;i++)await Promise.resolve();
  assert.ok(finish);m.stopMessageSound();finish({duration:.1,numberOfChannels:1});await pending;
  assert.equal(started,0);
});
test('new louder presets stay bounded and use distinct note patterns',async()=>{
  const frequencies=[],levels=[];
  class Context{constructor(){this.state='running';this.currentTime=0;this.destination={};}createOscillator(){return {frequency:{setValueAtTime:v=>frequencies.push(v),exponentialRampToValueAtTime(){}},connect(){},disconnect(){},start(){},stop(){}};}createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime:v=>levels.push(v)},connect(){},disconnect(){}};}}
  const m=load('src/messageSounds.ts',{window:{AudioContext:Context},require:()=>({})});
  for(const sound of ['bright','double','signal'])await m.playMessageSound({sound,volume:1},true);
  assert.equal(frequencies.length,8);assert.ok(levels.every(v=>v<=.5));
  assert.equal(m.normalizeSound({sound:'custom',volume:99}).volume,1);
});
test('notification badge has a real white alpha silhouette and is wired for web and Android',()=>{
  const zlib=require('node:zlib');const png=fs.readFileSync('public/notification-badge.png');
  assert.equal(png.readUInt32BE(16),96);assert.equal(png.readUInt32BE(20),96);
  const parts=[];for(let p=8;p<png.length;){const length=png.readUInt32BE(p),type=png.toString('ascii',p+4,p+8);if(type==='IDAT')parts.push(png.subarray(p+8,p+8+length));p+=12+length;}
  const raw=zlib.inflateSync(Buffer.concat(parts));let opaque=0,clear=0;
  for(let y=0;y<96;y++)for(let x=0;x<96;x++){const p=y*385+1+x*4,a=raw[p+3];if(a===0)clear++;if(a===255)opaque++;if(a>0)assert.deepEqual([...raw.subarray(p,p+3)],[255,255,255]);}
  assert.ok(opaque>1000&&clear>1000);
  const config=JSON.parse(fs.readFileSync('app.json','utf8')).expo.plugins.find(x=>Array.isArray(x)&&x[0]==='expo-notifications');
  assert.equal(config[1].icon,'./assets/images/notification-icon.png');
  assert.match(fs.readFileSync('public/sw.js','utf8'),/badge: "\/notification-badge.png"/);
});
