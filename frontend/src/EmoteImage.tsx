import React,{useEffect,useRef,useState,useSyncExternalStore} from "react";
import {Image,Platform,Pressable,Text,View} from "react-native";
import {Emote,emoteAsset} from "./emotes";
const watchers=new Set<()=>void>();
let stop:undefined|(()=>void);
function snapshot(){return Platform.OS==="web" && typeof document!=="undefined" && !document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;}
function subscribe(listener:()=>void){
  watchers.add(listener);
  if(watchers.size===1 && Platform.OS==="web" && typeof document!=="undefined"){
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    const notify=()=>watchers.forEach(fn=>fn());
    media.addEventListener("change",notify);document.addEventListener("visibilitychange",notify);
    stop=()=>{media.removeEventListener("change",notify);document.removeEventListener("visibilitychange",notify);};
  }
  return()=>{watchers.delete(listener);if(!watchers.size){stop?.();stop=undefined;}};
}
export const assetOrigin=Platform.OS==="web"?"":(process.env.EXPO_PUBLIC_WEB_ORIGIN||"https://kuku-git-codex-kuku-release-20261027-lionovart.vercel.app");
export default function EmoteImage({emote,size=128,autoPlay=false,onPress,selected=false}:{emote:Emote;size?:number;autoPlay?:boolean;onPress?:()=>void;selected?:boolean}){
  const motion=useSyncExternalStore(subscribe,snapshot,()=>false);
  const [visible,setVisible]=useState(false),[play,setPlay]=useState(0),[failed,setFailed]=useState(0);
  const ref=useRef<View>(null);
  useEffect(()=>{
    if(Platform.OS!=="web" || typeof IntersectionObserver==="undefined"){setVisible(true);return;}
    const node=ref.current as unknown as Element;if(!node?.nodeType){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)));
    observer.observe(node);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{setFailed(0);setPlay(0);},[emote.id]);
  const animated=motion && visible && (autoPlay||play>0) && failed===0;
  const uri=assetOrigin+emoteAsset(emote.slug,animated)+(animated&&play?"?replay="+play:"");
  return <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={onPress?"Choose "+emote.label+" emote":emote.label+" emote"+(motion?" · Tap to replay":"")} accessibilityState={{selected}} onPress={onPress||(()=>setPlay(value=>value+1))} testID={"emote-"+emote.slug} style={{width:size,height:size,alignItems:"center",justifyContent:"center"}}>
    {failed<2?<Image key={uri} source={{uri}} accessibilityLabel={emote.label} testID={"emote-image-"+emote.slug} style={{width:size,height:size}} resizeMode="contain" onError={()=>setFailed(value=>value+1)}/>:<Text style={{fontSize:size*.6}}>{emote.emoji}</Text>}
  </Pressable>;
}
