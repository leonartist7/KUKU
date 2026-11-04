const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript");
const source=ts.transpileModule(fs.readFileSync("src/EmoteImage.tsx","utf8"),{fileName:"EmoteImage.tsx",compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const hug={id:"fluent:hug",slug:"hug",label:"Hug",emoji:"🤗"},heart={id:"fluent:heart",slug:"heart",label:"Heart",emoji:"💗"};
function harness({platform="web",reduced=true}={}){
  const slots=[];let cursor=0,dirty=false,effects=[],reduce=reduced;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const React={
    useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==="function"?initial():initial;return[slots[index],value=>{const next=typeof value==="function"?value(slots[index]):value;if(!Object.is(next,slots[index])){slots[index]=next;dirty=true;}}];},
    useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},
    useEffect(effect,deps){const index=cursor++,previous=slots[index];if(!same(previous,deps)){slots[index]=deps;effects.push(effect);}},
    useSyncExternalStore(subscribe,snapshot){return snapshot();}
  };
  const element=(type,props)=>({type,props:props||{}});
  const exports={};
  vm.runInNewContext(source,{exports,process:{env:{}},Set,window:{matchMedia:()=>({matches:reduce})},document:{hidden:false},require:name=>{
    if(name==="react")return React;
    if(name==="react/jsx-runtime")return {jsx:element,jsxs:element};
    if(name==="react-native")return {Platform:{OS:platform},Image:"Image",Pressable:"Pressable",Text:"Text",View:"View"};
    if(name==="./emotes")return {emoteAsset:(slug,animated)=>"/emotes/"+slug+(animated?".webp":".png")};
    throw new Error("Unexpected import "+name);
  }});
  function render(emote=hug,props={}){
    let tree;
    for(let pass=0;pass<10;pass++){
      dirty=false;cursor=0;effects=[];tree=exports.default({emote,...props});const pending=effects;pending.forEach(effect=>effect());
      if(!dirty)return tree;
    }
    throw new Error("Hooks did not settle");
  }
  const find=(tree,type)=>tree?.type===type?tree:[tree?.props?.children].flat(Infinity).filter(Boolean).map(child=>typeof child==="object"?find(child,type):null).find(Boolean);
  return {render,find,setReduced:value=>{reduce=value;}};
}
test("Selected static emote has visible loading content, then replaces it after the actual image load",()=>{
  const h=harness(),tree=h.render(),image=h.find(tree,"Image");
  assert.ok(h.find(tree,"Text"),"A loading image never leaves an empty preview");
  assert.equal(image.props.source.uri,"/emotes/hug.png");assert.equal(image.props.style.opacity,0);assert.equal(tree.props.accessibilityState.busy,true);
  image.props.onLoad();const ready=h.render();
  assert.equal(h.find(ready,"Text"),undefined);assert.equal(h.find(ready,"Image").props.style.opacity,1);assert.equal(ready.props.accessibilityState.busy,false);
});
test("One failed PNG immediately becomes a stable Unicode fallback, without waiting for a second error",()=>{
  const h=harness(),initial=h.render();h.find(initial,"Image").props.onError();
  const fallback=h.render();
  assert.equal(h.find(fallback,"Image"),undefined);assert.equal(h.find(fallback,"Text").props.children,hug.emoji);assert.equal(fallback.props.accessibilityState.busy,false);
});
test("A failed animation falls back to PNG, and a failed PNG falls back to Unicode",()=>{
  const h=harness({reduced:false}),first=h.render(hug,{autoPlay:true});
  assert.equal(h.find(first,"Image").props.source.uri,"/emotes/hug.webp");h.find(first,"Image").props.onError();
  const poster=h.render(hug,{autoPlay:true});assert.equal(h.find(poster,"Image").props.source.uri,"/emotes/hug.png");assert.ok(h.find(poster,"Text"));
  h.find(poster,"Image").props.onError();assert.equal(h.find(h.render(hug,{autoPlay:true}),"Image"),undefined);
});
test("Late image events cannot mark a different selected emote ready or failed",()=>{
  const h=harness(),old=h.find(h.render(hug),"Image");
  h.render(heart);old.props.onLoad();old.props.onError();
  const current=h.render(heart);
  assert.equal(h.find(current,"Image").props.source.uri,"/emotes/heart.png");assert.equal(h.find(current,"Image").props.style.opacity,0);assert.equal(h.find(current,"Text").props.children,heart.emoji);
});
test("Switching to reduced motion ignores the old animated load and waits for its static poster",()=>{
  const h=harness({reduced:false}),animated=h.find(h.render(hug,{autoPlay:true}),"Image");
  h.setReduced(true);h.render(hug,{autoPlay:true});animated.props.onLoad();animated.props.onError();
  const poster=h.render(hug,{autoPlay:true});assert.equal(h.find(poster,"Image").props.source.uri,"/emotes/hug.png");assert.equal(h.find(poster,"Image").props.style.opacity,0);
  h.find(poster,"Image").props.onLoad();assert.equal(h.find(h.render(hug,{autoPlay:true}),"Image").props.style.opacity,1);
});
test("Native paths use posters, keep a single-error fallback and allow an explicit retry",()=>{
  const h=harness({platform:"android",reduced:false}),first=h.render(hug,{autoPlay:true});
  assert.ok(h.find(first,"Image").props.source.uri.endsWith("/emotes/hug.png"));h.find(first,"Image").props.onError();
  const fallback=h.render(hug,{autoPlay:true});assert.equal(h.find(fallback,"Image"),undefined);
  fallback.props.onPress();const retry=h.render(hug,{autoPlay:true});assert.ok(h.find(retry,"Image"));assert.ok(h.find(retry,"Text"));
});
