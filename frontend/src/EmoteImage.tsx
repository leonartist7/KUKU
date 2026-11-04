import React,{useEffect,useRef,useState,useSyncExternalStore} from "react";
import {Image,Platform,Pressable,Text,View} from "react-native";
import {Emote,emoteAsset} from "./emotes";
const watchers=new Set<()=>void>();
let stop:undefined|(()=>void);
function snapshot(){
  return Platform.OS==="web"&&typeof document!=="undefined"&&typeof window!=="undefined"&&!document.hidden&&typeof window.matchMedia==="function"&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function subscribe(listener:()=>void){
  watchers.add(listener);
  if(watchers.size===1&&Platform.OS==="web"&&typeof document!=="undefined"&&typeof window!=="undefined"){
    const media=typeof window.matchMedia==="function"?window.matchMedia("(prefers-reduced-motion: reduce)"):null;
    const notify=()=>watchers.forEach(fn=>fn());
    if(media?.addEventListener)media.addEventListener("change",notify);else media?.addListener?.(notify);
    document.addEventListener("visibilitychange",notify);
    stop=()=>{if(media?.removeEventListener)media.removeEventListener("change",notify);else media?.removeListener?.(notify);document.removeEventListener("visibilitychange",notify);};
  }
  return()=>{watchers.delete(listener);if(!watchers.size){stop?.();stop=undefined;}};
}
export const assetOrigin=Platform.OS==="web"?"":(process.env.EXPO_PUBLIC_WEB_ORIGIN||"https://kuku-git-codex-kuku-release-20261027-lionovart.vercel.app");
type AssetState={id:string;animationFailed:boolean;posterFailed:boolean;readyUri:string|null};
const emptyAsset=(id:string):AssetState=>({id,animationFailed:false,posterFailed:false,readyUri:null});
export default function EmoteImage({emote,size=128,autoPlay=false,onPress,selected=false}:{emote:Emote;size?:number;autoPlay?:boolean;onPress?:()=>void;selected?:boolean}){
  const motion=useSyncExternalStore(subscribe,snapshot,()=>false);
  const [visible,setVisible]=useState(false),[play,setPlay]=useState(0),[asset,setAsset]=useState<AssetState>(()=>emptyAsset(emote.id));
  const ref=useRef<View>(null);
  useEffect(()=>{
    if(Platform.OS!=="web"||typeof IntersectionObserver==="undefined"){setVisible(true);return;}
    const node=ref.current as unknown as Element;if(!node?.nodeType){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)));
    observer.observe(node);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    // A cache hit may load before passive effects. Never clear an already-ready current asset.
    setAsset(current=>current.id===emote.id?current:emptyAsset(emote.id));setPlay(0);
  },[emote.id]);
  const current=asset.id===emote.id?asset:emptyAsset(emote.id);
  const animated=motion&&visible&&(autoPlay||play>0)&&!current.animationFailed;
  const path=emoteAsset(emote.slug,animated);
  const uri=assetOrigin+path+(animated&&play?"?replay="+play:"");
  const showImage=!!path&&(animated||!current.posterFailed),ready=showImage&&current.readyUri===uri;
  const activeRequest=useRef({id:emote.id,uri});activeRequest.current={id:emote.id,uri};
  const stillCurrent=()=>activeRequest.current.id===emote.id&&activeRequest.current.uri===uri;
  function loaded(){
    if(!stillCurrent())return;
    setAsset(previous=>({...previous,...(previous.id===emote.id?{}:emptyAsset(emote.id)),readyUri:uri}));
  }
  function failed(){
    if(!stillCurrent())return;
    setAsset(previous=>{
      const base=previous.id===emote.id?previous:emptyAsset(emote.id);
      return {...base,readyUri:null,...(animated?{animationFailed:true}:{posterFailed:true})};
    });
  }
  function replay(){
    setAsset(emptyAsset(emote.id));setPlay(value=>value+1);
  }
  return <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={onPress?"Choose "+emote.label+" emote":emote.label+" emote"+(motion?" · Tap to replay":"")} accessibilityState={{selected,busy:showImage&&!ready}} onPress={onPress||replay} testID={"emote-"+emote.slug} style={{width:size,height:size,flexShrink:0,alignItems:"center",justifyContent:"center"}}>
    {!ready?<Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={"emote-fallback-"+emote.slug} style={{fontSize:size*.62,lineHeight:size*.9,textAlign:"center",includeFontPadding:false}}>{emote.emoji}</Text>:null}
    {showImage?<Image key={uri} source={{uri}} accessibilityLabel={emote.label} testID={"emote-image-"+emote.slug} style={{position:"absolute",width:size,height:size,opacity:ready?1:0}} resizeMode="contain" onLoad={loaded} onError={failed}/>:null}
  </Pressable>;
}
