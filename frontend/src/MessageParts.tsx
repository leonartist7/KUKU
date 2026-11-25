import {openPrivateDownload} from "./downloads";
import { api, getSessionEpoch, getSessionUserId, onSessionBoundary } from "./api";
import { View, Text, StyleSheet, Pressable, Alert, Platform } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createAudioPlayer } from "expo-audio";
import { useRef, useState, useEffect } from "react";
import { useTheme } from "./ThemeContext";
import { useAuth } from "./AuthContext";
import { useIsFocused } from "@react-navigation/native";
import { createPrivateMemoLease, PrivateMemoLease } from "./privateMemoLease";
import { Palette, radius, spacing } from "./theme";

let memoFileSequence = 0;
function usePrivateMessageScope(attachmentId: string | undefined, media: string | null | undefined, unavailable: boolean) {
  const {user, restoring} = useAuth(), focused = useIsFocused();
  const uid = user?.id, epoch = getSessionEpoch();
  const latest = useRef({uid, epoch, attachmentId, media, unavailable, focused, restoring});
  latest.current = {uid, epoch, attachmentId, media, unavailable, focused, restoring};
  const active = useRef<{uid: string; lease: PrivateMemoLease} | null>(null);
  useEffect(() => {
    if (!uid || restoring || !focused || unavailable || getSessionUserId() !== uid) return;
    const snapshot = latest.current;
    const lease = createPrivateMemoLease(() => {
      const now = latest.current;
      return now.uid === uid && now.epoch === epoch && now.attachmentId === snapshot.attachmentId &&
        now.media === snapshot.media && !now.unavailable && now.focused && !now.restoring &&
        getSessionUserId() === uid && getSessionEpoch() === epoch;
    });
    active.current = {uid, lease};
    const stop = onSessionBoundary(() => lease.close());
    return () => {stop(); lease.close(); if (active.current?.lease === lease) active.current = null;};
  }, [uid, epoch, attachmentId, media, unavailable, focused, restoring]);
  return {active, uid, epoch, ready: !!uid && !restoring && focused && !unavailable, key: [uid, epoch, attachmentId, media, unavailable, focused, restoring]};
}

export function VoiceMessageBubble({durationMs, outgoing, media, attachmentId, unavailable = false}: {
  durationMs: number; outgoing: boolean; media?: string | null; attachmentId?: string; unavailable?: boolean;
}) {
  const {c, f} = useTheme(); const styles = makeStyles(c, f);
  const scope = usePrivateMessageScope(attachmentId, media, unavailable);
  const player = useRef<any>(null), loading = useRef<PrivateMemoLease | null>(null);
  const [playing,setPlaying] = useState(false); const [busy,setBusy] = useState(false); const [error,setError] = useState("");
  const seconds = Math.max(1,Math.round(durationMs/1000));
  useEffect(() => {player.current = null; loading.current = null; setPlaying(false); setBusy(false); setError("");}, scope.key);
  async function togglePlay() {
    const owner = scope.active.current;
    if (!owner?.lease.current() || loading.current === owner.lease || unavailable) return;
    const {lease, uid} = owner;
    loading.current = lease; setBusy(true); setError("");
    let releaseSource: (() => void) | undefined;
    try {
      if (!player.current) {
        let source = media;
        if (attachmentId) {
          const download = await api.getAs<{url:string;media_type:string}>(uid,"/attachments/"+attachmentId+"/download");
          if (!lease.current()) return;
          if (typeof download.url !== "string" || !download.url.startsWith("https://")) throw new Error("memo_unavailable");
          if (Platform.OS === "web") {
            const response = await fetch(download.url,{cache:"no-store",signal:lease.signal});
            if (!lease.current()) return;
            if (!response.ok) throw new Error("memo_unavailable");
            const bytes = await response.arrayBuffer();
            if (!lease.current()) return;
            if (bytes.byteLength > 10*1024*1024) throw new Error("memo_too_large");
            source = URL.createObjectURL(new Blob([bytes],{type:download.media_type || "audio/webm"}));
            const objectUrl = source;
            releaseSource = lease.own(() => URL.revokeObjectURL(objectUrl));
          } else {
            const files = await import("expo-file-system/legacy");
            if (!lease.current()) return;
            const path = files.cacheDirectory+"kuku-voice-"+Date.now()+"-"+(++memoFileSequence)+".m4a";
            const removeFile = () => {void files.deleteAsync(path,{idempotent:true}).catch(() => {});};
            releaseSource = lease.own(removeFile);
            let result;
            try {result = await files.downloadAsync(download.url,path);}
            finally {if (!lease.current()) removeFile();} // A late download may recreate a file after teardown.
            if (!lease.current()) return;
            if (result.status !== 200) throw new Error("memo_unavailable");
            source = result.uri;
          }
        }
        if (!source) throw new Error("memo_missing");
        if (!lease.current()) return;
        const webAudio = Platform.OS === "web" ? new Audio(source) : null;
        const nativeAudio = webAudio ? null : createAudioPlayer(source);
        const audio = webAudio || nativeAudio!;
        player.current = audio;
        lease.own(() => {
          if (player.current === audio) player.current = null;
          try {audio.pause?.();} catch {}
          if (webAudio) {
            webAudio.onended = null;
            try {webAudio.removeAttribute("src"); webAudio.load();} catch {}
          } else if (nativeAudio) {try {nativeAudio.release();} catch {}}
        });
        if (webAudio) webAudio.onended = () => {if (lease.current() && player.current === audio) setPlaying(false);};
        else if (nativeAudio) {
          const subscription = nativeAudio.addListener("playbackStatusUpdate",status => {
            if (status.didJustFinish && lease.current() && player.current === audio) setPlaying(false);
          });
          lease.own(() => subscription.remove());
        }
      }
      const audio = player.current;
      if (!lease.current() || !audio) return;
      if (playing) {audio.pause(); if (lease.current()) setPlaying(false);}
      else {
        if (Platform.OS === "web" && audio.ended) audio.currentTime = 0;
        if (Platform.OS !== "web" && audio.currentTime >= seconds-0.1) await audio.seekTo(0);
        if (!lease.current() || player.current !== audio) return;
        await audio.play();
        if (lease.current() && player.current === audio) setPlaying(true);
        else {try {audio.pause();} catch {}}
      }
    } catch(e) {
      if (!player.current) releaseSource?.();
      if (lease.current()) setError(e instanceof Error && e.name === "NotAllowedError" ? "Ready — tap Play to listen." :
        e instanceof Error && e.message === "memo_too_large" ? "This memo is too large." :
        e instanceof Error && e.message === "memo_missing" ? "This older memo has no recording attached." : "Could not open this memo. Try again.");
    } finally {
      if (loading.current === lease) loading.current = null;
      if (lease.current()) setBusy(false);
    }
  }
  return <View style={{gap:6}}><View style={styles.voiceWrap}>
    <Pressable accessibilityRole="button" accessibilityLabel={playing?"Pause voice memo":"Play voice memo"} disabled={!scope.ready || busy || unavailable || (!media && !attachmentId)} onPress={()=>void togglePlay()} style={[styles.playBtn,{minWidth:44,minHeight:44,opacity:unavailable?0.4:1}]} testID="voice-play">
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
  const scope = usePrivateMessageScope(attachmentId, undefined, unavailable);
  const [deleted, setDeleted] = useState(false), [busy, setBusy] = useState(false);
  const inFlight = useRef<PrivateMemoLease | null>(null);
  useEffect(() => {setDeleted(false);}, [attachmentId, scope.uid, scope.epoch]);
  useEffect(() => {setBusy(false); inFlight.current = null;}, scope.key);
  const remove = async (owner: {uid: string; lease: PrivateMemoLease}) => {
    if (!attachmentId || !owner.lease.current() || inFlight.current === owner.lease) return;
    inFlight.current = owner.lease; setBusy(true);
    try {await api.deleteAs(owner.uid,"/attachments/"+attachmentId); if (owner.lease.current()) setDeleted(true);}
    catch {if (owner.lease.current()) Alert.alert("Could not delete file", "Please try again.");}
    finally {if (inFlight.current === owner.lease) inFlight.current = null; if (owner.lease.current()) setBusy(false);}
  };
  const confirmDelete = () => {
    const owner = scope.active.current;
    if (!owner?.lease.current() || !canDelete || !attachmentId || busy || deleted || unavailable) return;
    if(Platform.OS==="web"){if(window.confirm("Delete this file for everyone in this chat?"))void remove(owner);}
    else Alert.alert("Delete file", "This removes the file for everyone in this chat.", [{text:"Cancel",style:"cancel"},{text:"Delete",style:"destructive",onPress:()=>void remove(owner)}]);
  };
  const icon = type === "image" ? "image-outline" : "document-text-outline";
  const sizeLabel = fileSize
    ? fileSize > 1024
      ? `${(fileSize / 1024).toFixed(1)} KB`
      : `${fileSize} B`
    : "";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={"Download " + (fileName || "file")} disabled={!scope.ready || busy || !attachmentId || deleted || unavailable} onLongPress={confirmDelete} onPress={async () => {
      const owner = scope.active.current;
      if (!owner?.lease.current() || !attachmentId || inFlight.current === owner.lease) return;
      inFlight.current = owner.lease; setBusy(true);
      try {const {url} = await api.getAs<{url:string}>(owner.uid,"/attachments/" + attachmentId + "/download"); if (owner.lease.current()) await openPrivateDownload(url);}
      catch {if (owner.lease.current()) Alert.alert("Download failed", "Please try again.");}
      finally {if (inFlight.current === owner.lease) inFlight.current = null; if (owner.lease.current()) setBusy(false);}
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
