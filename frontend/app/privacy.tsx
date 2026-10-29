import React, {useCallback, useEffect, useState} from 'react';
import {View, Text, Pressable, ScrollView, TextInput} from 'react-native';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {api} from '../src/api';
import {useTheme} from '../src/ThemeContext';
export default function Privacy() {
  const {c}=useTheme();const router=useRouter();
  const {contact}=useLocalSearchParams<{contact?:string}>();
  const [blocks,setBlocks]=useState<{id:string;name:string}[]>([]);
  const [reason,setReason]=useState<'spam'|'harassment'|'other'>('other');
  const [note,setNote]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>setBlocks(await api.get('/blocks')),[]);
  useEffect(()=>{void load().catch(()=>setMessage('Could not load blocked contacts.'));},[load]);
  async function act(action:()=>Promise<unknown>,success:string){setBusy(true);try{await action();await load();setMessage(success);}catch(e){setMessage(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
  const isBlocked=blocks.some(b=>b.id===contact);
  return <ScrollView style={{flex:1,backgroundColor:c.bg}} contentContainerStyle={{padding:28,paddingTop:70,gap:20}}>
    <Pressable onPress={()=>router.back()}><Text style={{color:c.primary}}>Back</Text></Pressable>
    <Text style={{color:c.text,fontSize:28}}>Privacy & contacts</Text>
    <Text style={{color:c.text}}>Blocking stops new direct messages, uploads and alerts in both directions. Existing history stays available. Shared Spaces remain shared. KUKU is not end-to-end encrypted.</Text>
    {contact ? <View style={{gap:16}}>
      <Pressable disabled={busy} onPress={()=>act(()=>isBlocked?api.delete('/blocks/'+contact):api.post('/blocks/'+contact),isBlocked?'Contact unblocked.':'Contact blocked.')}><Text style={{color:c.primary}}>{isBlocked?'Unblock this contact':'Block this contact'}</Text></Pressable>
      <Text style={{color:c.text,fontSize:20}}>Report this contact</Text>
      <Text style={{color:c.textSecondary}}>Reports are stored privately for the app operator.</Text>
      <View style={{flexDirection:'row',gap:20}}>{(['spam','harassment','other'] as const).map(r=><Pressable key={r} accessibilityRole="radio" accessibilityState={{checked:r===reason}} onPress={()=>setReason(r)}><Text style={{color:r===reason?c.primary:c.text}}>{r}</Text></Pressable>)}</View>
      <TextInput accessibilityLabel="Report details" placeholder="Optional details" value={note} onChangeText={setNote} maxLength={1000} multiline style={{padding:14,borderWidth:1,borderColor:c.border,color:c.text}}/>
      <Pressable disabled={busy} onPress={()=>act(()=>api.post('/reports',{target_id:contact,reason,note}),'Report saved.')}><Text style={{color:c.primary}}>Submit report</Text></Pressable>
    </View>:null}
    <Text style={{color:c.text,fontSize:20}}>Blocked contacts</Text>
    {!blocks.length?<Text style={{color:c.textSecondary}}>No blocked contacts.</Text>:blocks.map(b=><View key={b.id} style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{color:c.text}}>{b.name}</Text><Pressable disabled={busy} accessibilityLabel={'Unblock '+b.name} onPress={()=>act(()=>api.delete('/blocks/'+b.id),'Contact unblocked.')}><Text style={{color:c.primary}}>Unblock</Text></Pressable></View>)}
    <Text accessibilityRole="alert" style={{color:c.text}}>{message}</Text>
  </ScrollView>;
}
