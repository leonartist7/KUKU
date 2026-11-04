// Controlled local-fixture performance measurements. No live accounts/providers.
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),zlib=require("node:zlib");
const {execFileSync}=require("node:child_process"),assert=require("node:assert/strict");
const root=path.resolve("dist"),out=path.resolve("test-results/performance");fs.mkdirSync(out,{recursive:true});
const PHOTO="/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCxRRRXIcZ//9k=";
const user={id:"perf-alex",name:"Alex",email_verified:true,onboarding_complete:true},other={id:"perf-sam",name:"Sam",email_verified:true};
const history=Array.from({length:100},(_,i)=>({id:"perf-"+i,chat_id:"perf-chat",sender_id:other.id,sender_name:other.name,type:"text",text:"Performance note "+i,created_at:new Date(Date.UTC(2026,10,4,10,0,i)).toISOString(),revision:0}));
const files=Array.from({length:80},(_,i)=>({id:"file-"+i,chat_id:"perf-chat",sender_id:other.id,sender:other,type:"image",file_name:"Fixture photo "+i,attachment_id:"perf-asset-"+i,created_at:"2026-11-04T10:00:00Z",file_size:1024}));
let gate=null,apiRequests=[],previewRequests=[];const cache=new Map();
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,"http://127.0.0.1"),p=decodeURIComponent(url.pathname);
  if(p.startsWith("/api/")){
   apiRequests.push({method:req.method,path:p});
   const json=(data,status=200)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(data));};
   if(p==="/api/auth/refresh"){if(gate)await gate.promise;return json({token:"synthetic-perf-token",user});}
   if(p==="/api/auth/me")return json(user);
   if(p==="/api/auth/ws-ticket")return json({detail:"Synthetic HTTP fallback"},503);
   if(p==="/api/messages/sync")return json({events:[],cursor:0,reset:false});
   if(p==="/api/chats")return json([{id:"perf-chat",type:"direct",other,last_message:history[99],updated_at:history[99].created_at}]);
   if(p==="/api/chats/perf-chat")return json({id:"perf-chat",type:"direct",other});
   if(p==="/api/chats/perf-chat/messages/resolve"){let body="";for await(const chunk of req)body+=chunk;const ids=JSON.parse(body).message_ids;return json(history.filter(m=>ids.includes(m.id)));}
   if(p==="/api/chats/perf-chat/messages")return json(url.searchParams.has("after")||url.searchParams.has("before")?[]:history);
   if(p==="/api/files/status")return json({available:true,used_bytes:81920,remaining_bytes:500000000,max_file_bytes:25000000});
   if(p==="/api/files")return json(files);
   if(p==="/api/spaces/sessions"||p==="/api/spaces"||p==="/api/users")return json([]);
   const preview=p.match(/^\/api\/attachments\/(perf-asset-\d+)\/preview$/);
   if(preview){previewRequests.push({id:preview[1],size:url.searchParams.get("size"),format:url.searchParams.get("format")});return json({image:"data:image/jpeg;base64,"+PHOTO,width:16,height:16});}
   return json([]);
  }
  let file=path.resolve(root,"."+p);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,"index.html");
  let item=cache.get(file);if(!item){const raw=fs.readFileSync(file);item={raw,gz:zlib.gzipSync(raw)};cache.set(file,item);}
  const ext=path.extname(file),type={".html":"text/html",".js":"application/javascript",".json":"application/json",".css":"text/css",".ttf":"font/ttf",".woff":"font/woff",".woff2":"font/woff2",".png":"image/png",".webp":"image/webp",".svg":"image/svg+xml"}[ext]||"application/octet-stream";
  const gzip=/gzip/.test(req.headers["accept-encoding"]||"")&&![".png",".webp"].includes(ext);
  const body=gzip?item.gz:item.raw;res.writeHead(200,{"content-type":type,"content-length":body.length,"cache-control":ext===".html"?"no-cache":"public,max-age=31536000,immutable","vary":"Accept-Encoding",...(gzip?{"content-encoding":"gzip"}:{})});res.end(body);
 }catch(error){res.writeHead(500);res.end("Fixture failure");console.error(error);}
});
function diskInventory(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?diskInventory(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const inventory=diskInventory(root).filter(p=>/\.(js|ttf|woff2?)$/.test(p)).map(p=>{const b=fs.readFileSync(p);return {path:path.relative(root,p),raw_bytes:b.length,gzip_bytes:zlib.gzipSync(b).length,brotli_bytes:zlib.brotliCompressSync(b,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:4}}).length};});
const report={schema_version:1,checked_out_commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),checked_out_tree:execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim(),pr_head:process.env.KUKU_SOURCE_SHA||null,scope:"Local static export and synthetic HTTP fixtures; Chromium4x CPU,390x844; no production/phone/CWV/RPO claim",inventory,loads:[],checks:[],limitations:["Three samples are not p75/p95 or real-user data.","Compressed static fixture server is not Vercel CDN.","No network latency shaping; font/API timings are fixture-controlled.","HTTP fallback fixture does not measure real realtime delivery.","Heap snapshots are not total memory, leak proof or Android memory.","Service workers blocked; no offline cache claims."]};
(async()=>{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const origin="http://127.0.0.1:"+server.address().port;
 const browser=await chromium.launch({headless:true,args:["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"]});
 const errors=[],external=[];
 async function context(saved=false){
  const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce",serviceWorkers:"block"});
  if(saved)await ctx.addInitScript(u=>localStorage.setItem("kuku_profile",JSON.stringify(u)),user);
  const page=await ctx.newPage();page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(String(e)));
  page.on("request",r=>{const u=new URL(r.url());if(!["127.0.0.1",""].includes(u.hostname)&&!["data:","blob:"].includes(u.protocol))external.push(u.hostname);});
  await page.addInitScript(()=>{window.__perf={lcp:null,cls:0,longTasks:0};for(const type of ["largest-contentful-paint","layout-shift","longtask"]){try{new PerformanceObserver(list=>{for(const e of list.getEntries()){if(type==="largest-contentful-paint")window.__perf.lcp=e.startTime;if(type==="layout-shift"&&!e.hadRecentInput)window.__perf.cls+=e.value;if(type==="longtask")window.__perf.longTasks++;}}).observe({type,buffered:true});}catch{}}});
  const cdp=await ctx.newCDPSession(page);await cdp.send("Performance.enable");await cdp.send("Network.enable");await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
  const responses=[];cdp.on("Network.responseReceived",e=>{if(e.response.url.startsWith(origin))responses.push({path:new URL(e.response.url).pathname,disk_cache:!!e.response.fromDiskCache,service_worker:!!e.response.fromServiceWorker});});
  return {ctx,page,cdp,responses};
 }
 async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
 async function metrics(p,label){
  await settle(p.page);
  const browserMetrics=await p.page.evaluate(()=>({ready_ms:performance.now(),paint:window.__perf,resources:performance.getEntriesByType("resource").map(r=>({path:new URL(r.name).pathname,transfer_bytes:r.transferSize,encoded_bytes:r.encodedBodySize,decoded_bytes:r.decodedBodySize,duration_ms:r.duration})),dom_nodes:document.getElementsByTagName("*").length}));
  const values=Object.fromEntries((await p.cdp.send("Performance.getMetrics")).metrics.map(m=>[m.name,m.value]));
  return {label,...browserMetrics,js_heap_used_bytes:values.JSHeapUsedSize,js_heap_total_bytes:values.JSHeapTotalSize,script_seconds:values.ScriptDuration,layout_seconds:values.LayoutDuration,responses:p.responses.slice()};
 }
 try{
  for(let i=0;i<3;i++){
   const p=await context();apiRequests=[];await p.page.goto(origin+"/login");await p.page.getByTestId("auth-switch").waitFor();report.loads.push(await metrics(p,"fresh-"+i));
   assert.equal(apiRequests.length,0,"Fresh sign-in must not wake the API");
   p.responses.length=0;await p.page.reload();await p.page.getByTestId("auth-switch").waitFor();report.loads.push(await metrics(p,"repeat-"+i));
   assert.equal(apiRequests.length,0,"Repeated fresh sign-in must not wake the API");await p.ctx.close();
  }
  report.checks.push("Fresh and repeat sign-in make zero API requests");
  const p=await context(true);apiRequests=[];let release;gate={promise:new Promise(r=>release=r)};
  await p.page.goto(origin+"/");await p.page.getByTestId("session-restore-notice").waitFor();await p.page.getByTestId("profile-button").waitFor();
  report.cached_shell=await metrics(p,"saved-profile-before-server-proof");
  assert.equal(apiRequests.filter(r=>!["/api/auth/refresh","/api/auth/me"].includes(r.path)).length,0,"Unproven cached shell must not dispatch private requests");
  gate=null;release();await p.page.getByTestId("session-restore-notice").waitFor({state:"hidden"});await p.page.getByTestId("chat-row-perf-chat").waitFor();
  report.checks.push("Saved profile shell paints before held refresh, without private operations");
  await p.page.getByTestId("chat-row-perf-chat").click();await p.page.getByText("Performance note 99",{exact:true}).waitFor();report.chat=await metrics(p,"100-text-message-history");
  report.chat.rendered_action_rows=await p.page.locator('[data-testid^="message-actions-perf-"]').count();
  const scroll=p.page.getByTestId("chat-message-list");await scroll.evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event("scroll"));});await settle(p.page);
  report.chat.after_scroll=await metrics(p,"history-scroll-top");
  await p.page.goto(origin+"/files");await p.page.getByTestId("image-open-perf-asset-0").waitFor();
  await p.page.waitForFunction(()=>document.querySelector('[data-testid="image-thumbnail-perf-asset-0"] img')?.naturalWidth>0);
  await p.page.waitForTimeout(500);report.files_initial=await metrics(p,"80-image-file-list");
  report.files_initial.previews=previewRequests.slice();report.files_initial.mounted_images=await p.page.locator('[data-testid^="image-open-perf-asset-"]').count();
  assert.ok(previewRequests.length>0&&previewRequests.length<40,"Initial image requests must stay near the viewport");
  assert.equal(previewRequests.filter(r=>r.size==="full").length,0,"Full preview must wait for an explicit open");
  await p.page.getByTestId("image-open-perf-asset-0").click();await p.page.getByTestId("image-enlarged").waitFor();
  await p.page.waitForFunction(()=>document.querySelector('[data-testid="image-enlarged"] img')?.naturalWidth>0);
  assert.equal(previewRequests.filter(r=>r.size==="full").length,1);await p.page.getByRole("button",{name:"Close image preview",exact:true}).click();
  for(let i=0;i<3;i++){await p.page.getByTestId("files-segment-By person").click();await p.page.getByText("Sam",{exact:true}).first().waitFor();await p.page.getByTestId("files-segment-Recent").click();await p.page.getByTestId("image-open-perf-asset-0").waitFor();}
  await p.page.waitForTimeout(500);report.files_after_navigation=await metrics(p,"three-person-recent-cycles");
  report.files_after_navigation.previews=previewRequests.slice();
  report.checks.push("Image list defers distant thumbnails and all full previews until explicitly opened");
  await p.page.screenshot({path:path.join(out,"files-390.png"),fullPage:true});await p.ctx.close();
  assert.deepEqual(errors,[],"No uncaught page errors");assert.deepEqual(external,[],"No external browser requests");
  assert.equal(apiRequests.filter(r=>r.method!=="GET"&&!["/api/auth/refresh","/api/auth/ws-ticket","/api/chats/perf-chat/messages/resolve"].includes(r.path)).length,0,"No business mutation requests");
  report.checks.push("No real accounts, outgoing business mutations or external browser requests");
  report.checked_at=new Date().toISOString();report.browser=browser.version();report.api_methods=apiRequests.reduce((a,r)=>(a[r.method]=(a[r.method]||0)+1,a),{});
  report.summary={js_raw_bytes:inventory.filter(x=>x.path.endsWith(".js")).reduce((n,x)=>n+x.raw_bytes,0),js_gzip_bytes:inventory.filter(x=>x.path.endsWith(".js")).reduce((n,x)=>n+x.gzip_bytes,0),font_raw_bytes:inventory.filter(x=>!x.path.endsWith(".js")).reduce((n,x)=>n+x.raw_bytes,0),initial_thumbnails:report.files_initial.previews.length,total_preview_requests_after_cycles:previewRequests.length};
  fs.writeFileSync(path.join(out,"performance.json"),JSON.stringify(report,null,2)+"\n");console.log("KUKU_PERFORMANCE_SUMMARY "+JSON.stringify({...report.summary,loads:report.loads.map(x=>({label:x.label,ready_ms:x.ready_ms,heap:x.js_heap_used_bytes})),cached_shell_ready_ms:report.cached_shell.ready_ms,checks:report.checks}));
  console.log("Controlled performance measurement passed");
 }catch(e){fs.writeFileSync(path.join(out,"partial-performance.json"),JSON.stringify(report,null,2)+"\n");throw e;}
 finally{if(gate){gate=null;}await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
