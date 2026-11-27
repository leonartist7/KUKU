import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { getSessionUserId } from "../../src/api";
import { useTheme } from "../../src/ThemeContext";
import { useAuth } from "../../src/AuthContext";
import type { Palette } from "../../src/theme";
import { spacesApi, type Space } from "../../src/spaces";
import Avatar from "../../src/Avatar";

export default function SpacesScreen() {
  const router = useRouter(), { c, f } = useTheme(), { user } = useAuth(), uid = user?.id || "";
  const styles = useMemo(() => makeStyles(c, f), [c, f]);
  const [active, setActive] = useState<Space[]>([]), [saved, setSaved] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState(""), [search, setSearch] = useState("");
  const [dataUid, setDataUid] = useState("");
  const generation = useRef(0), account = useRef(uid); account.current = uid;
  const load = useCallback(async () => {
    if (!uid) return;
    const request = ++generation.current; setError("");
    try {
      const data = await spacesApi.list(uid);
      if (generation.current === request && getSessionUserId() === uid && account.current === uid) { setActive(data.active); setSaved(data.saved); setDataUid(uid); }
    } catch (cause) {
      if (generation.current === request && account.current === uid) setError(cause instanceof Error ? cause.message : "Your rooms could not be loaded. Try again.");
    } finally {
      if (generation.current === request && account.current === uid) { setLoading(false); setRefreshing(false); }
    }
  }, [uid]);
  useFocusEffect(useCallback(() => {
    setActive([]); setSaved([]); setLoading(true); setSearch("");
    void load();
    return () => { generation.current++; };
  }, [load]));
  const query = search.trim().toLocaleLowerCase(), matches = (space: Space) => !query || space.name.toLocaleLowerCase().includes(query);
  const activeRooms = dataUid === uid ? active.filter(matches) : [], rooms = dataUid === uid ? saved.filter(matches) : [];
  return <SafeAreaView style={styles.safe} edges={["top"]}>
    <View style={styles.header}>
      <View style={{ flex: 1 }}><Text style={styles.kicker}>A little time together</Text><Text style={styles.title}>Spaces</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Create a Space" onPress={() => router.push("/space/create")} style={styles.createIcon} testID="create-space-button"><Ionicons name="add" size={25} color={c.textInverse} /></Pressable>
    </View>
    {loading ? <View style={styles.center}><ActivityIndicator color={c.primaryDark} /><Text style={styles.subtitle}>Opening your rooms…</Text></View> :
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={c.primaryDark} />} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}><View style={styles.introIcon}><Ionicons name="planet-outline" size={38} color={c.primaryDark} /></View><View style={{ flex: 1 }}><Text style={styles.introTitle}>Make room for each other.</Text><Text style={styles.subtitle}>A song, a video, a quiet catch-up. Your own small place to be together.</Text></View></View>
        {error ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.link}>Try again</Text></Pressable></View> : null}
        {saved.length + active.length > 4 ? <View style={styles.search}><Ionicons name="search-outline" size={20} color={c.textSecondary} /><TextInput accessibilityLabel="Find a Space" value={search} onChangeText={setSearch} placeholder="Find a room" placeholderTextColor={c.textSecondary} style={styles.searchInput} /></View> : null}
        <Section title="Happening now" count={activeRooms.length} />
        {activeRooms.length ? <View style={styles.grid}>{activeRooms.map(space => <RoomCard key={space.id} space={space} active onOpen={() => router.push("/space/" + space.id)} />)}</View> :
          <View style={styles.empty}><Text style={styles.body}>{query ? "No active rooms match that name." : "It's quiet here for now."}</Text><Text style={styles.subtitle}>Open one of your rooms to spend a little time together.</Text></View>}
        <Section title="Your rooms" count={rooms.length} />
        {rooms.length ? <View style={{ gap: 12 }}>{rooms.map(space => <RoomCard key={space.id} space={space} onOpen={() => router.push("/space/" + space.id)} />)}</View> :
          <View style={styles.empty}><Text style={styles.body}>{query ? "No rooms match that name." : "Your first room starts with someone you know."}</Text><Text style={styles.subtitle}>Choose your people, give it a name and settle in.</Text><Pressable accessibilityRole="button" onPress={() => router.push("/space/create")} style={styles.createButton}><Text style={{ color: c.textInverse, fontFamily: f.bodyBold, fontSize: 16 }}>Create a Space</Text><Ionicons name="arrow-forward" size={18} color={c.textInverse} /></Pressable></View>}
        <Text style={styles.footnote}>Private rooms for the people you've invited. Hosting controls shared playback; everyone keeps their own volume.</Text>
      </ScrollView>}
  </SafeAreaView>;
}
function Section({ title, count }: { title: string; count: number }) {
  const { c, f } = useTheme();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 28, marginBottom: 12 }}><Text style={{ fontFamily: f.bodyBold, fontSize: 16, color: c.text }}>{title}</Text><Text style={{ color: c.textSecondary, fontFamily: f.body, fontSize: 13 }}>{count}</Text></View>;
}
function RoomCard({ space, active, onOpen }: { space: Space; active?: boolean; onOpen: () => void }) {
  const { c, f } = useTheme(), styles = useMemo(() => makeStyles(c, f), [c, f]);
  const present = space.member_users.filter(person => space.active_members.includes(person.id));
  const people = active ? present : space.member_users;
  return <Pressable accessibilityRole="button" accessibilityLabel={space.name + ", " + present.length + " here"} onPress={onOpen} style={({ pressed }) => [styles.room, active && styles.activeRoom, pressed && { opacity: 0.8 }]} testID={(active ? "active-space-" : "room-row-") + space.id}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={[styles.roomIcon, active && { backgroundColor: c.primaryBgSubtle }]}><Ionicons name={space.mode === "video" ? "videocam-outline" : space.mode === "audio" ? "musical-notes-outline" : "planet-outline"} size={25} color={c.primaryDark} /></View>
      <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.roomTitle} numberOfLines={1}>{space.name}</Text><Text style={styles.subtitle} numberOfLines={1}>{active ? (space.mode === "video" ? "Watching together" : space.mode === "audio" ? "Listening together" : "Hanging out") : space.member_users.map(person => person.name.split(" ")[0]).join(", ") || "Just you"}</Text></View>
      <Ionicons name="chevron-forward" size={19} color={c.textSecondary} />
    </View>
    {active ? <View style={{ gap: 12, marginTop: 16 }}>
      {space.content?.title ? <Text style={styles.body} numberOfLines={2}>{space.content.title}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center" }}>{people.slice(0, 4).map((person, index) => <View key={person.id} style={{ marginLeft: index ? -8 : 0 }}><Avatar name={person.name} seed={person.id} photo={person.avatar} size={30} /></View>)}<Text style={[styles.subtitle, { marginLeft: 10 }]}>{present.length} here</Text></View>
    </View> : null}
  </Pressable>;
}
const makeStyles = (c: Palette, f: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { width: "100%", maxWidth: 1120, alignSelf: "center", flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  kicker: { color: c.textSecondary, fontFamily: f.bodyMedium, fontSize: 13, marginBottom: 5 },
  title: { color: c.text, fontFamily: f.heading, fontSize: 34, lineHeight: 42 },
  createIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  content: { width: "100%", maxWidth: 1120, alignSelf: "center", padding: 24, paddingTop: 8, paddingBottom: 44 },
  intro: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 16, marginBottom: 4 },
  introIcon: { width: 72, height: 80, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceElevated },
  introTitle: { color: c.text, fontFamily: f.heading, fontSize: 23, lineHeight: 29, marginBottom: 6 },
  subtitle: { color: c.textSecondary, fontFamily: f.body, fontSize: 14, lineHeight: 21 },
  body: { color: c.text, fontFamily: f.bodyMedium, fontSize: 16, lineHeight: 23 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  room: { backgroundColor: c.surface, borderRadius: 22, padding: 18 },
  activeRoom: { flexGrow: 1, flexShrink: 1, flexBasis: 280, maxWidth: 520, backgroundColor: c.surfaceElevated },
  roomIcon: { width: 48, height: 48, borderRadius: 18, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
  roomTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 17, lineHeight: 24, marginBottom: 3 },
  empty: { gap: 8, backgroundColor: c.surface, borderRadius: 22, padding: 24 },
  createButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, alignSelf: "flex-start", minHeight: 52, paddingHorizontal: 22, borderRadius: 26, backgroundColor: c.primary, marginTop: 12 },
  footnote: { fontFamily: f.body, fontSize: 13, lineHeight: 20, color: c.textSecondary, textAlign: "center", maxWidth: 540, alignSelf: "center", marginTop: 28 },
  notice: { backgroundColor: c.errorBg, borderRadius: 18, padding: 16, gap: 6 },
  error: { color: c.error, fontFamily: f.body, fontSize: 14, lineHeight: 21 },
  retry: { minHeight: 44, justifyContent: "center" },
  link: { color: c.primaryDark, fontFamily: f.bodyBold, fontSize: 15 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, backgroundColor: c.surface, borderRadius: 22, marginTop: 16 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, color: c.text, fontFamily: f.body, fontSize: 16 },
});
