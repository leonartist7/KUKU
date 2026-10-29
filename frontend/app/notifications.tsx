import React,{useState} from "react";
import {View,Text,Pressable} from "react-native";
import {useRouter} from "expo-router";
import {useAuth} from "../src/AuthContext";
import {useTheme} from "../src/ThemeContext";
import {PUSH_AVAILABLE,enableNotifications,disableNotifications} from "../src/notifications";
export default function NotificationsScreen(){
  const {c}=useTheme();const {user}=useAuth();const router=useRouter();
  const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  async function change(on:boolean){if(!user)return;setBusy(true);try{
    if(on)await enableNotifications(user.id);else await disableNotifications(user.id);
    setMessage(on?"Message notifications enabled on this device.":"Message notifications disabled on this device.");
  }catch(e){setMessage(e instanceof Error?e.message:"Please try again.");}finally{setBusy(false);}}
  return <View style={{flex:1,padding:28,paddingTop:70,gap:24,backgroundColor:c.bg}}>
    <Pressable onPress={()=>router.back()}><Text style={{color:c.primary}}>Back</Text></Pressable>
    <Text style={{fontSize:28,color:c.text}}>Notifications</Text>
    <Text style={{color:c.text}}>Alerts say “You have a new message.” Message text and filenames stay out of notification previews.</Text>
    {PUSH_AVAILABLE?<><Pressable disabled={busy} onPress={()=>change(true)}><Text style={{color:c.primary}}>Enable on this device</Text></Pressable><Pressable disabled={busy} onPress={()=>change(false)}><Text style={{color:c.primary}}>Disable on this device</Text></Pressable></>:<Text style={{color:c.textSecondary}}>Notifications are not available in this build.</Text>}
    <Text accessibilityRole="alert" style={{color:c.text}}>{message}</Text>
  </View>;
}
