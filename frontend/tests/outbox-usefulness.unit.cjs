const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function harness(send=async()=>{},storage=new Map()){
  const exports={},sent=[];
  class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/outbox.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,require:name=>name==='./api'?{ApiError,api:{postAs:async(uid,path,payload)=>{sent.push({uid,path,payload});return send(uid,path,payload);}}}:{default:{
      getItem:async key=>storage.get(key)||null,setItem:async(key,value)=>storage.set(key,value),removeItem:async key=>storage.delete(key),
    }},
  });
  return {box:exports,sent,storage,ApiError};
}
test('F50 R01 removing a later queued message during a slow send prevents its dispatch',async()=>{
  const gate=deferred(),h=harness(()=>gate.promise);
  await h.box.queueMessage('alice',{chat_id:'chat',text:'first'});
  const later=await h.box.queueMessage('alice',{chat_id:'chat',text:'cancel me'});
  const flush=h.box.flushOutbox('alice',()=>true);await tick();
  await h.box.removePending('alice',later.id);gate.resolve();await flush;
  assert.equal(h.sent.length,1);assert.equal((await h.box.getOutbox('alice')).length,0);
});
test('F50 R02 clearing an outbox while a send is pending never sends its stale snapshot',async()=>{
  const gate=deferred(),h=harness(()=>gate.promise);
  await h.box.queueMessage('alice',{chat_id:'chat',text:'first'});
  await h.box.queueMessage('alice',{chat_id:'chat',text:'cleared'});
  const flush=h.box.flushOutbox('alice',()=>true);await tick();
  await h.box.clearOutbox('alice');gate.resolve();await flush;
  assert.equal(h.sent.length,1);assert.equal((await h.box.getOutbox('alice')).length,0);
});
test('F50 R03 logout during a pending send stops all subsequent dispatch',async()=>{
  let current=true;const gate=deferred(),h=harness(()=>gate.promise);
  await h.box.queueMessage('alice',{chat_id:'chat',text:'first'});
  await h.box.queueMessage('alice',{chat_id:'chat',text:'later'});
  const flush=h.box.flushOutbox('alice',()=>current);await tick();current=false;gate.resolve();await flush;
  assert.equal(h.sent.length,1);assert.equal((await h.box.getOutbox('alice')).length,1);
});
test('F50 R04 a failing subscriber cannot falsely reject a message already saved to disk',async()=>{
  const h=harness();let healthy=0;
  h.box.subscribeOutbox(()=>{throw Error('unmounted view');});h.box.subscribeOutbox(()=>healthy++);
  const queued=await h.box.queueMessage('alice',{chat_id:'chat',text:'one copy'});
  assert.equal((await h.box.getOutbox('alice'))[0].id,queued.id);assert.equal(healthy,1);
  await h.box.flushOutbox('alice',()=>true);assert.equal(h.sent.length,1);
  await h.box.clearOutbox('alice');assert.equal(healthy,3);
});
test('F50 R05 a lost acknowledgement retries the same durable message ID after restart',async()=>{
  const storage=new Map(),h=harness(async()=>{throw Error('lost acknowledgement');},storage);
  const queued=await h.box.queueMessage('alice',{chat_id:'chat',text:'durable'});
  await h.box.flushOutbox('alice',()=>true);const restarted=harness(undefined,storage);
  await restarted.box.flushOutbox('alice',()=>true);
  assert.equal(restarted.sent[0].payload.client_message_id,queued.id);assert.equal((await restarted.box.getOutbox('alice')).length,0);
});
test('F50 R06 a permanently forbidden item fails visibly without blocking later valid messages',async()=>{
  const h=harness(async(_uid,_path,payload)=>{if(payload.text==='blocked')throw new h.ApiError('Contact unavailable',403);});
  await h.box.queueMessage('alice',{chat_id:'chat',text:'blocked'});await h.box.queueMessage('alice',{chat_id:'other',text:'allowed'});
  await h.box.flushOutbox('alice',()=>true);
  const remaining=await h.box.getOutbox('alice');assert.equal(h.sent.length,2);assert.equal(remaining.length,1);assert.equal(remaining[0].state,'failed');assert.equal(remaining[0].error,'Contact unavailable');
});
test('F50 R07 transient failures preserve order and leave later messages queued',async()=>{
  const h=harness(async()=>{throw Error('offline');});
  await h.box.queueMessage('alice',{chat_id:'chat',text:'first'});await h.box.queueMessage('alice',{chat_id:'chat',text:'later'});
  await h.box.flushOutbox('alice',()=>true);assert.equal(h.sent.length,1);assert.ok((await h.box.getOutbox('alice')).every(item=>item.state==='queued'));
});
test('F50 R08 explicit retry preserves the ID and clears the old failure',async()=>{
  let fail=true;const h=harness(async()=>{if(fail)throw new h.ApiError('Try after review',409);});
  const item=await h.box.queueMessage('alice',{chat_id:'chat',text:'retry'});await h.box.flushOutbox('alice',()=>true);
  await h.box.retryMessage('alice',item.id);assert.equal((await h.box.getOutbox('alice'))[0].error,undefined);
  fail=false;await h.box.flushOutbox('alice',()=>true);assert.equal(h.sent[1].payload.client_message_id,item.id);
});
test('F50 R09 account queues stay isolated and the 100-message limit is actionable',async()=>{
  const h=harness();for(let i=0;i<100;i++)await h.box.queueMessage('alice',{chat_id:'chat',text:String(i)});
  await assert.rejects(h.box.queueMessage('alice',{chat_id:'chat',text:'overflow'}),/Send or remove/);
  await h.box.queueMessage('bob',{chat_id:'other',text:'mine'});await h.box.flushOutbox('bob',()=>true);
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].uid,'bob');assert.equal((await h.box.getOutbox('alice')).length,100);
});
test('F50 R10 concurrent flush triggers dispatch once and encode the chat path segment',async()=>{
  const gate=deferred(),h=harness(()=>gate.promise);
  await h.box.queueMessage('alice',{chat_id:'chat/with?reserved',text:'once'});
  const first=h.box.flushOutbox('alice',()=>true);await tick();await h.box.flushOutbox('alice',()=>true);
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].path,'/chats/chat%2Fwith%3Freserved/messages');gate.resolve();await first;
});
