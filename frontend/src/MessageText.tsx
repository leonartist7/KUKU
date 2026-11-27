import React from "react";
import {Alert,Linking,Platform,StyleProp,Text,TextStyle} from "react-native";
import {messageTextParts,safeMessageUrl} from "./messageLinks";
import {useTheme} from "./ThemeContext";

export default function MessageText({text,style,onActions,disabled=false}:{text:string;style?:StyleProp<TextStyle>;onActions?:()=>void;disabled?:boolean}){
  const {c}=useTheme();
  const actions=()=>{if(!disabled)onActions?.();};
  async function open(url:string){
    if(disabled||!safeMessageUrl(url))return;
    try{await Linking.openURL(url);}catch{Alert.alert("Could not open link","Please try again, or copy the link from the message options.");}
  }
  return <Text style={style} selectable={!onActions} onPress={()=>{
    if(Platform.OS==="web"&&typeof window!=="undefined"&&window.getSelection()?.toString())return;
    actions();
  }} onLongPress={actions}>{messageTextParts(text).map((part,index)=>!part.url?part.text:Platform.OS==="web"?
    React.createElement("a",{key:index,href:part.url,"aria-disabled":disabled||undefined,target:"_blank",rel:"noopener noreferrer",style:{color:c.primaryDark,textDecoration:"underline",overflowWrap:"anywhere"},
      onClick:(event:React.MouseEvent<HTMLAnchorElement>)=>{event.stopPropagation();if(disabled)event.preventDefault();},
      onContextMenu:(event:React.MouseEvent<HTMLAnchorElement>)=>{if(onActions){event.preventDefault();event.stopPropagation();actions();}}},part.text):
    <Text key={index} accessibilityRole="link" accessibilityState={{disabled}} accessibilityLabel={part.text} style={{color:c.primaryDark,textDecorationLine:"underline"}}
      onLongPress={event=>{event.stopPropagation();actions();}}
      onPress={event=>{event.stopPropagation();void open(part.url!);}}>{part.text}</Text>
  )}</Text>;
}
