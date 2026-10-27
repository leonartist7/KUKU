import React, {useState} from "react";
import {View,Text,TextInput,Pressable} from "react-native";
import {useRouter} from "expo-router";
import {useAuth} from "../src/AuthContext";
import {api} from "../src/api";
import {useTheme} from "../src/ThemeContext";
export default function Verify() {
  const {c}=useTheme();const {user,refresh,signOut}=useAuth();const router=useRouter();
  const [code,setCode]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  async function run(confirm:boolean){setBusy(true);try{
    await api.post(confirm?"/auth/verify":"/auth/verification",confirm?{email:user?.email,code:code.trim()}:{});
    if(confirm){await refresh();router.replace("/");}
    else setMessage("Check your inbox for a code. It expires in 15 minutes.");
  }catch(e){setMessage(e instanceof Error?e.message:"Please try again.");}finally{setBusy(false);}}
  return <View style={{flex:1,padding:28,paddingTop:70,backgroundColor:c.bg,gap:20}}>
    <Text style={{fontSize:28,color:c.text}}>Verify your email</Text>
    <Text style={{color:c.text}}>Confirm {user?.email} to start chatting and sharing files.</Text>
    <Pressable disabled={busy} onPress={()=>run(false)}><Text style={{color:c.primary}}>Send verification code</Text></Pressable>
    <TextInput style={{padding:14,borderWidth:1,borderColor:c.border,color:c.text}} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} placeholder="Code from email" accessibilityLabel="Verification code"/>
    <Pressable disabled={busy} onPress={()=>run(true)}><Text style={{color:c.primary}}>Verify and continue</Text></Pressable>
    <Text accessibilityRole="alert" style={{color:c.text}}>{message}</Text>
    <Pressable disabled={busy} onPress={async()=>{try{await signOut();}catch{setMessage("Could not sign out. Check your connection.");}}}><Text style={{color:c.primary}}>Sign out</Text></Pressable>
  </View>;
}
