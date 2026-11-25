import React,{useCallback,useRef,useState} from "react";
import {ActivityIndicator,Platform,Pressable,ScrollView,Text,View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useFocusEffect,useRouter} from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import {useAuth} from "../src/AuthContext";
import {useTheme} from "../src/ThemeContext";
import {api,getSessionEpoch,getSessionUserId} from "../src/api";
import {CALLS_ENABLED} from "../src/config";
import {CallReadiness,callReadinessRows,checkMicrophoneAccess} from "../src/callReadiness";
import {IconButton} from "../src/ScreenUI";
import {layout,typography} from "../src/theme";

export default function CallSettings(){
  const {user,restoring}=useAuth(),{c,f}=useTheme(),router=useRouter();
  const [status,setStatus]=useState<CallReadiness|null>(null),[checking,setChecking]=useState(false);
  const [error,setError]=useState(""),[microphone,setMicrophone]=useState("Not checked"),[testing,setTesting]=useState(false);
  const revision=useRef(0),visible=useRef(false);
  const uid=user?.id;
  const refresh=useCallback(async()=>{
    if(!uid||restoring)return;
    const attempt=++revision.current,epoch=getSessionEpoch();setStatus(null);setChecking(true);setError("");
    const current=()=>visible.current&&attempt===revision.current&&uid===getSessionUserId()&&epoch===getSessionEpoch();
    try{const result=await api.getAs<CallReadiness>(uid,"/calls/status");if(current())setStatus(result);}
    catch{if(current())setError("We couldn't check calling right now. Reconnect and try again.");}
    finally{if(current())setChecking(false);}
  },[uid,restoring]);
  useFocusEffect(useCallback(()=>{
    visible.current=true;setStatus(null);setChecking(false);setTesting(false);setError("");setMicrophone("Not checked");void refresh();
    return()=>{visible.current=false;revision.current++;};
  },[refresh]));
  const webAudio=Platform.OS==="web"&&typeof navigator!=="undefined"&&!!navigator.mediaDevices?.getUserMedia;
  async function microphoneCheck(){
    if(!webAudio||!uid||restoring||testing||checking)return;
    const attempt=++revision.current,epoch=getSessionEpoch();setTesting(true);setMicrophone("Checking permission…");
    const current=()=>visible.current&&attempt===revision.current&&uid===getSessionUserId()&&epoch===getSessionEpoch();
    try{
      const allowed=await checkMicrophoneAccess(()=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}),current);
      if(allowed)setMicrophone("Microphone access allowed");
    }catch(failure){if(current())setMicrophone(failure instanceof Error&&failure.name==="NotAllowedError"?"Permission blocked. Allow microphone access in this site's settings.":"No usable microphone was found. Check your device and try again.");}
    finally{if(current())setTesting(false);}
  }
  const body={fontFamily:f.body,color:c.textSecondary,fontSize:15,lineHeight:23};
  return <SafeAreaView edges={["top","bottom"]} style={{flex:1,backgroundColor:c.bg}}>
    <ScrollView contentContainerStyle={{padding:24,gap:20,maxWidth:layout.readingMaxWidth,width:"100%",alignSelf:"center"}}>
      <View style={{alignSelf:"flex-start"}}><IconButton label="Back" icon="arrow-back" quiet onPress={()=>router.back()}/></View>
      <View style={{width:64,height:64,borderRadius:24,backgroundColor:c.primaryBgSubtle,alignItems:"center",justifyContent:"center"}}><Ionicons name="call-outline" size={29} color={c.primaryDark}/></View>
      <Text accessibilityRole="header" style={[typography.title,{fontFamily:f.heading,color:c.text}]}>Calls</Text>
      <Text style={body}>Clear audio starts with a secure connection and a microphone that’s ready.</Text>
      <View testID="call-readiness" style={{backgroundColor:c.surface,borderRadius:24,padding:20,gap:16}}>
        <Text style={{fontFamily:f.heading,fontSize:23,lineHeight:29,color:c.text}}>Before the first hello</Text>
        {restoring?<Text style={body}>Reconnecting securely. We’ll check calling when your account is ready.</Text>:checking&&!status?<ActivityIndicator color={c.primary}/>:status?callReadinessRows(status,CALLS_ENABLED).map(row=><View key={row.label} style={{flexDirection:"row",gap:16,alignItems:"flex-start"}}><Text style={{...body,flex:1}}>{row.label}</Text><Text style={{...body,flex:1,color:c.text,textAlign:"right",fontFamily:f.bodyMedium}}>{row.value}</Text></View>):null}
        <Text style={body}>Calls stay off until service setup and a real two-phone audio check are complete. A saved setup alone does not prove that sound reaches both people.</Text>
        {error?<Text accessibilityRole="alert" style={{...body,color:c.text}}>{error}</Text>:null}
        <Pressable accessibilityRole="button" accessibilityLabel="Check calling setup" disabled={restoring||checking||testing} onPress={()=>void refresh()} style={{minHeight:48,borderRadius:14,borderWidth:1,borderColor:c.border,alignItems:"center",justifyContent:"center"}}><Text style={{fontFamily:f.bodyMedium,color:c.primaryDark}}>{checking?"Checking…":"Check again"}</Text></Pressable>
      </View>
      <View style={{backgroundColor:c.surface,borderRadius:24,padding:20,gap:14}}>
        <Text style={{fontFamily:f.bodyBold,fontSize:18,color:c.text}}>Your microphone</Text>
        <Text style={body}>{webAudio?microphone:"Use KUKU in Chrome for the first audio-call checks. Installed-app calling is still being prepared."}</Text>
        {webAudio?<Pressable accessibilityRole="button" accessibilityLabel="Check microphone access" disabled={restoring||testing||checking} onPress={()=>void microphoneCheck()} style={{minHeight:50,borderRadius:14,backgroundColor:c.text,justifyContent:"center",alignItems:"center"}}>{testing?<ActivityIndicator color={c.bg}/>:<Text style={{fontFamily:f.bodyMedium,color:c.bg}}>Check microphone access</Text>}</Pressable>:null}
        <Text style={{...body,fontSize:12,lineHeight:19}}>This asks for permission, then immediately releases the microphone. It does not record, send audio or place a call.</Text>
      </View>
      <Text style={body}>Call audio uses encrypted transport. End-to-end encryption is not configured. During a call, KUKU distinguishes your signal, the other person’s signal, a muted microphone and audio that needs a tap to play.</Text>
    </ScrollView>
  </SafeAreaView>;
}
