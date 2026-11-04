import React, {useCallback, useMemo, useRef, useState} from "react";
import {View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter, useFocusEffect} from "expo-router";
import {api, Chat} from "../../src/api";
import {layout, Palette, radius, spacing, typography} from "../../src/theme";
import {useTheme} from "../../src/ThemeContext";
import {useAuth} from "../../src/AuthContext";
import Avatar from "../../src/Avatar";
import {getEmote} from "../../src/emotes";
import {subscribeChatEvents} from "../../src/chatRealtime";
import {ContentFrame, IconButton, PageHeader, ScreenState} from "../../src/ScreenUI";

function timeAgo(iso?: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return minutes + "m";
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? hours + "h" : Math.floor(hours / 24) + "d";
}
function previewText(chat: Chat) {
  const message = chat.last_message;
  if (!message) return "Start a conversation";
  if (message.type === "text") return message.text || "";
  if (message.type === "emote") return (getEmote(message.emote_id)?.label || "A little feeling") + " emote";
  if (message.type === "voice") return "Voice message";
  if (message.type === "image") return "Photo";
  if (message.type === "file") return message.file_name || "File";
  if (message.type === "space_invite") return "An invitation to spend time together";
  return "";
}

export default function HomeScreen() {
  const router = useRouter(); const {c, f} = useTheme(); const {user} = useAuth();
  const uid = user?.id;
  const styles = useMemo(() => makeStyles(c, f), [c, f]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(""); const [focusedControl, setFocusedControl] = useState<string | null>(null);
  const request = useRef(0); const visible = useRef(false); const account = useRef<string | undefined>(undefined);
  const loaded = useRef(false);

  const load = useCallback(async (refresh = false) => {
    if (!uid) return;
    const current = ++request.current;
    if (refresh) setRefreshing(true);
    setError("");
    try {
      const data = await api.getAs<Chat[]>(uid, "/chats");
      if (!visible.current || current !== request.current) return;
      setChats(data); loaded.current = true;
    } catch {
      if (visible.current && current === request.current) setError("We couldn't refresh your conversations.");
    } finally {
      if (visible.current && current === request.current) {setLoading(false); setRefreshing(false);}
    }
  }, [uid]);

  useFocusEffect(useCallback(() => {
    visible.current = true;
    if (account.current !== uid) {account.current = uid; loaded.current = false; setChats([]); setError("");}
    setLoading(!loaded.current); void load();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = uid ? subscribeChatEvents(uid, () => {
      if (refreshTimer !== undefined) return;
      refreshTimer = setTimeout(() => {refreshTimer = undefined; if (visible.current) void load();}, 120);
    }) : () => {};
    return () => {visible.current = false; request.current++; unsubscribe(); if (refreshTimer !== undefined) clearTimeout(refreshTimer);};
  }, [uid, load]));

  return <SafeAreaView style={styles.safe} edges={["top"]}><ContentFrame reading>
    <PageHeader title="Chats" subtitle="Your people, a little closer." trailing={<View style={{flexDirection: "row", alignItems: "center", gap: 6}}>
      <IconButton icon="create-outline" label="Start a new conversation" onPress={() => router.push("/new-message")} testID="new-chat-button"/>
      <Pressable accessibilityRole="button" accessibilityLabel="Your profile" testID="profile-button" onPress={() => router.push("/you")}
        onFocus={() => setFocusedControl("profile")} onBlur={() => setFocusedControl(null)}
        style={[styles.profileBtn, {borderColor: focusedControl === "profile" ? c.primaryDark : "transparent"}]}>
        <Avatar name={user?.name} seed={user?.id} photo={user?.avatar} size={40}/>
      </Pressable>
    </View>}/>
    {loading ? <View style={styles.center} accessibilityLiveRegion="polite"><ActivityIndicator color={c.primaryDark}/><Text style={styles.loadingText}>Gathering your conversations…</Text></View> :
      error && !chats.length ? <ScreenState error icon="cloud-offline-outline" title="Let's reconnect" detail={error + " Your account is still here."}
        action={{label: "Try again", onPress: () => {setLoading(true); void load();}, testID: "chats-retry"}}/> :
      <FlatList data={chats} keyExtractor={chat => chat.id} contentContainerStyle={styles.list}
        initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {void load(true);}} tintColor={c.primaryDark}/>}
        ListHeaderComponent={error ? <Pressable accessibilityRole="button" accessibilityLabel="Retry refreshing conversations"
          onPress={() => {void load(true);}} style={[styles.refreshNotice, {backgroundColor: c.errorBg}]}>
          <Text accessibilityLiveRegion="polite" style={styles.noticeText}>{error} Tap to retry.</Text>
        </Pressable> : null}
        ListEmptyComponent={<ScreenState title="Good things start with a hello." detail="Start a conversation with someone who's already here, or invite someone close."
          action={{label: "New conversation", onPress: () => router.push("/new-message")}}
          secondaryAction={{label: "Invite someone", onPress: () => router.push("/invite")}}/>}
        renderItem={({item}) => <Pressable accessibilityRole="button"
          accessibilityLabel={(item.other?.name || "Conversation") + ". " + previewText(item)}
          onPress={() => router.push("/chat/" + item.id)} testID={"chat-row-" + item.id}
          onFocus={() => setFocusedControl(item.id)} onBlur={() => setFocusedControl(null)}
          style={({pressed}) => [styles.row, {backgroundColor: pressed ? c.primaryBgSubtle : "transparent", borderColor: focusedControl === item.id ? c.primaryDark : "transparent"}]}>
          <Avatar name={item.other?.name} seed={item.other?.id} photo={item.other?.avatar} size={52}/>
          <View style={styles.rowMain}>
            <View style={styles.rowTop}><Text style={styles.rowName} numberOfLines={1}>{item.other?.name || "Conversation"}</Text><Text style={styles.rowTime}>{timeAgo(item.updated_at)}</Text></View>
            <Text style={styles.rowPreview} numberOfLines={2}>{item.last_message?.sender_id === uid ? "You: " : ""}{previewText(item)}</Text>
          </View>
        </Pressable>}
        ItemSeparatorComponent={() => <View style={styles.sep}/>}/>}
  </ContentFrame></SafeAreaView>;
}
const makeStyles = (c: Palette, f: any) => StyleSheet.create({
  safe: {flex: 1, backgroundColor: c.bg},
  profileBtn: {width: layout.touchTarget, height: layout.touchTarget, borderRadius: 18, borderWidth: 2, alignItems: "center", justifyContent: "center"},
  list: {paddingHorizontal: spacing.md, paddingBottom: spacing.xl, flexGrow: 1},
  row: {minHeight: 88, flexDirection: "row", alignItems: "center", paddingVertical: 15, paddingHorizontal: 12, gap: 14, borderRadius: radius.lg, borderWidth: 2},
  rowMain: {flex: 1, minWidth: 0},
  rowTop: {flexDirection: "row", alignItems: "center", gap: 8},
  rowName: {...typography.body, fontFamily: f.bodyBold, color: c.text, flex: 1},
  rowTime: {...typography.caption, fontFamily: f.body, color: c.textSecondary},
  rowPreview: {...typography.caption, fontFamily: f.body, color: c.textSecondary, marginTop: 4},
  sep: {height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 82, marginRight: 16},
  center: {flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: 12},
  loadingText: {...typography.caption, fontFamily: f.body, color: c.textSecondary, textAlign: "center"},
  refreshNotice: {padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm},
  noticeText: {...typography.caption, fontFamily: f.body, color: c.text},
});
