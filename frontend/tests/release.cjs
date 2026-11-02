const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
test("image previews accept only bounded JPEG data and recognize legacy photo files",()=>{
  const ts=require("typescript"),exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/imagePreview.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
  for(const name of ["family.jpg","portrait.JPEG","photo.PNG","animated.gif","camera.HEIC"])assert.equal(exports.isImageFilename(name),true);
  for(const name of [null,"notes.txt","fake.jpg.exe","image.svg"])assert.equal(exports.isImageFilename(name),false);
  const good={image:"data:image/jpeg;base64,YWJj",width:512,height:200};
  assert.equal(exports.validImagePreview(good),true);
  for(const bad of [null,{...good,width:0},{...good,height:1601},{...good,width:1.5},...['https://example.com/private.jpg','javascript:alert(1)','data:image/svg+xml;base64,YWJj',good.image+'<script>','data:image/jpeg;base64,'+'A'.repeat(660000)].map(image=>({...good,image}))])assert.equal(exports.validImagePreview(bad),false);
});
test("service worker never intercepts private or cross-origin requests", () => {
  const listeners = {};
  vm.runInNewContext(fs.readFileSync("public/sw.js","utf8"), {
    self:{addEventListener:(name,fn)=>listeners[name]=fn,location:{origin:"https://kuku.example"}},
    URL, caches:{}, fetch:()=>{throw new Error("Unexpected fetch")}
  });
  for (const url of ["https://kuku.example/api/chats","https://api.example/api/chats","https://kuku.example/auth/me","https://kuku.example/file?token=secret"]) {
    let intercepted=false;
    listeners.fetch({request:{url,method:"GET",headers:new Headers(),mode:"cors"},respondWith:()=>{intercepted=true;}});
    assert.equal(intercepted,false,url);
  }
});
test("API proxy preserves cookies without caching", async () => {
  const handler = require("../api/[...path].js");
  const oldFetch=global.fetch, oldOrigin=process.env.BACKEND_URL;
  process.env.BACKEND_URL="https://api.example";
  let sent;
  global.fetch=async (url,options)=>{sent={url:String(url),options};return new Response('{"ok":true}',{headers:{"content-type":"application/json","set-cookie":"kuku_refresh=test; HttpOnly; Path=/api/auth"}});};
  const headers={};
  const res={setHeader:(k,v)=>headers[k]=v,end:(body)=>res.body=body,status:(code)=>{res.statusCode=code;return res;},json:(v)=>res.body=v};
  try {
    await handler({url:"/api/auth/refresh",method:"POST",headers:{cookie:"kuku_refresh=old",origin:"https://kuku.example","x-kuku-platform":"web"},body:{}},res);
    assert.equal(sent.url,"https://api.example/api/auth/refresh");
    assert.equal(sent.options.headers.cookie,"kuku_refresh=old");
    assert.equal(headers["Cache-Control"],"no-store");
    assert.match(headers["Set-Cookie"][0],/HttpOnly/);
    assert.equal(res.statusCode,200);
  } finally {global.fetch=oldFetch;if(oldOrigin===undefined)delete process.env.BACKEND_URL;else process.env.BACKEND_URL=oldOrigin;}
});

function outboxHarness(storage, send) {
  const ts=require("typescript");
  const source=ts.transpileModule(fs.readFileSync("src/outbox.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  class ApiError extends Error {constructor(message,status){super(message);this.status=status;}}
  const local={getItem:async key=>storage.get(key)||null,setItem:async(key,value)=>{storage.set(key,value);},removeItem:async key=>{storage.delete(key);}};
  vm.runInNewContext(source,{exports,require:name=>name.includes("async-storage")?{default:local}:{api:{postAs:send},ApiError},Date,Math,JSON,Set,Promise,Error});
  return {outbox:exports,ApiError};
}
test("outbox survives restart and preserves IDs after a lost acknowledgement",async()=>{
  const storage=new Map();const sent=[];
  const first=outboxHarness(storage,async()=>{throw new Error("offline");}).outbox;
  await Promise.all([first.queueMessage("alice",{chat_id:"chat",type:"text",text:"one"}),first.queueMessage("alice",{chat_id:"chat",type:"text",text:"two"})]);
  const before=await first.getOutbox("alice");
  await first.flushOutbox("alice",()=>true);
  assert.equal((await first.getOutbox("alice")).length,2);
  const restarted=outboxHarness(storage,async(uid,path,payload)=>sent.push({uid,payload})).outbox;
  await restarted.flushOutbox("alice",()=>true);
  assert.equal((await restarted.getOutbox("alice")).length,0);
  assert.deepEqual(sent.map(s=>s.payload.client_message_id),Array.from(before,m=>m.id));
  assert.ok(sent.every(s=>s.uid==="alice"));
});
test("outbox keeps accounts separate and stops dispatch after logout",async()=>{
  const storage=new Map();let sent=0;
  const box=outboxHarness(storage,async()=>{sent++;}).outbox;
  await box.queueMessage("alice",{chat_id:"chat",type:"text",text:"private"});
  assert.equal((await box.getOutbox("bob")).length,0);
  await box.flushOutbox("alice",()=>false);
  assert.equal(sent,0);
  await box.clearOutbox("alice");
  assert.equal((await box.getOutbox("alice")).length,0);
});

test("late refresh cannot restore a signed-out session or dispatch another account's queue",async()=>{
  const ts=require("typescript");
  const source=ts.transpileModule(fs.readFileSync("src/api.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let resolveFetch;let calls=0;const exports={};
  vm.runInNewContext(source,{exports,__DEV__:false,Response,Set,Promise,Error,
    require:name=>name==="react-native"?{Platform:{OS:"web"}}:name==="./config"?{API_ORIGIN:"https://api.example"}:{},
    fetch:()=>{calls++;return new Promise(resolve=>{resolveFetch=resolve;});}});
  const pending=exports.refreshSession();
  await exports.setToken(null);
  resolveFetch(new Response(JSON.stringify({token:"old-access",user:{id:"alice"}}),{headers:{"content-type":"application/json"}}));
  assert.equal(await pending,null);
  await exports.acceptSession({token:"bob-access",user:{id:"bob"}});
  await assert.rejects(exports.api.postAs("alice","/chats/private/messages",{}),/Account changed/);
  assert.equal(calls,1);
});


test("account routing resumes verification and profile setup without repeating completed onboarding", () => {
  const ts=require("typescript");
  const source=ts.transpileModule(fs.readFileSync("src/onboarding.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};vm.runInNewContext(source,{exports});
  const destination=exports.accountDestination;
  assert.equal(destination(null),"/login");
  assert.equal(destination({email_verified:false,onboarding_complete:false}),"/verify");
  assert.equal(destination({email_verified:true,onboarding_complete:false}),"/onboarding");
  assert.equal(destination({email_verified:true,onboarding_complete:true}),"/(tabs)");
  assert.equal(destination({email_verified:true}),"/(tabs)");
  assert.equal(exports.validEmail("hello@example.com"),true);
  assert.equal(exports.validEmail("hello@"),false);
});

function pureModule(file) {
  const ts=require("typescript"),exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,URLSearchParams});
  return exports;
}
test("scheduled appearance switches at exact local boundaries, including same-day schedules",()=>{
  const {scheduledDark,resolveDark,validTime}=pureModule("src/appearance.ts");
  const time=(h,m)=>({getHours:()=>h,getMinutes:()=>m});
  for(const [h,m,dark] of [[18,59,false],[19,0,true],[23,59,true],[0,0,true],[6,59,true],[7,0,false]]) assert.equal(scheduledDark(time(h,m)),dark,`${h}:${m}`);
  assert.equal(scheduledDark(time(12,0),"09:00","17:00"),true);
  assert.equal(scheduledDark(time(18,0),"09:00","17:00"),false);
  assert.equal(resolveDark("light",time(23,0),true,"19:00","07:00"),false);
  assert.equal(resolveDark("dark",time(12,0),false,"19:00","07:00"),true);
  assert.equal(resolveDark("system",time(12,0),true,"19:00","07:00"),true);
  assert.equal(resolveDark("system",time(23,0),false,"19:00","07:00"),false);
  for(const input of ["7:00","24:00","19:60","",null,undefined]) assert.equal(validTime(input),false);
  assert.equal(validTime("00:00"),true);
});
test("invitation fragments accept only complete codes and never treat a query as a secret",()=>{
  const {invitationFromUrl}=pureModule("src/invitations.ts");
  const token="abcDEF012_-".repeat(4);
  assert.equal(invitationFromUrl("https://kuku.example/login#invite="+token),token);
  assert.equal(invitationFromUrl("https://kuku.example/login?invite="+token),"");
  assert.equal(invitationFromUrl("https://kuku.example/login#invite=short"),"");
  assert.equal(invitationFromUrl(null),"");
});

test("private downloads survive asynchronous preparation without a browser popup",async()=>{
  const ts=require("typescript"),exports={},navigations=[];
  const source=ts.transpileModule(fs.readFileSync("src/downloads.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(source,{exports,URL,Error,require:()=>({Platform:{OS:"web"},Linking:{openURL:()=>{throw new Error("Unexpected popup");}}}),window:{location:{assign:url=>navigations.push(url)}}});
  await Promise.resolve();
  await exports.openPrivateDownload("https://files.example.test/content?ticket=synthetic");
  assert.equal(navigations.length,1);
  await assert.rejects(exports.openPrivateDownload("javascript:alert(1)"),/isn’t valid/);
  await assert.rejects(exports.openPrivateDownload("http://files.example.test/private"),/isn’t valid/);
});

test("browser push respects account changes and never exposes message content",async()=>{
  const listeners={}, shown=[], opened=[],notifications=[];const values=new Map();
  const db={createObjectStore:()=>{},close:()=>{},transaction:()=>{
    const tx={};tx.objectStore=()=>({get:key=>{const op={result:values.get(key)};queueMicrotask(()=>tx.oncomplete());return op;},put:(value,key)=>{values.set(key,value);const op={result:key};queueMicrotask(()=>tx.oncomplete());return op;}});return tx;
  }};
  const indexedDB={open:()=>{const req={result:db};queueMicrotask(()=>req.onsuccess());return req;}};
  const self={location:{origin:"https://kuku.example"},addEventListener:(name,fn)=>listeners[name]=fn,
    registration:{getNotifications:async()=>notifications,showNotification:async(title,opts)=>shown.push({title,...opts})},
    clients:{matchAll:async()=>[],openWindow:async path=>opened.push(path)}};
  vm.runInNewContext(fs.readFileSync("public/sw.js","utf8"),{self,indexedDB,URL,Promise,Error,queueMicrotask});
  const uid="11111111-1111-4111-8111-111111111111",chatId="22222222-2222-4222-8222-222222222222",messageId="33333333-3333-4333-8333-333333333333";
  async function dispatch(name,data){let done;listeners[name]({...data,waitUntil:p=>{done=p;}});await done;}
  await dispatch("message",{data:{type:"KUKU_ACCOUNT",userId:uid},ports:[{postMessage:()=>{}}]});
  const payload={userId:uid,chatId,messageId,body:"PRIVATE TEXT"};
  await dispatch("push",{data:{json:()=>({...payload,userId:"another-account"})}});assert.equal(shown.length,0);
  self.clients.matchAll=async()=>[{visibilityState:"visible"}];
  await dispatch("push",{data:{json:()=>payload}});assert.equal(shown[0].silent,true,"Visible apps use their selected tone without a second system sound");self.clients.matchAll=async()=>[];assert.equal(shown.length,1);assert.equal(shown[0].body,"You have a new message.");assert.ok(!JSON.stringify(shown).includes("PRIVATE TEXT"));
  await dispatch("notificationclick",{notification:{close:()=>{},data:{userId:uid,chatId:"https://evil.example"}}});assert.equal(opened.length,0);
  await dispatch("notificationclick",{notification:{close:()=>{},data:{userId:uid,chatId}}});assert.equal(opened[0],"/chat/"+chatId);
  await dispatch("message",{data:{type:"KUKU_ACCOUNT",userId:null},ports:[]});
  await dispatch("push",{data:{json:()=>payload}});assert.equal(shown.length,1,"Logged out devices must ignore queued alerts");
});

test("message sound settings isolate accounts, survive reload and validate saved values",async()=>{
  const storage=new Map();const ts=require("typescript");
  function harness(){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/messageSounds.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Map,Set,Promise,JSON,Number,Array,Error,require:()=>({default:{getItem:async key=>storage.get(key)||null,setItem:async(key,value)=>storage.set(key,value)}})});return exports;}
  let sounds=harness();
  await sounds.saveSound("alice",{sound:"drop",volume:0.25});
  await sounds.saveSound("bob",{sound:"silent",volume:0.85});
  sounds=harness();assert.equal((await sounds.readSound("alice")).sound,"drop");assert.equal((await sounds.readSound("bob")).sound,"silent");
  assert.equal(sounds.normalizeSound({sound:"unexpected",volume:99}).sound,"bell");assert.equal(sounds.normalizeSound({volume:99}).volume,1);assert.equal(sounds.normalizeSound({volume:-2}).volume,0);
  assert.equal(sounds.normalizeSound({volume:NaN}).volume,0.5);
  await sounds.playMessageSound({sound:"silent",volume:1},true);
  await sounds.playMessageSound({sound:"bell",volume:0},true);
});

test("incoming sound tracking ignores history, own sends and duplicate polls",()=>{
  const ts=require("typescript"),exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/messageSounds.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Map,Set,Promise,JSON,Number,Array,require:()=>({})});
  const track=exports.incomingSoundTracker("alice");
  assert.equal(track([{id:"old",sender_id:"bob"}]),undefined);
  assert.equal(track([{id:"mine",sender_id:"alice"}]),undefined);
  assert.equal(track([{id:"new",sender_id:"bob"}]),"new");
  assert.equal(track([{id:"new",sender_id:"bob"}]),undefined);
  const other=exports.incomingSoundTracker("bob");assert.equal(other([]),undefined);assert.equal(other([{id:"own",sender_id:"bob"}]),undefined);
});

test("sound previews create distinct tones at bounded volume and silent creates no audio",async()=>{
  const ts=require("typescript"),exports={},frequencies=[],levels=[];let contexts=0;
  class Context{constructor(){contexts++;this.state="running";this.currentTime=0;this.destination={};}createOscillator(){return {frequency:{setValueAtTime:value=>frequencies.push(value),exponentialRampToValueAtTime:()=>{}},connect:()=>{},disconnect:()=>{},start:()=>{},stop:()=>{}};}createGain(){return {gain:{setValueAtTime:()=>{},exponentialRampToValueAtTime:value=>levels.push(value)},connect:()=>{},disconnect:()=>{}};}}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/messageSounds.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Map,Set,Promise,JSON,Number,Array,Error,window:{AudioContext:Context},require:()=>({})});
  await exports.playMessageSound({sound:"silent",volume:1},true);assert.equal(contexts,0);
  for(const sound of ["bell","wood","chime","drop"])await exports.playMessageSound({sound,volume:0.5},true);
  assert.equal(contexts,1);assert.deepEqual(frequencies,[523.25,1046.5,245,390,659.25,987.77,1100]);assert.ok(levels.every(value=>value<=0.11));
  const before=frequencies.length;await exports.playMessageSound({sound:"silent",volume:1},true);assert.equal(frequencies.length,before);
});
