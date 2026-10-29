import React, {useCallback, useState} from "react";
import {View, Text, Pressable, ActivityIndicator} from "react-native";
import {useFocusEffect} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {api} from "./api";
import {useTheme} from "./ThemeContext";
type FileStatus = {available: boolean; used_bytes: number; remaining_bytes: number; max_file_bytes: number};
export default function FileSharingStatus() {
  const {c, f} = useTheme();
  const [status, setStatus] = useState<FileStatus | null>(null);
  const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true; setLoading(true); setFailed(false);
    void api.get<FileStatus>("/files/status").then(value => {if (active) setStatus(value);}).catch(() => {if (active) setFailed(true);}).finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [attempt]));
  const ready = status?.available === true;
  const title = loading ? "Getting your files ready…" : failed ? "Let’s check your connection" : ready ? "A little space to share" : "File sharing is getting ready";
  return <View testID="file-sharing-status" style={{padding: 16, marginBottom: 14, borderRadius: 20, backgroundColor: c.surface, flexDirection: "row", gap: 12, alignItems: "flex-start"}}>
    <View style={{width: 38, height: 38, borderRadius: 14, backgroundColor: c.primaryBgSubtle, alignItems: "center", justifyContent: "center"}}>{loading ? <ActivityIndicator size="small" color={c.primaryDark}/> : <Ionicons name={ready ? "lock-closed-outline" : "cloud-outline"} size={21} color={c.primaryDark}/>}</View>
    <View style={{flex: 1, gap: 5}}><Text style={{fontFamily: f.bodyMedium, color: c.text, fontSize: 14}}>{title}</Text>
      <Text style={{fontFamily: f.body, color: c.textSecondary, fontSize: 12, lineHeight: 18}}>{loading ? "Just a moment." : failed ? "Your conversations are still here. Try checking again." : ready ? "Photos and files up to 25 MB, shared privately in your conversation." : "You can keep chatting. Files will be available once setup is complete."}</Text>
      {ready ? <Text style={{fontFamily: f.body, color: c.textSecondary, fontSize: 11}}>{Math.ceil(status.remaining_bytes / 1048576)} MB available · {Math.ceil(status.used_bytes / 1048576)} MB used</Text> : null}
      {!loading && !ready ? <Pressable accessibilityRole="button" accessibilityLabel="Check file sharing again" onPress={() => setAttempt(n => n + 1)} style={{minHeight: 44, justifyContent: "center"}}><Text style={{fontFamily: f.bodyMedium, color: c.primaryDark, fontSize: 12}}>Check again</Text></Pressable> : null}
    </View>
  </View>;
}
