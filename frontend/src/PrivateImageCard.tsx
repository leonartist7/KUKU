import React,{useCallback,useEffect,useRef,useState} from "react";
import {View,Text,Pressable,Image,Modal,ActivityIndicator,Platform,Alert} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useIsFocused} from "@react-navigation/native";
import Ionicons from "@expo/vector-icons/Ionicons";
import {useAuth} from "./AuthContext";
import {useTheme} from "./ThemeContext";
import {useReducedMotion} from "./useReducedMotion";
import {api,ApiError} from "./api";
import {openPrivateDownload} from "./downloads";
import {ImagePreview,invalidatePrivateImagePreview,loadPrivateImagePreview,privateImagePreviewInvalidationMatches,privateImagePreviewKey,privateImagePreviewScope,subscribePrivateImagePreviewInvalidation} from "./imagePreview";

function usePreview(id:string|undefined,size:"thumb"|"full",enabled:boolean,screenScope:string){
  const {user,restoring}=useAuth();
  const scope=!restoring&&user?.email_verified?privateImagePreviewScope(user.id,screenScope):null;
  const format=Platform.OS==="web"?"webp":"jpeg";
  const key=scope&&id?privateImagePreviewKey(scope,id,size,format):"";
  const [attempt,retry]=useState(0);
  const [state,setState]=useState<{key:string;data?:ImagePreview;error?:string}>({key:""});
  useEffect(()=>{
    if(!id||!scope||!enabled){setState({key:""});return;}
    let active=true;setState({key});
    const stop=subscribePrivateImagePreviewInvalidation(event=>{
      if(active&&privateImagePreviewInvalidationMatches(event,scope,id))setState({key:""});
    });
    void loadPrivateImagePreview(scope,id,size,format,()=>api.getAs<ImagePreview>(scope.accountId,
      "/attachments/"+encodeURIComponent(id)+"/preview?size="+size+"&format="+format)).then(result=>{
      if(active)setState({key,data:result});
    }).catch(error=>{
      if(error instanceof ApiError&&[401,403,404].includes(error.status))invalidatePrivateImagePreview(scope.accountId,id);
      if(active)setState({key,error:error instanceof ApiError&&error.status===404?"Image no longer available.":"Preview unavailable. Try again or download the original."});
    });
    return()=>{active=false;stop();};
  },[key,enabled,attempt,user?.email_verified,restoring]);
  const result=state.key===key&&enabled?state:{key};
  return {...result,retry:()=>retry(value=>value+1)};
}

export default function PrivateImageCard({attachmentId,fileName="Photo",unavailable=false,canDelete=false,compact=false,subtitle,cacheScope}: {
  attachmentId?:string;fileName?:string|null;unavailable?:boolean;canDelete?:boolean;compact?:boolean;subtitle?:string;cacheScope?:string;
}){
  const {c,f}=useTheme(),{user}=useAuth();const account=useRef(user?.id);account.current=user?.id;
  const reducedMotion=useReducedMotion(),focused=useIsFocused();
  const previewScope=cacheScope||"private-card:"+(attachmentId||"missing");
  const [open,setOpen]=useState(false),[deleted,setDeleted]=useState(false),[visible,setVisible]=useState(Platform.OS!=="web");
  const [actionError,setActionError]=useState("");const container=useRef<View>(null);
  const gone=unavailable||deleted;const title=fileName||"Photo";
  const thumb=usePreview(attachmentId,"thumb",focused&&visible&&!gone,previewScope);
  const full=usePreview(attachmentId,"full",focused&&open&&!gone,previewScope);
  useEffect(()=>{setOpen(false);setDeleted(false);setActionError("");},[attachmentId,user?.id]);
  useEffect(()=>{if(gone&&attachmentId&&user?.id)invalidatePrivateImagePreview(user.id,attachmentId);},[gone,attachmentId,user?.id]);
  useEffect(()=>{
    if(Platform.OS!=="web" || typeof IntersectionObserver==="undefined"){setVisible(true);return;}
    const node=container.current as unknown as Element;
    if(!node || node.nodeType!==1){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:"160px"});
    observer.observe(node);return()=>observer.disconnect();
  },[attachmentId,user?.id]);
  const close=useCallback(()=>{setOpen(false);setActionError("");},[]);
  async function download(){
    const uid=account.current;setActionError("");
    try{if(!uid||!attachmentId)return;const result=await api.getAs<{url:string}>(uid,"/attachments/"+attachmentId+"/download");if(account.current===uid)await openPrivateDownload(result.url);}
    catch{setActionError("Could not download this image. Please try again.");}
  }
  function remove(){
    const uid=account.current;
    const perform=async()=>{if(!uid||!attachmentId)return;try{await api.deleteAs(uid,"/attachments/"+attachmentId);invalidatePrivateImagePreview(uid,attachmentId);if(account.current===uid){setDeleted(true);setOpen(false);}}catch{setActionError("Could not delete this image. Try again.");}};
    if(Platform.OS==="web"){if(window.confirm("Delete this image for everyone in this chat?"))void perform();}
    else Alert.alert("Delete image","This removes the image for everyone in this chat.",[{text:"Cancel",style:"cancel"},{text:"Delete",style:"destructive",onPress:()=>void perform()}]);
  }
  const button={minWidth:44,minHeight:44,alignItems:"center" as const,justifyContent:"center" as const,padding:10,borderRadius:14};
  const data=full.data||thumb.data;
  return <View ref={container} style={{maxWidth:"100%",width:compact?"100%":224}}>
    <Pressable accessibilityRole="button" accessibilityLabel={"View "+title} disabled={gone||!attachmentId} onPress={()=>setOpen(true)} testID={"image-open-"+attachmentId} style={{flexDirection:compact?"row":"column",alignItems:compact?"center":undefined,gap:compact?14:0}}>
      <View style={compact?{width:80,height:80,borderRadius:14,overflow:"hidden",alignItems:"center",justifyContent:"center",backgroundColor:c.surface}:{width:"100%",borderRadius:16,overflow:"hidden",aspectRatio:thumb.data?Math.max(.55,Math.min(1.8,thumb.data.width/thumb.data.height)):1.25,alignItems:"center",justifyContent:"center",backgroundColor:c.surface}}>
        {!gone && thumb.data?<Image source={{uri:thumb.data.image}} accessibilityLabel={"Preview "+title} testID={"image-thumbnail-"+attachmentId} style={{width:"100%",height:"100%"}} resizeMode="cover"/>:gone||thumb.error?<Ionicons name={gone?"image-outline":"cloud-offline-outline"} size={28} color={c.textSecondary}/>:<ActivityIndicator color={c.primary}/>}
      </View>
      {gone||thumb.error?<Text style={{flex:compact?1:undefined,paddingVertical:8,fontFamily:f.body,color:c.textSecondary,fontSize:12,lineHeight:17}}>{gone?"Image deleted":"Preview unavailable · Tap for options"}</Text>:compact&&subtitle?<Text numberOfLines={2} style={{flex:1,fontFamily:f.body,color:c.textSecondary,fontSize:12,lineHeight:19}}>{subtitle}</Text>:null}
    </Pressable>
    <Modal visible={open&&!gone} animationType={reducedMotion?"none":"fade"} onRequestClose={close} transparent={false}>
      <SafeAreaView edges={["top","bottom"]} style={{flex:1,backgroundColor:c.bg}}>
        <View style={{flexDirection:"row",alignItems:"center",justifyContent:"flex-end",paddingHorizontal:16,paddingVertical:8}}><Pressable accessibilityRole="button" accessibilityLabel="Close image preview" onPress={close} style={button}><Ionicons name="close" size={24} color={c.text}/></Pressable></View>
        <View style={{flex:1,alignItems:"center",justifyContent:"center",padding:12}} testID="image-viewer">
          {data?<Image source={{uri:data.image}} accessibilityLabel={"Enlarged "+title} testID="image-enlarged" resizeMode="contain" style={{width:"100%",height:"100%"}}/>:full.error?<View style={{padding:24,alignItems:"center",gap:18}}><Ionicons name="image-outline" size={40} color={c.textSecondary}/><Text style={{textAlign:"center",color:c.textSecondary,lineHeight:22}}>{full.error}</Text></View>:<ActivityIndicator color={c.primary} size="large"/>}
          {!full.data && !full.error && data?<View style={{position:"absolute",bottom:24,borderRadius:20,padding:10,backgroundColor:c.surface}}><ActivityIndicator color={c.primary}/></View>:null}
        </View>
        {full.error?<Pressable accessibilityRole="button" accessibilityLabel="Retry image preview" onPress={()=>{full.retry();thumb.retry();}} style={button}><Text style={{fontFamily:f.bodyMedium,color:c.primary}}>Try preview again</Text></Pressable>:null}
        {actionError?<Text accessibilityRole="alert" style={{paddingHorizontal:20,color:c.error,lineHeight:20}}>{actionError}</Text>:null}
        <View style={{padding:16,gap:10,borderTopWidth:1,borderColor:c.border}}><Pressable accessibilityRole="button" accessibilityLabel={"Download original "+title} onPress={()=>void download()} style={{...button,backgroundColor:c.primary,flexDirection:"row",gap:10}}><Ionicons name="download-outline" size={20} color={c.textInverse}/><Text style={{fontFamily:f.bodyBold,color:c.textInverse}}>Download original</Text></Pressable>
          {canDelete?<Pressable accessibilityRole="button" accessibilityLabel="Delete image for everyone" onPress={remove} style={button}><Text style={{color:c.textSecondary,fontFamily:f.body}}>Delete image for everyone</Text></Pressable>:null}
          <Text style={{fontFamily:f.body,fontSize:12,lineHeight:18,color:c.textSecondary,textAlign:"center"}}>Private preview. Download the original for full resolution or animation.</Text>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
}
