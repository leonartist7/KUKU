const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript");
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const compile=file=>ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function pure(file){const exports={};vm.runInNewContext(compile(file),{exports,Number,Date,Map,Set,Array,URL});return exports;}
const tools=pure("src/chatTools.ts");
function message(overrides={}){return {id:"m",chat_id:"chat",sender_id:"alice",sender_name:"Alice",type:"text",text:"Original private text",created_at:"2026-11-04T12:00:00Z",revision:0,...overrides};}

test("older reads cannot resurrect an edited or removed message",()=>{
  const old=message(),edit=message({revision:1,text:"New wording",edited_at:"2026-11-04T12:01:00Z"}),removed=message({revision:2,text:null,deleted_at:"2026-11-04T12:02:00Z",reactions:[]});
  for(const history of [[old,edit,removed],[removed,old,edit],[edit,removed,old]]){
    const merged=tools.mergeChatMessages("chat",[],history);
    assert.equal(merged.length,1);assert.equal(merged[0].revision,2);
    assert.equal(tools.messagePreview(merged[0]),"Message removed");
    assert.ok(!tools.messagePreview(merged[0]).includes("private"));
  }
  assert.equal(tools.currentMessage("m",[removed],{m:old}).revision,2);
  assert.equal(tools.currentMessage("m",[old],{m:removed}).revision,2);
});
test("a missing original overrides a stale visible quote and never falls back to copied text",()=>{
  assert.equal(tools.currentMessage("m",[message()],{m:null}),null);
  const payload={type:"text",text:"My reply",...tools.replyFields("m")};
  assert.equal(payload.reply_to_id,"m");assert.equal(payload.reply_to,undefined);
  assert.ok(!JSON.stringify(payload).includes("Original private text"));
  assert.equal(Object.keys(tools.replyFields(null)).length,0);
});
test("chat merges reject foreign conversation data and keep stable chronological order",()=>{
  const result=tools.mergeChatMessages("chat",[message({id:"b"})],[message({id:"a"}),message({id:"foreign",chat_id:"another"})]);
  assert.deepEqual(Array.from(result,item=>item.id),["a","b"]);
});
test("edit and removal affordances obey ownership, age, type and tombstones",()=>{
  const start=Date.parse(message().created_at);
  assert.equal(tools.canEditMessage(message(),"alice",start+899999),true);
  assert.equal(tools.canEditMessage(message(),"alice",start+900000),false);
  assert.equal(tools.canEditMessage(message(),"bob",start+10),false);
  assert.equal(tools.canEditMessage(message({type:"voice"}),"alice",start+10),false);
  assert.equal(tools.canEditMessage(message({deleted_at:"now"}),"alice",start+10),false);
  assert.equal(tools.canEditMessage(message(),"alice",start-1000),false);
  assert.equal(tools.canRemoveMessage(message({type:"emote"}),"alice"),true);
  assert.equal(tools.canRemoveMessage(message({type:"image"}),"alice"),false);
  assert.equal(tools.canRemoveMessage(message(),"bob"),false);
});
test("reaction selection stays allowlisted and scoped to the current member",()=>{
  const item=message({reactions:[{emoji:"❤️",user_ids:["alice"]},{emoji:"👍",user_ids:["bob"]}]});
  assert.equal(tools.ownReaction(item,"alice"),"❤️");assert.equal(tools.ownReaction(item,"bob"),"👍");
  assert.equal(tools.ownReaction(message({reactions:[{emoji:"unknown",user_ids:["alice"]}]}),"alice"),null);
});
test("realtime mutation hints preserve revision but never forward message content",()=>{
  const {parseChatFrame}=pure("src/chatRealtimeCore.ts");
  const hint={type:"chat_changed",chat_id:"chat",message_id:"m",sender_id:"alice",cursor:7,live:true,change:"updated",revision:3,text:"must stay private"};
  const parsed=parseChatFrame(hint);
  assert.equal(parsed.change,"updated");assert.equal(parsed.revision,3);assert.equal(parsed.text,undefined);
  assert.equal(parseChatFrame({...hint,revision:-1}),null);assert.equal(parseChatFrame({...hint,change:"unknown"}),null);
  const {change,revision,...legacy}=hint;
  assert.equal(parseChatFrame(legacy).change,"created");assert.equal(parseChatFrame(legacy).revision,0);
});

function hookHarness({getAs=async()=>message(),postAs=async()=>message(),initial=[message()]}={}){
  const slots=[],exports={};let index=0,messages=initial;
  const scopeRef={current:"chat:alice"},messagesRef={current:messages},errors=[];
  const state=initialValue=>{const key=index++;if(!(key in slots))slots[key]=typeof initialValue==="function"?initialValue():initialValue;return [slots[key],next=>{slots[key]=typeof next==="function"?next(slots[key]):next;}];};
  class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}
  vm.runInNewContext(compile("src/useChatTools.ts"),{
    exports,Map,Set,Object,Array,
    require:name=>name==="react"?{useState:state,useRef:initialValue=>{const key=index++;return slots[key]||(slots[key]={current:initialValue});},useCallback:fn=>{index++;return fn;}}
      :name==="./chatTools"?tools:{ApiError,api:{getAs,postAs}}
  });
  return {ApiError,scopeRef,messagesRef,errors,render:()=>{index=0;return exports.useChatTools({chatId:"chat",userId:"alice",scopeRef,messages,messagesRef,setMessages:next=>{messages=next;messagesRef.current=next;},setError:error=>errors.push(error)});}};
}
test("late original-message fetch cannot populate another account's view",async()=>{
  let resolve;const h=hookHarness({getAs:()=>new Promise(done=>resolve=done)}),hook=h.render();
  const opening=hook.openOriginal("m");h.scopeRef.current="chat:bob";resolve(message({text:"Late Alice secret",revision:1}));
  await opening;assert.equal(h.render().lookup("m").text,"Original private text");
  // The pre-existing local row is untouched; the late server value is never installed.
  assert.equal(h.render().focusMessage.text,"Original private text");
  assert.equal(h.errors.length,0);
});
test("reconnection resolves existing messages in bounded batches",async()=>{
  const initial=Array.from({length:205},(_,i)=>message({id:"m"+i})),requests=[];
  const h=hookHarness({initial,postAs:async(uid,path,body)=>{requests.push({uid,path,ids:body.message_ids});return initial.filter(item=>body.message_ids.includes(item.id));}});
  await h.render().reconcile();
  assert.deepEqual(requests.map(request=>request.ids.length),[100,100,5]);
  assert.ok(requests.every(request=>request.uid==="alice"&&request.path==="/chats/chat/messages/resolve"));
  assert.equal(h.messagesRef.current.length,205);
});
test("a second mutation hint while refreshing schedules another read instead of losing it",async()=>{
  const pending=[],h=hookHarness({getAs:()=>new Promise(resolve=>pending.push(resolve))}),hook=h.render();
  hook.updated("m");hook.updated("m");assert.equal(pending.length,1);
  pending[0](message({revision:1,text:"Edited"}));await tick();assert.equal(pending.length,2);
  pending[1](message({revision:2,text:null,deleted_at:"2026-11-04T12:02:00Z"}));await tick();
  assert.equal(h.messagesRef.current[0].revision,2);assert.equal(tools.messagePreview(h.render().lookup("m")),"Message removed");
});
test("edit conflicts refresh the original and require explicit user review without automatic overwrite",async()=>{
  const posts=[];let h;
  h=hookHarness({getAs:async()=>message({revision:1,text:"Edited on another device"}),postAs:async(uid,path,body)=>{posts.push({uid,path,body});throw new h.ApiError("Changed",409);}});
  h.render().openActions(message());await h.render().mutate("m","edit",{text:"My draft",expected_revision:0});
  const result=h.render();
  assert.equal(posts.length,1);assert.equal(result.actionError.conflict,true);
  assert.equal(result.actionMessage.text,"Edited on another device");
  assert.equal(posts[0].body.text,"My draft");assert.equal(posts[0].body.expected_revision,0);
});
test("missing originals remove cached content while keeping reply IDs safe",async()=>{
  let h;h=hookHarness({getAs:async()=>{throw new h.ApiError("Message not found",404);}});
  h.render().reply("m");await h.render().openOriginal("m");
  const result=h.render();assert.equal(result.replyToId,"m");assert.equal(result.replyMessage,null);assert.equal(h.messagesRef.current.length,0);
});
test("foreground sounds ignore edits, reactions, removals, replay and own messages",async()=>{
  let receive,cleanup,plays=0;const exports={};
  vm.runInNewContext(compile("src/MessageSoundListener.tsx"),{
    exports,Set,document:{hidden:false,addEventListener(){},removeEventListener(){}},navigator:{onLine:true},
    require:name=>name==="react"?{useEffect:fn=>{cleanup=fn();}}:name==="react-native"?{Platform:{OS:"web"}}
      :name==="./AuthContext"?{useAuth:()=>({user:{id:"alice",email_verified:true}})}
      :name==="./api"?{api:{getAs:async()=>[]}}
      :name==="./chatRealtime"?{subscribeChatEvents:(_uid,fn)=>{receive=fn;return()=>{};}}
      :{armMessageSounds(){},incomingSoundTracker:()=>()=>undefined,playMessageSound:async()=>{plays++;},readSound:async()=>({sound:"bell",volume:0.5}),stopMessageSound(){}}
  });
  exports.default();
  const event={type:"chat_changed",chat_id:"chat",message_id:"updated",sender_id:"bob",cursor:1,live:true,change:"updated",revision:1};
  receive(event);receive({...event,message_id:"replay",live:false,change:"created"});receive({...event,message_id:"own",sender_id:"alice",change:"created"});await tick();assert.equal(plays,0);
  receive({...event,message_id:"new",change:"created"});await tick();assert.equal(plays,1);
  receive({...event,message_id:"new",change:"created"});await tick();assert.equal(plays,1);
  cleanup();
});

test("a recovery request arriving during reconciliation gets its own latest-state pass",async()=>{
  const pending=[],h=hookHarness({postAs:()=>new Promise(resolve=>pending.push(resolve))}),hook=h.render();
  const first=hook.reconcile();await hook.reconcile();assert.equal(pending.length,1);
  pending[0]([message({revision:1,text:"Snapshot before reconnect"})]);await tick();
  assert.equal(pending.length,2,"The newer recovery request must not be dropped");
  pending[1]([message({revision:2,text:"Latest after reconnect"})]);await first;
  assert.equal(h.messagesRef.current[0].revision,2);assert.equal(h.render().lookup("m").text,"Latest after reconnect");
});
test("a newer recovery request survives a failed first reconciliation without clearing history",async()=>{
  const pending=[],h=hookHarness({postAs:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}),hook=h.render();
  const first=hook.reconcile();await hook.reconcile();pending[0].reject(new Error("Offline"));await first;await tick();
  assert.equal(h.messagesRef.current.length,1);assert.equal(pending.length,2);
  pending[1].resolve([message({revision:1,text:"Recovered"})]);await tick();
  assert.equal(h.render().lookup("m").text,"Recovered");
});
test("reply and action transitions dismiss an in-flight original panel without reopening it",async()=>{
  for(const destination of ["reply","actions"]){
    let resolve;const h=hookHarness({getAs:()=>new Promise(done=>resolve=done)}),hook=h.render();
    const opening=hook.openOriginal("m");assert.equal(h.render().focusLoading,true);
    if(destination==="reply")h.render().reply("m");else h.render().openActions(message());
    assert.equal(h.render().focusLoading,false);assert.equal(h.render().focusMessage,null);
    resolve(message({revision:1,text:"Latest original"}));await opening;
    assert.equal(h.render().focusLoading,false);assert.equal(h.render().focusMessage,null);
    if(destination==="reply")assert.equal(h.render().replyToId,"m");else assert.equal(h.render().actionMessage.id,"m");
  }
});
test("a recovery request is not retried into a different account after a failed pass",async()=>{
  let reject,requests=0;const h=hookHarness({postAs:()=>{requests++;return new Promise((_,fail)=>reject=fail);}}),hook=h.render();
  const first=hook.reconcile();await hook.reconcile();h.scopeRef.current="chat:bob";reject(new Error("Offline"));await first;await tick();
  assert.equal(requests,1);assert.equal(h.errors.length,0);
});

function actionSheetHarness(){
  const slots=[],exports={};let index=0,dependencies=[],effects=[];
  const react={createElement:(type,props,...children)=>({type,props,children}),
    useState:initial=>{const key=index++;if(!(key in slots))slots[key]=initial;return [slots[key],value=>slots[key]=typeof value==="function"?value(slots[key]):value];},
    useRef:initial=>{const key=index++;return slots[key]||(slots[key]={current:initial});},
    useEffect:(effect,next)=>{const key=index++,old=dependencies[key];if(!old||next.some((value,i)=>value!==old[i])){dependencies[key]=next;effects.push(effect);}}};
  const native=Object.fromEntries(["ActivityIndicator","KeyboardAvoidingView","Modal","Pressable","ScrollView","Text","TextInput","View"].map(name=>[name,name]));
  native.StyleSheet={create:value=>value};native.Platform={OS:"web"};
  const modules={react:{default:react,...react},"react-native":native,"./chatTools":tools,"./api":{},"./messageLinks":pure("src/messageLinks.ts"),
    "./ThemeContext":{useTheme:()=>({c:{},f:{}})},"./useReducedMotion":{useReducedMotion:()=>true},
    "react-native-safe-area-context":{SafeAreaView:"SafeAreaView"},"@expo/vector-icons/Ionicons":{default:"Ionicons"}};
  const source=ts.transpileModule(fs.readFileSync("src/MessageTools.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  vm.runInNewContext(source,{exports,require:name=>modules[name]||{}});
  const walk=(node,predicate)=>{if(!node)return null;if(Array.isArray(node)){for(const child of node){const found=walk(child,predicate);if(found)return found;}return null;}if(typeof node!=="object")return null;if(predicate(node))return node;return walk(node.children,predicate);};
  return {render:props=>{index=0;const tree=exports.MessageActionSheet(props);for(const effect of effects.splice(0))effect();return tree;},find:(tree,label)=>walk(tree,node=>node.props?.accessibilityLabel===label)};
}
test("removal conflicts allow explicit review of the new revision without automatic deletion",()=>{
  const h=actionSheetHarness(),removed=[],cleared=[];
  let item=message(),error=null;
  const props=()=>({message:item,userId:"alice",busy:false,error,onClose(){},onReply(){},onReact(){},onEdit(){},onPin(){},onRemove:revision=>removed.push(revision),onClearError:()=>{error=null;cleared.push(true);}});
  let tree=h.render(props());tree=h.render(props());
  h.find(tree,"Remove for everyone").props.onPress();tree=h.render(props());
  h.find(tree,"Confirm remove message for everyone").props.onPress();assert.deepEqual(removed,[0]);
  item=message({revision:1,text:"Edited elsewhere"});error={message:"Changed",conflict:true};tree=h.render(props());
  h.find(tree,"Review latest before removing").props.onPress();assert.deepEqual(removed,[0],"Review must never submit deletion");
  tree=h.render(props());h.find(tree,"Confirm remove message for everyone").props.onPress();assert.deepEqual(removed,[0,1]);
  assert.equal(cleared.length,2);
});
