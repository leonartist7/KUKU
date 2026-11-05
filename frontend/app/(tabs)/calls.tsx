import React, { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { radius, spacing } from "../../src/theme";
import { useTheme } from "../../src/ThemeContext";
import { useAuth } from "../../src/AuthContext";
import { useCall } from "../../src/CallContext";
import { CALLS_ENABLED } from "../../src/config";
import { Call, callsApi } from "../../src/calls";
import { callHistoryLabel } from "../../src/callState";
import Avatar from "../../src/Avatar";

function dateLabel(iso: string) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}
export default function CallsScreen() {
  const router = useRouter();
  const { c, f } = useTheme();
  const { user } = useAuth();
  const { supported } = useCall();
  const uid = user?.email_verified ? user.id : null;
  const owner = useRef(uid); owner.current = uid;
  const generation = useRef(0);
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!uid || !CALLS_ENABLED) { setCalls([]); setLoading(false); setLoadedFor(uid); return; }
    setError(null); setLoading(true);
    try {
      const data = await callsApi.list(uid);
      if (request === generation.current && owner.current === uid) { setCalls(data); setLoadedFor(uid); }
    } catch {
      if (request === generation.current && owner.current === uid) { setError("Your calls could not load. Please try again."); setLoadedFor(uid); }
    } finally {
      if (request === generation.current && owner.current === uid) setLoading(false);
    }
  }, [uid]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current++; };
  }, [load]));
  const currentCalls = loadedFor === uid ? calls : [];
  const busy = loading || loadedFor !== uid;
  return <SafeAreaView style={styles.safe} edges={["top"]}>
    <View style={styles.header}>
      <Text style={styles.kicker}>A little closer</Text>
      <Text style={styles.title}>Calls</Text>
      <Text style={styles.subtitle}>Your moments together, in one place.</Text>
    </View>
    {!CALLS_ENABLED ? <View style={styles.center}>
      <Ionicons name="call-outline" size={30} color={c.primaryDark} />
      <Text style={styles.emptyTitle}>Calls are being prepared</Text>
      <Text style={styles.emptyText}>Keep chatting and sharing voice messages while audio calls are checked for this beta.</Text>
    </View> : busy ? <View style={styles.center}><ActivityIndicator color={c.primary} /></View> : error ? <View style={styles.center}>
      <Text accessibilityRole="alert" style={styles.emptyText}>{error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry loading calls" onPress={() => { void load(); }} style={styles.retry} testID="calls-retry"><Text style={styles.retryText}>Try again</Text></Pressable>
    </View> : <FlatList
      data={currentCalls}
      keyExtractor={(call) => call.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<View style={styles.empty}>
        <Ionicons name="call-outline" size={28} color={c.primaryDark} />
        <Text style={styles.emptyTitle}>No calls yet</Text>
        <Text style={styles.emptyText}>{supported ? "Open a conversation to start an audio call." : "Audio calls are available in the browser while the installed app is being prepared."}</Text>
      </View>}
      renderItem={({ item }) => {
        const missed = item.status === "missed" || item.end_reason === "ringing_timeout";
        return <Pressable
          accessibilityRole="button"
          accessibilityLabel={"Call " + (item.other?.name || "contact")}
          accessibilityState={{ disabled: !supported || !item.other }}
          disabled={!supported || !item.other}
          onPress={() => { if (item.other) router.push({ pathname: "/call/[id]", params: { id: item.other.id, ...(["ringing", "active"].includes(item.status) ? { callId: item.id } : {}) } }); }}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.primaryBgSubtle }]}
          testID={"call-row-" + item.id}
        >
          <Avatar name={item.other?.name} seed={item.other?.id} photo={item.other?.avatar} size={48} />
          <View style={styles.rowMain}>
            <Text style={styles.rowName} numberOfLines={1}>{item.other?.name || "Contact"}</Text>
            <View style={styles.rowSubLine}>
              <Ionicons name={item.initiator_id === uid ? "arrow-up-outline" : "arrow-down-outline"} size={14} color={missed ? c.error : c.textSecondary} />
              <Text style={styles.rowSub}>{callHistoryLabel(item)}</Text>
            </View>
            <Text style={styles.date}>{dateLabel(item.created_at)}</Text>
          </View>
          {supported && item.other ? <View style={styles.callBtn}><Ionicons name="call-outline" size={20} color={c.primaryDark} /></View> : null}
        </Pressable>;
      }}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />}
  </SafeAreaView>;
}
const makeStyles = (c: any, f: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  kicker: { fontFamily: f.bodyMedium, fontSize: 13, color: c.textSecondary, marginBottom: 6 },
  title: { fontFamily: f.heading, fontSize: 32, color: c.text, letterSpacing: -0.5 },
  subtitle: { fontFamily: f.body, fontSize: 14, lineHeight: 22, color: c.textSecondary, marginTop: 8 },
  list: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.md, borderRadius: radius.lg, minHeight: 88 },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: f.bodyBold, fontSize: 16, color: c.text },
  rowSubLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  rowSub: { fontFamily: f.body, fontSize: 13, color: c.textSecondary, flexShrink: 1 },
  date: { fontFamily: f.body, fontSize: 12, color: c.textSecondary, marginTop: 4 },
  callBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primaryBgSubtle, alignItems: "center", justifyContent: "center" },
  separator: { height: 1, backgroundColor: c.border, marginHorizontal: spacing.lg },
  center: { flex: 1, padding: 28, alignItems: "center", justifyContent: "center", gap: 16 },
  empty: { padding: spacing.xl, alignItems: "center", gap: 12 },
  emptyTitle: { fontFamily: f.heading, fontSize: 22, color: c.text, textAlign: "center" },
  emptyText: { fontFamily: f.body, fontSize: 15, lineHeight: 23, color: c.textSecondary, textAlign: "center", maxWidth: 380 },
  retry: { minHeight: 48, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 24, backgroundColor: c.primaryBgSubtle },
  retryText: { fontFamily: f.bodyMedium, fontSize: 15, color: c.primaryDark },
});
