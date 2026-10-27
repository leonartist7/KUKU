import {Platform} from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {api} from "./api";
export const PUSH_AVAILABLE = Platform.OS !== "web" && process.env.EXPO_PUBLIC_ENABLE_PUSH === "true";
const pref=(uid:string)=>"kuku_push_opt_in_"+uid;
export async function enableNotifications(uid:string,ask=true){
  if(!PUSH_AVAILABLE)throw new Error("Notifications are not available in this build.");
  if(!ask && await AsyncStorage.getItem(pref(uid))!=="true")return;
  const n=await import("expo-notifications");
  if(Platform.OS==="android")await n.setNotificationChannelAsync("messages",{name:"Messages",importance:n.AndroidImportance.DEFAULT});
  let permissions=await n.getPermissionsAsync();
  if(!permissions.granted && ask)permissions=await n.requestPermissionsAsync();
  if(!permissions.granted){if(ask)throw new Error("Allow notifications in your phone settings to receive message alerts.");return;}
  const projectId=Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
  if(!projectId)throw new Error("Notifications are not available in this build.");
  const token=(await n.getExpoPushTokenAsync({projectId})).data;
  await api.postAs(uid,"/devices",{token});
  await AsyncStorage.setItem(pref(uid),"true");
}
export async function disableNotifications(uid:string){
  await api.delete("/devices");
  await AsyncStorage.setItem(pref(uid),"false");
}
