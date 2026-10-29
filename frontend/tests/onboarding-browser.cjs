const TEST_PHOTO="/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCxRRRXIcZ//9k=";
// Synthetic browser acceptance: no real accounts, invitation codes or outgoing email.
const {chromium}=require("playwright");
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const root=path.resolve("dist"),shots=path.resolve("test-results/onboarding");
fs.mkdirSync(shots,{recursive:true});
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
  let file=path.resolve(root,"."+pathname);
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);return res.end();}
  if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,"index.html");
  const type={".html":"text/html",".js":"application/javascript",".json":"application/json",".png":"image/png",".woff":"font/woff",".ttf":"font/ttf",".css":"text/css"}[path.extname(file)]||"application/octet-stream";
  res.setHeader("content-type",type);fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(4173,"127.0.0.1",resolve));
  const browser=await chromium.launch({headless:true});
  const origin="http://127.0.0.1:4173",errors=[];
  async function scenario(width,height){
    const context=await browser.newContext({viewport:{width,height},reducedMotion:"reduce",timezoneId:"UTC",permissions:["clipboard-read","clipboard-write"]});
    const page=await context.newPage();let user=null,sends=0,profiles=0,uploadedBytes=null,shared=null,inviteEmail="unset",photoSaves=0,uploadAttempts=0;
    page.on("pageerror",e=>errors.push(String(e)));
    await page.clock.setFixedTime(new Date("2026-10-29T12:00:00Z"));
    await page.route("**/api/**",async route=>{
      const req=route.request(),endpoint=new URL(req.url()).pathname,body=req.headers()["content-type"]?.includes("application/json") ? req.postDataJSON()||{} : {};
      const respond=(status,data)=>route.fulfill({status,contentType:"application/json",headers:{"cache-control":"no-store","access-control-allow-origin":origin,"access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"POST,GET,OPTIONS"},body:JSON.stringify(data)});
      if(endpoint==="/api/auth/register"){user={id:"qa-user",email:body.email,name:body.name,bio:"",email_verified:false,onboarding_complete:false};return respond(200,{token:"synthetic-test-access",user});}
      if(endpoint==="/api/auth/refresh")return user?respond(200,{token:"synthetic-test-access",user}):respond(401,{detail:"Sign in again"});
      if(endpoint==="/api/auth/me")return user?respond(200,user):respond(401,{detail:"Sign in again"});
      if(endpoint==="/api/auth/verification"){sends++;return respond(200,{ok:true});}
      if(endpoint==="/api/auth/verify"){if(body.code!=="synthetic-email-code")return respond(400,{detail:"Invalid or expired code"});user.email_verified=true;return respond(200,{ok:true});}
      if(endpoint==="/api/auth/profile"){profiles++;user={...user,name:body.name,bio:body.bio,onboarding_complete:true};return respond(200,user);}
      if(endpoint==="/api/auth/photo"){photoSaves++;assert.ok(body.image_base64===null||body.image_base64.length>20);user={...user,avatar:body.image_base64===null?null:"data:image/jpeg;base64,"+TEST_PHOTO};return respond(200,user);}
      if(endpoint==="/api/invites"){inviteEmail=body.email;return respond(200,{invite_url:origin+"/login#invite="+"synthetic-link-invitation-0123456789",invite_token:"synthetic-link-invitation-0123456789"});}
      if(endpoint==="/api/users")return respond(200,[{id:"sister",name:"Sam",email_verified:true}]);
      if(endpoint==="/api/chats"&&req.method()==="POST")return respond(200,{id:"synthetic-chat"});
      if(endpoint==="/api/chats/synthetic-chat/attachments"){if(req.method()==="OPTIONS")return respond(200,{});uploadedBytes=req.postDataBuffer();uploadAttempts++;if(uploadAttempts===1)return respond(503,{detail:"File storage is not configured"});return respond(200,{id:"synthetic-attachment",file_name:"family.txt",file_size:uploadedBytes.length});}
      if(endpoint==="/api/chats/synthetic-chat/messages"&&req.method()==="POST"){shared=body;return respond(200,{...body,id:"synthetic-message",sender_id:"qa-user",created_at:new Date().toISOString()});}
      if(endpoint==="/api/chats/synthetic-chat")return respond(200,{id:"synthetic-chat",other:{id:"sister",name:"Sam"}});
      if(endpoint==="/api/auth/logout"){user=null;return respond(200,{ok:true});}
      return respond(200,[]);
    });
    await page.goto(origin+(width===320?"/":"/login"));await page.getByTestId("auth-switch").waitFor();
    assert.equal(await page.locator("html").evaluate(e=>e.scrollWidth),width,"No horizontal overflow at "+width);
    await page.screenshot({path:path.join(shots,"login-"+width+".png"),fullPage:true});
    return {page,context,state:()=>({user,sends,profiles,uploadedBytes,shared,inviteEmail,photoSaves})};
  }
  try {
    const {page,context,state}=await scenario(390,844);
    await page.getByTestId("auth-switch").click();
    await page.getByTestId("auth-submit").click();
    await page.getByRole("alert").filter({hasText:"complete email address"}).waitFor();
    await page.getByTestId("email-input").fill("onboarding-qa@example.com");
    await page.getByTestId("invite-input").fill("synthetic-invitation-code-for-browser-tests");
    await page.getByTestId("auth-submit").click();
    await page.getByTestId("name-input").fill("Alex");
    await page.getByTestId("password-input").fill("a long synthetic passphrase");
    await page.getByRole("button",{name:"Show password",exact:true}).click();
    assert.equal(await page.getByTestId("password-input").evaluate(input=>input.type),"text");
    await page.screenshot({path:path.join(shots,"create-account-390.png"),fullPage:true});
    await page.getByTestId("auth-submit").click();
    await page.getByTestId("send-verification").waitFor();
    assert.equal(state().sends,0,"Opening verification must not send email as an effect");
    await page.reload();await page.getByTestId("send-verification").waitFor();
    await page.getByTestId("send-verification").click();
    await page.getByText("Code sent. Check your inbox or spam folder.",{exact:false}).waitFor();
    assert.equal(state().sends,1);
    await page.getByTestId("verification-code").fill("incorrect-email-code");
    await page.getByTestId("verify-submit").click();
    await page.getByRole("alert").filter({hasText:"Invalid or expired code"}).waitFor();
    await page.screenshot({path:path.join(shots,"verification-error-390.png"),fullPage:true});
    await page.getByTestId("verification-code").fill("synthetic-email-code");
    await page.getByTestId("verify-submit").click();
    await page.getByTestId("profile-name").waitFor();
    await page.getByTestId("profile-name").fill("Alex Rivera");
    await page.getByTestId("profile-bio").fill("Coffee, sketches, and little everyday stories.");
    await page.getByRole("radio",{name:"Sage appearance"}).click();
    await page.screenshot({path:path.join(shots,"profile-390.png"),fullPage:true});
    await page.getByTestId("profile-submit").click();
    try {await page.getByRole("button",{name:"Invite someone I care about",exact:true}).waitFor();}
    catch(e){console.log("Onboarding failure context:",JSON.stringify({url:page.url(),state:state(),body:(await page.locator("body").innerText()).slice(-2500)}));throw e;}
    assert.equal(state().profiles,1);
    assert.equal(state().user.onboarding_complete,true);
    await page.screenshot({path:path.join(shots,"welcome-390.png"),fullPage:true});
    await page.reload();await page.getByTestId("profile-button").waitFor();
    await page.getByTestId("profile-button").click();
    await page.getByTestId("settings-profile").click();
    await page.getByTestId("profile-name").waitFor();
    assert.equal(await page.getByTestId("profile-name").inputValue(),"Alex Rivera");
    assert.equal(await page.getByTestId("profile-bio").inputValue(),"Coffee, sketches, and little everyday stories.");
    // Photo picker sends image content, saves without completing profile again, and supports removal.
    const chooser=page.waitForEvent("filechooser");
    await page.getByRole("button",{name:"Add profile photo",exact:true}).click();
    await (await chooser).setFiles({name:"portrait.jpg",mimeType:"image/jpeg",buffer:Buffer.from(TEST_PHOTO,"base64")});
    await page.getByRole("alert").filter({hasText:"Photo saved"}).waitFor();
    assert.equal(state().photoSaves,1);
    await page.reload();await page.getByRole("button",{name:"Change profile photo",exact:true}).waitFor();
    await page.getByRole("button",{name:"Remove profile photo",exact:true}).click();
    await page.getByRole("alert").filter({hasText:"Photo removed"}).waitFor();
    assert.equal(state().photoSaves,2);
    await page.goto(origin+"/appearance");
    await page.getByRole("radio",{name:"Automatic",exact:true}).waitFor();
    await page.clock.install({time:new Date("2026-10-29T18:59:58Z")});
    await page.clock.runFor(1000);
    await page.getByText("Active now: Sage.",{exact:false}).waitFor();
    await page.clock.runFor(1100);
    await page.getByText("Active now: Evening.",{exact:false}).waitFor();
    await page.getByRole("radio",{name:"Night palettes",exact:true}).click();
    await page.getByRole("radio",{name:"Forest palette",exact:true}).click();
    await page.getByText("Active now: Forest.",{exact:false}).waitFor();
    await page.getByRole("radio",{name:"Little garden decoration",exact:true}).click();
    await page.screenshot({path:path.join(shots,"appearance-night-390.png"),fullPage:true});
    await page.clock.setFixedTime(new Date("2026-10-30T07:00:00Z"));await page.clock.runFor(1000);
    await page.getByText("Active now: Sage.",{exact:false}).waitFor();
    await page.getByLabel("Dark starts",{exact:true}).fill("25:00");
    await page.getByRole("button",{name:"Save schedule",exact:true}).click();
    await page.getByRole("alert").filter({hasText:"Choose two different times"}).waitFor();
    await page.getByLabel("Dark starts",{exact:true}).fill("20:00");
    await page.getByRole("button",{name:"Save schedule",exact:true}).click();
    await page.getByRole("alert").filter({hasText:"Schedule saved"}).waitFor();
    await page.reload();await page.getByLabel("Dark starts",{exact:true}).waitFor();
    assert.equal(await page.getByLabel("Dark starts",{exact:true}).inputValue(),"20:00");
    await page.getByRole("radio",{name:"Always dark",exact:true}).click();
    await page.getByText("Active now: Forest.",{exact:false}).waitFor();
    await page.clock.resume();
    await page.goto(origin+"/invite");
    await page.getByRole("button",{name:"Create invitation link",exact:true}).click();
    await page.getByRole("button",{name:"Copy invitation link",exact:true}).click();
    await page.getByRole("alert").filter({hasText:"Invitation link copied"}).waitFor();
    assert.equal(state().inviteEmail,null);
    const link=await page.evaluate(()=>navigator.clipboard.readText());
    assert.ok(link.endsWith("#invite=synthetic-link-invitation-0123456789"));
    await page.screenshot({path:path.join(shots,"invitation-390.png"),fullPage:true});
    await page.goto(origin+"/files");
    await page.getByRole("button",{name:"Upload a file",exact:true}).click();
    await page.getByTestId("contact-sister").click();
    const filePicker=page.waitForEvent("filechooser");
    await page.getByRole("button",{name:"Choose a file",exact:true}).click();
    await (await filePicker).setFiles({name:"family.txt",mimeType:"text/plain",buffer:Buffer.from("A real family file.")});
    await page.getByTestId("quick-send").click();
    await page.getByRole("alert").filter({hasText:"File storage is not configured"}).waitFor();
    await page.getByText("family.txt",{exact:false}).waitFor();
    await page.getByTestId("quick-send").click();
    await page.waitForURL("**/chat/synthetic-chat");
    await page.waitForTimeout(250);
    assert.equal(state().uploadedBytes.toString(),"A real family file.");
    assert.equal(state().shared.attachment_id,"synthetic-attachment");
    assert.equal(state().shared.file_name,undefined,"No filename-only pretend upload");
    await page.goto(origin+"/");
    await page.setViewportSize({width:320,height:844});
    await page.getByRole("button",{name:"Open quick actions",exact:true}).click();
    for(const key of ["share-file","share-photo","invite"]) await page.getByTestId("radial-"+key).waitFor();
    assert.equal(await page.locator("html").evaluate(e=>e.scrollWidth),320);
    await page.waitForTimeout(350);
    await page.screenshot({path:path.join(shots,"quick-actions-320.png"),fullPage:true});
    await context.close();
    const invited=await scenario(390,844);
    await invited.page.goto(link);
    await invited.page.getByTestId("invite-input").waitFor();
    assert.equal(await invited.page.getByTestId("invite-input").inputValue(),"synthetic-link-invitation-0123456789");
    assert.equal(new URL(invited.page.url()).hash,"");
    await invited.context.close();
    for(const width of [320,768,1440]){const s=await scenario(width,900);await s.context.close();}
    assert.deepEqual(errors,[],"No uncaught browser errors");
    console.log("Onboarding, profile photo, local-time schedule, saved themes/decor, invitation links, file bytes and quick action browser checks passed: signup, visibility, resume, verification, profile persistence/editing, and 320/390/768/1440px layouts.");
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
