import {useEffect} from "react";
import {AppState} from "react-native";
import {useAuth} from "./AuthContext";
import {flushOutbox,subscribeOutbox} from "./outbox";
export default function OutboxRunner(){
  const {user}=useAuth();
  useEffect(()=>{
    if(!user?.email_verified)return;
    let active=true;
    const flush=()=>{if(active && AppState.currentState==="active")void flushOutbox(user.id,()=>active).catch(()=>{});};
    flush();const timer=setInterval(flush,3000);
    const unsubscribe=subscribeOutbox(flush);
    const app=AppState.addEventListener("change",state=>{if(state==="active")flush();});
    return()=>{active=false;clearInterval(timer);unsubscribe();app.remove();};
  },[user?.id,user?.email_verified]);
  return null;
}
