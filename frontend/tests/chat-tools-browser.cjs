// Synthetic chat-tools UI acceptance: mock HTTP/WS and fixture accounts only.
// This is browser interaction evidence, not proof of real server authorization or provider delivery.
const {chromium}=require("playwright");
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const root=path.resolve("dist"),shots=path.resolve("test-results/chat-tools");
fs.mkdirSync(shots,{recursive:true});
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
  let file=path.resolve(root,"."+pathname);
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end();return;}
  if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,"index.html");
  res.setHeader("content-type",({".html":"text/html",".js":"application/javascript",".json":"application/json",".css":"text/css",".ttf":"font/ttf",".woff":"font/woff",".woff2":"font/woff2",".png":"image/png",".webp":"image/webp",".svg":"image/svg+xml"})[path.extname(file)]||"application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:"reduce",timezoneId:"UTC"});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const errors=[];page.on("pageerror",error=>errors.push(String(error)));
  const alice={id:"qa-alex",name:"Alex",email:"alex@example.test",email_verified:true,onboarding_complete:true};
  const morgan={id:"qa-morgan",name:"Morgan",email:"morgan@example.test",email_verified:true,onboarding_complete:true};
  const sam={id:"qa-sam",name:"Sam",email_verified:true},jordan={id:"qa-jordan",name:"Jordan",email_verified:true},jay={id:"qa-jay",name:"Jay",email_verified:true};
  let activeUser=alice,cursor=0,editConflict=true,removeCalls=0;
  const stamp=()=>new Date().toISOString(),ago=minutes=>new Date(Date.now()-minutes*60000).toISOString(),clone=value=>JSON.parse(JSON.stringify(value));
  const make=(id,text,sender,minutes,chat="chat-main")=>({id,chat_id:chat,type:"text",text,sender_id:sender.id,sender_name:sender.name,created_at:ago(minutes),revision:0,reactions:[],pinned:false});
  const messages=[
    make("own-original","Meet me by the garden gate.",alice,6),
    make("older-note","The old picnic plan.",sam,5),
    make("reply-target","Bring the little blue cup.",sam,4),
    {...make("existing-reply","Keeping the original close.",sam,3),reply_to_id:"own-original"},
    make("vanishing-original","A temporary source for a draft.",sam,2.5),
    make("latest-note","Newest conversation marker.",alice,2),
    make("side-note","A separate conversation with Jordan.",jordan,1,"chat-side"),
    make("foreign-garden","Garden note from the side conversation.",jordan,1,"chat-side"),
    make("morgan-note","Morgan's separate note.",morgan,1,"chat-morgan"),
  ];
  const chats={
    "chat-main":{id:"chat-main",members:[alice.id,sam.id],other:sam},
    "chat-side":{id:"chat-side",members:[alice.id,jordan.id],other:jordan},
    "chat-morgan":{id:"chat-morgan",members:[morgan.id,jay.id],other:jay},
  };
  const sockets=new Set(),searchRequests=[],singleReads=[],editRequests=[],reactionRequests=[],sends=[];
  let delayedSearch=null;
  function holdNextSearch(query){
    assert.equal(delayedSearch,null,"Only one delayed fixture request at a time");
    let seen;const observed=new Promise(resolve=>{seen=resolve;});
    delayedSearch={query,seen,release:null};return observed;
  }
  async function releaseSearch(){
    assert.ok(delayedSearch?.release,"A delayed search must actually reach HTTP before release");
    const release=delayedSearch.release;delayedSearch=null;release();
    await page.waitForTimeout(120);
  }
  function message(id){const value=messages.find(item=>item.id===id);assert.ok(value,"Fixture message exists: "+id);return value;}
  function emit(id,change="updated",knownRow){
    const row=knownRow||message(id),frame={type:"chat_changed",chat_id:row.chat_id,message_id:row.id,sender_id:row.sender_id,cursor:++cursor,live:true,change,revision:row.revision};
    for(const entry of sockets)if(chats[row.chat_id].members.includes(entry.uid))entry.ws.send(JSON.stringify(frame));
  }
  await context.addInitScript(user=>{
    if(!localStorage.getItem("kuku_profile"))localStorage.setItem("kuku_profile",JSON.stringify(user));
    localStorage.setItem("kuku_appearance_v1",JSON.stringify({mode:"light",dayTheme:"warm",nightTheme:"evening",dayAt:"07:00",nightAt:"19:00",decor:"plain"}));
  },alice);
  await page.routeWebSocket(/.*/,ws=>{
    const entry={ws,uid:activeUser?.id};sockets.add(entry);
    ws.onClose(()=>sockets.delete(entry));
    ws.onMessage(raw=>{if(String(raw)==="ping")ws.send(JSON.stringify({type:"pong"}));});
    ws.send(JSON.stringify({type:"ready",cursor,reset:false}));
  });
  await page.route("**/api/**",async route=>{
    const req=route.request(),url=new URL(req.url()),endpoint=url.pathname,method=req.method();
    const body=req.headers()["content-type"]?.includes("application/json")?req.postDataJSON()||{}:{};
    const respond=(status,data)=>route.fulfill({status,contentType:"application/json",headers:{"cache-control":"no-store","access-control-allow-origin":origin,"access-control-allow-credentials":"true","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"GET,POST,DELETE,OPTIONS"},body:JSON.stringify(data)});
    if(method==="OPTIONS")return respond(200,{});
    if(endpoint==="/api/auth/refresh")return activeUser?respond(200,{token:"fixture-"+activeUser.id,user:activeUser}):respond(401,{detail:"Sign in again"});
    if(endpoint==="/api/auth/login"){
      if(body.email!==morgan.email)return respond(401,{detail:"Unknown synthetic account"});
      activeUser=morgan;return respond(200,{token:"fixture-"+activeUser.id,user:activeUser});
    }
    if(endpoint==="/api/auth/me")return activeUser?respond(200,activeUser):respond(401,{detail:"Sign in again"});
    if(endpoint==="/api/auth/logout"){activeUser=null;return respond(200,{ok:true});}
    if(endpoint==="/api/auth/ws-ticket")return respond(200,{ticket:"fixture-ticket"});
    if(endpoint==="/api/messages/sync")return respond(200,{events:[],cursor,reset:false});
    if(endpoint==="/api/files/status")return respond(200,{available:true,used_bytes:0,remaining_bytes:5000000,max_file_bytes:5000000});
    if(endpoint==="/api/users")return respond(200,activeUser?.id===alice.id?[sam,jordan]:[jay]);
    if(endpoint==="/api/chats"&&method==="GET")return respond(200,Object.values(chats).filter(chat=>chat.members.includes(activeUser?.id)).map(chat=>({...chat,type:"direct",last_message:messages.filter(row=>row.chat_id===chat.id).slice(-1)[0],updated_at:stamp()})));
    const match=endpoint.match(/^\/api\/chats\/([^/]+)(?:\/(.*))?$/);
    if(!match)return respond(200,[]);
    const chatId=decodeURIComponent(match[1]),tail=match[2]||"",chat=chats[chatId];
    if(!activeUser||!chat?.members.includes(activeUser.id))return respond(403,{detail:"This conversation is unavailable"});
    if(!tail)return respond(200,{...chat,type:"direct"});
    let rows=messages.filter(row=>row.chat_id===chatId);
    if(tail==="messages"&&method==="GET"){
      if(url.searchParams.get("after")){const index=rows.findIndex(row=>row.id===url.searchParams.get("after"));rows=index<0?[]:rows.slice(index+1);}
      if(url.searchParams.get("before")){const index=rows.findIndex(row=>row.id===url.searchParams.get("before"));rows=index<0?[]:rows.slice(0,index);}
      return respond(200,clone(rows.slice(-Number(url.searchParams.get("limit")||100))));
    }
    if(tail==="messages"&&method==="POST"){
      sends.push(clone(body));assert.equal(body.chat_id,chatId);assert.ok(body.client_message_id);
      let row=rows.find(item=>item.client_message_id===body.client_message_id);
      if(!row){row={...make("sent-"+sends.length,body.text,activeUser,0,chatId),client_message_id:body.client_message_id,...(body.reply_to_id?{reply_to_id:body.reply_to_id}:{})};messages.push(row);emit(row.id,"created");}
      return respond(200,clone(row));
    }
    if(tail==="messages/resolve"&&method==="POST")return respond(200,clone(rows.filter(row=>body.message_ids.includes(row.id))));
    if(tail==="search"){
      const q=url.searchParams.get("q");searchRequests.push({chatId,q,uid:activeUser.id});
      let results=rows.filter(row=>!row.deleted_at&&row.text?.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
      // Fault injection tests client-side scope filtering in addition to backend integration tests.
      if(q==="garden"&&chatId==="chat-main")results=[...results,message("foreign-garden")];
      if(delayedSearch?.query===q){
        const held=delayedSearch,captured=clone(results);
        held.seen();await new Promise(resolve=>{held.release=resolve;});
        return respond(200,captured);
      }
      return respond(200,clone(results));
    }
    if(tail==="pins")return respond(200,clone(rows.filter(row=>row.pinned&&!row.deleted_at)));
    const actionMatch=tail.match(/^messages\/([^/]+)(?:\/(edit|remove|reaction|pin))?$/);
    if(!actionMatch)return respond(404,{detail:"Unknown fixture route"});
    const row=rows.find(item=>item.id===decodeURIComponent(actionMatch[1])),action=actionMatch[2];
    if(!row)return respond(404,{detail:"Message not found"});
    if(!action&&method==="GET"){singleReads.push({id:row.id,uid:activeUser.id});return respond(200,clone(row));}
    if(action==="edit"){
      assert.equal(row.sender_id,activeUser.id);editRequests.push(clone(body));
      if(editConflict){editConflict=false;row.text="Garden plan changed on another device.";row.revision++;row.edited_at=stamp();return respond(409,{detail:"This message changed. Refresh it and try again."});}
      if(body.expected_revision!==row.revision)return respond(409,{detail:"This message changed. Refresh it and try again."});
      row.text=body.text;row.revision++;row.edited_at=stamp();emit(row.id);return respond(200,clone(row));
    }
    if(action==="reaction"){
      reactionRequests.push(clone(body));row.reactions=body.emoji?[{emoji:body.emoji,user_ids:[activeUser.id]}]:[];row.revision++;emit(row.id);return respond(200,clone(row));
    }
    if(action==="pin"){row.pinned=body.pinned;row.revision++;emit(row.id);return respond(200,clone(row));}
    if(action==="remove"){
      removeCalls++;assert.equal(row.sender_id,activeUser.id);assert.equal(body.expected_revision,row.revision);
      row.type="text";row.text=null;row.deleted_at=stamp();row.revision++;row.reactions=[];row.pinned=false;delete row.reply_to_id;
      emit(row.id);return respond(200,clone(row));
    }
    return respond(404,{detail:"Unknown mutation"});
  });
  const main=()=>page.getByRole("button",{name:"Back to chats",exact:true}).locator("..").locator("..");
  const panel=title=>page.getByRole("heading",{name:title,exact:true}).locator("..").locator("..");
  async function closePanel(){await page.getByRole("button",{name:"Close message panel",exact:true}).click();await page.getByRole("button",{name:"Close message panel",exact:true}).waitFor({state:"hidden"});}
  async function actions(id){await main().getByTestId("message-actions-"+id).click();await page.getByRole("heading",{name:"Message",exact:true}).waitFor();}
  async function openMain(){await page.getByTestId("chat-row-chat-main").click();await main().getByText("Newest conversation marker.",{exact:true}).waitFor();}
  try{
    await page.goto(origin+"/");await openMain();
    // Reply drafts remain deliberate, and sending stores an ID rather than a copied quotation.
    await actions("reply-target");await page.getByRole("button",{name:"Reply",exact:true}).click();
    await main().getByTestId("reply-draft").getByText("Bring the little blue cup.",{exact:true}).waitFor();
    await main().getByTestId("message-input").fill("A draft we keep.");
    await page.getByRole("button",{name:"Cancel reply",exact:true}).click();
    assert.equal(await main().getByTestId("reply-draft").count(),0);assert.equal(await main().getByTestId("message-input").inputValue(),"A draft we keep.");
    await actions("reply-target");await page.getByRole("button",{name:"Reply",exact:true}).click();
    await main().getByTestId("message-input").fill("I will bring it.");
    const sent=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname==="/api/chats/chat-main/messages");
    await main().getByTestId("send-button").click();await sent;
    await main().getByText("I will bring it.",{exact:true}).waitFor();await main().getByTestId("reply-draft").waitFor({state:"hidden"});
    assert.equal(sends[0].reply_to_id,"reply-target");assert.equal(sends[0].text,"I will bring it.");
    assert.equal(sends[0].reply_preview,undefined);assert.equal(sends[0].quoted_text,undefined);
    const sentBubble=main().getByText("I will bring it.",{exact:true}).locator("..");
    await sentBubble.getByRole("button",{name:"View original message",exact:true}).click();
    await panel("Original message").getByText("Bring the little blue cup.",{exact:true}).waitFor();await closePanel();
    // Reactions can be added and removed through the actual controls.
    await actions("reply-target");await page.getByRole("button",{name:"React with ❤️",exact:true}).click();
    await main().getByRole("button",{name:"❤️ reaction, 1, selected",exact:true}).waitFor();
    await main().getByRole("button",{name:"❤️ reaction, 1, selected",exact:true}).click();
    await main().getByRole("button",{name:"❤️ reaction, 1, selected",exact:true}).waitFor({state:"hidden"});
    assert.deepEqual(reactionRequests.map(body=>body.emoji),["❤️",null]);
    // A conflict preserves the draft and requires explicitly reviewing the latest revision.
    const editedText="Meet me by the garden gate at six.";
    await actions("own-original");await page.getByRole("button",{name:"Edit message",exact:true}).click();
    await page.getByTestId("edit-message-input").fill(editedText);
    await page.getByRole("button",{name:"Save edited message",exact:true}).click();
    await panel("Edit your message").getByRole("alert").filter({hasText:"Review the latest version"}).waitFor();
    assert.equal(await page.getByTestId("edit-message-input").inputValue(),editedText);
    await page.screenshot({path:path.join(shots,"edit-conflict-390.png"),fullPage:true});
    await page.getByRole("button",{name:"Keep draft and review latest",exact:true}).click();
    await panel("Edit your message").getByText("Garden plan changed on another device.",{exact:true}).waitFor();
    assert.equal(await page.getByTestId("edit-message-input").inputValue(),editedText);
    await page.getByRole("button",{name:"Save edited message",exact:true}).click();
    await page.getByTestId("edit-message-input").waitFor({state:"hidden"});await main().getByText(editedText,{exact:true}).first().waitFor();
    assert.deepEqual(editRequests.map(body=>body.expected_revision),[0,1]);
    // Pin/search results stay inside the selected conversation and open the canonical original.
    await actions("own-original");await page.getByRole("button",{name:"Pin message",exact:true}).click();
    await main().getByTestId("chat-pins-button").click();
    await panel("Pinned messages").getByRole("button",{name:"Open message from Alex",exact:true}).click();
    await panel("Original message").getByText(editedText,{exact:true}).waitFor();await closePanel();
    await main().getByTestId("chat-search-button").click();await page.getByTestId("chat-search-input").fill("garden");
    await panel("Find a message").getByRole("button",{name:"Open message from Alex",exact:true}).waitFor();
    assert.equal(await panel("Find a message").getByText("Garden note from the side conversation.",{exact:true}).count(),0,"Client rejects an injected result from another conversation");
    await page.screenshot({path:path.join(shots,"scoped-search-390.png"),fullPage:true});await closePanel();
    await actions("own-original");await page.getByRole("button",{name:"Unpin message",exact:true}).click();
    await main().getByTestId("chat-pins-button").click();await panel("Pinned messages").getByText("Pin a message from its action menu.",{exact:true}).waitFor();await closePanel();
    // Updates to older loaded rows must fetch that row, not only poll after the newest ID.
    const beforeReads=singleReads.filter(read=>read.id==="older-note").length;
    const older=message("older-note");older.text="Older note refreshed through its own message lookup.";older.revision++;emit(older.id);
    await main().getByText(older.text,{exact:true}).waitFor();
    assert.ok(singleReads.filter(read=>read.id==="older-note").length>beforeReads,"An updated older row resolves its own message ID");
    // Cancel removal once, then confirm; both the row and cached reply quotation redact.
    await actions("own-original");await page.getByRole("button",{name:"Remove for everyone",exact:true}).click();
    await page.getByRole("button",{name:"Keep message",exact:true}).click();assert.equal(removeCalls,0);
    await page.getByRole("button",{name:"Remove for everyone",exact:true}).click();
    await page.getByRole("button",{name:"Confirm remove message for everyone",exact:true}).click();
    await page.getByRole("button",{name:"Confirm remove message for everyone",exact:true}).waitFor({state:"hidden"});
    await main().getByText("Message removed",{exact:true}).first().waitFor();
    assert.equal(await main().getByText(editedText,{exact:true}).count(),0,"Removed text disappears from loaded rows and reply previews");
    assert.ok(await main().getByText("Message removed",{exact:true}).count()>=2,"Tombstone and original reply both show removal");
    const originalReply=main().getByText("Keeping the original close.",{exact:true}).locator("..");
    await originalReply.getByRole("button",{name:"View original message",exact:true}).click();
    await panel("Original message").getByText("Message removed",{exact:true}).waitFor();
    assert.equal(await panel("Original message").getByText(editedText,{exact:true}).count(),0);
    await page.screenshot({path:path.join(shots,"removed-original-390.png"),fullPage:true});await closePanel();
    await main().getByTestId("chat-search-button").click();await page.getByTestId("chat-search-input").fill("garden");
    await panel("Find a message").getByText("No messages found. Try another word.",{exact:true}).waitFor();await closePanel();
    // A disappeared original resolves to null (404), not merely a tombstone.
    await actions("vanishing-original");await page.getByRole("button",{name:"Reply",exact:true}).click();
    const preservedDraft="Keep this unsent reply draft.";
    await main().getByTestId("message-input").fill(preservedDraft);
    const vanished=clone(message("vanishing-original"));messages.splice(messages.findIndex(row=>row.id===vanished.id),1);vanished.revision++;
    emit(vanished.id,"updated",vanished);
    await main().getByTestId("reply-draft").getByText("View original message",{exact:true}).waitFor();
    assert.equal(await main().getByTestId("reply-draft").getByText("A temporary source for a draft.",{exact:true}).count(),0);
    const sendsBeforeMissingOriginal=sends.length;
    await main().getByTestId("send-button").click();
    await main().getByTestId("chat-error").getByText(/^The original message is unavailable\. Cancel this reply to send your draft\. Your text is kept\.(?:\s*·\s*Tap to retry)?$/).waitFor();
    assert.equal(await main().getByTestId("message-input").inputValue(),preservedDraft);
    assert.equal(sends.length,sendsBeforeMissingOriginal,"An unavailable reply original cannot queue a send");
    await page.getByRole("button",{name:"Cancel reply",exact:true}).click();
    await main().getByTestId("chat-error").waitFor({state:"hidden"});
    assert.equal(await main().getByTestId("message-input").inputValue(),preservedDraft);
    const ordinarySend=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname==="/api/chats/chat-main/messages");
    await main().getByTestId("send-button").click();await ordinarySend;
    assert.equal(sends[sends.length-1].text,preservedDraft);assert.equal(sends[sends.length-1].reply_to_id,undefined,"Cancel reply preserves the text for an ordinary send");
    // Check the actual search/action sheets at phone and tablet widths, not only an idle chat.
    for(const width of [320,390,768]){
      await page.setViewportSize({width,height:900});
      await main().getByTestId("chat-search-button").click();await page.getByTestId("chat-search-input").fill("cup");
      await panel("Find a message").getByRole("button",{name:"Open message from Sam",exact:true}).waitFor();
      assert.equal(await page.locator("html").evaluate(element=>element.scrollWidth),width,"Search sheet fits "+width+"px");
      await page.screenshot({path:path.join(shots,"search-"+width+".png"),fullPage:true});await closePanel();
      await actions("reply-target");
      assert.equal(await page.locator("html").evaluate(element=>element.scrollWidth),width,"Message actions fit "+width+"px");
      const replyTarget=await page.getByRole("button",{name:"Reply",exact:true}).boundingBox();assert.ok(replyTarget&&replyTarget.height>=44,"Reply action has a usable touch target");
      await page.screenshot({path:path.join(shots,"actions-"+width+".png"),fullPage:true});await closePanel();
    }
    await page.setViewportSize({width:390,height:900});
    // Actual SPA navigation disposes reply/search state and ignores a response released later.
    await actions("reply-target");await page.getByRole("button",{name:"Reply",exact:true}).click();
    const navigationHeld=holdNextSearch("cup");await main().getByTestId("chat-search-button").click();await page.getByTestId("chat-search-input").fill("cup");await navigationHeld;
    await closePanel();await page.getByRole("button",{name:"Back to chats",exact:true}).click();
    await page.getByTestId("chat-row-chat-side").click();await main().getByText("A separate conversation with Jordan.",{exact:true}).waitFor();
    await releaseSearch();
    assert.equal(await main().getByTestId("reply-draft").count(),0);assert.equal(await main().getByText("Bring the little blue cup.",{exact:true}).count(),0);
    assert.equal(await main().getByTestId("message-input").inputValue(),"");
    // Repeat with real sign-out/sign-in UI while a previous account's response is held.
    await page.getByRole("button",{name:"Back to chats",exact:true}).click();await openMain();
    const accountHeld=holdNextSearch("original");await main().getByTestId("chat-search-button").click();await page.getByTestId("chat-search-input").fill("original");await accountHeld;
    await closePanel();await page.getByRole("button",{name:"Back to chats",exact:true}).click();
    await page.getByTestId("profile-button").click();await page.getByTestId("sign-out-btn").click();
    await page.getByTestId("email-input").fill(morgan.email);await page.getByTestId("password-input").fill("a synthetic safe passphrase");await page.getByTestId("auth-submit").click();
    await page.getByTestId("chat-row-chat-morgan").click();await main().getByText("Morgan's separate note.",{exact:true}).waitFor();
    await releaseSearch();
    assert.equal(await main().getByTestId("reply-draft").count(),0);assert.equal(await main().getByTestId("message-input").inputValue(),"");
    assert.equal(await main().getByText("Bring the little blue cup.",{exact:true}).count(),0);assert.equal(await main().getByText("Keeping the original close.",{exact:true}).count(),0);
    assert.equal(await page.getByRole("heading",{name:"Find a message",exact:true}).count(),0,"A late prior-account response cannot reopen its search panel");
    for(const width of [320,390,768]){
      await page.setViewportSize({width,height:900});await page.waitForTimeout(80);
      assert.equal(await page.locator("html").evaluate(element=>element.scrollWidth),width,"Chat tools fit "+width+"px");
      await page.screenshot({path:path.join(shots,"chat-"+width+".png"),fullPage:true});
    }
    assert.ok(searchRequests.some(request=>request.chatId==="chat-main"&&request.q==="garden"));
    assert.deepEqual(errors,[],"No uncaught browser errors");
    console.log("Synthetic chat-tools UI acceptance passed: deliberate replies, ID-only quotes, reactions, edit conflict/review retry, scoped search/pins, older-message websocket updates, removal redaction, navigation/account isolation and 320/390/768px layouts. Mock HTTP/WS evidence only.");
  }catch(error){
    await page.screenshot({path:path.join(shots,"failure.png"),fullPage:true}).catch(()=>{});
    console.error("Chat-tools failure context:",JSON.stringify({url:page.url(),body:(await page.locator("body").innerText()).slice(-3500),activeUser:activeUser?.id,editRequests,reactionRequests,errors}));throw error;
  }finally{
    if(delayedSearch?.release)delayedSearch.release();
    await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
