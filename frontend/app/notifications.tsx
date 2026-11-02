import React,{useEffect,useState} from "react";
import {View,Text,Pressable,ScrollView,ActivityIndicator,Platform} from "react-native";
import {Ionicons} from "@expo/vector-icons";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter} from "expo-router";
import {useAuth} from "../src/AuthContext";
import {useTheme} from "../src/ThemeContext";
import {PUSH_AVAILABLE,enableNotifications,disableNotifications} from "../src/notifications";
import NotificationSoundSettings from "../src/NotificationSoundSettings";
export default function NotificationsScreen(){
  const {c,f}=useTheme();const {user}=useAuth();const router=useRouter();
  const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const [enabled,setEnabled]=useState(false);
  useEffect(()=>{
    let active=true;
    if(Platform.OS==="web" && PUSH_AVAILABLE)void navigator.serviceWorker.getRegistration().then(async registration=>{
      const subscription=await registration?.pushManager.getSubscription();
      if(active)setEnabled(Notification.permission==="granted" && !!subscription);
    }).catch(()=>{});
    return()=>{active=false;};
  },[]);
  async function change(on:boolean){if(!user)return;setBusy(true);setMessage("");try{
    if(on)await enableNotifications(user.id);else await disableNotifications(user.id);
    setEnabled(on);setMessage(on?"You’re all set. New messages can now reach this device.":"Notifications turned off on this device.");
  }catch(e){setMessage(e instanceof Error?e.message:"Please try again.");}finally{setBusy(false);}}
  return <SafeAreaView edges={["top","bottom"]} style={{flex:1,backgroundColor:c.bg}}><ScrollView contentContainerStyle={{padding:24,gap:22,maxWidth:560,width:"100%",alignSelf:"center"}}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={()=>router.back()} style={{minHeight:44,justifyContent:"center"}}><Ionicons name="arrow-back" size={24} color={c.text}/></Pressable>
    <View style={{width:68,height:68,borderRadius:24,backgroundColor:c.surface,alignItems:"center",justifyContent:"center"}}><Ionicons name="notifications-outline" size={30} color={c.primary}/></View>
    <Text style={{fontFamily:f.heading,fontSize:34,color:c.text}}>Stay a little closer.</Text>
    <Text style={{fontFamily:f.body,fontSize:16,lineHeight:25,color:c.textSecondary}}>A gentle heads-up when someone sends you a message—even while you’re away from KUKU.</Text>
    <View style={{padding:20,gap:14,borderRadius:24,backgroundColor:c.surface}}>
      <Text style={{fontFamily:f.bodyBold,fontSize:17,color:c.text}}>{enabled?"Notifications allowed on this device":"Let your messages find you"}</Text>
      <Text style={{fontFamily:f.body,lineHeight:22,color:c.textSecondary}}>Alerts say “You have a new message.” Your conversation and filenames stay private.</Text>
      {PUSH_AVAILABLE?<><Pressable accessibilityRole="button" disabled={busy} onPress={()=>void change(true)} testID="enable-notifications" style={{minHeight:52,padding:16,borderRadius:16,backgroundColor:c.primary,alignItems:"center",opacity:busy?0.6:1}}>{busy?<ActivityIndicator color={c.textInverse}/>:<Text style={{fontFamily:f.bodyBold,color:c.textInverse}}>{enabled?"Reconnect notifications":"Enable notifications"}</Text>}</Pressable>
      {enabled?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void change(false)} style={{minHeight:44,alignItems:"center",justifyContent:"center"}}><Text style={{color:c.textSecondary}}>Turn off on this device</Text></Pressable>:null}</>:<Text style={{color:c.textSecondary,lineHeight:22}}>On Android, open this KUKU link in Chrome. An embedded browser may not support notifications.</Text>}
    </View>
    <Text accessibilityRole="alert" style={{fontFamily:f.body,color:c.text,lineHeight:22}}>{message}</Text>
    <NotificationSoundSettings/>
    {Platform.OS==="web"?<Text style={{fontFamily:f.body,color:c.textSecondary,lineHeight:23}}>On Android: tap Enable, then choose Allow in Chrome. You can also use Chrome’s ⋮ menu → Add to Home screen for an app shortcut. If alerts stay silent, check Chrome’s site notifications and Android’s notification settings.</Text>:null}
  </ScrollView></SafeAreaView>;
}
