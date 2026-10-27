import { api } from "./api";
import { View, Text, StyleSheet, Pressable, Linking, Alert, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { createAudioPlayer } from "expo-audio";
import { useRef, useState, useEffect } from "react";
import { useTheme } from "./ThemeContext";
import { Palette, radius, spacing } from "./theme";

export function VoiceMessageBubble({
  durationMs,
  outgoing,
  media,
}: {
  durationMs: number;
  outgoing: boolean;
  media?: string | null;
}) {
  const { c, f } = useTheme();
  const styles = makeStyles(c, f);
  const playerRef = useRef<any>(null);
  const [playing, setPlaying] = useState(false);
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  const bars = 22;
  // deterministic pseudo-waveform
  const heights = Array.from({ length: bars }, (_, i) => {
    const h = Math.abs(Math.sin(i * 1.7 + seconds)) * 16 + 6;
    return h;
  });

  useEffect(() => () => {
    try {
      playerRef.current?.release?.();
    } catch {}
  }, []);

  function togglePlay() {
    if (!media) return;
    try {
      if (!playerRef.current) {
        playerRef.current = createAudioPlayer(media);
        playerRef.current.onPlaybackStatusUpdate = (s: any) => {
          if (s?.didJustFinish) setPlaying(false);
        };
      }
      if (playing) {
        playerRef.current.pause();
        setPlaying(false);
      } else {
        playerRef.current.play();
        setPlaying(true);
      }
    } catch {}
  }

  return (
    <View style={styles.voiceWrap}>
      <Pressable
        onPress={togglePlay}
        disabled={!media}
        style={({ pressed }) => [
          styles.playBtn,
          !media && styles.playBtnDisabled,
          pressed && { transform: [{ scale: 0.92 }] },
        ]}
        testID="voice-play"
      >
        <Ionicons name={playing ? "pause" : "play"} size={14} color={c.textInverse} />
      </Pressable>
      <View style={styles.waveform}>
        {heights.map((h, i) => (
          <View
            key={i}
            style={{
              width: 2.5,
              height: h,
              borderRadius: 2,
              marginHorizontal: 1.5,
              backgroundColor: i < bars * 0.4 ? c.primary : c.border,
            }}
          />
        ))}
      </View>
      <Text style={styles.voiceTime}>0:{seconds.toString().padStart(2, "0")}</Text>
    </View>
  );
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
      try { const {url} = await api.get<{url:string}>("/attachments/" + attachmentId + "/download"); await Linking.openURL(url); }
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
