import {openPrivateDownload} from "./downloads";
import { api } from "./api";
import { View, Text, StyleSheet, Pressable, Linking, Alert, Platform } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createAudioPlayer } from "expo-audio";
import { useRef, useState, useEffect } from "react";
import { useTheme } from "./ThemeContext";
import { Palette, radius, spacing } from "./theme";

export function VoiceMessageBubble({durationMs, outgoing, media, attachmentId, unavailable = false}: {
  durationMs: number; outgoing: boolean; media?: string | null; attachmentId?: string; unavailable?: boolean;
}) {
  const {c, f} = useTheme(); const styles = makeStyles(c, f);
  const player = useRef<any>(null); const objectUrl = useRef<string | null>(null);
  const cleanupNative = useRef<(() => void) | null>(null); const alive = useRef(true);
  const [playing,setPlaying] = useState(false); const [busy,setBusy] = useState(false); const [error,setError] = useState("");
  const seconds = Math.max(1,Math.round(durationMs/1000));
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;player.current?.pause?.();player.current?.release?.();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);cleanupNative.current?.();};},[]);
  async function togglePlay() {
    if(busy || unavailable)return;
    setError("");
    try {
      if(!player.current) {
        setBusy(true);let source = media;
        if(attachmentId) {
          const download = await api.get<{url:string;media_type:string}>("/attachments/"+attachmentId+"/download");
          if(!download.url.startsWith("https://"))throw new Error("This memo could not be opened.");
          if(Platform.OS === "web") {
            const response = await fetch(download.url,{cache:"no-store"});
            if(!response.ok)throw new Error("Could not open this memo. Try again.");
            const bytes = await response.arrayBuffer();
            if(bytes.byteLength>10*1024*1024)throw new Error("This memo is too large.");
            source = URL.createObjectURL(new Blob([bytes],{type:download.media_type || "audio/webm"}));objectUrl.current=source;
          } else {
            const files = await import("expo-file-system/legacy");
            const path = files.cacheDirectory+"kuku-voice-"+attachmentId+".m4a";
            const result = await files.downloadAsync(download.url,path);
            if(result.status!==200)throw new Error("Could not open this memo. Try again.");
            source=result.uri;cleanupNative.current=()=>{void files.deleteAsync(path,{idempotent:true});};
          }
        }
        if(!source)throw new Error("This older memo has no recording attached.");
        if(!alive.current)return;
        if(Platform.OS === "web") {
          player.current = new Audio(source);
          player.current.onended=()=>{if(alive.current)setPlaying(false);};
        } else {
          player.current = createAudioPlayer(source);
          player.current.addListener("playbackStatusUpdate",(status:any)=>{if(status.didJustFinish && alive.current)setPlaying(false);});
        }
      }
      if(!alive.current)return;
      if(playing){player.current.pause();setPlaying(false);}
      else {
        if(Platform.OS === "web" && player.current.ended)player.current.currentTime=0;
        if(Platform.OS !== "web" && player.current.currentTime>=seconds-0.1)await player.current.seekTo(0);
        await player.current.play();setPlaying(true);
      }
    }catch(e){if(alive.current)setError(e instanceof Error && e.name!=="NotAllowedError"?e.message:"Ready — tap Play to listen.");}
    finally{if(alive.current)setBusy(false);}
  }
  return <View style={{gap:6}}><View style={styles.voiceWrap}>
    <Pressable accessibilityRole="button" accessibilityLabel={playing?"Pause voice memo":"Play voice memo"} disabled={busy || unavailable || (!media && !attachmentId)} onPress={()=>void togglePlay()} style={[styles.playBtn,{minWidth:44,minHeight:44,opacity:unavailable?0.4:1}]} testID="voice-play">
      <Ionicons name={busy?"hourglass-outline":playing?"pause":"play"} size={18} color={c.textInverse}/>
    </Pressable>
    <View style={{flex:1,paddingHorizontal:12}}><Text style={{color:c.text,fontFamily:f.bodyMedium}}>{unavailable?"Voice memo deleted":busy?"Opening memo…":playing?"Playing…":"Voice memo"}</Text><Text style={{color:c.textSecondary,fontSize:12}}>{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,"0")}</Text></View>
  </View>{error?<Text accessibilityRole="alert" style={{color:c.error,fontSize:12,maxWidth:240}}>{error}</Text>:null}</View>;
}

export function FilePreviewCard({
  attachmentId,
  canDelete = false,
  unavailable = false,
  fileName,
  fileSize,
  type,
}: {
  attachmentId?: string;
  canDelete?: boolean;
  unavailable?: boolean;
  fileName?: string | null;
  fileSize?: number | null;
  type: "file" | "image";
}) {
  const { c, f } = useTheme();
  const styles = makeStyles(c, f);
  const [deleted, setDeleted] = useState(false);
  const remove = async () => {try {await api.delete("/attachments/"+attachmentId);setDeleted(true);}catch{Alert.alert("Could not delete file", "Please try again.");}};
  const confirmDelete = () => {
    if (!canDelete || !attachmentId || deleted || unavailable) return;
    if(Platform.OS==="web"){if(window.confirm("Delete this file for everyone in this chat?"))void remove();}
    else Alert.alert("Delete file", "This removes the file for everyone in this chat.", [{text:"Cancel",style:"cancel"},{text:"Delete",style:"destructive",onPress:()=>void remove()}]);
  };
  const icon = type === "image" ? "image-outline" : "document-text-outline";
  const sizeLabel = fileSize
    ? fileSize > 1024
      ? `${(fileSize / 1024).toFixed(1)} KB`
      : `${fileSize} B`
    : "";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={"Download " + (fileName || "file")} disabled={!attachmentId || deleted || unavailable} onLongPress={confirmDelete} onPress={async () => {
      try { const {url} = await api.get<{url:string}>("/attachments/" + attachmentId + "/download"); await openPrivateDownload(url); }
      catch { Alert.alert("Download failed", "Please try again."); }
    }} style={styles.fileWrap}>
      <View style={styles.fileIcon}>
        <Ionicons name={icon as any} size={22} color={c.primaryDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fileName} numberOfLines={1}>
          {fileName || "file"}
        </Text>
        <Text style={styles.fileMeta}>{deleted || unavailable ? "File deleted" : (sizeLabel || (type === "image" ? "Image" : "File")) + (canDelete ? " · Hold to delete" : "")}</Text>
      </View>
      <Ionicons name="arrow-down-outline" size={18} color={c.textSecondary} />
    </Pressable>
  );
}

const makeStyles = (c: Palette, f: any) =>
  StyleSheet.create({
    voiceWrap: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 6,
      paddingHorizontal: 4,
      minWidth: 200,
    },
    playBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.sm,
    },
    playBtnDisabled: { opacity: 0.35 },
    waveform: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
      height: 28,
    },
    voiceTime: {
      marginLeft: spacing.sm,
      color: c.textSecondary,
      fontFamily: f.body,
      fontSize: 12,
    },
    fileWrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: spacing.sm + 2,
      minWidth: 220,
      gap: spacing.sm,
    },
    fileIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.sm,
      backgroundColor: c.primaryBgSubtle,
      alignItems: "center",
      justifyContent: "center",
    },
    fileName: {
      color: c.text,
      fontFamily: f.bodyMedium,
      fontSize: 14,
    },
    fileMeta: {
      color: c.textSecondary,
      fontFamily: f.body,
      fontSize: 12,
      marginTop: 2,
    },
  });
