import React,{useState} from "react";
import {ActivityIndicator,Modal,Pressable,ScrollView,Text,View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {Ionicons} from "@expo/vector-icons";
import {EMOTES,Emote} from "./emotes";
import EmoteImage from "./EmoteImage";
import {useTheme} from "./ThemeContext";
export default function EmotePicker({onClose,onSend}:{onClose:()=>void;onSend:(id:string)=>Promise<boolean>}){
  const {c,f}=useTheme();const [chosen,setChosen]=useState<Emote|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const button={minHeight:44,minWidth:44,alignItems:"center" as const,justifyContent:"center" as const,borderRadius:16,padding:12};
  async function send(){if(!chosen||busy)return;setBusy(true);setError("");try{if(await onSend(chosen.id))onClose();else setError("Couldn't queue your emote. Try again.");}catch{setError("Couldn't queue your emote. Try again.");}finally{setBusy(false);}}
  return <Modal visible transparent animationType="fade" onRequestClose={()=>{if(!busy)onClose();}}>
    <View style={{flex:1,backgroundColor:"rgba(0,0,0,0.35)",justifyContent:"flex-end",alignItems:"center"}}>
      <SafeAreaView edges={["bottom"]} style={{width:"100%",maxWidth:520,maxHeight:"88%",backgroundColor:c.bg,borderTopLeftRadius:28,borderTopRightRadius:28,padding:20}} testID="emote-picker">
        <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:12}}><Text style={{fontFamily:f.heading,fontSize:24,color:c.text}}>A little feeling</Text><Pressable accessibilityRole="button" accessibilityLabel="Close emotes" disabled={busy} onPress={onClose} style={button}><Ionicons name="close" size={24} color={c.text}/></Pressable></View>
        {chosen?<View style={{alignItems:"center",gap:10,paddingVertical:8}}><EmoteImage key={chosen.id} emote={chosen} size={144} autoPlay/><Text style={{fontFamily:f.bodyMedium,color:c.text}}>{chosen.label}</Text></View>:<Text style={{fontFamily:f.body,color:c.textSecondary,lineHeight:21,marginBottom:12}}>Choose one, then send it.</Text>}
        <ScrollView contentContainerStyle={{flexDirection:"row",flexWrap:"wrap",justifyContent:"center",gap:8,paddingVertical:8}} style={{maxHeight:290}}>
          {EMOTES.map(emote=><View key={emote.id} style={{borderRadius:18,padding:6,backgroundColor:chosen?.id===emote.id?c.surfaceElevated:"transparent"}}><EmoteImage emote={emote} size={66} selected={chosen?.id===emote.id} onPress={()=>{if(!busy)setChosen(emote);}}/></View>)}
        </ScrollView>
        {error?<Text accessibilityRole="alert" style={{color:c.error,marginVertical:8}}>{error}</Text>:null}
        <View style={{flexDirection:"row",gap:12,marginTop:12}}><Pressable accessibilityRole="button" accessibilityLabel="Cancel emote" disabled={busy} onPress={onClose} style={{...button,flex:1,backgroundColor:c.surface}}><Text style={{fontFamily:f.bodyMedium,color:c.text}}>Cancel</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Send emote" disabled={!chosen||busy} onPress={()=>void send()} style={{...button,flex:1,backgroundColor:c.primary,opacity:(!chosen||busy)?0.5:1}}>{busy?<ActivityIndicator color={c.textInverse}/>:<Text style={{fontFamily:f.bodyBold,color:c.textInverse}}>Send emote</Text>}</Pressable></View>
      </SafeAreaView>
    </View>
  </Modal>;
}
