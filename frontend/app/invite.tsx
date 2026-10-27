import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Share } from "react-native";
import { useRouter } from "expo-router";
import { api } from "../src/api";
import { useTheme } from "../src/ThemeContext";
export default function InviteScreen() {
  const {c} = useTheme(); const router = useRouter();
  const [email,setEmail] = useState(""); const [code,setCode] = useState("");
  const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  return <View style={{flex:1,padding:28,paddingTop:70,backgroundColor:c.bg,gap:20}}>
    <Pressable onPress={() => router.back()}><Text style={{color:c.primary}}>Back</Text></Pressable>
    <Text style={{fontSize:28,color:c.text}}>Invite someone</Text>
    <Text style={{color:c.text}}>Your invitation works only for this email and expires in seven days. Share the code privately.</Text>
    <TextInput accessibilityLabel="Invitation email" placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={{padding:16,borderWidth:1,borderColor:c.border,color:c.text}} />
    <Pressable disabled={busy} onPress={async () => {setBusy(true);setError("");setCode("");try {
      const data=await api.post<{invite_token:string}>("/invites",{email:email.trim()});setCode(data.invite_token);
    } catch(e){setError(e instanceof Error?e.message:"Could not create invitation");}finally{setBusy(false);}}}>
      <Text style={{color:c.primary}}>{busy?"Creating…":"Create invitation"}</Text>
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={{color:c.error}}>{error}</Text>:null}
    {code ? <><Text selectable style={{color:c.text}}>{code}</Text><Pressable onPress={() => Share.share({message:"Join me on KUKU using "+email+" and this invitation code: "+code})}><Text style={{color:c.primary}}>Share invitation</Text></Pressable></>:null}
  </View>;
}
