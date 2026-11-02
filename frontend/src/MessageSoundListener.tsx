import {useEffect} from "react";
import {Platform} from "react-native";
import {useAuth} from "./AuthContext";
import {api,Chat} from "./api";
import {armMessageSounds,incomingSoundTracker,playMessageSound,readSound,stopMessageSound} from "./messageSounds";

export default function MessageSoundListener(){
  const {user}=useAuth();
  useEffect(()=>{
    if(Platform.OS!=="web" || !user?.email_verified)return;
    const uid=user.id;let active=true,busy=false;
    let track=incomingSoundTracker(uid);
    const unlock=()=>armMessageSounds();
    document.addEventListener("pointerdown",unlock);
    document.addEventListener("keydown",unlock);
    async function poll(){
      if(!active || busy || document.hidden || navigator.onLine===false)return;
      busy=true;
      try{
        const chats=await api.get<Chat[]>("/chats");
        if(!active || document.hidden)return;
        const messages=chats.map(chat=>chat.last_message).filter((message):message is NonNullable<Chat["last_message"]>=>!!message);
        const incoming=track(messages);
        if(incoming){const settings=await readSound(uid);if(active && !document.hidden)await playMessageSound(settings);}
      }catch{/* Sound never prevents reading or sending a message. */}
      finally{busy=false;}
    }
    const visibility=()=>{track=incomingSoundTracker(uid);if(document.hidden)stopMessageSound();else void poll();};
    document.addEventListener("visibilitychange",visibility);
    void poll();const timer=setInterval(()=>void poll(),4000);
    return()=>{active=false;clearInterval(timer);stopMessageSound();document.removeEventListener("pointerdown",unlock);document.removeEventListener("keydown",unlock);document.removeEventListener("visibilitychange",visibility);};
  },[user?.id,user?.email_verified]);
  return null;
}
