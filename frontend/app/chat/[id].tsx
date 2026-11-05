import VoiceComposer from "../../src/VoiceComposer";
import EmotePicker from "../../src/EmotePicker";
import EmoteImage from "../../src/EmoteImage";
import {getEmote} from "../../src/emotes";
import Decor from "../../src/Decor";
import { getOutbox, queueMessage, retryMessage, removePending, subscribeOutbox, PendingMessage } from "../../src/outbox";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { api, Message, User, uploadAttachment } from "../../src/api";
import { CALLS_ENABLED } from "../../src/config";
import { radius, spacing } from "../../src/theme";
import { useTheme } from "../../src/ThemeContext";
import Avatar from "../../src/Avatar";
import { useAuth } from "../../src/AuthContext";
import { VoiceMessageBubble, FilePreviewCard } from "../../src/MessageParts";
import PrivateImageCard from "../../src/PrivateImageCard";
import {clearPrivateImagePreviewScope,isImageFilename} from "../../src/imagePreview";
import {subscribeChatEvents} from "../../src/chatRealtime";
import {useChatConnection} from "../../src/ChatRealtimeProvider";
import {mergeChatMessages,messageRemoved,replyFields} from "../../src/chatTools";
import {useChatTools} from "../../src/useChatTools";
import {ChatFindSheet,MessageActionSheet,MessageFocusSheet,ReactionChips,ReplyPreview} from "../../src/MessageTools";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  return <ChatConversation key={id + ":" + (user?.id || "")} id={id}/>;
}

function ChatConversation({id}: {id: string}) {
  const router = useRouter();
  const { user } = useAuth();
  const { c, f } = useTheme();
  const connection = useChatConnection();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const [chatInfo, setChatInfo] = useState<{ other: User | null } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [emotesOpen,setEmotesOpen]=useState(false);
  const [attachmentsOpen,setAttachmentsOpen]=useState(false);
  const [creatingSpace,setCreatingSpace]=useState(false);
  const [hasOlder,setHasOlder]=useState(false);
  const [loadingOlder,setLoadingOlder]=useState(false);
  const olderFlight=useRef(false);
  const [draft,setDraft]=useState<{uri:string;name:string;type:"image"|"file";size?:number|null;uploadedId?:string}|null>(null);
  const [newMessages,setNewMessages]=useState(false);
  const nearBottom=useRef(true);
  const loadingRef = useRef(false);
  const reloadRequested = useRef(false);
  const sendFlight = useRef(false);
  const uploadFlight = useRef(false);
  const creatingSpaceRef = useRef(false);
  const chatInfoRef = useRef(chatInfo);
  chatInfoRef.current = chatInfo;
  const activeChat = useRef(id);
  const focused = useRef(false);
  const previewScopeCounter=useRef(0);
  const [previewScope,setPreviewScope]=useState(()=>`chat:${user?.id||"none"}:${id}:0`);
  activeChat.current = id+":"+(user?.id||"");

  const listRef = useRef<FlatList<Message>>(null);
  const inputRef = useRef<TextInput>(null);
  const [compactWindow,setCompactWindow]=useState(false);
  const tailAnchoring=useRef(true);
  const latestVisible=useRef<string|null>(null);
  const scrollPosition=useRef({offset:0,content:0,viewport:0});
  const rowLayouts=useRef(new Map<string,{y:number;height:number}>());
  const preservePrepend=useRef<{scope:string;anchorId:string;index:number;viewOffset:number;target?:number;attempts:number;stable?:number;ignoreNext?:boolean}|null>(null);
  const prependRetryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const tailRetryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const tailRetryCount=useRef(0);
  const viewabilityConfig=useRef({itemVisiblePercentThreshold:1}).current;
  const settleTailAnchor=useCallback(()=>{
    const position=scrollPosition.current;
    const latest=messagesRef.current[messagesRef.current.length-1];
    const bottomGap=position.content-position.viewport-position.offset;
    if(latest&&tailAnchoring.current&&latestVisible.current===latest.id&&position.viewport>0&&bottomGap<80){
      tailAnchoring.current=false;nearBottom.current=true;setNewMessages(false);setCompactWindow(true);
      if(tailRetryTimer.current)clearTimeout(tailRetryTimer.current);tailRetryTimer.current=null;
    }
  },[]);
  const onViewableItemsChanged=useRef(({viewableItems}:{viewableItems:Array<{item:Message;isViewable:boolean|null}>})=>{
    const latest=messagesRef.current[messagesRef.current.length-1];
    latestVisible.current=latest&&viewableItems.some(token=>token.isViewable&&token.item.id===latest.id)?latest.id:null;
    settleTailAnchor();
  }).current;
  function requestTailAnchor(animated=false){
    if(!tailAnchoring.current)return;
    listRef.current?.scrollToEnd({animated});
    if(tailRetryTimer.current)clearTimeout(tailRetryTimer.current);
    if(tailRetryCount.current<24){
      tailRetryTimer.current=setTimeout(()=>{tailRetryCount.current+=1;requestTailAnchor(false);},80);
    }else{
      const position=scrollPosition.current,atBottom=position.content-position.viewport-position.offset<80;
      tailAnchoring.current=false;nearBottom.current=atBottom;setNewMessages(!atBottom&&messagesRef.current.length>0);setCompactWindow(true);tailRetryTimer.current=null;
    }
  }
  function cancelPrependAnchor(){
    preservePrepend.current=null;
    if(prependRetryTimer.current)clearTimeout(prependRetryTimer.current);
    prependRetryTimer.current=null;setCompactWindow(true);
  }
  function requestPrependAnchor(){
    const pending=preservePrepend.current;
    if(!pending||activeChat.current!==pending.scope){cancelPrependAnchor();return;}
    if(pending.attempts>=24){cancelPrependAnchor();return;}
    pending.attempts+=1;pending.ignoreNext=true;pending.target=undefined;
    const layout=rowLayouts.current.get(pending.anchorId);
    if(Platform.OS==="web"){
      const list=document.querySelector('[data-testid="chat-message-list"]') as HTMLElement|null;
      const row=list?Array.from(list.querySelectorAll<HTMLElement>('[data-testid^="message-row-"]')).find(node=>node.dataset.testid==="message-row-"+pending.anchorId):null;
      if(list){
        pending.target=row?Math.max(0,list.scrollTop+(row.getBoundingClientRect().top-list.getBoundingClientRect().top)-pending.viewOffset):Math.max(0,(list.scrollHeight-list.clientHeight)*(pending.index/Math.max(1,messagesRef.current.length-1)));
        pending.stable=row&&Math.abs(list.scrollTop-pending.target)<=2?(pending.stable||0)+1:0;
        list.scrollTop=pending.target;list.dispatchEvent(new Event("scroll"));
        if(pending.stable>=3){cancelPrependAnchor();return;}
      }
    }else if(layout){
      pending.target=Math.max(0,layout.y-pending.viewOffset);
      pending.stable=Math.abs(scrollPosition.current.offset-pending.target)<=2?(pending.stable||0)+1:0;
      listRef.current?.scrollToOffset({offset:pending.target,animated:false});
      if(pending.stable>=3){cancelPrependAnchor();return;}
    }else{
      listRef.current?.scrollToIndex({index:pending.index,viewPosition:0,viewOffset:pending.viewOffset,animated:false});
    }
    if(prependRetryTimer.current)clearTimeout(prependRetryTimer.current);
    prependRetryTimer.current=setTimeout(requestPrependAnchor,80);
  }
  function cancelListAnchors(){
    cancelPrependAnchor();tailAnchoring.current=false;latestVisible.current=null;
    if(tailRetryTimer.current)clearTimeout(tailRetryTimer.current);tailRetryTimer.current=null;setCompactWindow(true);
  }
  const tools=useChatTools({chatId:id,userId:user?.id,scopeRef:activeChat,messages,messagesRef,setMessages,setError});
  const {updated,reconcile,mutate,openActions,openOriginal}=tools;
  const reactTo=useCallback((messageId:string,emoji:string|null)=>{void mutate(messageId,"reaction",{emoji});},[mutate]);
  useEffect(()=>{if(tools.replyToId&&!voiceOpen)inputRef.current?.focus();},[tools.replyToId,voiceOpen]);

  const load = useCallback(async (): Promise<void> => {
    if (!id || !user || (Platform.OS==="web" && document.hidden)) return;
    if (loadingRef.current) { reloadRequested.current = true; return; }
    const scope=id+":"+user.id;
    loadingRef.current = true;
    try {
      const [info, msgs] = await Promise.all([
        chatInfoRef.current ? Promise.resolve(chatInfoRef.current) : api.getAs<{ other: User | null }>(user.id,`/chats/${id}`),
        (async () => {
          const all: Message[] = [];
          let after = messagesRef.current[messagesRef.current.length - 1]?.id;
          for (let page = 0; page < 10; page++) {
            const batch = await api.getAs<Message[]>(user.id,"/chats/"+id+"/messages?limit=100"+(after ? "&after="+encodeURIComponent(after) : ""));
            if (activeChat.current !== scope) return [];
            if (!after) setHasOlder(batch.length === 100);
            all.push(...batch);
            if (!after || batch.length < 100) break;
            after = batch[batch.length - 1]?.id;
            if (page === 9) reloadRequested.current = true;
          }
          return all;
        })(),
      ]);
      if (activeChat.current !== scope) return;
      setChatInfo(info);
      const merged = mergeChatMessages(id,messagesRef.current,msgs);
      messagesRef.current = merged; setMessages(merged);
      setError(null);
    } catch (failure) {
      if(activeChat.current===scope)setError(failure instanceof Error ? failure.message : "Couldn't load messages. Please try again.");
    } finally {
      if(activeChat.current===scope){
        loadingRef.current = false;setLoading(false);
        if (reloadRequested.current) { reloadRequested.current = false; void load(); }
      }
    }
  }, [id,user?.id]);

  useEffect(() => {
    activeChat.current = id+":"+(user?.id||"");
    setError(null);
    setMessages([]); setChatInfo(null); setPending([]); setLoading(true);setText("");setSending(false);setDraft(null);setEmotesOpen(false);setVoiceOpen(false);setAttachmentsOpen(false);setCreatingSpace(false);nearBottom.current=true;setNewMessages(false);setCompactWindow(false);
    messagesRef.current = []; loadingRef.current = false; tailAnchoring.current=true;latestVisible.current=null;scrollPosition.current={offset:0,content:0,viewport:0};preservePrepend.current=null;rowLayouts.current.clear();if(prependRetryTimer.current)clearTimeout(prependRetryTimer.current);prependRetryTimer.current=null;tailRetryCount.current=0;if(tailRetryTimer.current)clearTimeout(tailRetryTimer.current);tailRetryTimer.current=null;
    chatInfoRef.current = null; reloadRequested.current = false; sendFlight.current = false; uploadFlight.current = false; creatingSpaceRef.current = false;
    olderFlight.current = false; setHasOlder(false); setLoadingOlder(false);
    load();
    return () => { activeChat.current = "";if(prependRetryTimer.current)clearTimeout(prependRetryTimer.current);prependRetryTimer.current=null;if(tailRetryTimer.current)clearTimeout(tailRetryTimer.current);tailRetryTimer.current=null; };
  }, [load]);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      if (!user) return;
      const all = await getOutbox(user.id);
      if (active) setPending(all.filter(message => message.chat_id === id));
    };
    const changed = () => {
      void sync().catch(() => { if (active) setError("Could not read queued messages"); });
      void load();
    };
    void sync().catch(() => { if (active) setError("Could not read queued messages"); });
    const stop = subscribeOutbox(changed);
    return () => { active = false; stop(); };
  }, [user?.id, id, load]);

  // The account provider owns one connection; views only subscribe while focused.
  useFocusEffect(
    useCallback(() => {
      const scope=`chat:${user?.id||"none"}:${id}:${++previewScopeCounter.current}`;setPreviewScope(scope);
      focused.current = true;
      void load();void reconcile();
      const stop = user ? subscribeChatEvents(user.id, event => {
        if(event.type==="chat_changed"){
          if(event.chat_id!==id)return;
          if(event.change==="updated")updated(event.message_id);else void load();
        }else{void load();void reconcile();}
      }) : () => {};
      return () => { focused.current = false; stop(); if(user)clearPrivateImagePreviewScope(user.id,scope); };
    }, [load, user?.id, id, updated, reconcile]),
  );

  function jumpToLatest(){cancelPrependAnchor();tailAnchoring.current=true;tailRetryCount.current=0;nearBottom.current=true;setNewMessages(false);setCompactWindow(false);requestTailAnchor(true);}
  useEffect(()=>{
    const latest=messages[messages.length-1];if(!latest)return;
    if(nearBottom.current||latest.sender_id===user?.id){const timer=setTimeout(jumpToLatest,60);return()=>clearTimeout(timer);}
    setNewMessages(true);
  },[messages[messages.length-1]?.id]);
  useEffect(()=>{
    if(Platform.OS!=="web")return;
    const resume=()=>{if(!document.hidden)void load();};
    document.addEventListener("visibilitychange",resume);return()=>document.removeEventListener("visibilitychange",resume);
  },[load]);

  async function send(payload: Record<string,unknown>): Promise<boolean> {
    if (!user || sendFlight.current) return false;
    const replyAtSend=tools.replyToId;
    if(replyAtSend&&(!tools.replyMessage||messageRemoved(tools.replyMessage))){setError("The original message is unavailable. Cancel this reply to send your draft. Your text is kept.");return false;}
    setError(null);
    sendFlight.current = true;
    const scope=id+":"+user.id;setSending(true);
    try { await queueMessage(user.id,{...payload,...replyFields(replyAtSend)}); if(activeChat.current===scope){nearBottom.current=true;setNewMessages(false);tools.setReplyToId(current=>current===replyAtSend?null:current);}return activeChat.current===scope; }
    catch(e) { if(activeChat.current===scope)setError(e instanceof Error ? e.message : "Could not save this message for sending");return false; }
    finally {if(activeChat.current===scope){sendFlight.current = false;setSending(false);}}
  }
  async function sendText() {
    const t = text.trim();
    if (!t) return;
    const ok = await send({ chat_id: id, type: "text", text: t });
    if (ok) setText(current => current.trim() === t ? "" : current);
  }

  async function sendAttachment(){
    if(!draft || !user || sending || uploadFlight.current)return;
    uploadFlight.current = true;
    const selected=draft,uid=user.id,scope=id+":"+uid;setSending(true);setError(null);
    try{
      const uploadedId=selected.uploadedId||(await uploadAttachment(id,selected.uri,selected.name,uid)).id;
      if(activeChat.current!==scope)return;
      setDraft({...selected,uploadedId});
      if(await send({chat_id:id,type:selected.type,attachment_id:uploadedId}))setDraft(null);
    }catch(error){if(activeChat.current===scope)setError(error instanceof Error?error.message:"Couldn't upload. Your file is still selected; try again.");}
    finally{if(activeChat.current===scope){uploadFlight.current=false;setSending(false);}}
  }
  async function attachImage(){
    if(sending)return;const scope=activeChat.current;
    setAttachmentsOpen(false);
    try{
      const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],quality:0.8});
      const photo=!result.canceled&&result.assets[0];
      if(photo&&activeChat.current===scope){
        if(photo.fileSize&&photo.fileSize>25*1024*1024)throw Error("Choose a photo up to 25 MB.");
        setDraft({uri:photo.uri,name:photo.fileName||"image.jpg",type:"image",size:photo.fileSize});setError(null);
      }
    }catch(error){if(activeChat.current===scope)setError(error instanceof Error?error.message:"Couldn't choose this photo.");}
  }
  async function attachFile(){
    if(sending)return;const scope=activeChat.current;
    setAttachmentsOpen(false);
    try{
      const result=await DocumentPicker.getDocumentAsync({multiple:false,copyToCacheDirectory:true});
      const file=!result.canceled&&result.assets[0];
      if(file&&activeChat.current===scope){
        if(file.size&&file.size>25*1024*1024)throw Error("Choose a file up to 25 MB.");
        setDraft({uri:file.uri,name:file.name,type:isImageFilename(file.name)?"image":"file",size:file.size});setError(null);
      }
    }catch(error){if(activeChat.current===scope)setError(error instanceof Error?error.message:"Couldn't choose this file.");}
  }
  async function loadOlder() {
    if (!user || !hasOlder || olderFlight.current || preservePrepend.current || !messagesRef.current[0]) return;
    const scope = activeChat.current;
    olderFlight.current = true; setLoadingOlder(true);
    try {
      const older = await api.getAs<Message[]>(user.id,"/chats/" + id + "/messages?before=" + encodeURIComponent(messagesRef.current[0].id));
      if (activeChat.current !== scope) return;
      const current=messagesRef.current,position=scrollPosition.current;
      const anchor=current.map(message=>({message,layout:rowLayouts.current.get(message.id)})).filter(item=>item.layout&&item.layout.y+item.layout.height>position.offset+1&&item.layout.y<position.offset+position.viewport).sort((a,b)=>a.layout!.y-b.layout!.y)[0];
      const merged = mergeChatMessages(id,current,older);
      const added=merged.length>current.length;
      if(added&&anchor){
        const index=merged.findIndex(message=>message.id===anchor.message.id);
        let viewOffset=anchor.layout!.y-position.offset;
        if(Platform.OS==="web"){
          const list=document.querySelector('[data-testid="chat-message-list"]') as HTMLElement|null;
          const row=list?Array.from(list.querySelectorAll<HTMLElement>('[data-testid^="message-row-"]')).find(node=>node.dataset.testid==="message-row-"+anchor.message.id):null;
          if(list&&row)viewOffset=row.getBoundingClientRect().top-list.getBoundingClientRect().top;
        }
        preservePrepend.current=index>=0?{scope,anchorId:anchor.message.id,index,viewOffset,attempts:0}:null;
        rowLayouts.current.delete(anchor.message.id);
      }else cancelPrependAnchor();
      tailAnchoring.current=false;latestVisible.current=null;nearBottom.current=false;setCompactWindow(!preservePrepend.current);
      messagesRef.current = merged; setMessages(merged); setHasOlder(older.length === 50);
    } catch (failure) {
      if (activeChat.current === scope) setError(failure instanceof Error ? failure.message : "Could not load older messages");
    } finally {
      if (activeChat.current === scope) { olderFlight.current = false; setLoadingOlder(false); }
    }
  }
  async function startSpace() {
    if (!chatInfo?.other || !user || creatingSpaceRef.current) return;
    const uid = user.id, scope = activeChat.current;
    creatingSpaceRef.current = true; setCreatingSpace(true); setError(null);
    try {
      const space = await api.postAs<{id: string; name?: string}>(uid, "/spaces", {
        name: chatInfo.other.name.split(" ")[0] + " & you", member_ids: [chatInfo.other.id],
      });
      if (activeChat.current !== scope) return;
      await queueMessage(uid, {chat_id: id, type: "space_invite", text: "Started a space", space_id: space.id, space_name: space.name || "Shared space"});
      if (activeChat.current === scope && focused.current) router.push(`/space/${space.id}`);
    } catch (failure) {
      if (activeChat.current === scope) setError(failure instanceof Error ? failure.message : "Couldn't start this Space. Please try again.");
    } finally {
      if (activeChat.current === scope) { creatingSpaceRef.current = false; setCreatingSpace(false); }
    }
  }
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to chats" onPress={() => router.back()} style={styles.iconBtn} testID="chat-back">
          <Ionicons name="chevron-back" size={22} color={c.text} />
        </Pressable>
        <Pressable accessibilityLabel="Message notifications" onPress={()=>router.push("/notifications")} style={styles.iconBtn}><Ionicons name="notifications-outline" size={20} color={c.primary}/></Pressable>
        <View style={styles.headerCenter}>
          <Avatar name={chatInfo?.other?.name} seed={chatInfo?.other?.id} photo={chatInfo?.other?.avatar} size={36} />
          <View style={{flex:1,minWidth:0}}>
            <Text style={styles.headerName} numberOfLines={1}>
              {chatInfo?.other?.name || "Chat"}
            </Text>
            <Text numberOfLines={1} style={styles.headerSub}>{connection === "offline" ? "Offline · messages stay queued" : connection === "reconnecting" ? "Reconnecting…" : "Private conversation"}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Contact privacy and reporting" onPress={()=>chatInfo?.other && router.push(("/privacy?contact="+chatInfo.other.id) as never)} style={styles.iconBtn}><Ionicons name="ellipsis-horizontal" size={22} color={c.text}/></Pressable>
        {CALLS_ENABLED && <Pressable
          onPress={() => chatInfo?.other && router.push(`/call/${chatInfo.other.id}`)}
          style={styles.iconBtn}
          testID="chat-call"
        >
          <Ionicons name="call-outline" size={20} color={c.primaryDark} />
        </Pressable>}
      </View>

      <View style={styles.toolsBar}>
      <Pressable
        style={styles.spacesPill}
        accessibilityRole="button" accessibilityLabel="Start a shared space" disabled={creatingSpace || !chatInfo?.other}
        onPress={() => void startSpace()}
        testID="shared-space-pill"
      >
        <Ionicons name="sparkles-outline" size={14} color={c.textSecondary} />
        <Text numberOfLines={1} style={styles.spacesText}>{creatingSpace ? "Creating…" : "Shared space"}</Text>
        <Ionicons name="arrow-forward" size={12} color={c.primary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Search conversation" testID="chat-search-button" onPress={()=>tools.setFindMode("search")} style={styles.iconBtn}><Ionicons name="search-outline" size={21} color={c.textSecondary}/></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Pinned messages" testID="chat-pins-button" onPress={()=>tools.setFindMode("pins")} style={styles.iconBtn}><Ionicons name="pin-outline" size={21} color={c.textSecondary}/></Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
        style={{ flex: 1 }}
      >
        {error ? (
          <Pressable
            onPress={() => {
              setError(null);
              load();
            }}
            style={styles.errorBanner}
            testID="chat-error"
          >
            <Ionicons name="cloud-offline-outline" size={14} color={c.error} />
            <Text style={styles.errorText}>{error} · Tap to retry</Text>
          </Pressable>
        ) : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={c.primary} />
          </View>
        ) : (
          <View style={{flex: 1}}><Decor/><FlatList
            ref={listRef}
            testID="chat-message-list"
            scrollEventThrottle={32}
            onScroll={event=>{
              const {contentOffset,contentSize,layoutMeasurement}=event.nativeEvent;
              scrollPosition.current={offset:contentOffset.y,content:contentSize.height,viewport:layoutMeasurement.height};
              const prepend=preservePrepend.current;
              if(prepend?.target!==undefined&&Math.abs(contentOffset.y-prepend.target)>8){
                if(prepend.ignoreNext)prepend.ignoreNext=false;else cancelPrependAnchor();
              }else if(prepend)prepend.ignoreNext=false;
              if(tailAnchoring.current){settleTailAnchor();return;}
              nearBottom.current=contentSize.height-layoutMeasurement.height-contentOffset.y<80;
              if(nearBottom.current)setNewMessages(false);
            }}
            onScrollBeginDrag={cancelListAnchors}
            onTouchStart={cancelListAnchors}
            onLayout={()=>requestTailAnchor(false)}
            onScrollToIndexFailed={({index,averageItemLength})=>{
              const pending=preservePrepend.current;
              if(pending&&pending.index===index){
                pending.ignoreNext=true;
                listRef.current?.scrollToOffset({offset:Math.max(0,averageItemLength*index-pending.viewOffset),animated:false});
              }
            }}
            onContentSizeChange={(_width,height)=>{
              const pending=preservePrepend.current;
              scrollPosition.current={...scrollPosition.current,content:height};
              if(pending){requestPrependAnchor();return;}
              if(tailAnchoring.current)requestTailAnchor(false);else if(nearBottom.current)listRef.current?.scrollToEnd({animated:false});
              settleTailAnchor();
            }}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            windowSize={compactWindow?7:21}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.msgList}
            renderItem={({ item, index }) => <View onLayout={event=>{const {y,height}=event.nativeEvent.layout;rowLayouts.current.set(item.id,{y,height});if(preservePrepend.current?.anchorId===item.id)requestPrependAnchor();}}>
              {index === 0 || new Date(messages[index - 1].created_at).toLocaleDateString() !== new Date(item.created_at).toLocaleDateString()
                ? <Text style={styles.dateLabel}>{new Date(item.created_at).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})}</Text> : null}
              <MessageRow msg={item} mine={item.sender_id === user?.id} userId={user?.id||""} previewScope={previewScope} busy={tools.busy} replyMessage={item.reply_to_id?tools.lookup(item.reply_to_id):null} onActions={openActions} onOriginal={openOriginal} onReact={reactTo}/>
            </View>}
            ListHeaderComponent={hasOlder ? <Pressable accessibilityRole="button" accessibilityLabel="Load older messages" disabled={loadingOlder} onPress={()=>void loadOlder()}><Text style={{color:c.primary,padding:16,textAlign:"center",fontFamily:f.bodyMedium}}>{loadingOlder ? "Loading earlier messages…" : "Load older messages"}</Text></Pressable> : null}
            ListFooterComponent={<View>{pending.filter(p => !messages.some(m=>m.client_message_id===p.id)).map(p => <View key={p.id} style={{padding:12,alignSelf:"flex-end"}}>
              <Text style={{color:c.text}}>{String(p.payload.text || (p.payload.emote_id?"Emote waiting to send":"File waiting to send"))}</Text>
              <Text style={{color:c.textSecondary}}>{p.state==="failed"?p.error:"Waiting to send…"}</Text>
              {p.state==="failed" ? <Pressable onPress={()=>user && retryMessage(user.id,p.id)}><Text style={{color:c.primary}}>Retry</Text></Pressable>:null}
              <Pressable onPress={()=>user && removePending(user.id,p.id)}><Text style={{color:c.textSecondary}}>Remove from queue</Text></Pressable>
            </View>)}</View>}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>A little closer starts with hello.</Text>
              </View>
            }
          /></View>
        )}

        {newMessages?<Pressable accessibilityRole="button" accessibilityLabel="Jump to new messages" onPress={jumpToLatest} style={{alignSelf:"center",flexDirection:"row",gap:8,paddingHorizontal:18,paddingVertical:12,borderRadius:24,backgroundColor:c.primary,marginBottom:8}}><Text style={{fontFamily:f.bodyBold,color:c.textInverse}}>New messages</Text><Ionicons name="arrow-down" size={18} color={c.textInverse}/></Pressable>:null}
        {tools.replyToId?<View style={styles.replyDraft}><ReplyPreview draft message={tools.replyMessage} onOpen={()=>void tools.openOriginal(tools.replyToId!)} onCancel={()=>{tools.setReplyToId(null);setError(null);}}/></View>:null}
        {draft?<View testID="attachment-draft" style={{padding:16,gap:10,borderTopWidth:1,borderColor:c.border,backgroundColor:c.bg}}>
          {draft.type==="image"?<Image source={{uri:draft.uri}} accessibilityLabel="Photo ready to send" testID="chat-attachment-preview" resizeMode="contain" style={{height:148,width:"100%",borderRadius:14}}/>:<View style={{flexDirection:"row",alignItems:"center",gap:10}}><Ionicons name="document-text-outline" size={24} color={c.primary}/><Text numberOfLines={2} style={{flex:1,fontFamily:f.bodyMedium,color:c.text}}>{draft.name}</Text></View>}
          <View style={{flexDirection:"row",gap:12}}><Pressable accessibilityRole="button" accessibilityLabel="Cancel attachment" disabled={sending} onPress={()=>setDraft(null)} style={{flex:1,minHeight:44,alignItems:"center",justifyContent:"center",borderRadius:14,backgroundColor:c.surface}}><Text style={{color:c.text,fontFamily:f.bodyMedium}}>Cancel</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Send attachment" disabled={sending} onPress={()=>void sendAttachment()} style={{flex:1,minHeight:44,alignItems:"center",justifyContent:"center",borderRadius:14,backgroundColor:c.primary}}>{sending?<ActivityIndicator color={c.textInverse}/>:<Text style={{color:c.textInverse,fontFamily:f.bodyBold}}>Send {draft.type==="image"?"photo":"file"}</Text>}</Pressable></View>
        </View>:null}
        {emotesOpen?<EmotePicker key={id+":"+user?.id} onClose={()=>setEmotesOpen(false)} onSend={emote_id=>send({chat_id:id,type:"emote",emote_id})}/>:null}
        {attachmentsOpen ? <View testID="chat-attachment-menu" style={styles.attachmentMenu}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose a photo to share" disabled={sending} onPress={attachImage} style={styles.attachmentChoice} testID="attach-image"><Ionicons name="image-outline" size={23} color={c.primary}/><Text style={styles.attachmentLabel}>Photo</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose a file to share" disabled={sending} onPress={attachFile} style={styles.attachmentChoice} testID="attach-file"><Ionicons name="document-outline" size={23} color={c.primary}/><Text style={styles.attachmentLabel}>File</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Record a voice memo" disabled={sending} onPress={()=>{setAttachmentsOpen(false);setVoiceOpen(true);}} style={styles.attachmentChoice}><Ionicons name="mic-outline" size={23} color={c.primary}/><Text style={styles.attachmentLabel}>Voice memo</Text></Pressable>
        </View> : null}
        {voiceOpen ? <VoiceComposer getChatId={async()=>id} replyToId={tools.replyToId} onSent={(_,sentReply)=>{setVoiceOpen(false);tools.setReplyToId(current=>current===(sentReply||null)?null:current);}} onClose={()=>setVoiceOpen(false)}/> : (
          <View style={styles.composer}>
            <Pressable accessibilityRole="button" accessibilityLabel={attachmentsOpen ? "Close attachment options" : "Add an attachment"} accessibilityState={{expanded:attachmentsOpen}} disabled={sending} onPress={()=>{setAttachmentsOpen(value=>!value);setEmotesOpen(false);}} style={styles.attachBtn} testID="attachment-menu-button">
              <Ionicons name={attachmentsOpen ? "close" : "add"} size={23} color={c.text} />
            </Pressable>
            <View style={styles.inputWrap}>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor={c.textTertiary}
              style={styles.input}
              multiline
              maxLength={10000}
              accessibilityLabel="Message"
              testID="message-input"
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Open emotes" disabled={sending} onPress={()=>{setEmotesOpen(true);setAttachmentsOpen(false);}} style={styles.emoteBtn}><Ionicons name="happy-outline" size={21} color={c.textSecondary}/></Pressable>
            </View>
            {text.trim().length > 0 ? (
              <Pressable
                accessibilityRole="button" accessibilityLabel="Send message"
                onPress={sendText}
                disabled={sending}
                style={styles.sendBtn}
                testID="send-button"
              >
                <Ionicons name="arrow-up" size={20} color={c.textInverse} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button" accessibilityLabel="Record a voice memo"
                disabled={sending}
                onPress={() => { setAttachmentsOpen(false); setVoiceOpen(true); }}
                style={styles.sendBtn}
                testID="mic-button"
              >
                <Ionicons name="mic-outline" size={20} color={c.textInverse} />
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
      <MessageActionSheet message={tools.actionMessage} userId={user?.id||""} busy={tools.busy} error={tools.actionError} onClose={tools.closeActions} onClearError={()=>tools.setActionError(null)}
        onReply={()=>{if(tools.actionMessage)tools.reply(tools.actionMessage.id);}}
        onReact={emoji=>{if(tools.actionMessage)reactTo(tools.actionMessage.id,emoji);}}
        onEdit={(text,revision)=>{if(tools.actionMessage)void mutate(tools.actionMessage.id,"edit",{text,expected_revision:revision});}}
        onRemove={revision=>{if(tools.actionMessage)void mutate(tools.actionMessage.id,"remove",{expected_revision:revision});}}
        onPin={pinned=>{if(tools.actionMessage)void mutate(tools.actionMessage.id,"pin",{pinned});}}/>
      <ChatFindSheet mode={tools.findMode} chatId={id} userId={user?.id||""} refreshVersion={tools.refreshVersion} onClose={()=>tools.setFindMode(null)} onOpen={messageId=>void openOriginal(messageId)}/>
      <MessageFocusSheet message={tools.focusMessage} loading={tools.focusLoading} onClose={tools.closeFocus} onReply={()=>{if(tools.focusMessage)tools.reply(tools.focusMessage.id);}} onActions={()=>{if(tools.focusMessage)openActions(tools.focusMessage);}}/>
    </SafeAreaView>
  );
}

const MessageRow = React.memo(function MessageRow({msg,mine,userId,busy,replyMessage,onActions,onOriginal,onReact}:{
  msg:Message;mine:boolean;userId:string;busy:boolean;replyMessage:Message|null;
  onActions:(message:Message)=>void;onOriginal:(messageId:string)=>void;onReact:(messageId:string,emoji:string|null)=>void;
}) {
  const { c, f } = useTheme();
  const router = useRouter();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const emote=getEmote(msg.emote_id);
  const photo = msg.type === "image" || (msg.type === "file" && isImageFilename(msg.file_name));
  const bubbleStyle = [
    styles.bubble,
    mine
      ? { backgroundColor: c.surfaceElevated, borderBottomRightRadius: 4 }
      : { backgroundColor: c.surface, borderBottomLeftRadius: 4 },
    (photo||msg.type==="emote") && {paddingHorizontal:0,paddingVertical:0,backgroundColor:"transparent"},
  ];
  return (
    <View testID={"message-row-"+msg.id} style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]}>
      {mine&&!msg.deleted_at?<Pressable accessibilityRole="button" accessibilityLabel="Message actions" testID={"message-actions-"+msg.id} disabled={busy} onPress={()=>onActions(msg)} style={styles.messageAction}><Ionicons name="ellipsis-horizontal" size={17} color={c.textTertiary}/></Pressable>:null}
      <View style={bubbleStyle} testID={photo?"photo-message-"+msg.id:undefined}>
        {msg.reply_to_id&&!msg.deleted_at?<ReplyPreview message={replyMessage} onOpen={()=>onOriginal(msg.reply_to_id!)}/>:null}
        {msg.deleted_at?<Text style={[styles.msgText,{color:c.textSecondary,fontStyle:"italic"}]}>Message removed</Text>:<>
        {msg.type === "emote" ? emote?<EmoteImage emote={emote} autoPlay/>:<Text style={styles.msgText}>Emote unavailable</Text>:null}
        {msg.type === "text" && (
          <Text onLongPress={()=>onActions(msg)} style={styles.msgText}>{msg.text}</Text>
        )}
        {msg.type === "voice" && (
          <VoiceMessageBubble durationMs={msg.duration_ms || 0} outgoing={mine} media={msg.media} attachmentId={msg.attachment_id} unavailable={msg.attachment_deleted} />
        )}
        {msg.type === "image" && msg.media ? (
          <Image
            source={{ uri: msg.media }}
            style={styles.imageMsg}
            resizeMode="cover"
          />
        ) : msg.type === "image" ? (
          <PrivateImageCard unavailable={msg.attachment_deleted} canDelete={mine} attachmentId={msg.attachment_id} fileName={msg.file_name} cacheScope={previewScope} />
        ) : null}
        {msg.type === "file" && (
          isImageFilename(msg.file_name) ? <PrivateImageCard unavailable={msg.attachment_deleted} canDelete={mine} attachmentId={msg.attachment_id} fileName={msg.file_name} cacheScope={previewScope} /> : <FilePreviewCard unavailable={msg.attachment_deleted} canDelete={mine} attachmentId={msg.attachment_id} fileName={msg.file_name} fileSize={msg.file_size} type="file" />
        )}
        {msg.type === "space_invite" && (
          <Pressable
            onPress={() => msg.space_id && router.push(`/space/${msg.space_id}`)}
            style={{
              backgroundColor: c.primaryBgSubtle,
              padding: 12,
              borderRadius: 16,
              minWidth: 220,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
            testID={`join-space-${msg.space_id}`}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: c.primary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="planet-outline" size={20} color={c.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: f.bodyBold, fontSize: 13, color: c.text }}>
                {msg.space_name || "Shared space"}
              </Text>
              <Text style={{ fontFamily: f.body, fontSize: 11, color: c.textSecondary, marginTop: 2 }}>
                Tap to join
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={c.primary} />
          </Pressable>
        )}
        </>}
        <Text style={styles.msgTime}>
          {msg.pinned?"Pinned · ":""}{new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{msg.edited_at&&!msg.deleted_at?" · edited":""}
        </Text>
        <ReactionChips message={msg} userId={userId} disabled={busy} onReact={emoji=>onReact(msg.id,emoji)}/>
      </View>
      {!mine&&!msg.deleted_at?<Pressable accessibilityRole="button" accessibilityLabel="Message actions" testID={"message-actions-"+msg.id} disabled={busy} onPress={()=>onActions(msg)} style={styles.messageAction}><Ionicons name="ellipsis-horizontal" size={17} color={c.textTertiary}/></Pressable>:null}
    </View>
  );
});

const makeStyles = (c: any, f: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  header: {
    width: "100%", maxWidth: 960, alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerName: { fontFamily: f.heading, fontSize: 18, color: c.text },
  headerSub: { fontFamily: f.body, fontSize: 12, color: c.textSecondary, marginTop: 2, flexShrink: 1 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surface,
  },
  toolsBar:{width:"100%",maxWidth:960,alignSelf:"center",flexDirection:"row",alignItems:"center",gap:8,paddingHorizontal:spacing.md,paddingVertical:8},
  messageAction:{width:44,height:44,alignItems:"center",justifyContent:"center",alignSelf:"flex-end"},
  replyDraft:{width:"100%",maxWidth:960,alignSelf:"center",paddingHorizontal:spacing.md,paddingTop:8},
  spacesPill: {
    flex:1,minWidth:0,minHeight:44,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: "dashed",
    marginVertical: 0,
  },
  spacesText: { flex:1, fontFamily: f.bodyMedium, fontSize: 13, color: c.textSecondary },
  spacesSoon: {
    fontFamily: f.bodyMedium,
    fontSize: 10,
    color: c.primary,
    backgroundColor: c.primaryBgSubtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
    marginLeft: 2,
  },
  msgList: { width: "100%", maxWidth: 960, alignSelf: "center", padding: spacing.md, paddingBottom: spacing.lg },
  dateLabel: { textAlign: "center", fontFamily: f.bodyMedium, fontSize: 12, color: c.textSecondary, paddingVertical: 16 },
  msgRow: { flexDirection: "row", marginBottom: spacing.sm },
  msgLeft: { justifyContent: "flex-start" },
  msgRight: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "80%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  msgText: { fontFamily: f.body, fontSize: 16, color: c.text, lineHeight: 24 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    backgroundColor: c.errorBg,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 999,
    marginVertical: spacing.sm,
  },
  errorText: { fontFamily: f.bodyMedium, fontSize: 13, lineHeight: 20, flexShrink: 1, color: c.error },
  msgTime: {
    fontFamily: f.body,
    fontSize: 12,
    color: c.textTertiary,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  imageMsg: {
    width: 220,
    height: 220,
    borderRadius: 16,
    backgroundColor: c.primaryBgSubtle,
  },
  composer: {
    width: "100%", maxWidth: 960, alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bg,
  },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 20,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  inputWrap: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-end", backgroundColor: c.surface, borderRadius: 24 },
  emoteBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  attachmentMenu: { width: "100%", maxWidth: 960, alignSelf: "center", flexDirection: "row", gap: 10, paddingHorizontal: spacing.md, paddingTop: 12, paddingBottom: 8, backgroundColor: c.bg },
  attachmentChoice: { flex: 1, minHeight: 76, alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 18, backgroundColor: c.surface },
  attachmentLabel: { fontFamily: f.bodyMedium, fontSize: 13, color: c.text },
  input: {
    flex: 1,
    minWidth:0,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: c.surface,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: f.body,
    fontSize: 16,
    color: c.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  recordBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.error },
  recordText: { flex: 1, fontFamily: f.bodyMedium, color: c.text },
  recordCancel: { paddingHorizontal: 10, paddingVertical: 6 },
  recordCancelText: { color: c.textSecondary, fontFamily: f.bodyMedium },
  recordSend: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", padding: spacing.xl },
  emptyText: { fontFamily: f.body, color: c.textSecondary },
});
