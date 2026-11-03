import React,{useEffect,useState} from "react";
import {Linking,Pressable,ScrollView,Text,View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {useTheme} from "../src/ThemeContext";
import {assetOrigin} from "../src/EmoteImage";
export default function Credits(){
  const {c,f}=useTheme(),router=useRouter();const [license,setLicense]=useState("");
  useEffect(()=>{let active=true;void fetch(assetOrigin+"/emotes/LICENSE.txt").then(r=>{if(!r.ok)throw Error();return r.text();}).then(text=>{if(active)setLicense(text);}).catch(()=>{if(active)setLicense("Open the original license below to read the full notice.");});return()=>{active=false;};},[]);
  return <SafeAreaView edges={["top","bottom"]} style={{flex:1,backgroundColor:c.bg}}><View style={{flexDirection:"row",alignItems:"center",padding:16,gap:16}}><Pressable accessibilityRole="button" accessibilityLabel="Back from credits" onPress={()=>router.back()} style={{minHeight:44,minWidth:44,justifyContent:"center"}}><Ionicons name="chevron-back" size={24} color={c.text}/></Pressable><Text style={{fontFamily:f.heading,fontSize:26,color:c.text}}>Credits</Text></View><ScrollView contentContainerStyle={{padding:24,gap:16,maxWidth:760}}><Text style={{fontFamily:f.bodyBold,fontSize:18,color:c.text}}>A little feeling, by Microsoft</Text><Text style={{fontFamily:f.body,color:c.textSecondary,lineHeight:24}}>KUKU's animated emotes use Microsoft Fluent Emoji Animated, under the MIT license. The original artwork has been resized and converted to transparent WebP animations, with still PNG previews.</Text><Pressable accessibilityRole="link" onPress={()=>void Linking.openURL("https://github.com/microsoft/fluentui-emoji-animated")}><Text style={{color:c.primary,fontFamily:f.bodyMedium,paddingVertical:10}}>View the original collection ↗</Text></Pressable><Text selectable style={{fontFamily:f.body,color:c.textSecondary,lineHeight:23}}>{license||"Loading license…"}</Text><Pressable accessibilityRole="link" onPress={()=>void Linking.openURL("https://github.com/microsoft/fluentui-emoji-animated/blob/daa0365c09795789ed2bc6e8b228c97736cb6669/LICENSE")}><Text style={{color:c.primary,paddingVertical:10}}>Read the original MIT license ↗</Text></Pressable></ScrollView></SafeAreaView>;
}
