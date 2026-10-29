import {useEffect} from "react";
import {AppState} from "react-native";
import {useRouter} from "expo-router";
import {useAuth} from "./AuthContext";
import {api} from "./api";
import {PUSH_AVAILABLE,enableNotifications} from "./notifications";
export default function NotificationListener(){
  const {user}=useAuth();const router=useRouter();
  useEffect(()=>{
    if(!user?.email_verified || !PUSH_AVAILABLE)return;
    let active=true;let dispose=()=>{};
    const setup=async()=>{
      const n=await import("expo-notifications");
      if(!active)return;
      n.setNotificationHandler({handleNotification:async()=>({shouldPlaySound:active,shouldSetBadge:false,shouldShowBanner:active,shouldShowList:active})});
      const open=async(response:import("expo-notifications").NotificationResponse)=>{
        const id=response.notification.request.content.data.chatId;
        if(typeof id!=="string" || !/^[a-f0-9-]{36}$/.test(id) || !active)return;
        try{await api.get("/chats/"+id);if(active)router.push(("/chat/"+id) as never);}catch{/* No membership or session: don't open private content. */}
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
  },[user?.id,user?.email_verified,router]);
  return null;
}
