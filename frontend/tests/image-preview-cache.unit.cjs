const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const ts=require("typescript");

const preview={image:"data:image/jpeg;base64,AA==",width:16,height:16};
function moduleHarness(initialUser=null,initialEpoch=0){
  let user=initialUser,epoch=initialEpoch,now=0;
  const boundaries=new Set(),exports={};
  class FakeDate extends Date{static now(){return now;}}
  const source=ts.transpileModule(fs.readFileSync("src/imagePreview.ts","utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  vm.runInNewContext(source,{
    exports,Map,Set,Promise,Error,Number,JSON,RegExp,FakeDate,Date:FakeDate,
    require:name=>{
      assert.equal(name,"./api");
      return {
        getSessionEpoch:()=>epoch,
        getSessionUserId:()=>user,
        onSessionBoundary:listener=>{boundaries.add(listener);return()=>boundaries.delete(listener);}
      };
    }
  });
  return {
    api:exports,
    setSession(nextUser,nextEpoch,{boundary=true}={}){user=nextUser;epoch=nextEpoch;if(boundary)boundaries.forEach(listener=>listener());},
    advance(ms){now+=ms;}
  };
}
function assertPreview(value){assert.equal(value.image,preview.image);assert.equal(value.width,16);assert.equal(value.height,16);}

test("a proven session is required and identical thumbnail requests share one flight and cache entry",async()=>{
  const h=moduleHarness(),api=h.api;
  assert.equal(api.privateImagePreviewScope("alice","files:1"),null);
  h.setSession("alice",1);
  const scope=api.privateImagePreviewScope("alice","files:1");
  let resolve,calls=0;
  const loader=()=>{calls++;return new Promise(done=>{resolve=done;});};
  const first=api.loadPrivateImagePreview(scope,"photo","thumb","jpeg",loader);
  const second=api.loadPrivateImagePreview(scope,"photo","thumb","jpeg",loader);
  assert.equal(calls,1);
  resolve(preview);
  assertPreview(await first);assertPreview(await second);
  assertPreview(await api.loadPrivateImagePreview(scope,"photo","thumb","jpeg",async()=>{calls++;return preview;}));
  assert.equal(calls,1);
  assert.equal(api.getPrivateImagePreviewCacheStats().entries,1);
});

test("screen, account and session boundaries isolate and revoke thumbnail entries",async()=>{
  const h=moduleHarness("alice",1),api=h.api;
  const files=api.privateImagePreviewScope("alice","files:1"),chat=api.privateImagePreviewScope("alice","chat:1");
  await api.loadPrivateImagePreview(files,"photo","thumb","webp",async()=>preview);
  assert.equal(api.getCachedPrivateImagePreview(chat,"photo","thumb","webp"),undefined);
  await api.loadPrivateImagePreview(chat,"photo","thumb","webp",async()=>preview);
  assert.equal(api.getPrivateImagePreviewCacheStats().entries,2);
  api.clearPrivateImagePreviewScope("alice","files:1");
  assert.equal(api.getCachedPrivateImagePreview(files,"photo","thumb","webp"),undefined);
  assertPreview(api.getCachedPrivateImagePreview(chat,"photo","thumb","webp"));
  api.invalidatePrivateImagePreview("alice","photo");
  assert.equal(api.getPrivateImagePreviewCacheStats().entries,0);
  await api.loadPrivateImagePreview(chat,"other","thumb","jpeg",async()=>preview);
  h.setSession("alice",2);
  assert.equal(api.getPrivateImagePreviewCacheStats().entries,0);
  assert.equal(api.getCachedPrivateImagePreview(chat,"other","thumb","jpeg"),undefined);
  assert.ok(api.privateImagePreviewScope("alice","chat:2"));
  h.setSession("bob",3);
  assert.equal(api.privateImagePreviewScope("alice","chat:3"),null);
});

test("clearing a scope rejects its late private response without cancelling an unrelated flight",async()=>{
  const h=moduleHarness("alice",1),api=h.api;
  const one=api.privateImagePreviewScope("alice","files:1"),two=api.privateImagePreviewScope("alice","chat:1");
  let finishOne,finishTwo;
  const p1=api.loadPrivateImagePreview(one,"one","thumb","jpeg",()=>new Promise(done=>finishOne=done));
  const p2=api.loadPrivateImagePreview(two,"two","thumb","jpeg",()=>new Promise(done=>finishTwo=done));
  api.clearPrivateImagePreviewScope("alice","files:1");
  finishOne(preview);finishTwo(preview);
  await assert.rejects(p1,/session changed/i);
  assertPreview(await p2);
  assert.equal(api.getPrivateImagePreviewCacheStats().entries,1);
});

test("full previews and failures are never retained, while thumbnail TTL and memory limits are enforced",async()=>{
  const h=moduleHarness("alice",1),api=h.api,scope=api.privateImagePreviewScope("alice","files:1");
  let fullCalls=0;
  await api.loadPrivateImagePreview(scope,"photo","full","jpeg",async()=>{fullCalls++;return preview;});
  await api.loadPrivateImagePreview(scope,"photo","full","jpeg",async()=>{fullCalls++;return preview;});
  assert.equal(fullCalls,2);assert.equal(api.getPrivateImagePreviewCacheStats().entries,0);
  await assert.rejects(api.loadPrivateImagePreview(scope,"bad","thumb","jpeg",async()=>({image:"private",width:1,height:1})),/unavailable/i);
  assertPreview(await api.loadPrivateImagePreview(scope,"bad","thumb","jpeg",async()=>preview));
  h.advance(60_001);assert.equal(api.getPrivateImagePreviewCacheStats().entries,0);
  const large={image:"data:image/jpeg;base64,"+"A".repeat(500000),width:32,height:32};
  for(let i=0;i<6;i++)await api.loadPrivateImagePreview(scope,"large-"+i,"thumb","jpeg",async()=>large);
  const stats=api.getPrivateImagePreviewCacheStats();
  assert.ok(stats.entries<6);assert.ok(stats.estimated_bytes<=stats.max_estimated_bytes);assert.equal(stats.max_entries,64);
});

test("private image UI uses account-fenced requests and explicit navigation invalidation",()=>{
  const card=fs.readFileSync("src/PrivateImageCard.tsx","utf8");
  const files=fs.readFileSync("app/(tabs)/files.tsx","utf8");
  const chat=fs.readFileSync("app/chat/[id].tsx","utf8");
  assert.match(card,/api\.getAs<[^>]+>\(scope\.accountId/);assert.match(card,/api\.deleteAs\(uid/);
  assert.match(card,/loadPrivateImagePreview/);assert.match(card,/subscribePrivateImagePreviewInvalidation/);
  assert.match(files,/clearPrivateImagePreviewScope/);assert.match(files,/subscribeChatEvents/);assert.match(files,/cacheScope=/);
  assert.match(chat,/clearPrivateImagePreviewScope/);assert.match(chat,/cacheScope=/);
});
