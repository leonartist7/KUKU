const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function pure(file){const exports={};vm.runInNewContext(compile(file),{exports,URL});return exports;}
const links=pure('src/messageLinks.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function nodes(tree,predicate){if(!tree)return [];if(Array.isArray(tree))return tree.flatMap(node=>nodes(node,predicate));if(typeof tree!=='object')return [];return [...(predicate(tree)?[tree]:[]),...nodes(tree.children,predicate)];}
function componentHarness({native=false,copy=async()=>true,open=async()=>{}}={}){
 let uid='alice',cursor=0;const slots=[],deps=[],effects=[],cleanups=new Map(),copied=[],opened=[],alerts=[];
 const react={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'Fragment',
  useState:initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},
  useRef:initial=>{const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},
  useEffect:(effect,next)=>{const index=cursor++,previous=deps[index];if(!previous||next.some((value,i)=>value!==previous[i])){deps[index]=next;effects.push({index,effect});}}};
 const components=Object.fromEntries(['ActivityIndicator','KeyboardAvoidingView','Modal','Pressable','ScrollView','Text','TextInput','View'].map(name=>[name,name]));
 const modules={react:{default:react,...react},'react-native':{...components,Platform:{OS:native?'android':'web'},StyleSheet:{create:value=>value},Linking:{openURL:async url=>{opened.push(url);await open(url);}},Alert:{alert:(...args)=>alerts.push(args)}},
  './ThemeContext':{useTheme:()=>({c:{primaryDark:'#315747'},f:{}})},'./messageLinks':links,'./chatTools':pure('src/chatTools.ts'),
  './api':{getSessionUserId:()=>uid},'expo-clipboard':{setStringAsync:async value=>{copied.push(value);return copy(value);}},
  '@expo/vector-icons/Ionicons':{default:'Ionicons'},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'}};
 const load=file=>{const exports={};vm.runInNewContext(compile(file),{exports,require:name=>modules[name]||{},window:{getSelection:()=>null}});return exports;};
 const text=load('src/MessageText.tsx'),sheet=load('src/MessageTools.tsx');
 const render=(fn,props)=>{cursor=0;const tree=fn(props);for(const {index,effect}of effects.splice(0)){cleanups.get(index)?.();const cleanup=effect();if(cleanup)cleanups.set(index,cleanup);else cleanups.delete(index);}return tree;};
 return {copied,opened,alerts,text:props=>render(text.default,props),sheet:props=>render(sheet.MessageActionSheet,props),account:value=>uid=value,
  dispose:()=>{for(const cleanup of cleanups.values())cleanup();},find:(tree,label)=>nodes(tree,node=>node.props.accessibilityLabel===label)[0]};
}
const message={id:'fixture',chat_id:'chat',sender_id:'alice',sender_name:'Alex',type:'text',text:'Look at www.example.test/a?x=1.',revision:0,created_at:'2026-11-27T12:00:00Z'};
const sheetProps=item=>({message:item,userId:'alice',busy:false,error:null,onClose(){},onReply(){},onReact(){},onEdit(){},onRemove(){},onPin(){},onClearError(){}});

test('mixed message links preserve every character and exclude surrounding punctuation',()=>{
 const text='A sketch (https://example.test/a_(b)).\nTry www.example.test/next! Café.';
 const parts=links.messageTextParts(text);assert.equal(parts.map(part=>part.text).join(''),text);
 assert.deepEqual(plain(parts.filter(part=>part.url).map(part=>part.url)),['https://example.test/a_(b)','https://www.example.test/next']);
});
test('unsafe schemes, embedded credentials, controls and malformed addresses stay inert',()=>{
 for(const value of ['javascript:alert(1)','data:text/html,test','file:///secret','mailto:me@example.test','//example.test','https://user:pass@example.test','https://','https://example.test/\u202eexe','https://example.test/a\nb'])assert.equal(links.safeMessageUrl(value),null,value);
 const text='javascript:alert(1) file:///secret https://user:pass@example.test';
 assert.equal(links.messageTextParts(text).filter(part=>part.url).length,0);assert.equal(links.messageTextParts(text).map(part=>part.text).join(''),text);
});
test('balanced URL brackets survive, trailing quotes and punctuation remain ordinary text',()=>{
 const parts=links.messageTextParts("See https://example.test/view?q=(one)' and [https://example.test/two].");
 assert.deepEqual(plain(parts.filter(part=>part.url).map(part=>part.text)),['https://example.test/view?q=(one)','https://example.test/two']);
});
test('link copy choices deduplicate targets and keep the action panel bounded',()=>{
 const text=Array.from({length:20},(_,i)=>'https://example.test/'+i).join(' ');
 assert.equal(links.messageLinkTargets(text).length,5);
 assert.deepEqual(plain(links.messageLinkTargets('www.example.test www.example.test')),['https://www.example.test/']);
});
test('many valid links preserve the complete bounded message without fetching destinations',()=>{
 const text=Array.from({length:250},(_,i)=>'https://example.test/'+i).join('\n');
 const parts=links.messageTextParts(text);assert.equal(parts.map(part=>part.text).join(''),text);assert.equal(parts.filter(part=>part.url).length,250);
});
test('web links have real safe anchors and do not trigger the message action handler',()=>{
 const h=componentHarness();let actions=0,stopped=0;
 const tree=h.text({text:'See www.example.test.',onActions:()=>actions++});
 const anchor=nodes(tree,node=>node.type==='a')[0];assert.equal(anchor.props.href,'https://www.example.test/');assert.equal(anchor.props.target,'_blank');assert.equal(anchor.props.rel,'noopener noreferrer');
 anchor.props.onClick({stopPropagation:()=>stopped++,preventDefault(){throw Error('Unexpected cancellation');}});
 assert.equal(stopped,1);assert.equal(actions,0);assert.equal(h.opened.length,0);
 tree.props.onPress();assert.equal(actions,1);
});
test('right-clicking a link opens message options without a second browser context menu',()=>{
 const h=componentHarness();let actions=0,stopped=0,prevented=0;
 const tree=h.text({text:'https://example.test',onActions:()=>actions++});
 nodes(tree,node=>node.type==='a')[0].props.onContextMenu({stopPropagation:()=>stopped++,preventDefault:()=>prevented++});
 assert.deepEqual([actions,stopped,prevented],[1,1,1]);
});
test('native link press opens only the URL while holding it requests message options',async()=>{
 const h=componentHarness({native:true});let actions=0,stopped=0;
 const tree=h.text({text:'https://example.test/path',onActions:()=>actions++}),link=nodes(tree,node=>node.props.accessibilityRole==='link')[0];
 link.props.onLongPress({stopPropagation:()=>stopped++});assert.equal(actions,1);assert.equal(h.opened.length,0);
 link.props.onPress({stopPropagation:()=>stopped++});await tick();assert.deepEqual(h.opened,['https://example.test/path']);assert.equal(actions,1);assert.equal(stopped,2);
});
test('native URL failures show controlled help without exposing raw provider errors',async()=>{
 const h=componentHarness({native:true,open:async()=>{throw Error('provider-private-details');}});
 const tree=h.text({text:'https://example.test'});nodes(tree,node=>node.props.accessibilityRole==='link')[0].props.onPress({stopPropagation(){}});await tick();
 assert.equal(h.alerts.length,1);assert.ok(!JSON.stringify(h.alerts).includes('provider-private-details'));
});
test('copy actions write exact text or the normalized link without reading the clipboard',async()=>{
 const h=componentHarness();let tree=h.sheet(sheetProps(message));tree=h.sheet(sheetProps(message));
 h.find(tree,'Copy text').props.onPress();await tick();assert.equal(h.copied[0],message.text);
 tree=h.sheet(sheetProps(message));assert.ok(JSON.stringify(tree).includes('Message copied.'));
 h.find(tree,'Copy link').props.onPress();await tick();assert.equal(h.copied[1],'https://www.example.test/a?x=1');
});
test('copy permission failure never claims success and a deliberate retry can recover',async()=>{
 let allowed=false;const h=componentHarness({copy:async()=>allowed});let tree=h.sheet(sheetProps(message));tree=h.sheet(sheetProps(message));
 h.find(tree,'Copy text').props.onPress();await tick();tree=h.sheet(sheetProps(message));assert.ok(JSON.stringify(tree).includes('Could not copy.'));
 allowed=true;h.find(tree,'Copy text').props.onPress();await tick();tree=h.sheet(sheetProps(message));assert.ok(JSON.stringify(tree).includes('Message copied.'));
});
test('stale account actions and late clipboard results cannot affect a different message panel',async()=>{
 let finish;const h=componentHarness({copy:()=>new Promise(resolve=>finish=resolve)});let tree=h.sheet(sheetProps(message));tree=h.sheet(sheetProps(message));
 h.find(tree,'Copy text').props.onPress();h.sheet(sheetProps({...message,id:'new-message',text:'Something else'}));finish(true);await tick();
 tree=h.sheet(sheetProps({...message,id:'new-message',text:'Something else'}));assert.ok(!JSON.stringify(tree).includes('Message copied.'));
 h.account('bob');h.find(tree,'Copy text').props.onPress();await tick();assert.equal(h.copied.length,1);
});
