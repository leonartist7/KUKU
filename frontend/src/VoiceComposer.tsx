import React, {useEffect, useRef, useState} from "react";
import {View, Text, Pressable, Platform, ActivityIndicator} from "react-native";
import {Ionicons} from "@expo/vector-icons";
import {useTheme} from "./ThemeContext";
import {useAuth} from "./AuthContext";
import {api, uploadAttachment} from "./api";
import {queueMessage} from "./outbox";
import {VoiceMessageBubble} from "./MessageParts";

export default function VoiceComposer({getChatId, onSent, onClose}: {
  getChatId: () => Promise<string>; onSent: (chatId: string) => void; onClose?: () => void;
}) {
  const {c, f} = useTheme(); const {user} = useAuth();
  const [phase, setPhase] = useState<"idle"|"requesting"|"recording"|"preview"|"sending">("idle");
  const [seconds, setSeconds] = useState(0); const [error, setError] = useState("");
  const [memo, setMemo] = useState<{uri: string; name: string; duration: number} | null>(null);
  const recorder = useRef<any>(null); const stream = useRef<MediaStream | null>(null);
  const started = useRef(0); const cancelled = useRef(false); const alive = useRef(true);
  const operation = useRef(0);
  const uri = useRef<string | null>(null); const uploaded = useRef<{id: string; chatId: string} | null>(null);
  const uid = useRef(user?.id); uid.current = user?.id;
  const stopRef = useRef<(cancel?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {alive.current = true; return () => {
    alive.current = false; cancelled.current = true; operation.current++;
    stream.current?.getTracks().forEach(track => track.stop());
    if(recorder.current?.state === "recording") recorder.current.stop();
    else void recorder.current?.stopAndUnloadAsync?.().catch(()=>{});
    if(uri.current && Platform.OS === "web") URL.revokeObjectURL(uri.current);
  };}, []);
  useEffect(() => {
    if(phase !== "recording") return;
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started.current) / 1000); setSeconds(elapsed);
      if(elapsed >= 300) void stopRef.current();
    }, 250);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if(Platform.OS !== "web")return;
    const hide = () => {if(document.hidden) void stopRef.current(true);};
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  async function start() {
    if(phase !== "idle") return;
    cancelled.current = false; setError(""); setPhase("requesting");
    const attempt = ++operation.current;
    const account = uid.current;
    try {
      if(Platform.OS === "web") {
        if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Open KUKU in Chrome to record a voice memo.");
        const input = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false});
        stream.current = input;
        if(!alive.current || cancelled.current || attempt !== operation.current || uid.current !== account) {input.getTracks().forEach(t=>t.stop());return;}
        const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(t=>MediaRecorder.isTypeSupported(t));
        if(!type) throw new Error("Your browser cannot record a supported audio format.");
        const record = new MediaRecorder(input, {mimeType: type, audioBitsPerSecond: 64000});
        const chunks: Blob[] = []; let size = 0;
        record.ondataavailable = event => {if(event.data.size) {chunks.push(event.data); size += event.data.size; if(size > 10*1024*1024)void stopRef.current(true);}};
        record.onerror = () => {void stopRef.current(true); if(alive.current)setError("Recording was interrupted. Please try again.");};
        record.onstop = () => {
          input.getTracks().forEach(t=>t.stop());
          if(!alive.current || cancelled.current || attempt !== operation.current || uid.current !== account)return;
          const duration = Math.min(300000, Date.now() - started.current);
          if(duration < 250 || !size) {setPhase("idle");setError("Record a little longer, then stop.");return;}
          const blob = new Blob(chunks, {type}); const url = URL.createObjectURL(blob); uri.current = url;
          setMemo({uri: url, name: "voice-memo." + (type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"), duration});
          setPhase("preview");
        };
        recorder.current = record; started.current = Date.now(); record.start(1000);
      } else {
        const {Audio} = await import("expo-av");
        if(!(await Audio.requestPermissionsAsync()).granted) throw new Error("Allow microphone access in your phone settings to record.");
        if(!alive.current || cancelled.current || attempt !== operation.current || uid.current !== account)return;
        await Audio.setAudioModeAsync({allowsRecordingIOS: true, playsInSilentModeIOS: true});
        const result = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        if(!alive.current || cancelled.current || attempt !== operation.current || uid.current !== account){await result.recording.stopAndUnloadAsync();return;}
        recorder.current = result.recording; started.current = Date.now();
      }
      if(alive.current){setSeconds(0);setPhase("recording");}
    } catch(e) {
      if(attempt !== operation.current)return;
      stream.current?.getTracks().forEach(t=>t.stop());
      if(alive.current){setPhase("idle");setError(e instanceof Error && e.name !== "NotAllowedError" ? e.message : "Allow microphone access, then tap Record again.");}
    }
  }
  async function stop(cancel = false) {
    if(phase !== "recording" && phase !== "requesting")return;
    cancelled.current = cancel;
    if(cancel)operation.current++;
    if(Platform.OS === "web") {
      if(recorder.current?.state === "recording")recorder.current.stop();
      stream.current?.getTracks().forEach(t=>t.stop());
    } else if(recorder.current) {
      await recorder.current.stopAndUnloadAsync();
      const {Audio} = await import("expo-av"); await Audio.setAudioModeAsync({allowsRecordingIOS: false});
      const path = recorder.current.getURI();
      const duration = Math.min(300000,Date.now()-started.current);
      if(!cancel && path && alive.current){uri.current=path;setMemo({uri:path,name:"voice-memo.m4a",duration});setPhase("preview");}
    }
    if(cancel && alive.current){setMemo(null);setPhase("idle");}
  }
  stopRef.current = stop;
  async function discard() {
    try {
      if(uploaded.current)await api.delete("/attachments/"+uploaded.current.id);
      uploaded.current=null;
      if(uri.current && Platform.OS === "web")URL.revokeObjectURL(uri.current);
      uri.current=null;setMemo(null);setPhase("idle");setError("");
    }catch {setError("Could not remove this draft. Please try again.");}
  }
  async function send() {
    if(!memo || !user || phase !== "preview")return;
    const account = user.id; setPhase("sending");setError("");
    try {
      const chatId = uploaded.current?.chatId || await getChatId();
      if(uid.current !== account)throw new Error("Your account changed. Please sign in again.");
      if(!uploaded.current){const file=await uploadAttachment(chatId,memo.uri,memo.name,account,"voice");uploaded.current={id:file.id,chatId};}
      if(uid.current !== account)throw new Error("Your account changed. Please sign in again.");
      await queueMessage(account,{chat_id:chatId,type:"voice",attachment_id:uploaded.current.id,duration_ms:memo.duration});
      uploaded.current=null;onSent(chatId);
    }catch(e){if(alive.current){setPhase("preview");setError(e instanceof Error?e.message:"Your memo is kept. Try sending again.");}}
  }
  const button = {minHeight:44,minWidth:44,padding:12,borderRadius:16,alignItems:"center" as const,justifyContent:"center" as const};
  return <View style={{padding:16,gap:12,backgroundColor:c.surface,borderRadius:22,margin:8}} testID="voice-composer">
    <View style={{flexDirection:"row",alignItems:"center",gap:10}}><Ionicons name="mic-outline" size={22} color={c.primary}/><Text style={{flex:1,fontFamily:f.bodyBold,color:c.text}}>Voice memo</Text>{onClose && phase!=="sending"?<Pressable accessibilityLabel="Close voice memo" onPress={()=>{void stop(true);void discard();onClose();}} style={button}><Ionicons name="close" size={20} color={c.text}/></Pressable>:null}</View>
    {phase==="idle" ? <><Text style={{color:c.textSecondary,fontFamily:f.body,lineHeight:20}}>A little more personal. Record up to 5 minutes, listen, then send.</Text><Pressable accessibilityRole="button" onPress={()=>void start()} testID="voice-record" style={{...button,backgroundColor:c.primary}}><Text style={{color:c.textInverse,fontFamily:f.bodyBold}}>Record a voice memo</Text></Pressable></> : null}
    {phase==="recording" || phase==="requesting" ? <View style={{flexDirection:"row",alignItems:"center",gap:8}}><Text accessibilityLiveRegion="polite" style={{flex:1,color:c.text,fontFamily:f.bodyMedium}}>{phase==="requesting"?"Allow microphone access…":"● Recording  "+Math.floor(seconds/60)+":"+String(seconds%60).padStart(2,"0")}</Text><Pressable onPress={()=>void stop(true)} style={button}><Text style={{color:c.textSecondary}}>Cancel</Text></Pressable><Pressable onPress={()=>void stop()} disabled={phase==="requesting"} accessibilityLabel="Stop recording" testID="voice-stop" style={{...button,backgroundColor:c.primary}}><Ionicons name="stop" size={18} color={c.textInverse}/></Pressable></View>:null}
    {memo && (phase==="preview" || phase==="sending") ? <><VoiceMessageBubble durationMs={memo.duration} outgoing media={memo.uri}/><View style={{flexDirection:"row",gap:12}}><Pressable disabled={phase==="sending"} onPress={()=>void discard()} style={button}><Text style={{color:c.textSecondary}}>Record again</Text></Pressable><Pressable disabled={phase==="sending"} onPress={()=>void send()} testID="voice-send" style={{...button,flex:1,backgroundColor:c.primary}}>{phase==="sending"?<ActivityIndicator color={c.textInverse}/>:<Text style={{color:c.textInverse,fontFamily:f.bodyBold}}>Send voice memo</Text>}</Pressable></View></>:null}
    {error?<Text accessibilityRole="alert" style={{color:c.error,lineHeight:20}}>{error}</Text>:null}
  </View>;
}
