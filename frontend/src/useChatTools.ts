import {useCallback, useRef, useState} from "react";
import {api, ApiError, Message} from "./api";
import {currentMessage, mergeChatMessages, messageRemoved, messageRevision} from "./chatTools";
type Ref<T>={current:T};
export function useChatTools({chatId,userId,scopeRef,messages,messagesRef,setMessages,setError}:{
  chatId:string;userId:string|undefined;scopeRef:Ref<string>;messages:Message[];messagesRef:Ref<Message[]>;
  setMessages:(messages:Message[])=>void;setError:(message:string|null)=>void;
}){
  const [resolved,setResolved]=useState<Record<string,Message|null>>({});
  const resolvedRef=useRef(resolved);resolvedRef.current=resolved;
  const [replyToId,setReplyToId]=useState<string|null>(null),[actionId,setActionId]=useState<string|null>(null);
  const replyToRef=useRef(replyToId);replyToRef.current=replyToId;
  const [actionError,setActionError]=useState<{message:string;conflict?:boolean}|null>(null);
  const [busy,setBusy]=useState(false),busyRef=useRef(false);
  const [findMode,setFindMode]=useState<"search"|"pins"|null>(null);
  const [focusId,setFocusId]=useState<string|null>(null),[focusLoading,setFocusLoading]=useState(false),focusRequest=useRef(0);
  const [refreshVersion,setRefreshVersion]=useState(0);
  const resolving=useRef(new Set<string>()),dirty=useRef(new Set<string>()),reconciling=useRef(false);
  const scoped=useCallback(()=>!!userId&&scopeRef.current===chatId+":"+userId,[chatId,userId,scopeRef]);
  const apply=useCallback((incoming:Message[],missing:string[]=[])=>{
    const good=incoming.filter(message=>message?.chat_id===chatId);
    const absent=new Set(missing.filter(id=>!good.some(message=>message.id===id)));
    const loadedIds=new Set(messagesRef.current.map(message=>message.id));
    const next=mergeChatMessages(chatId,messagesRef.current.filter(message=>!absent.has(message.id)),good.filter(message=>loadedIds.has(message.id)));
    messagesRef.current=next;setMessages(next);
    const cache={...resolvedRef.current};
    for(const id of absent)cache[id]=null;
    for(const message of good){const previous=cache[message.id];if(!previous||messageRevision(message)>=messageRevision(previous))cache[message.id]=message;}
    const bounded=Object.fromEntries(Object.entries(cache).slice(-200));
    resolvedRef.current=bounded;setResolved(bounded);
  },[chatId,messagesRef,setMessages]);
  const fetchOne=useCallback(async(messageId:string,quiet=false):Promise<Message|null>=>{
    if(!userId||!scoped())return null;
    try{
      const message=await api.getAs<Message>(userId,"/chats/"+chatId+"/messages/"+encodeURIComponent(messageId));
      if(!scoped())return null;
      if(message?.id!==messageId||message.chat_id!==chatId)throw new Error("Couldn't read this message. Please try again.");
      apply([message]);return message;
    }catch(failure){
      if(!scoped())return null;
      if(failure instanceof ApiError&&(failure.status===403||failure.status===404))apply([],[messageId]);
      if(!quiet)setError(failure instanceof Error?failure.message:"This message is unavailable.");
      return null;
    }
  },[userId,chatId,scoped,apply,setError]);
  const reconcile=useCallback(async()=>{
    if(!userId||!scoped()||reconciling.current)return;
    const ids=Array.from(new Set([...messagesRef.current.map(message=>message.id),...Object.keys(resolvedRef.current)]));
    if(!ids.length)return;reconciling.current=true;
    try{
      for(let offset=0;offset<ids.length;offset+=100){
        const batch=ids.slice(offset,offset+100),current=await api.postAs<Message[]>(userId,"/chats/"+chatId+"/messages/resolve",{message_ids:batch});
        if(!scoped())return;
        if(!Array.isArray(current))throw new Error("Couldn't refresh message changes.");
        apply(current,batch);
      }
      if(scoped())setRefreshVersion(version=>version+1);
    }catch(failure){
      if(scoped()&&failure instanceof ApiError&&failure.status===403){
        messagesRef.current=[];setMessages([]);resolvedRef.current={};setResolved({});setError("This conversation is no longer available.");
      }
      // An unavailable new endpoint during a phased rollout is not deletion of all history.
    }finally{reconciling.current=false;}
  },[userId,chatId,scoped,messagesRef,apply,setMessages,setError]);
  const updated=useCallback((messageId:string)=>{
    if(!scoped())return;setRefreshVersion(version=>version+1);
    if(resolving.current.has(messageId)){dirty.current.add(messageId);return;}
    if(!messagesRef.current.some(message=>message.id===messageId)&&!(messageId in resolvedRef.current)&&replyToRef.current!==messageId)return;
    resolving.current.add(messageId);
    void(async()=>{do{dirty.current.delete(messageId);await fetchOne(messageId,true);}while(dirty.current.has(messageId)&&scoped());})().finally(()=>resolving.current.delete(messageId));
  },[messagesRef,fetchOne,scoped]);
  const mutate=useCallback(async(messageId:string,action:"edit"|"remove"|"reaction"|"pin",body:Record<string,unknown>)=>{
    if(!userId||!scoped()||busyRef.current)return;
    busyRef.current=true;setBusy(true);setActionError(null);
    try{
      const message=await api.postAs<Message>(userId,"/chats/"+chatId+"/messages/"+encodeURIComponent(messageId)+"/"+action,body);
      if(!scoped())return;
      if(message?.id!==messageId||message.chat_id!==chatId)throw new Error("Couldn't confirm this change. Please try again.");
      apply([message]);setRefreshVersion(version=>version+1);setActionId(null);setActionError(null);
    }catch(failure){
      if(!scoped())return;
      const conflict=failure instanceof ApiError&&failure.status===409;
      if(conflict)await fetchOne(messageId,true);
      if(!scoped())return;
      const message=conflict?"The message changed. Review the latest version before trying again.":failure instanceof Error?failure.message:"Couldn't update this message. Your draft is kept.";
      setActionError({message,conflict});
      if(actionId!==messageId||!currentMessage(messageId,messagesRef.current,resolvedRef.current))setError(message);
    }finally{if(scoped()){busyRef.current=false;setBusy(false);}}
  },[userId,scoped,chatId,apply,fetchOne,actionId,messagesRef,setError]);
  const reply=useCallback((messageId:string)=>{
    const message=currentMessage(messageId,messagesRef.current,resolvedRef.current);
    if(!message||messageRemoved(message))return;
    setReplyToId(messageId);setActionId(null);setFocusId(null);setFindMode(null);setActionError(null);
  },[messagesRef]);
  const openActions=useCallback((message:Message)=>{
    if(busyRef.current||message.chat_id!==chatId||messageRemoved(message))return;
    apply([message]);setFocusId(null);setActionId(message.id);setActionError(null);
  },[chatId,apply]);
  const openOriginal=useCallback(async(messageId:string)=>{
    setFindMode(null);setFocusId(messageId);setFocusLoading(true);
    const request=++focusRequest.current,message=await fetchOne(messageId);
    if(!scoped()||focusRequest.current!==request)return;
    setFocusLoading(false);if(!message)setFocusId(null);
  },[fetchOne,scoped]);
  const closeFocus=useCallback(()=>{focusRequest.current++;setFocusId(null);setFocusLoading(false);},[]);
  const lookup=(messageId:string)=>currentMessage(messageId,messages,resolved);
  return{
    replyToId,setReplyToId,replyMessage:replyToId?lookup(replyToId):null,actionMessage:actionId?lookup(actionId):null,
    actionError,setActionError,busy,findMode,setFindMode,focusMessage:focusId?lookup(focusId):null,focusLoading,refreshVersion,
    closeActions:()=>{setActionId(null);setActionError(null);},closeFocus,openActions,openOriginal,reply,mutate,updated,reconcile,lookup,
  };
}
