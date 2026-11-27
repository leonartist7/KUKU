const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function moduleUnderTest(){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/callReadiness.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});return exports;}
test('saved provider setup never claims physical audio or client enablement',()=>{
 const m=moduleUnderTest(),rows=m.callReadinessRows({calls_enabled:true,provider_configured:true,secure_transport:true},false);
 assert.equal(rows[0].value,'Not enabled yet');assert.equal(rows[1].value,'Setup saved');assert.equal(rows[3].value,'Not verified');
});
test('microphone access checks release every track and never acquire after account loss',async()=>{
 const m=moduleUnderTest();let captured=0,stopped=0;
 const capture=async()=>{captured++;return {getTracks:()=>[{stop:()=>stopped++},{stop:()=>stopped++}]};};
 assert.equal(await m.checkMicrophoneAccess(capture,()=>true),true);assert.equal(stopped,2);
 assert.equal(await m.checkMicrophoneAccess(capture,()=>false),false);assert.equal(captured,1);
});
test('a late microphone permission grant is stopped after leaving the screen',async()=>{
 const m=moduleUnderTest();let resolve,current=true,stopped=0;
 const result=m.checkMicrophoneAccess(()=>new Promise(r=>resolve=r),()=>current);
 current=false;resolve({getTracks:()=>[{stop:()=>stopped++}]});assert.equal(await result,false);assert.equal(stopped,1);
});
test('microphone preflight releases later tracks even when one stop fails',async()=>{
 const m=moduleUnderTest();let stopped=0;
 const allowed=await m.checkMicrophoneAccess(async()=>({getTracks:()=>[
  {stop(){throw new Error('device cleanup failed');}}, {stop(){stopped++;}},
 ]}),()=>true);
 assert.equal(allowed,true);assert.equal(stopped,1);
});
test('client and server flags cannot advertise test calling while secure setup is incomplete',()=>{
 const m=moduleUnderTest(),ready={calls_enabled:true,provider_configured:true,secure_transport:true,configuration_ready:true};
 assert.equal(m.callReadinessRows(ready,true)[0].value,'Enabled for testing');
 for(const missing of ['provider_configured','secure_transport','configuration_ready']){
  assert.equal(m.callReadinessRows({...ready,[missing]:false},true)[0].value,'Setup still needed',missing);
 }
 assert.equal(m.callReadinessRows({...ready,calls_enabled:false},true)[0].value,'Not enabled yet');
});
