// Controlled local-fixture performance measurements. No live accounts/providers.
const {chromium}=require("playwright");
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),zlib=require("node:zlib");
const {execFileSync}=require("node:child_process"),assert=require("node:assert/strict");
const {performance:clock}=require("node:perf_hooks");
const root=path.resolve("dist"),out=path.resolve("test-results/performance");fs.mkdirSync(out,{recursive:true});
const PHOTO="/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCxRRRXIcZ//9k=";
const user={id:"perf-alex",name:"Alex",email_verified:true,onboarding_complete:true},other={id:"perf-sam",name:"Sam",email_verified:true};
const olderHistory=Array.from({length:50},(_,i)=>({id:"perf-old-"+i,chat_id:"perf-chat",sender_id:other.id,sender_name:other.name,type:"text",text:"Earlier performance note "+i,created_at:new Date(Date.UTC(2026,10,4,9,0,i)).toISOString(),revision:0}));
const currentHistory=Array.from({length:100},(_,i)=>({id:"perf-"+i,chat_id:"perf-chat",sender_id:other.id,sender_name:other.name,type:"text",text:"Performance note "+i+(i%9===0?" with a longer second line to exercise variable-height rows.":""),created_at:new Date(Date.UTC(2026,10,4,10,0,i)).toISOString(),revision:0}));
let history=[...olderHistory,...currentHistory];
const files=Array.from({length:80},(_,i)=>({id:"file-"+i,chat_id:"perf-chat",sender_id:other.id,sender:other,type:"image",file_name:"Fixture photo "+i,attachment_id:"perf-asset-"+i,created_at:"2026-11-04T10:00:00Z",file_size:1024}));
let gate=null,apiRequests=[],previewRequests=[],fullPhoto=PHOTO;const cache=new Map();
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
   if(p==="/api/chats")return json([{id:"perf-chat",type:"direct",other,last_message:history[history.length-1],updated_at:history[history.length-1].created_at}]);
   if(p==="/api/chats/perf-chat")return json({id:"perf-chat",type:"direct",other});
   if(p==="/api/chats/perf-chat/messages/resolve"){let body="";for await(const chunk of req)body+=chunk;const ids=JSON.parse(body).message_ids;return json(history.filter(m=>ids.includes(m.id)));}
   if(p==="/api/chats/perf-chat/messages"){
    const after=url.searchParams.get("after"),before=url.searchParams.get("before");
    if(after){const index=history.findIndex(message=>message.id===after);return json(index<0?[]:history.slice(index+1,index+101));}
    if(before){const index=history.findIndex(message=>message.id===before);return json(index<=0?[]:history.slice(Math.max(0,index-50),index));}
    return json(history.slice(-100));
   }
   if(p==="/api/files/status")return json({available:true,used_bytes:81920,remaining_bytes:500000000,max_file_bytes:25000000});
   if(p==="/api/files")return json(files);
   if(p==="/api/spaces/sessions"||p==="/api/spaces"||p==="/api/users")return json([]);
   const preview=p.match(/^\/api\/attachments\/(perf-asset-\d+)\/preview$/);
   if(preview){previewRequests.push({id:preview[1],size:url.searchParams.get("size"),format:url.searchParams.get("format")});return json({image:"data:image/jpeg;base64,"+(url.searchParams.get("size")==="full"?fullPhoto:PHOTO),width:url.searchParams.get("size")==="full"?32:16,height:url.searchParams.get("size")==="full"?32:16});}
   return json([]);
  }
  let file=path.resolve(root,"."+p);if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,"index.html");
  let item=cache.get(file);if(!item){const raw=fs.readFileSync(file);item={raw,gz:zlib.gzipSync(raw)};cache.set(file,item);}
  const ext=path.extname(file),type={".html":"text/html",".js":"application/javascript",".json":"application/json",".css":"text/css",".ttf":"font/ttf",".woff":"font/woff",".woff2":"font/woff2",".png":"image/png",".webp":"image/webp",".svg":"image/svg+xml"}[ext]||"application/octet-stream";
  const gzip=/gzip/.test(req.headers["accept-encoding"]||"")&&![".png",".webp"].includes(ext);
  const body=gzip?item.gz:item.raw;res.writeHead(200,{"content-type":type,"content-length":body.length,"cache-control":ext===".html"?"no-cache":"public,max-age=31536000,immutable","vary":"Accept-Encoding",...(gzip?{"content-encoding":"gzip"}:{})});res.end(body);
 }catch(error){res.writeHead(500);res.end("Fixture failure");console.error(error);}
});
function diskInventory(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?diskInventory(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const inventory=diskInventory(root).filter(p=>/\.(js|ttf|woff2?)$/.test(p)).map(p=>{const b=fs.readFileSync(p);return {path:path.relative(root,p),raw_bytes:b.length,gzip_bytes:zlib.gzipSync(b).length,brotli_bytes:zlib.brotliCompressSync(b,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:4}}).length};});
const iconFonts=inventory.filter(x=>x.path.includes("/@expo/vector-icons/"));
const expectedIconFamilies=(process.env.KUKU_EXPECT_ICON_FAMILIES||"").split(",").filter(Boolean);
if(expectedIconFamilies.length)assert.deepEqual(iconFonts.map(x=>path.basename(x.path).split(".")[0]).sort(),expectedIconFamilies.slice().sort(),"Export only icon font families used by the app");
const expectedFonts=Number(process.env.KUKU_EXPECT_GOOGLE_FONT_FACES||0);if(expectedFonts)assert.equal(inventory.filter(x=>x.path.includes("/@expo-google-fonts/")).length,expectedFonts,"Export only the selected brand-font files");
const report={schema_version:1,checked_out_commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),checked_out_tree:execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim(),pr_head:process.env.KUKU_SOURCE_SHA||null,scope:"Local static export and synthetic HTTP fixtures; Chromium4x CPU,390x844; no production/phone/CWV/RPO claim",inventory,loads:[],checks:[],limitations:["Three samples are not p75/p95 or real-user data.","Compressed static fixture server is not Vercel CDN.","No network latency shaping; font/API timings are fixture-controlled.","HTTP fallback fixture does not measure real realtime delivery.","Heap snapshots are not total memory, leak proof or Android memory.","Runner action durations include automation/CDP overhead; document elapsed and paint snapshots are not action durations.","Paint snapshots stop at collection time and are not complete CWV windows.","Service workers blocked; no offline cache claims."]};
(async()=>{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const origin="http://127.0.0.1:"+server.address().port;
 const browser=await chromium.launch({headless:true,args:["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"]});
 const errors=[],external=[];let activePage=null;
 async function context(saved=false){
  const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce",serviceWorkers:"block"});
  if(saved)await ctx.addInitScript(u=>localStorage.setItem("kuku_profile",JSON.stringify(u)),user);
  const page=await ctx.newPage();activePage=page;page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(String(e)));
  page.on("request",r=>{const u=new URL(r.url());if(!["127.0.0.1",""].includes(u.hostname)&&!["data:","blob:"].includes(u.protocol))external.push(u.hostname);});
  await page.addInitScript(()=>{window.__perf={lcp:null,cls:0,longTasks:0};for(const type of ["largest-contentful-paint","layout-shift","longtask"]){try{new PerformanceObserver(list=>{for(const e of list.getEntries()){if(type==="largest-contentful-paint")window.__perf.lcp=e.startTime;if(type==="layout-shift"&&!e.hadRecentInput)window.__perf.cls+=e.value;if(type==="longtask")window.__perf.longTasks++;}}).observe({type,buffered:true});}catch{}}});
  const cdp=await ctx.newCDPSession(page);await cdp.send("Performance.enable");await cdp.send("Network.enable");await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
  const responses=[];cdp.on("Network.responseReceived",e=>{if(e.response.url.startsWith(origin))responses.push({path:new URL(e.response.url).pathname,disk_cache:!!e.response.fromDiskCache,service_worker:!!e.response.fromServiceWorker});});
  return {ctx,page,cdp,responses};
 }
 async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
 async function rowPosition(page,id){
  return page.getByTestId("message-row-"+id).evaluate(node=>{const list=document.querySelector('[data-testid="chat-message-list"]'),row=node.getBoundingClientRect(),box=list.getBoundingClientRect();return {top:row.top-box.top,bottom:row.bottom-box.top,viewport:box.height,scrollTop:list.scrollTop,bottomGap:list.scrollHeight-list.clientHeight-list.scrollTop};});
 }
 async function firstVisiblePerfRow(page){
  return page.evaluate(()=>{const list=document.querySelector('[data-testid="chat-message-list"]'),box=list.getBoundingClientRect();const rows=Array.from(list.querySelectorAll('[data-testid^="message-row-perf-"]')).map(node=>{const rect=node.getBoundingClientRect();return {id:node.getAttribute("data-testid"),top:rect.top-box.top,bottom:rect.bottom-box.top};}).filter(row=>row.bottom>0&&row.top<box.height).sort((a,b)=>a.top-b.top);return rows[0]||null;});
 }
 async function beginAction(p){p.responses.length=0;await p.page.evaluate(()=>performance.clearResourceTimings());return clock.now();}
 async function metrics(p,label,started=null){
  await settle(p.page);
  const browserMetrics=await p.page.evaluate(()=>({document_elapsed_ms:performance.now(),document_paint_snapshot:window.__perf,resources:performance.getEntriesByType("resource").map(r=>({path:new URL(r.name).pathname,transfer_bytes:r.transferSize,encoded_bytes:r.encodedBodySize,decoded_bytes:r.decodedBodySize,duration_ms:r.duration})),font_faces:Array.from(document.fonts).map(f=>({family:f.family,status:f.status})),dom_nodes:document.getElementsByTagName("*").length}));
  const values=Object.fromEntries((await p.cdp.send("Performance.getMetrics")).metrics.map(m=>[m.name,m.value]));
  return {label,runner_action_elapsed_ms:started===null?null:clock.now()-started,...browserMetrics,js_heap_used_bytes:values.JSHeapUsedSize,js_heap_total_bytes:values.JSHeapTotalSize,script_seconds:values.ScriptDuration,layout_seconds:values.LayoutDuration,responses:p.responses.slice()};
 }
 try{
  for(let i=0;i<3;i++){
   const p=await context();apiRequests=[];const started=await beginAction(p);await p.page.goto(origin+"/login");await p.page.getByTestId("auth-switch").waitFor();report.loads.push(await metrics(p,"fresh-"+i,started));if(i===0){report.font_validation=await p.page.evaluate(async()=>{const names=["Fraunces_400Regular","Fraunces_600SemiBold","DMSans_400Regular","DMSans_500Medium","DMSans_600SemiBold","ionicons"];await Promise.race([Promise.all(names.map(name=>document.fonts.load('16px "'+name+'"'))),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Fixture font validation timed out")),10000))]);return Array.from(document.fonts).map(f=>({family:f.family,status:f.status}));});}
   assert.equal(apiRequests.length,0,"Fresh sign-in must not wake the API");
   const reloaded=await beginAction(p);await p.page.reload();await p.page.getByTestId("auth-switch").waitFor();report.loads.push(await metrics(p,"repeat-"+i,reloaded));
   assert.equal(apiRequests.length,0,"Repeated fresh sign-in must not wake the API");await p.ctx.close();
  }
  for(const family of ["Fraunces_400Regular","Fraunces_600SemiBold","DMSans_400Regular","DMSans_500Medium","DMSans_600SemiBold"]){assert.ok(report.font_validation.some(f=>f.family.replace(/['"]/g,"")===family&&f.status==="loaded"),"Selected font loads: "+family);}
  assert.ok(report.font_validation.some(f=>f.family.replace(/['"]/g,"")==="ionicons"&&f.status==="loaded"),"Used Ionicons font loads");
  report.checks.push("All five brand fonts and the used Ionicons font load under their existing names");
  report.checks.push("Fresh and repeat sign-in make zero API requests");
  const p=await context(true);apiRequests=[];let release;gate={promise:new Promise(r=>release=r)};
  const shellStarted=await beginAction(p);await p.page.goto(origin+"/");await p.page.getByTestId("session-restore-notice").waitFor();await p.page.getByTestId("profile-button").waitFor();
  report.cached_shell=await metrics(p,"saved-profile-before-server-proof",shellStarted);
  assert.equal(apiRequests.filter(r=>!["/api/auth/refresh","/api/auth/me"].includes(r.path)).length,0,"Unproven cached shell must not dispatch private requests");
  gate=null;release();await p.page.getByTestId("session-restore-notice").waitFor({state:"hidden"});await p.page.getByTestId("chat-row-perf-chat").waitFor();
  report.checks.push("Saved profile shell paints before held refresh, without private operations");
  const chatStarted=await beginAction(p);await p.page.getByTestId("chat-row-perf-chat").click();await p.page.getByTestId("chat-message-list").getByText(/Performance note 99/).waitFor();
  await p.page.waitForFunction(()=>{const list=document.querySelector('[data-testid="chat-message-list"]'),row=document.querySelector('[data-testid="message-row-perf-99"]');if(!list||!row)return false;const box=list.getBoundingClientRect(),rect=row.getBoundingClientRect();return rect.bottom>box.top&&rect.top<box.bottom&&list.scrollHeight-list.clientHeight-list.scrollTop<=80;});
  report.chat_initial=await metrics(p,"100-variable-height-message-history-ready",chatStarted);
  await p.page.waitForTimeout(750);await settle(p.page);
  report.chat=await metrics(p,"100-variable-height-message-history-window-settled",chatStarted);
  report.chat.rendered_message_rows=await p.page.getByTestId("chat-message-list").locator('[data-testid^="message-row-"]').count();
  assert.ok(report.chat.rendered_message_rows>0&&report.chat.rendered_message_rows<100,"Settled chat window must mount fewer than the 100 loaded rows");
  const latestInitial=await rowPosition(p.page,"perf-99");assert.ok(latestInitial.bottom>0&&latestInitial.top<latestInitial.viewport&&latestInitial.bottomGap<=80,"Initial latest message must intersect the list at its tail");

  const scrollStarted=await beginAction(p);const scroll=p.page.getByTestId("chat-message-list");await scroll.evaluate(e=>{e.scrollTop=(e.scrollHeight-e.clientHeight)*0.45;e.dispatchEvent(new Event("scroll"));});await p.page.waitForTimeout(200);
  const anchorBefore=await firstVisiblePerfRow(p.page);assert.ok(anchorBefore,"A middle reading anchor must be mounted");
  history.push({id:"perf-incoming-100",chat_id:"perf-chat",sender_id:other.id,sender_name:other.name,type:"text",text:"New performance note while reading",created_at:"2026-11-04T10:02:00.000Z",revision:0});
  await p.page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
  await p.page.getByRole("button",{name:"Jump to new messages",exact:true}).waitFor();
  const anchorAfter=await firstVisiblePerfRow(p.page);
  assert.equal(anchorAfter.id,anchorBefore.id,"Remote append must preserve the first visible message");
  assert.ok(Math.abs(anchorAfter.top-anchorBefore.top)<=4,"Remote append must preserve the reading anchor within four pixels");
  await p.page.getByRole("button",{name:"Jump to new messages",exact:true}).click();
  await p.page.getByTestId("message-row-perf-incoming-100").waitFor();
  await p.page.waitForFunction(()=>{const list=document.querySelector('[data-testid="chat-message-list"]'),row=document.querySelector('[data-testid="message-row-perf-incoming-100"]');if(!list||!row)return false;const box=list.getBoundingClientRect(),rect=row.getBoundingClientRect();return rect.bottom>box.top&&rect.top<box.bottom&&list.scrollHeight-list.clientHeight-list.scrollTop<=80;});
  await p.page.getByRole("button",{name:"Jump to new messages",exact:true}).waitFor({state:"hidden"});
  const latestAfterJump=await rowPosition(p.page,"perf-incoming-100");assert.ok(latestAfterJump.bottomGap<=80);

  await scroll.evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event("scroll"));});await p.page.waitForTimeout(200);
  const prependAnchorBefore=await rowPosition(p.page,"perf-0");
  const olderResponse=p.page.waitForResponse(response=>new URL(response.url()).searchParams.get("before")==="perf-0"&&response.status()===200);
  await p.page.getByRole("button",{name:"Load older messages",exact:true}).click();await olderResponse;
  history.push({id:"perf-incoming-101",chat_id:"perf-chat",sender_id:other.id,sender_name:other.name,type:"text",text:"New performance note during prepend settling",created_at:"2026-11-04T10:02:01.000Z",revision:0});
  await p.page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
  await p.page.getByRole("button",{name:"Jump to new messages",exact:true}).waitFor();await p.page.waitForTimeout(350);
  const prependAnchorAfter=await rowPosition(p.page,"perf-0");
  report.chat.anchor={remote_before:anchorBefore,remote_after:anchorAfter,prepend_before:prependAnchorBefore,prepend_after:prependAnchorAfter};
  assert.ok(Math.abs(prependAnchorAfter.top-prependAnchorBefore.top)<=4,"Loading older messages must preserve the visible row position");
  await scroll.evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event("scroll"));});await p.page.getByTestId("message-row-perf-old-0").waitFor();
  report.chat.after_scroll=await metrics(p,"remote-append-jump-and-prepend-preserved",scrollStarted);
  report.checks.push("Latest row intersects the viewport; settled chat mounts fewer than 100 rows; remote append and concurrent-append 50-row prepend preserve reading position");
  fullPhoto=await p.page.evaluate(encoded=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const c=document.createElement("canvas");c.width=32;c.height=32;c.getContext("2d").drawImage(img,0,0,32,32);resolve(c.toDataURL("image/jpeg").split(",")[1]);};img.onerror=reject;img.src="data:image/jpeg;base64,"+encoded;}),PHOTO);
  const filesStarted=await beginAction(p);await p.page.goto(origin+"/files");await p.page.getByTestId("image-open-perf-asset-0").waitFor();
  await p.page.waitForFunction(()=>document.querySelector('[data-testid="image-thumbnail-perf-asset-0"] img')?.naturalWidth>0);
  await p.page.waitForTimeout(500);report.files_initial=await metrics(p,"80-image-file-list",filesStarted);
  report.files_initial.previews=previewRequests.slice();report.files_initial.mounted_images=await p.page.locator('[data-testid^="image-open-perf-asset-"]').count();
  assert.ok(previewRequests.length>0&&previewRequests.length<40,"Initial image requests must stay near the viewport");
  assert.equal(previewRequests.filter(r=>r.size==="full").length,0,"Full preview must wait for an explicit open");
  const fullResponse=p.page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==="/api/attachments/perf-asset-0/preview"&&u.searchParams.get("size")==="full"&&r.status()===200;});
  await p.page.getByTestId("image-open-perf-asset-0").click();await fullResponse;await p.page.getByTestId("image-enlarged").waitFor();
  await p.page.waitForFunction(()=>document.querySelector('[data-testid="image-enlarged"] img')?.naturalWidth===32);
  assert.equal(previewRequests.filter(r=>r.size==="full").length,1);await p.page.getByRole("button",{name:"Close image preview",exact:true}).click();
  const previewCount=(id,size)=>previewRequests.filter(request=>request.id===id&&request.size===size).length;
  const cyclesStarted=await beginAction(p);for(let i=0;i<3;i++){await p.page.getByTestId("files-segment-By person").click();await p.page.getByText("Sam",{exact:true}).first().waitFor();await p.page.getByTestId("files-segment-Recent").click();await p.page.getByTestId("image-open-perf-asset-0").waitFor();}
  await p.page.waitForTimeout(500);report.files_after_navigation=await metrics(p,"three-person-recent-cycles",cyclesStarted);
  report.files_after_navigation.previews=previewRequests.slice();
  const sameScopeCounts=new Map();for(const request of previewRequests.filter(request=>request.size==="thumb")){const key=request.id+":"+request.format;sameScopeCounts.set(key,(sameScopeCounts.get(key)||0)+1);}
  assert.ok([...sameScopeCounts.values()].every(count=>count===1),"Thumbnail requests must be coalesced and reused within one Files focus scope");
  const secondFull=p.page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==="/api/attachments/perf-asset-0/preview"&&u.searchParams.get("size")==="full"&&r.status()===200;});
  await p.page.getByTestId("image-open-perf-asset-0").click();await secondFull;await p.page.getByTestId("image-enlarged").waitFor();
  assert.equal(previewCount("perf-asset-0","full"),2,"Full previews must be released and fetched again after close");
  await p.page.getByRole("button",{name:"Close image preview",exact:true}).click();
  const thumbBeforeRoute=previewCount("perf-asset-0","thumb");
  await p.page.getByTestId("tab-home").click();await p.page.getByTestId("chat-row-perf-chat").waitFor();
  const returnedThumb=p.page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==="/api/attachments/perf-asset-0/preview"&&u.searchParams.get("size")==="thumb"&&r.status()===200;});
  await p.page.getByTestId("tab-files").click();await returnedThumb;await p.page.getByTestId("image-open-perf-asset-0").waitFor();
  assert.equal(previewCount("perf-asset-0","thumb"),thumbBeforeRoute+1,"Leaving Files must invalidate its private thumbnail scope");
  report.files_after_navigation.same_scope_max_thumbnail_requests=Math.max(...sameScopeCounts.values());
  report.files_after_navigation.full_requests_after_reopen=previewCount("perf-asset-0","full");
  report.files_after_navigation.route_return_thumbnail_requests=previewCount("perf-asset-0","thumb");
  const previousIds=new Set(previewRequests.map(r=>r.id));const distant=p.page.waitForResponse(r=>{const u=new URL(r.url()),parts=u.pathname.split("/");return parts[2]==="attachments"&&parts[4]==="preview"&&u.searchParams.get("size")==="thumb"&&!previousIds.has(parts[3]);});
  const filesScrollStarted=await beginAction(p);const scrolled=await p.page.getByTestId("image-open-perf-asset-0").evaluate(e=>{for(let p=e.parentElement;p;p=p.parentElement){if(p.scrollHeight>p.clientHeight&&/auto|scroll/.test(getComputedStyle(p).overflowY)){p.scrollTop=p.scrollHeight;p.dispatchEvent(new Event("scroll"));return true;}}return false;});
  assert.equal(scrolled,true,"Files must expose a scrollable list");await distant;await p.page.waitForTimeout(500);
  report.files_scrolled=await metrics(p,"distant-image-scroll",filesScrollStarted);report.files_scrolled.new_thumbnail_ids=Array.from(new Set(previewRequests.filter(r=>r.size==="thumb"&&!previousIds.has(r.id)).map(r=>r.id)));
  assert.ok(report.files_scrolled.new_thumbnail_ids.length>0,"Distant images must load after scrolling");assert.equal(previewRequests.filter(r=>r.size==="full").length,2);
  report.checks.push("Bounded lazy thumbnails; same-scope requests coalesce; full previews release on close; route and account boundaries invalidate private memory");
  await p.page.screenshot({path:path.join(out,"files-390.png"),fullPage:true});await p.ctx.close();
  assert.deepEqual(errors,[],"No uncaught page errors");assert.deepEqual(external,[],"No external browser requests");
  assert.equal(apiRequests.filter(r=>r.method!=="GET"&&!["/api/auth/refresh","/api/auth/ws-ticket","/api/chats/perf-chat/messages/resolve"].includes(r.path)).length,0,"No business mutation requests");
  report.checks.push("No real accounts, outgoing business mutations or external browser requests");
  report.checked_at=new Date().toISOString();report.browser=browser.version();report.api_methods=apiRequests.reduce((a,r)=>(a[r.method]=(a[r.method]||0)+1,a),{});
  report.summary={icon_font_files:iconFonts.length,icon_font_raw_bytes:iconFonts.reduce((n,x)=>n+x.raw_bytes,0),icon_font_paths:iconFonts.map(x=>x.path),google_font_faces:inventory.filter(x=>x.path.includes("/@expo-google-fonts/")).length,google_font_raw_bytes:inventory.filter(x=>x.path.includes("/@expo-google-fonts/")).reduce((n,x)=>n+x.raw_bytes,0),js_raw_bytes:inventory.filter(x=>x.path.endsWith(".js")).reduce((n,x)=>n+x.raw_bytes,0),js_gzip_bytes:inventory.filter(x=>x.path.endsWith(".js")).reduce((n,x)=>n+x.gzip_bytes,0),font_raw_bytes:inventory.filter(x=>!x.path.endsWith(".js")).reduce((n,x)=>n+x.raw_bytes,0),rendered_chat_rows:report.chat.rendered_message_rows,initial_thumbnails:report.files_initial.previews.length,total_preview_requests_after_cycles:previewRequests.length,same_scope_max_thumbnail_requests:report.files_after_navigation.same_scope_max_thumbnail_requests,full_requests_after_reopen:report.files_after_navigation.full_requests_after_reopen};
  fs.writeFileSync(path.join(out,"performance.json"),JSON.stringify(report,null,2)+"\n");console.log("KUKU_PERFORMANCE_SUMMARY "+JSON.stringify({...report.summary,loads:report.loads.map(x=>({label:x.label,document_elapsed_ms:x.document_elapsed_ms,runner_action_elapsed_ms:x.runner_action_elapsed_ms,heap:x.js_heap_used_bytes})),cached_shell_document_elapsed_ms:report.cached_shell.document_elapsed_ms,checks:report.checks}));
  console.log("Controlled performance measurement passed");
 }catch(e){fs.writeFileSync(path.join(out,"partial-performance.json"),JSON.stringify(report,null,2)+"\n");if(activePage&&!activePage.isClosed()){console.error("Performance fixture failure context",JSON.stringify({url:activePage.url(),body:(await activePage.locator("body").innerText()).slice(-4000),api:apiRequests.slice(-25),errors,external}));await activePage.screenshot({path:path.join(out,"failure.png"),fullPage:true}).catch(()=>{});}throw e;}
 finally{if(gate){gate=null;}await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
