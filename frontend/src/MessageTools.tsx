import React,{useEffect,useRef,useState} from "react";
import {ActivityIndicator,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {Ionicons} from "@expo/vector-icons";
import {api,Message} from "./api";
import {useTheme} from "./ThemeContext";
import {useReducedMotion} from "./useReducedMotion";
import {canEditMessage,canRemoveMessage,CHAT_REACTIONS,messagePreview,messageRemoved,messageRevision,ownReaction} from "./chatTools";
import PrivateImageCard from "./PrivateImageCard";
import {VoiceMessageBubble,FilePreviewCard} from "./MessageParts";
import {isImageFilename} from "./imagePreview";
import EmoteImage from "./EmoteImage";
import {getEmote} from "./emotes";

function Sheet({visible,title,onClose,children}:{visible:boolean;title:string;onClose:()=>void;children:React.ReactNode}){
  const {c,f}=useTheme(),reducedMotion=useReducedMotion();
  if(!visible)return null;
  return <Modal visible transparent animationType={reducedMotion?"none":"fade"} onRequestClose={onClose}>
    <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS==="ios"?"padding":undefined}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message panel" onPress={onClose} style={[StyleSheet.absoluteFill,{backgroundColor:"rgba(0,0,0,0.28)"}]}/>
      <SafeAreaView edges={["bottom"]} style={[s.sheet,{backgroundColor:c.bg}]} accessibilityViewIsModal>
        <View style={s.sheetHeader}><Text accessibilityRole="header" style={{flex:1,fontFamily:f.heading,fontSize:23,color:c.text}}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close message panel" onPress={onClose} style={s.touch}><Ionicons name="close" size={24} color={c.text}/></Pressable></View>
        {children}
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}
export function ReplyPreview({message,onOpen,onCancel,draft=false}:{message:Message|null;onOpen:()=>void;onCancel?:()=>void;draft?:boolean}){
  const {c,f}=useTheme();
  return <View style={[s.reply,{backgroundColor:c.primaryBgSubtle,borderLeftColor:c.primary}]} testID={draft?"reply-draft":undefined}>
    <Pressable accessibilityRole="button" accessibilityLabel="View original message" onPress={onOpen} style={{flex:1,minWidth:0,justifyContent:"center",minHeight:44}}>
      <Text numberOfLines={1} style={{fontFamily:f.bodyBold,fontSize:12,color:c.primary}}>{draft?"Replying to ":""}{message?.sender_name||"a message"}</Text>
      <Text numberOfLines={2} style={{fontFamily:f.body,fontSize:13,lineHeight:19,color:c.textSecondary}}>{message?messagePreview(message,140):"View original message"}</Text>
    </Pressable>
    {onCancel?<Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={onCancel} style={s.touch}><Ionicons name="close" size={20} color={c.textSecondary}/></Pressable>:null}
  </View>;
}
export function ReactionChips({message,userId,disabled,onReact}:{message:Message;userId:string;disabled?:boolean;onReact:(emoji:string|null)=>void}){
  const {c,f}=useTheme(),mine=ownReaction(message,userId);
  const reactions=message.reactions?.filter(reaction=>reaction.user_ids.length>0&&CHAT_REACTIONS.some(emoji=>emoji===reaction.emoji))||[];
  if(messageRemoved(message)||!reactions.length)return null;
  return <View style={s.reactionChips}>{reactions.map(reaction=>
    <Pressable key={reaction.emoji} accessibilityRole="button" accessibilityLabel={reaction.emoji+" reaction, "+reaction.user_ids.length+(mine===reaction.emoji?", selected":"")} accessibilityState={{selected:mine===reaction.emoji,disabled}} disabled={disabled} onPress={()=>onReact(mine===reaction.emoji?null:reaction.emoji)} style={[s.reactionChip,{backgroundColor:mine===reaction.emoji?c.primaryBgSubtle:c.surface,borderColor:mine===reaction.emoji?c.primary:"transparent"}]}><Text style={{fontSize:18}}>{reaction.emoji}</Text><Text style={{fontFamily:f.bodyMedium,fontSize:12,color:c.textSecondary}}>{reaction.user_ids.length}</Text></Pressable>)}</View>;
}
type ActionError={message:string;conflict?:boolean}|null;
export function MessageActionSheet({message,userId,busy,error,onClose,onReply,onReact,onEdit,onRemove,onPin,onClearError}:{
  message:Message|null;userId:string;busy:boolean;error:ActionError;onClose:()=>void;onReply:()=>void;
  onReact:(emoji:string|null)=>void;onEdit:(text:string,revision:number)=>void;onRemove:(revision:number)=>void;onPin:(pinned:boolean)=>void;onClearError:()=>void;
}){
  const {c,f}=useTheme();
  const [editing,setEditing]=useState(false),[removing,setRemoving]=useState(false),[editText,setEditText]=useState(""),[revision,setRevision]=useState(0),[reviewed,setReviewed]=useState(false);
  useEffect(()=>{setEditing(false);setRemoving(false);setReviewed(false);setEditText(message?.text||"");setRevision(message?messageRevision(message):0);},[message?.id]);
  const removed=!!message&&messageRemoved(message),selectedReaction=message?ownReaction(message,userId):null;
  const action=(label:string,icon:React.ComponentProps<typeof Ionicons>["name"],onPress:()=>void,destructive=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress} style={s.action}><Ionicons name={icon} size={21} color={destructive?c.error:c.textSecondary}/><Text style={{fontFamily:f.bodyMedium,fontSize:16,color:destructive?c.error:c.text}}>{label}</Text></Pressable>;
  return <Sheet visible={!!message} title={editing?"Edit your message":removing?"Remove this message?":"Message"} onClose={onClose}>
    <ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight:520}}>
      <Text numberOfLines={editing&&reviewed?undefined:3} style={{fontFamily:f.body,fontSize:14,lineHeight:21,color:c.textSecondary,marginBottom:14}}>{message?(editing&&reviewed?message.text||messagePreview(message):messagePreview(message,180)):""}</Text>
      {error?<Text accessibilityRole="alert" style={{fontFamily:f.bodyMedium,fontSize:14,lineHeight:21,color:c.error,marginBottom:12}}>{error.message}</Text>:null}
      {busy?<ActivityIndicator color={c.primary} style={{marginBottom:12}}/>:null}
      {message&&!removed&&editing?<View style={{gap:12}}>
        <TextInput accessibilityLabel="Edit message text" testID="edit-message-input" multiline autoFocus maxLength={10000} editable={!busy} value={editText} onChangeText={setEditText} style={[s.editInput,{backgroundColor:c.surface,color:c.text,fontFamily:f.body}]}/>
        {error?.conflict?action("Keep draft and review latest","refresh-outline",()=>{setRevision(messageRevision(message));setReviewed(true);onClearError();}):null}
        <View style={s.buttons}>{action("Cancel","close-outline",()=>{setEditing(false);onClearError();})}<Pressable accessibilityRole="button" accessibilityLabel="Save edited message" disabled={busy||!editText.trim()} onPress={()=>onEdit(editText.trim(),revision)} style={[s.primaryButton,{backgroundColor:c.primary,opacity:busy||!editText.trim()?0.5:1}]}><Text style={{fontFamily:f.bodyBold,color:c.textInverse,fontSize:15}}>Save changes</Text></Pressable></View>
      </View>:message&&!removed&&removing?<View style={{gap:12}}>
        <Text style={{fontFamily:f.body,fontSize:15,lineHeight:23,color:c.text}}>This removes the message for everyone. Replies will show that it was removed.</Text>
        <View style={s.buttons}>{action("Keep message","close-outline",()=>{setRemoving(false);onClearError();})}<Pressable accessibilityRole="button" accessibilityLabel="Confirm remove message for everyone" disabled={busy} onPress={()=>onRemove(revision)} style={[s.primaryButton,{backgroundColor:c.error}]}><Text style={{fontFamily:f.bodyBold,color:c.textInverse,fontSize:15}}>Remove</Text></Pressable></View>
      </View>:message&&!removed?<View>
        <View style={s.reactionPicker}>{CHAT_REACTIONS.map(emoji=><Pressable key={emoji} accessibilityRole="button" accessibilityLabel={"React with "+emoji} accessibilityState={{selected:selectedReaction===emoji,disabled:busy}} disabled={busy} onPress={()=>onReact(selectedReaction===emoji?null:emoji)} style={[s.touch,{borderRadius:22,backgroundColor:selectedReaction===emoji?c.primaryBgSubtle:"transparent"}]}><Text style={{fontSize:26}}>{emoji}</Text></Pressable>)}</View>
        {action("Reply","return-up-back-outline",onReply)}
        {action(message.pinned?"Unpin message":"Pin message","pin-outline",()=>onPin(!message.pinned))}
        {canEditMessage(message,userId)?action("Edit message","create-outline",()=>{setEditText(message.text||"");setRevision(messageRevision(message));setEditing(true);onClearError();}):null}
        {canRemoveMessage(message,userId)?action("Remove for everyone","trash-outline",()=>{setRevision(messageRevision(message));setRemoving(true);onClearError();},true):null}
      </View>:null}
    </ScrollView>
  </Sheet>;
}
export function MessageFocusSheet({message,loading,onClose,onReply,onActions}:{message:Message|null;loading:boolean;onClose:()=>void;onReply:()=>void;onActions:()=>void}){
  const {c,f}=useTheme(),emote=getEmote(message?.emote_id);
  return <Sheet visible={!!message||loading} title="Original message" onClose={onClose}>
    {loading?<ActivityIndicator color={c.primary} style={{padding:32}}/>:message?<ScrollView style={{maxHeight:420}} keyboardShouldPersistTaps="handled">
      <Text style={{fontFamily:f.bodyBold,color:c.text,fontSize:15,marginBottom:4}}>{message.sender_name}</Text>
      <Text style={{fontFamily:f.body,color:c.textSecondary,fontSize:12,marginBottom:18}}>{new Date(message.created_at).toLocaleString()}</Text>
      {messageRemoved(message)?<Text style={{fontFamily:f.body,color:c.textSecondary,fontSize:16}}>Message removed</Text>:message.type==="voice"?<VoiceMessageBubble durationMs={message.duration_ms||0} outgoing={false} attachmentId={message.attachment_id} unavailable={message.attachment_deleted}/>:message.type==="image"||(message.type==="file"&&isImageFilename(message.file_name))?<PrivateImageCard attachmentId={message.attachment_id} unavailable={message.attachment_deleted} canDelete={false} fileName={message.file_name}/>:message.type==="file"?<FilePreviewCard attachmentId={message.attachment_id} unavailable={message.attachment_deleted} canDelete={false} fileName={message.file_name} fileSize={message.file_size} type="file"/>:message.type==="emote"&&emote?<EmoteImage emote={emote}/>:<Text selectable style={{fontFamily:f.body,color:c.text,fontSize:16,lineHeight:25}}>{message.type==="text"?message.text:messagePreview(message,10000)}</Text>}
      {!messageRemoved(message)?<View style={[s.buttons,{marginTop:20}]}><Pressable accessibilityRole="button" accessibilityLabel="Reply to original message" onPress={onReply} style={[s.primaryButton,{backgroundColor:c.primary}]}><Text style={{fontFamily:f.bodyBold,color:c.textInverse}}>Reply</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Original message actions" onPress={onActions} style={[s.primaryButton,{backgroundColor:c.surface}]}><Text style={{fontFamily:f.bodyMedium,color:c.text}}>More</Text></Pressable></View>:null}
    </ScrollView>:null}
  </Sheet>;
}
export function ChatFindSheet({mode,chatId,userId,refreshVersion,onClose,onOpen}:{mode:"search"|"pins"|null;chatId:string;userId:string;refreshVersion:number;onClose:()=>void;onOpen:(id:string)=>void}){
  const {c,f}=useTheme();
  const [query,setQuery]=useState(""),[results,setResults]=useState<Message[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null),[more,setMore]=useState(false),[retry,setRetry]=useState(0);
  const requestVersion=useRef(0),search=query.trim();
  useEffect(()=>{
    const version=++requestVersion.current;if(!mode){setLoading(false);return;}
    if(mode==="search"&&search.length<2){setResults([]);setMore(false);setLoading(false);setError(null);return;}
    setResults([]);setError(null);setLoading(true);setMore(false);
    const timer=setTimeout(()=>{void(async()=>{try{
      const path=mode==="pins"?"/chats/"+chatId+"/pins":"/chats/"+chatId+"/search?q="+encodeURIComponent(search)+"&limit=20";
      const data=await api.getAs<Message[]>(userId,path);if(requestVersion.current!==version)return;
      setResults(data.filter(message=>message.chat_id===chatId&&!messageRemoved(message)));setMore(mode==="search"&&data.length===20);
    }catch(failure){if(requestVersion.current===version)setError(failure instanceof Error?failure.message:"Couldn't load messages. Please try again.");}
    finally{if(requestVersion.current===version)setLoading(false);}})();},mode==="search"?300:0);
    return()=>{clearTimeout(timer);requestVersion.current++;};
  },[mode,chatId,userId,search,refreshVersion,retry]);
  async function loadMore(){
    if(loading||!more||!results.length||mode!=="search")return;const version=requestVersion.current;setLoading(true);setError(null);
    try{
      const data=await api.getAs<Message[]>(userId,"/chats/"+chatId+"/search?q="+encodeURIComponent(search)+"&before="+encodeURIComponent(results[results.length-1].id)+"&limit=20");
      if(requestVersion.current!==version)return;
      setResults(previous=>Array.from(new Map([...previous,...data.filter(message=>message.chat_id===chatId&&!messageRemoved(message))].map(message=>[message.id,message])).values()).slice(0,100));
      setMore(data.length===20&&results.length+data.length<100);
    }catch(failure){if(requestVersion.current===version)setError(failure instanceof Error?failure.message:"Couldn't load more messages.");}
    finally{if(requestVersion.current===version)setLoading(false);}
  }
  return <Sheet visible={!!mode} title={mode==="pins"?"Pinned messages":"Find a message"} onClose={onClose}>
    {mode==="search"?<TextInput accessibilityLabel="Search this conversation" testID="chat-search-input" autoFocus maxLength={80} value={query} onChangeText={setQuery} placeholder="Search this conversation" placeholderTextColor={c.textTertiary} style={[s.searchInput,{backgroundColor:c.surface,color:c.text,fontFamily:f.body}]}/>:<Text style={{fontFamily:f.body,fontSize:14,color:c.textSecondary,marginBottom:12}}>Keep up to 20 useful messages close.</Text>}
    {error?<View><Text accessibilityRole="alert" style={{color:c.error,fontFamily:f.bodyMedium,fontSize:14,paddingVertical:12}}>{error}</Text><Pressable accessibilityRole="button" onPress={()=>setRetry(value=>value+1)} style={s.action}><Text style={{fontFamily:f.bodyMedium,color:c.primary}}>Try again</Text></Pressable></View>:null}
    <ScrollView style={{maxHeight:380}} keyboardShouldPersistTaps="handled">
      {results.map(message=><Pressable key={message.id} accessibilityRole="button" accessibilityLabel={"Open message from "+message.sender_name} onPress={()=>onOpen(message.id)} style={[s.result,{borderBottomColor:c.border}]}><View style={{flexDirection:"row",gap:8,alignItems:"center"}}><Text style={{flex:1,fontFamily:f.bodyBold,color:c.text,fontSize:13}}>{message.sender_name}</Text><Text style={{fontFamily:f.body,color:c.textSecondary,fontSize:12}}>{new Date(message.created_at).toLocaleDateString()}</Text></View><Text numberOfLines={3} style={{fontFamily:f.body,color:c.text,fontSize:15,lineHeight:23,marginTop:5}}>{messagePreview(message,220)}</Text></Pressable>)}
      {!loading&&!results.length&&!error?<Text style={{fontFamily:f.body,color:c.textSecondary,fontSize:15,lineHeight:23,paddingVertical:24,textAlign:"center"}}>{mode==="pins"?"Pin a message from its action menu.":search.length<2?"Type at least two characters.":"No messages found. Try another word."}</Text>:null}
      {more?<Pressable accessibilityRole="button" disabled={loading} onPress={()=>void loadMore()} style={s.action}><Text style={{fontFamily:f.bodyMedium,color:c.primary,fontSize:15}}>Load more results</Text></Pressable>:null}
      {results.length>=100?<Text style={{fontFamily:f.body,color:c.textSecondary,fontSize:13,paddingVertical:12}}>Refine your search to find another message.</Text>:null}
    </ScrollView>{loading?<ActivityIndicator color={c.primary} style={{padding:18}}/>:null}
  </Sheet>;
}
const s=StyleSheet.create({
  overlay:{flex:1,justifyContent:"flex-end"},sheet:{width:"100%",maxWidth:600,maxHeight:"90%",alignSelf:"center",borderTopLeftRadius:28,borderTopRightRadius:28,padding:20},
  sheetHeader:{flexDirection:"row",alignItems:"center",gap:12,marginBottom:16},touch:{width:44,height:44,alignItems:"center",justifyContent:"center",flexShrink:0},
  reply:{flexDirection:"row",alignItems:"center",gap:6,borderLeftWidth:3,borderRadius:10,paddingHorizontal:10,paddingVertical:4,marginBottom:8,minWidth:120},
  reactionChips:{flexDirection:"row",flexWrap:"wrap",gap:5,marginTop:4},reactionChip:{minHeight:44,minWidth:48,paddingHorizontal:10,borderRadius:22,borderWidth:1,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:6},
  reactionPicker:{flexDirection:"row",justifyContent:"space-between",gap:2,marginBottom:10},action:{minHeight:48,flexDirection:"row",alignItems:"center",gap:12,paddingVertical:10,paddingHorizontal:4},
  buttons:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"},primaryButton:{minHeight:46,borderRadius:16,paddingHorizontal:20,paddingVertical:12,alignItems:"center",justifyContent:"center"},
  editInput:{minHeight:100,maxHeight:220,borderRadius:18,padding:16,fontSize:16,lineHeight:24,textAlignVertical:"top"},searchInput:{minHeight:48,borderRadius:18,paddingHorizontal:16,paddingVertical:12,fontSize:16,marginBottom:12},result:{paddingVertical:14,borderBottomWidth:1,minHeight:70},
});
