import React,{useCallback,useRef,useState} from "react";
import {View,Text,Pressable,Platform,ActivityIndicator} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import {useAuth} from "./AuthContext";
import {useTheme} from "./ThemeContext";
import {useFocusEffect} from "expo-router";
import {getSessionEpoch,getSessionUserId} from "./api";
import {DEFAULT_SOUND,SOUND_CHOICES,SoundId,SoundSettings,CustomSound,readSound,saveSound,playMessageSound,stopMessageSound,readCustomSound,prepareCustomSound,saveCustomSound,removeCustomSound} from "./messageSounds";

export default function NotificationSoundSettings(){
  const {user,restoring}=useAuth(),{c,f}=useTheme();const [value,setValue]=useState<SoundSettings>(DEFAULT_SOUND);
  const [custom,setCustom]=useState<CustomSound|null>(null),[busy,setBusy]=useState(false);
  const [ready,setReady]=useState(false),[message,setMessage]=useState("");const revision=useRef(0);
  const input=useRef<HTMLInputElement>(null);
  useFocusEffect(useCallback(()=>{
    let active=true;
    const uid=user?.id,epoch=getSessionEpoch(),version=++revision.current;
    const current=()=>active&&version===revision.current&&uid===getSessionUserId()&&epoch===getSessionEpoch();
    setReady(false);setMessage("");setBusy(false);setCustom(null);setValue(DEFAULT_SOUND);
    if(uid&&!restoring&&current())void Promise.all([readSound(uid),readCustomSound(uid)]).then(([next,clip])=>{
      if(current()){setValue(next);setCustom(clip);setReady(true);}
    }).catch(()=>{if(current())setMessage("Could not load sound settings. Please reopen this page.");});
    return()=>{active=false;revision.current++;stopMessageSound();};
  },[user?.id,restoring]));
  if(Platform.OS!=="web")return null;
  const disabled=!ready||busy||restoring;
  function preview(sound:SoundId,volume=value.volume){
    const version=revision.current;
    void playMessageSound({sound,volume},true,user?.id).catch(error=>{
      if(version===revision.current)setMessage(error instanceof Error?error.message:"Could not preview this sound.");
    });
  }
  async function change(next:SoundSettings){
    if(!user||disabled)return;
    const version=++revision.current;const previous=value;setValue(next);setMessage("");setBusy(true);
    preview(next.sound,next.volume);
    try{await saveSound(user.id,next);if(version===revision.current)setMessage(next.sound==="silent"?"Silent mode saved on this device.":"Sound saved on this device.");}
    catch{if(version===revision.current){setValue(previous);setMessage("Could not save this sound. Please try again.");}}
    finally{if(version===revision.current)setBusy(false);}
  }
  async function importWav(file:File){
    if(!user||disabled)return;
    const uid=user.id,epoch=getSessionEpoch(),version=++revision.current;
    const current=()=>version===revision.current&&uid===getSessionUserId()&&epoch===getSessionEpoch();
    setBusy(true);setMessage("Preparing your sound…");
    try{
      const clip=await prepareCustomSound(file);if(!current())return;
      await saveCustomSound(uid,clip);if(!current())return;
      setCustom(clip);
      const next={...value,sound:"custom" as const};
      // Replacing an already-selected clip needs only the successful clip write.
      // If selection fails, keep the previous tone and explain the saved clip.
      if(value.sound!=="custom"){
        try{await saveSound(uid,next);}catch{
          if(current())setMessage("Your WAV was saved. Choose My WAV to select it, or keep your current sound.");
          return;
        }
      }
      if(!current())return;
      setValue(next);setMessage("Your WAV is ready. Volume balanced and saved only on this device.");
      preview("custom",next.volume);
    }catch(error){if(current())setMessage(error instanceof Error?error.message:"Could not import this WAV. Try a shorter file.");}
    finally{if(current())setBusy(false);}
  }
  async function removeWav(){
    if(!user||disabled)return;
    const version=++revision.current;setBusy(true);stopMessageSound();
    try{
      if(value.sound==="custom"){
        const next={...value,sound:"bell" as const};await saveSound(user.id,next);
        if(version!==revision.current)return;setValue(next);
      }
      await removeCustomSound(user.id);
      if(version===revision.current){setCustom(null);setMessage("Imported sound removed from this account on this device.");}
    }catch{if(version===revision.current)setMessage("Could not remove the imported sound. Please try again.");}
    finally{if(version===revision.current)setBusy(false);}
  }
  const choices=[...SOUND_CHOICES,...(custom?[{id:"custom" as const,label:"My WAV",description:`${custom.name} · ${custom.duration.toFixed(1)} sec`}]:[])];
  return <View style={{padding:20,gap:16,borderRadius:24,backgroundColor:c.surface}} testID="notification-sound-settings">
    <View style={{flexDirection:"row",alignItems:"center",gap:10}}><Ionicons name="musical-notes-outline" size={22} color={c.primary}/><Text style={{flex:1,fontFamily:f.bodyBold,fontSize:18,lineHeight:24,color:c.text}}>Make it your sound</Text></View>
    <Text style={{fontFamily:f.body,lineHeight:22,color:c.textSecondary}}>Message sounds while KUKU is open. Choose a gentle note or something easier to hear.</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Message sound" style={{gap:8}}>
      {choices.map(choice=><View key={choice.id} style={{flexDirection:"row",alignItems:"center",borderRadius:18,borderWidth:1,borderColor:value.sound===choice.id?c.primary:c.border,backgroundColor:value.sound===choice.id?c.primaryBgSubtle:c.bg}}>
        <Pressable disabled={disabled} accessibilityRole="radio" accessibilityState={{checked:value.sound===choice.id,disabled}} aria-checked={value.sound===choice.id} accessibilityLabel={choice.label+" message sound"} onPress={()=>void change({...value,sound:choice.id})} style={{flex:1,minHeight:66,padding:12,flexDirection:"row",alignItems:"center",gap:10}}>
          <Ionicons name={value.sound===choice.id?"radio-button-on":"radio-button-off"} size={20} color={value.sound===choice.id?c.primary:c.textSecondary}/>
          <View style={{flex:1}}><Text style={{fontFamily:f.bodyMedium,fontSize:15,color:c.text}}>{choice.label}</Text><Text numberOfLines={2} style={{fontFamily:f.body,fontSize:12,lineHeight:18,color:c.textSecondary}}>{choice.description}</Text></View>
        </Pressable>
        {choice.id!=="silent"?<Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={"Preview "+choice.label} onPress={()=>preview(choice.id)} style={{width:48,minHeight:48,alignItems:"center",justifyContent:"center",marginRight:4}}><Ionicons name="play-circle-outline" size={28} color={c.primary}/></Pressable>:null}
      </View>)}
    </View>
    {React.createElement("input",{ref:input,type:"file",accept:".wav,audio/wav,audio/x-wav","data-testid":"notification-wav-input",style:{display:"none"},onChange:(event:React.ChangeEvent<HTMLInputElement>)=>{const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)void importWav(file);}})}
    <View style={{gap:8}}>
      <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={custom?"Replace imported WAV":"Import a WAV sound"} onPress={()=>input.current?.click()} style={{minHeight:50,padding:12,gap:8,flexDirection:"row",alignItems:"center",justifyContent:"center",borderRadius:16,borderWidth:1,borderColor:c.border,opacity:disabled?0.6:1}}>
        {busy?<ActivityIndicator size="small" color={c.primary}/>:<Ionicons name="cloud-upload-outline" size={22} color={c.primary}/>}
        <Text style={{fontFamily:f.bodyMedium,color:c.text}}>{custom?"Replace my WAV":"Import a WAV sound"}</Text>
      </Pressable>
      <Text style={{fontFamily:f.body,fontSize:12,lineHeight:19,color:c.textSecondary}}>Up to 5 seconds · 1 MB · mono or stereo. Quiet files are boosted with headroom to avoid clipping. Your audio stays on this device.</Text>
      {custom?<Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel="Remove imported WAV" onPress={()=>void removeWav()} style={{minHeight:44,justifyContent:"center",alignItems:"center"}}><Text style={{fontFamily:f.bodyMedium,color:c.textSecondary}}>Remove my WAV</Text></Pressable>:null}
    </View>
    <Text style={{fontFamily:f.bodyBold,color:c.text}}>Volume</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Message sound volume" style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>{[{label:"Low",volume:0.25},{label:"Medium",volume:0.5},{label:"High",volume:0.85},{label:"Maximum",volume:1}].map(option=><Pressable key={option.label} disabled={disabled} accessibilityRole="radio" accessibilityLabel={option.label+" message volume"} accessibilityState={{checked:value.volume===option.volume,disabled}} aria-checked={value.volume===option.volume} onPress={()=>void change({...value,volume:option.volume})} style={{flexGrow:1,flexBasis:"40%",minHeight:46,paddingHorizontal:10,alignItems:"center",justifyContent:"center",borderRadius:14,backgroundColor:value.volume===option.volume?c.primary:c.bg}}><Text style={{fontFamily:f.bodyMedium,color:value.volume===option.volume?c.textInverse:c.text}}>{option.label}</Text></Pressable>)}</View>
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{fontFamily:f.body,color:c.text,lineHeight:20}}>{message}</Text>
    <Text style={{fontFamily:f.body,fontSize:12,lineHeight:19,color:c.textSecondary}}>Turn up your phone’s media volume for these sounds. Background and lock-screen alerts use Android/Chrome’s notification sound and volume; imported WAVs cannot replace those browser alerts. Long-press a KUKU notification to open its sound settings. Preferences are saved per account on this device.</Text>
  </View>;
}
