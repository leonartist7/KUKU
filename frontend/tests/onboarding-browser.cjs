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
    const context=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});
    const page=await context.newPage();let user=null,sends=0,profiles=0;
    page.on("pageerror",e=>errors.push(String(e)));
    await page.route("**/api/**",async route=>{
      const req=route.request(),endpoint=new URL(req.url()).pathname,body=req.postDataJSON()||{};
      const respond=(status,data)=>route.fulfill({status,contentType:"application/json",headers:{"cache-control":"no-store"},body:JSON.stringify(data)});
      if(endpoint==="/api/auth/register"){user={id:"qa-user",email:body.email,name:body.name,bio:"",email_verified:false,onboarding_complete:false};return respond(200,{token:"synthetic-test-access",user});}
      if(endpoint==="/api/auth/refresh")return user?respond(200,{token:"synthetic-test-access",user}):respond(401,{detail:"Sign in again"});
      if(endpoint==="/api/auth/me")return user?respond(200,user):respond(401,{detail:"Sign in again"});
      if(endpoint==="/api/auth/verification"){sends++;return respond(200,{ok:true});}
      if(endpoint==="/api/auth/verify"){if(body.code!=="synthetic-email-code")return respond(400,{detail:"Invalid or expired code"});user.email_verified=true;return respond(200,{ok:true});}
      if(endpoint==="/api/auth/profile"){profiles++;user={...user,name:body.name,bio:body.bio,onboarding_complete:true};return respond(200,user);}
      if(endpoint==="/api/auth/logout"){user=null;return respond(200,{ok:true});}
      return respond(200,[]);
    });
    await page.goto(origin+"/login");await page.getByTestId("auth-switch").waitFor();
    assert.equal(await page.locator("html").evaluate(e=>e.scrollWidth),width,"No horizontal overflow at "+width);
    await page.screenshot({path:path.join(shots,"login-"+width+".png"),fullPage:true});
    if(width===390||width===1440)console.log("KUKU_VISUAL_LOGIN_"+width+":"+(await page.screenshot({type:"jpeg",quality:48})).toString("base64"));
    return {page,context,state:()=>({user,sends,profiles})};
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
    assert.equal(await page.getByTestId("password-input").getAttribute("type"),"text");
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
    console.log("KUKU_VISUAL_PROFILE:"+(await page.screenshot({type:"jpeg",quality:48})).toString("base64"));
    await page.getByTestId("profile-submit").click();
    await page.getByRole("button",{name:"Invite someone I care about",exact:true}).waitFor();
    assert.equal(state().profiles,1);
    assert.equal(state().user.onboarding_complete,true);
    await page.screenshot({path:path.join(shots,"welcome-390.png"),fullPage:true});
    await page.reload();await page.getByTestId("profile-button").waitFor();
    await page.getByTestId("profile-button").click();
    await page.getByTestId("settings-profile").click();
    await page.getByTestId("profile-name").waitFor();
    assert.equal(await page.getByTestId("profile-name").inputValue(),"Alex Rivera");
    assert.equal(await page.getByTestId("profile-bio").inputValue(),"Coffee, sketches, and little everyday stories.");
    await context.close();
    for(const width of [320,768,1440]){const s=await scenario(width,900);await s.context.close();}
    assert.deepEqual(errors,[],"No uncaught browser errors");
    console.log("Onboarding browser checks passed: signup, visibility, resume, verification, profile persistence/editing, and 320/390/768/1440px layouts.");
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
