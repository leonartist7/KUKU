import React,{useEffect,useRef,useState} from "react";
import {View,Text,Pressable,Platform} from "react-native";
import {Ionicons} from "@expo/vector-icons";
import {useAuth} from "./AuthContext";
import {useTheme} from "./ThemeContext";
import {DEFAULT_SOUND,SOUND_CHOICES,SoundId,SoundSettings,readSound,saveSound,playMessageSound,stopMessageSound} from "./messageSounds";

export default function NotificationSoundSettings(){
  const {user}=useAuth(),{c,f}=useTheme();const [value,setValue]=useState<SoundSettings>(DEFAULT_SOUND);
  const [ready,setReady]=useState(false),[message,setMessage]=useState("");const revision=useRef(0);
  useEffect(()=>{
    let active=true;setReady(false);setMessage("");
    if(user)void readSound(user.id).then(next=>{if(active){setValue(next);setReady(true);}}).catch(()=>{if(active)setMessage("Could not load sound settings. Please reopen this page.");});
    return()=>{active=false;revision.current++;stopMessageSound();};
  },[user?.id]);
  if(Platform.OS!=="web")return null;
  function preview(sound:SoundId,volume=value.volume){void playMessageSound({sound,volume},true).catch(error=>setMessage(error instanceof Error?error.message:"Could not preview this sound."));}
  async function change(next:SoundSettings){
    if(!user || !ready)return;
    const version=++revision.current;const previous=value;setValue(next);setMessage("");
    preview(next.sound,next.volume);
    try{await saveSound(user.id,next);if(version===revision.current)setMessage(next.sound==="silent"?"Silent mode saved on this device.":"Sound saved on this device.");}
    catch{if(version===revision.current){setValue(previous);setMessage("Could not save this sound. Please try again.");}}
  }
  return <View style={{padding:20,gap:14,borderRadius:24,backgroundColor:c.surface}} testID="notification-sound-settings">
    <View style={{flexDirection:"row",alignItems:"center",gap:10}}><Ionicons name="musical-notes-outline" size={22} color={c.primary}/><Text style={{flex:1,fontFamily:f.bodyBold,fontSize:18,lineHeight:24,color:c.text}}>A sound that feels like you</Text></View>
    <Text style={{fontFamily:f.body,lineHeight:22,color:c.textSecondary}}>Choose your message sound while KUKU is open. Tap a play button to listen.</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Message sound" style={{gap:8}}>
      {SOUND_CHOICES.map(choice=><View key={choice.id} style={{flexDirection:"row",alignItems:"center",borderRadius:18,borderWidth:1,borderColor:value.sound===choice.id?c.primary:c.border,backgroundColor:value.sound===choice.id?c.primaryBgSubtle:c.bg}}>
        <Pressable disabled={!ready} accessibilityRole="radio" accessibilityState={{checked:value.sound===choice.id}} accessibilityLabel={choice.label+" message sound"} onPress={()=>void change({...value,sound:choice.id})} style={{flex:1,minHeight:66,padding:12,flexDirection:"row",alignItems:"center",gap:10}}>
          <Ionicons name={value.sound===choice.id?"radio-button-on":"radio-button-off"} size={20} color={value.sound===choice.id?c.primary:c.textSecondary}/>
          <View style={{flex:1}}><Text style={{fontFamily:f.bodyMedium,fontSize:15,color:c.text}}>{choice.label}</Text><Text style={{fontFamily:f.body,fontSize:12,lineHeight:18,color:c.textSecondary}}>{choice.description}</Text></View>
        </Pressable>
        {choice.id!=="silent"?<Pressable disabled={!ready} accessibilityRole="button" accessibilityLabel={"Preview "+choice.label} onPress={()=>preview(choice.id)} style={{width:48,minHeight:48,alignItems:"center",justifyContent:"center",marginRight:4}}><Ionicons name="play-circle-outline" size={28} color={c.primary}/></Pressable>:null}
      </View>)}
    </View>
    <Text style={{fontFamily:f.bodyBold,color:c.text}}>Volume</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Message sound volume" style={{flexDirection:"row",gap:8}}>{[{label:"Low",volume:0.25},{label:"Medium",volume:0.5},{label:"High",volume:0.85}].map(option=><Pressable key={option.label} disabled={!ready} accessibilityRole="radio" accessibilityLabel={option.label+" message volume"} accessibilityState={{checked:value.volume===option.volume}} onPress={()=>void change({...value,volume:option.volume})} style={{flex:1,minHeight:44,alignItems:"center",justifyContent:"center",borderRadius:14,backgroundColor:value.volume===option.volume?c.primary:c.bg}}><Text style={{fontFamily:f.bodyMedium,color:value.volume===option.volume?c.textInverse:c.text}}>{option.label}</Text></Pressable>)}</View>
    <Text accessibilityRole="alert" style={{fontFamily:f.body,color:c.text,lineHeight:20}}>{message}</Text>
    <Text style={{fontFamily:f.body,fontSize:12,lineHeight:19,color:c.textSecondary}}>Background and lock-screen sounds use Android's notification settings. To change those, long-press a KUKU notification on your phone and open its settings. These choices are saved for this account on this device.</Text>
  </View>;
}
