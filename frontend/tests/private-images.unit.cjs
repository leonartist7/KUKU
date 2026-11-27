const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function harness({platform='web',get,remove}={}){
  let uid='alice',epoch=1,focused=true,verified=true,restoring=false,cursor=0,props={attachmentId:'photo',canDelete:true},tree;
  const cells=[],effects=[],cleanups=new Map(),boundaries=new Set(),invalidations=new Set();
  const calls=[],opened=[],alerts=[],cleared=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useCallback:callback=>callback,
    useRef:initial=>{const at=cursor++;return cells[at]||(cells[at]={current:initial});},
    useState:initial=>{const at=cursor++;if(!(at in cells))cells[at]=initial;return[cells[at],value=>{cells[at]=typeof value==='function'?value(cells[at]):value;}];},
    useEffect:(effect,deps)=>{const at=cursor++;if(!same(cells[at],deps)){cells[at]=deps;effects.push({at,effect});}}};
  const lease={};vm.runInNewContext(compile('src/privateMemoLease.ts'),{exports:lease,AbortController,Set});
  class ApiError extends Error{constructor(status){super();this.status=status;}}
  const modules={react:{default:react,...react},'react-native':{View:'View',Text:'Text',Pressable:'Pressable',Image:'Image',Modal:'Modal',ActivityIndicator:'ActivityIndicator',Platform:{OS:platform},Alert:{alert:(...args)=>alerts.push(args)}},
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@react-navigation/native':{useIsFocused:()=>focused},'@expo/vector-icons/Ionicons':{default:'Icon'},
    './AuthContext':{useAuth:()=>({user:{id:uid,email_verified:verified},restoring})},'./ThemeContext':{useTheme:()=>({c:{},f:{}})},'./useReducedMotion':{useReducedMotion:()=>false},
    './api':{ApiError,getSessionUserId:()=>uid,getSessionEpoch:()=>epoch,onSessionBoundary:cb=>{boundaries.add(cb);return()=>boundaries.delete(cb);},
      api:{getAs:async(account,path)=>{calls.push(['get',account,path]);return get?get(account,path):{url:'https://files.example.test/photo?ticket=synthetic'};},
        deleteAs:async(account,path)=>{calls.push(['delete',account,path]);return remove?remove(account,path):{};}}},
    './downloads':{openPrivateDownload:async url=>{opened.push(url);}},'./privateMemoLease':lease,
    './imagePreview':{privateImagePreviewScope:(accountId,screenScope)=>({accountId,screenScope,sessionEpoch:epoch}),
      privateImagePreviewKey:(scope,id,size)=>JSON.stringify([scope,id,size]),loadPrivateImagePreview:async()=>({image:'data:image/jpeg;base64,AA==',width:16,height:16}),
      subscribePrivateImagePreviewInvalidation:cb=>{invalidations.add(cb);return()=>invalidations.delete(cb);},
      privateImagePreviewInvalidationMatches:(event,scope,id)=>(!event.accountId||event.accountId===scope.accountId)&&(!event.attachmentId||event.attachmentId===id),
      invalidatePrivateImagePreview:(accountId,attachmentId)=>{cleared.push([accountId,attachmentId]);for(const cb of [...invalidations])cb({accountId,attachmentId});}}};
  const exports={};vm.runInNewContext(compile('src/PrivateImageCard.tsx'),{exports,require:name=>{assert.ok(modules[name],name);return modules[name];},window:{confirm:()=>true},encodeURIComponent});
  function render(next=props){props=next;cursor=0;tree=exports.default(props);for(const{at,effect}of effects.splice(0)){cleanups.get(at)?.();const cleanup=effect();if(cleanup)cleanups.set(at,cleanup);else cleanups.delete(at);}return tree;}
  function find(node,predicate){if(!node)return;if(predicate(node))return node;for(const item of node.children||[]){if(Array.isArray(item)){for(const child of item){const found=find(child,predicate);if(found)return found;}}else if(item&&typeof item==='object'){const found=find(item,predicate);if(found)return found;}}}
  const button=label=>find(tree,node=>node.props.accessibilityLabel===label);
  render();
  return{calls,opened,alerts,cleared,render,button,text:()=>JSON.stringify(tree),
    open(){button('View Photo').props.onPress();render();},close(){button('Close image preview').props.onPress();render();},
    download(){return button('Download original Photo').props.onPress();},remove(){return button('Delete image for everyone').props.onPress();},
    blur(){focused=false;render();},focus(){focused=true;render();},
    account(next='bob'){uid=next;epoch++;for(const cb of [...boundaries])cb();},
    attachment(){render({...props,attachmentId:'other'});},revoke(){render({...props,unavailable:true});},
    revokeDelete(){render({...props,canDelete:false});},invalidate(){for(const cb of [...invalidations])cb({accountId:uid,attachmentId:props.attachmentId});render();},
    modal:()=>find(tree,node=>node.type==='Modal').props.visible,
    dispose(){for(const cleanup of cleanups.values())cleanup();cleanups.clear();}};
}

test('image download resolved after blur, close or unmount never opens private media',async()=>{
  for(const boundary of ['blur','close','dispose']){
    const ticket=deferred(),h=harness({get:()=>ticket.promise});h.open();h.download();await flush();h[boundary]();
    ticket.resolve({url:'https://files.example.test/photo?ticket=synthetic'});await flush();assert.equal(h.opened.length,0,boundary);h.dispose();
  }
});
test('image download is fenced by a same-account session renewal without waiting for render',async()=>{
  const ticket=deferred(),h=harness({get:()=>ticket.promise});h.open();h.download();h.account('alice');
  ticket.resolve({url:'https://files.example.test/photo'});await flush();assert.equal(h.opened.length,0);h.dispose();
});
test('old image downloads cannot open after attachment replacement or access invalidation',async()=>{
  for(const boundary of ['attachment','revoke','invalidate']){
    const ticket=deferred(),h=harness({get:()=>ticket.promise});h.open();h.download();h[boundary]();ticket.resolve({url:'https://files.example.test/photo'});
    await flush();assert.equal(h.opened.length,0,boundary);h.dispose();
  }
});
test('native image confirmations cannot dispatch after navigation, session, attachment or permission loss',async()=>{
  for(const boundary of ['blur','close','account','attachment','revoke','revokeDelete','invalidate','dispose']){
    const h=harness({platform:'android'});h.open();h.remove();const confirm=h.alerts[0][2].find(value=>value.text==='Delete').onPress;
    h[boundary]();confirm();await flush();assert.equal(h.calls.length,0,boundary);h.dispose();
  }
});
test('rapid image download taps share one action and open the original once',async()=>{
  const ticket=deferred(),h=harness({get:()=>ticket.promise});h.open();h.download();h.download();assert.equal(h.calls.length,1);
  ticket.resolve({url:'https://files.example.test/photo'});await flush();assert.equal(h.opened.length,1);h.render();assert.equal(h.button('Download original Photo').props.disabled,false);h.dispose();
});
test('late image failures cannot overwrite a replacement image with stale error feedback',async()=>{
  const ticket=deferred(),h=harness({get:()=>ticket.promise});h.open();h.download();h.attachment();ticket.reject(new Error('provider ticket SECRET'));
  await flush();h.render();assert.ok(!h.text().includes('Could not download'));assert.ok(!h.text().includes('SECRET'));h.dispose();
});
test('image viewer closes on navigation and does not reopen itself when returning',async()=>{
  const h=harness();h.open();assert.equal(h.modal(),true);h.blur();assert.equal(h.modal(),false);h.focus();assert.equal(h.modal(),false);h.dispose();
});
test('confirmed image deletion is deduplicated and invalidates its exact private attachment',async()=>{
  const deletion=deferred(),h=harness({platform:'android',remove:()=>deletion.promise});h.open();h.remove();
  const confirm=h.alerts[0][2].find(value=>value.text==='Delete').onPress;confirm();confirm();assert.equal(h.calls.length,1);
  deletion.resolve({});await flush();h.render();assert.equal(h.modal(),false);assert.ok(h.cleared.length>0);assert.ok(h.cleared.every(([uid,id])=>uid==='alice'&&id==='photo'));h.dispose();
});
