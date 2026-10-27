import React, {useState} from "react";
import {View,Text,TextInput,Pressable} from "react-native";
import {useRouter} from "expo-router";
import {api} from "../src/api";
import {useTheme} from "../src/ThemeContext";
export default function Recover() {
  const {c}=useTheme();const router=useRouter();
  const [email,setEmail]=useState("");const [code,setCode]=useState("");const [password,setPassword]=useState("");
  const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  async function run(reset:boolean){setBusy(true);try{
    await api.post(reset?"/auth/reset-password":"/auth/forgot-password",reset?{email:email.trim(),code:code.trim(),password}:{email:email.trim()});
    setMessage(reset?"Password changed. Sign in with your new password.":"If this account exists, a code has been sent. Check your inbox.");
  }catch(e){setMessage(e instanceof Error?e.message:"Please try again.");}finally{setBusy(false);}}
  const input={padding:14,borderWidth:1,borderColor:c.border,color:c.text};
  return <View style={{flex:1,padding:28,paddingTop:70,backgroundColor:c.bg,gap:20}}>
    <Pressable onPress={()=>router.replace("/login")}><Text style={{color:c.primary}}>Back to sign in</Text></Pressable>
    <Text style={{fontSize:28,color:c.text}}>Reset password</Text>
    <TextInput style={input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" accessibilityLabel="Account email"/>
    <Pressable disabled={busy} onPress={()=>run(false)}><Text style={{color:c.primary}}>Send reset code</Text></Pressable>
    <TextInput style={input} value={code} onChangeText={setCode} autoCapitalize="none" placeholder="Code from email" accessibilityLabel="Reset code"/>
    <TextInput style={input} value={password} onChangeText={setPassword} secureTextEntry placeholder="New password (12+ characters)" accessibilityLabel="New password"/>
    <Pressable disabled={busy} onPress={()=>run(true)}><Text style={{color:c.primary}}>Change password</Text></Pressable>
    <Text accessibilityRole="alert" style={{color:c.text}}>{message}</Text>
  </View>;
}
