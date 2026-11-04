import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCall } from "./CallContext";
import { useTheme } from "./ThemeContext";
import { callDuration, callPhaseLabel } from "./callState";

// Mount once within CallProvider, alongside the Stack, to keep an ongoing call
// reachable while a conversation or file is open. This banner does not own media.
export default function OngoingCallBanner() {
  const { session, supported, hangUp } = useCall();
  const { c, f } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!session || session.phase === "ended" || pathname.startsWith("/call/")) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pathname, session?.callId, session?.phase]);
  if (!supported || !session || session.phase === "ended" || pathname.startsWith("/call/")) return null;
  return <View testID="ongoing-call-banner" style={[styles.outer, { backgroundColor: c.bg, paddingBottom: Math.max(insets.bottom, 8) }]}>
    <View style={[styles.banner, { backgroundColor: c.surfaceElevated }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={"Return to call with " + session.other.name} style={styles.return} onPress={() => router.push({ pathname: "/call/[id]", params: { id: session.other.id, ...(session.callId ? { callId: session.callId } : {}) } })}>
        <Ionicons name={session.muted ? "mic-off-outline" : "call-outline"} size={20} color={c.primaryDark} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: f.bodyMedium, fontSize: 14, color: c.text }}>{session.other.name}</Text>
          <Text numberOfLines={1} style={{ fontFamily: f.body, fontSize: 12, color: c.textSecondary }}>{session.phase === "connected" ? callDuration(session.startedAt, now) + " · Return to call" : callPhaseLabel(session.phase) + " · Return to call"}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Hang up ongoing call" onPress={() => { void hangUp(); }} style={[styles.end, { backgroundColor: c.error }]}>
        <Ionicons name="call" size={21} color={c.textInverse} style={{ transform: [{ rotate: "135deg" }] }} />
      </Pressable>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  outer: { paddingHorizontal: 12, paddingTop: 8 },
  banner: { width: "100%", maxWidth: 680, alignSelf: "center", borderRadius: 20, flexDirection: "row", alignItems: "center", padding: 6, gap: 6 },
  return: { flex: 1, flexDirection: "row", gap: 12, paddingHorizontal: 10, paddingVertical: 7, minHeight: 48, alignItems: "center" },
  end: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
