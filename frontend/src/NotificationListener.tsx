import {useEffect} from "react";
import {AppState,Platform} from "react-native";
import {useRouter} from "expo-router";
import {useAuth} from "./AuthContext";
import {api} from "./api";
import {PUSH_AVAILABLE,enableNotifications} from "./notifications";
import {setBrowserPushAccount} from "./browserPush";
export default function NotificationListener(){
  const {user,restoring}=useAuth();const router=useRouter();
  useEffect(()=>{
    if(restoring || Platform.OS!=="web" || user===undefined)return;
    void setBrowserPushAccount(user?.email_verified ? user.id : null).catch(()=>{});
  },[user?.id,user?.email_verified,user===undefined,restoring]);
  useEffect(()=>{
    if(restoring || !user?.email_verified || !PUSH_AVAILABLE)return;
    let active=true;let dispose=()=>{};
    const setup=async()=>{
      if(Platform.OS==="web") {await enableNotifications(user.id,false);return;}
      const n=await import("expo-notifications");
      if(!active)return;
      n.setNotificationHandler({handleNotification:async()=>({shouldPlaySound:active,shouldSetBadge:false,shouldShowBanner:active,shouldShowList:active})});
      const open=async(response:import("expo-notifications").NotificationResponse)=>{
        const id=response.notification.request.content.data.chatId;
        if(typeof id!=="string" || !/^[a-f0-9-]{36}$/.test(id) || !active)return;
        try{await api.getAs(user.id,"/chats/"+id);if(active)router.push(("/chat/"+id) as never);}catch{/* No membership or session: don't open private content. */}
        await n.clearLastNotificationResponseAsync();
      };
      const sub=n.addNotificationResponseReceivedListener(response=>void open(response));
      dispose=()=>sub.remove();
      const last=await n.getLastNotificationResponseAsync();if(last)await open(last);
      await enableNotifications(user.id,false);
    };
    void setup().catch(()=>{});
    const app=AppState.addEventListener("change",state=>{if(state==="active")void enableNotifications(user.id,false).catch(()=>{});});
    return()=>{active=false;dispose();app.remove();};
  },[user?.id,user?.email_verified,restoring,router]);
  return null;
}
