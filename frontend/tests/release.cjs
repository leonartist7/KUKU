const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
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
