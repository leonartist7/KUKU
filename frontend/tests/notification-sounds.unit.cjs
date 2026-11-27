const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file,extra={}){
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{exports,Map,Set,Promise,JSON,Number,Array,Math,Error,Float32Array,Uint8Array,DataView,ArrayBuffer,atob,btoa,...extra});
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

test('WAV validation respects RIFF extent, chunk padding, complete headers and whole frames',()=>{
  const m=wav(),base=m.normalizedWav(audio(Float32Array.from({length:800},(_,i)=>Math.sin(i)*.1)));
  const wrongExtent=base.slice();new DataView(wrongExtent.buffer).setUint32(4,36,true);
  assert.throws(()=>m.validateWav(wrongExtent.buffer),/valid WAV/);
  function append(chunk){const result=new Uint8Array(base.length+chunk.length);result.set(base);result.set(chunk,base.length);new DataView(result.buffer).setUint32(4,result.length-8,true);return result;}
  const missingPad=append(Uint8Array.from([74,85,78,75,1,0,0,0,99]));
  assert.throws(()=>m.validateWav(missingPad.buffer),/incomplete/);
  assert.throws(()=>m.validateWav(append(Uint8Array.from([74,85,78,75])).buffer),/incomplete/);
  const duplicate=append(Uint8Array.from([100,97,116,97,2,0,0,0,0,0]));
  assert.throws(()=>m.validateWav(duplicate.buffer),/invalid audio frames/);
  const halfFrame=new Uint8Array(46);halfFrame.set(base.subarray(0,44));new DataView(halfFrame.buffer).setUint32(4,38,true);new DataView(halfFrame.buffer).setUint32(40,1,true);
  assert.throws(()=>m.validateWav(halfFrame.buffer),/invalid audio frames/);
  const validMetadata=append(Uint8Array.from([74,85,78,75,1,0,0,0,99,0]));
  assert.doesNotThrow(()=>m.validateWav(validMetadata.buffer));
});
test('decoded WAV metadata cannot disagree with its frames or channel count',()=>{
  const m=wav(),source=audio(Float32Array.from({length:800},()=>.1));
  assert.throws(()=>m.normalizedWav({...source,duration:.01}),/5 seconds/);
  assert.throws(()=>m.normalizedWav({...source,numberOfChannels:1.5}),/5 seconds/);
  assert.throws(()=>m.normalizedWav({...source,sampleRate:8000.5}),/5 seconds/);
});
test('removing an imported sound waits for an earlier pending write and cannot resurrect it',async()=>{
  const storage=new Map();let release,writing=false;
  const m=load('src/messageSounds.ts',{require:name=>name==='./notificationWav'?wav():{default:{
    getItem:async key=>storage.get(key)||null,
    setItem:async(key,value)=>{writing=true;await new Promise(r=>release=r);storage.set(key,value);},
    removeItem:async key=>storage.delete(key)
  }}});
  const save=m.saveCustomSound('alice',{name:'pending.wav',duration:1,data:btoa('synthetic')});
  for(let i=0;i<8&&!writing;i++)await Promise.resolve();assert.ok(writing);
  const remove=m.removeCustomSound('alice');release();await Promise.all([save,remove]);
  assert.equal(await m.readCustomSound('alice'),null);
});
test('reopening sound preferences waits for a failed save before showing the previous value',async()=>{
  let rejectWrite;
  const m=load('src/messageSounds.ts',{require:()=>({default:{getItem:async()=>null,setItem:()=>new Promise((_,reject)=>rejectWrite=reject)}})});
  await m.readSound('alice');
  const save=m.saveSound('alice',{sound:'signal',volume:1});
  const read=m.readSound('alice');let finished=false;read.then(()=>finished=true);
  for(let i=0;i<8&&!rejectWrite;i++)await Promise.resolve();assert.equal(finished,false);
  rejectWrite(new Error('storage unavailable'));await assert.rejects(save,/storage/);
  assert.equal((await read).sound,'bell');
});
function settingsHarness(soundModule){
  const values=[];let cursor=0,focused;
  const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useCallback:callback=>callback,
    useState:initial=>{const at=cursor++;if(!(at in values))values[at]=initial;return[values[at],value=>values[at]=value];},
    useRef:initial=>{const at=cursor++;return values[at]||(values[at]={current:initial});}};
  const modules={react:{default:react,...react},'react-native':{Platform:{OS:'web'}},'@expo/vector-icons/Ionicons':{default:()=>null},
    './AuthContext':{useAuth:()=>({user:{id:'alice'},restoring:false})},'./ThemeContext':{useTheme:()=>({c:{},f:{}})},
    'expo-router':{useFocusEffect:callback=>focused=callback},'./api':{getSessionEpoch:()=>1,getSessionUserId:()=>'alice'},
    './messageSounds':{DEFAULT_SOUND:{sound:'bell',volume:.5},SOUND_CHOICES:[],readSound:async()=>({sound:'bell',volume:.5}),readCustomSound:async()=>null,stopMessageSound(){},...soundModule}};
  const m=load('src/NotificationSoundSettings.tsx',{require:name=>modules[name]});
  return {values,render:()=>{cursor=0;return m.default();},focus:()=>focused()};
}
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function findElement(node,predicate){if(predicate(node))return node;for(const child of node?.children||[]){if(Array.isArray(child)){for(const item of child){const found=findElement(item,predicate);if(found)return found;}}else if(child&&typeof child==='object'){const found=findElement(child,predicate);if(found)return found;}}}
test('sound settings reload on focus and ignore a preference load that finishes after leaving',async()=>{
  let finish;const h=settingsHarness({readSound:()=>new Promise(resolve=>finish=resolve)});
  h.render();const leave=h.focus();leave();finish({sound:'signal',volume:1});await flush();assert.equal(h.values[3],false);assert.equal(h.values[0].sound,'bell');
  h.focus();finish({sound:'bright',volume:1});await flush();assert.equal(h.values[3],true);assert.equal(h.values[0].sound,'bright');
});
test('replacing the selected WAV uses one write and a selection-save failure keeps the previous tone',async()=>{
  const clip={name:'new.wav',duration:1,data:'test'};let selections=0;
  const selected=settingsHarness({readSound:async()=>({sound:'custom',volume:1}),readCustomSound:async()=>({...clip,name:'old.wav'}),prepareCustomSound:async()=>clip,saveCustomSound:async()=>{},saveSound:async()=>{selections++;throw new Error('storage unavailable');},playMessageSound:async()=>{}});
  selected.render();selected.focus();await flush();
  findElement(selected.render(),n=>n?.props?.['data-testid']==='notification-wav-input').props.onChange({currentTarget:{files:[{}],value:'file'}});await flush();
  assert.equal(selections,0);assert.equal(selected.values[1].name,'new.wav');assert.match(selected.values[4],/Your WAV is ready/);
  const other=settingsHarness({prepareCustomSound:async()=>clip,saveCustomSound:async()=>{},saveSound:async()=>{throw new Error('storage unavailable');}});
  other.render();other.focus();await flush();findElement(other.render(),n=>n?.props?.['data-testid']==='notification-wav-input').props.onChange({currentTarget:{files:[{}],value:'file'}});await flush();
  assert.equal(other.values[0].sound,'bell');assert.equal(other.values[1].name,'new.wav');assert.match(other.values[4],/WAV was saved/);assert.equal(other.values[2],false);
});

test('two queued failed preference saves restore a persisted tone rather than an earlier failed write',async()=>{
  const m=load('src/messageSounds.ts',{require:()=>({default:{getItem:async()=>JSON.stringify({sound:'wood',volume:.5}),setItem:async()=>{throw new Error('storage unavailable');}}})});
  await m.readSound('alice');
  const one=m.saveSound('alice',{sound:'bright',volume:1}).catch(()=>{});
  const two=m.saveSound('alice',{sound:'signal',volume:1}).catch(()=>{});
  await Promise.all([one,two]);assert.equal((await m.readSound('alice')).sound,'wood');
});

test('a stale initial preference read cannot replace the rollback value from a successful save',async()=>{
  let finishRead,stored={sound:'wood',volume:.5},failWrites=false;
  const m=load('src/messageSounds.ts',{require:()=>({default:{
    getItem:()=>new Promise(resolve=>finishRead=resolve),
    setItem:async(_key,value)=>{if(failWrites)throw new Error('storage unavailable');stored=JSON.parse(value);}
  }})});
  const initial=m.readSound('alice');
  for(let i=0;i<8&&!finishRead;i++)await Promise.resolve();assert.ok(finishRead);
  await m.saveSound('alice',{sound:'bright',volume:1});
  finishRead(JSON.stringify({sound:'wood',volume:.5}));assert.equal((await initial).sound,'bright');
  failWrites=true;await assert.rejects(m.saveSound('alice',{sound:'signal',volume:.5}),/storage unavailable/);
  assert.equal((await m.readSound('alice')).sound,'bright');assert.equal(stored.sound,'bright');
});
