import React, {useCallback, useMemo, useRef, useState} from "react";
import {View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, ScrollView, Alert} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useFocusEffect, useRouter} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {api, Message, User} from "../../src/api";
import {layout, radius, spacing, typography} from "../../src/theme";
import {useTheme} from "../../src/ThemeContext";
import {useAuth} from "../../src/AuthContext";
import {spacesApi, SpaceSession} from "../../src/spaces";
import {openPrivateDownload} from "../../src/downloads";
import FileSharingStatus from "../../src/FileSharingStatus";
import PrivateImageCard from "../../src/PrivateImageCard";
import {isImageFilename} from "../../src/imagePreview";
import {ContentFrame, PageHeader, ScreenState} from "../../src/ScreenUI";

type FileMsg = Message & {sender: User | null};
type Category = "image" | "file" | "voice";
const fileCategory = (file: FileMsg) => file.type === "image" || (file.type === "file" && isImageFilename(file.file_name)) ? "image" : file.type;
const SECTIONS = ["Recent", "By person", "Categories", "Sessions"] as const;
type Section = typeof SECTIONS[number];
const CATEGORIES: {key: Category; label: string; icon: keyof typeof Ionicons.glyphMap}[] = [
  {key: "image", label: "Images", icon: "image-outline"},
  {key: "file", label: "Documents", icon: "document-text-outline"},
  {key: "voice", label: "Audio", icon: "musical-notes-outline"},
];
function fmtBytes(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}
function dateLabel(iso?: string) {
  return iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString(undefined, {month: "short", day: "numeric"}) : "";
}

export default function FilesScreen() {
  const {c, f} = useTheme(); const {user} = useAuth(); const uid = user?.id; const router = useRouter();
  const styles = useMemo(() => makeStyles(c, f), [c, f]);
  const [section, setSection] = useState<Section>("Recent");
  const [files, setFiles] = useState<FileMsg[]>([]); const [sessions, setSessions] = useState<SpaceSession[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [sessionsError, setSessionsError] = useState(false);
  const [activeCat, setActiveCat] = useState<Category | null>(null); const [personId, setPersonId] = useState<string | null>(null);
  const request = useRef(0); const visible = useRef(false);
  const load = useCallback(async () => {
    if (!uid) return;
    const current = ++request.current; setError("");
    try {
      const [items, moments] = await Promise.allSettled([api.getAs<FileMsg[]>(uid, "/files"), spacesApi.sessions(uid)]);
      if (!visible.current || current !== request.current) return;
      if (items.status === "rejected") throw items.reason;
      setFiles(items.value);
      setSessions(moments.status === "fulfilled" ? moments.value : []);
      setSessionsError(moments.status === "rejected");
    } catch {
      if (visible.current && current === request.current) setError("We couldn't load your shared files.");
    } finally {
      if (visible.current && current === request.current) setLoading(false);
    }
  }, [uid]);
  useFocusEffect(useCallback(() => {
    visible.current = true; setFiles([]); setSessions([]); setLoading(true); setSessionsError(false);
    setActiveCat(null); setPersonId(null); void load();
    return () => {visible.current = false; request.current++;};
  }, [load]));
  const retry = () => {setLoading(true); void load();};
  const byPerson = useMemo(() => {
    const groups = new Map<string, {user: User; items: FileMsg[]}>();
    for (const item of files) {
      if (!item.sender) continue;
      if (!groups.has(item.sender.id)) groups.set(item.sender.id, {user: item.sender, items: []});
      groups.get(item.sender.id)!.items.push(item);
    }
    return Array.from(groups.values());
  }, [files]);
  const filtered = useMemo(() => {
    if (section === "Categories" && activeCat) return files.filter(item => fileCategory(item) === activeCat);
    if (section === "By person" && personId) return files.filter(item => item.sender?.id === personId);
    return files;
  }, [files, section, activeCat, personId]);
  const back = section === "Categories" && activeCat ? {label: "All categories", action: () => setActiveCat(null)} :
    section === "By person" && personId ? {label: "Back to people", action: () => setPersonId(null)} : null;

  let content: React.ReactNode;
  if (loading) content = <View style={styles.center} accessibilityLiveRegion="polite"><ActivityIndicator color={c.primaryDark}/><Text style={styles.loadingText}>Gathering your shared things…</Text></View>;
  else if (error) content = <ScreenState error icon="cloud-offline-outline" title="Let's reconnect" detail={error} action={{label: "Try again", testID: "files-retry", onPress: retry}}/>;
  else if (section === "Categories" && !activeCat) content = <ScrollView contentContainerStyle={styles.catGrid}>
    {CATEGORIES.map(category => {
      const count = files.filter(item => fileCategory(item) === category.key).length;
      return <Pressable key={category.key} accessibilityRole="button" accessibilityLabel={category.label}
        onPress={() => setActiveCat(category.key)} testID={"category-" + category.key}
        style={({pressed}) => [styles.catCard, {opacity: pressed ? 0.8 : 1}]}>
        <View style={styles.catIcon}><Ionicons name={category.icon} size={26} color={c.primaryDark}/></View>
        <Text style={styles.catLabel}>{category.label}</Text><Text style={styles.catCount}>{count} {count === 1 ? "item" : "items"}</Text>
      </Pressable>;
    })}
    <Pressable accessibilityRole="button" accessibilityLabel="Shared sessions" onPress={() => setSection("Sessions")} testID="category-sessions"
      style={({pressed}) => [styles.catCard, {opacity: pressed ? 0.8 : 1}]}>
      <View style={styles.catIcon}><Ionicons name="planet-outline" size={26} color={c.primaryDark}/></View>
      <Text style={styles.catLabel}>Sessions</Text><Text style={styles.catCount}>{sessionsError ? "Reconnect to view" : sessions.length + " shared moments"}</Text>
    </Pressable>
  </ScrollView>;
  else if (section === "By person" && !personId) content = <FlatList data={byPerson} keyExtractor={person => person.user.id} contentContainerStyle={styles.list}
    renderItem={({item}) => <View style={styles.personCard}>
      <Text style={styles.personName}>{item.user.name}</Text><Text style={styles.personMeta}>{item.items.length} shared items</Text>
      <View style={styles.personFiles}>{item.items.slice(0, 3).map(file => <FileRow key={file.id} file={file}/>)}</View>
      {item.items.length > 3 ? <Pressable accessibilityRole="button" accessibilityLabel={"View all files from " + item.user.name} onPress={() => setPersonId(item.user.id)} style={styles.backLink}>
        <Text style={styles.backText}>View all {item.items.length} items</Text><Ionicons name="arrow-forward" size={16} color={c.primaryDark}/>
      </Pressable> : null}
    </View>} ListEmptyComponent={<EmptyHint label="No shared files yet."/>}/>;
  else if (section === "Sessions" && sessionsError) content = <ScreenState error icon="planet-outline" title="Let's find your moments" detail="We couldn't load past sessions. Try reconnecting." action={{label: "Try again", onPress: retry}}/>;
  else if (section === "Sessions") content = <FlatList data={sessions} keyExtractor={session => session.id} contentContainerStyle={styles.list}
    renderItem={({item}) => <SessionRow session={item}/>} ListEmptyComponent={<EmptyHint sessions label="Past shared sessions will collect here."/>}/>;
  else content = <FlatList data={filtered} keyExtractor={item => item.id} contentContainerStyle={styles.list}
    initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7}
    renderItem={({item}) => <FileRow file={item} showSender/>} ListEmptyComponent={<EmptyHint label="Nothing here yet."/>}
    ListHeaderComponent={back ? <Pressable accessibilityRole="button" accessibilityLabel={back.label} onPress={back.action} style={styles.backLink}>
      <Ionicons name="chevron-back" size={16} color={c.primaryDark}/><Text style={styles.backText}>{back.label}</Text>
    </Pressable> : null}/>;

  return <SafeAreaView style={styles.safe} edges={["top"]}><ContentFrame reading>
    <PageHeader title="Files" subtitle="The little things you've shared."/>
    <View style={styles.intro}><FileSharingStatus/>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Upload a file" onPress={() => router.push("/new-message?mode=file")} style={({pressed}) => [styles.shareAction, {opacity: pressed ? 0.8 : 1}]}>
          <Ionicons name="cloud-upload-outline" size={21} color={c.primaryDark}/><Text style={styles.actionText}>Upload file</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Share a photo" onPress={() => router.push("/new-message?mode=photo")} style={({pressed}) => [styles.shareAction, {opacity: pressed ? 0.8 : 1}]}>
          <Ionicons name="image-outline" size={21} color={c.primaryDark}/><Text style={styles.actionText}>Share photo</Text>
        </Pressable>
      </View>
    </View>
    <View style={styles.segmentWrap}><ScrollView horizontal style={{flexGrow: 0}} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmentRow}>
      {SECTIONS.map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value} accessibilityState={{selected: section === value}}
        onPress={() => {setSection(value); setActiveCat(null); setPersonId(null);}}
        style={[styles.segment, {backgroundColor: section === value ? c.text : c.surface}]} testID={"files-segment-" + value}>
        <Text style={[styles.segmentText, {color: section === value ? c.bg : c.textSecondary}]}>{value}</Text>
      </Pressable>)}
    </ScrollView></View>
    {content}
  </ContentFrame></SafeAreaView>;
}

function FileRow({file, showSender = false}: {file: FileMsg; showSender?: boolean}) {
  const {c, f} = useTheme(); const {user} = useAuth(); const styles = useMemo(() => makeStyles(c, f), [c, f]);
  const title = file.file_name || (file.type === "voice" ? "Voice message" : file.type === "image" ? "Image" : "File");
  const subtitle = [showSender ? file.sender?.name : null, fmtBytes(file.file_size), dateLabel(file.created_at)].filter(Boolean).join(" · ");
  if (fileCategory(file) === "image" && file.attachment_id) return <PrivateImageCard compact attachmentId={file.attachment_id} fileName={title}
    unavailable={file.attachment_deleted} canDelete={file.sender_id === user?.id} subtitle={subtitle}/>;
  const disabled = !file.attachment_id || !!file.attachment_deleted;
  return <Pressable disabled={disabled} accessibilityRole="button" accessibilityState={{disabled}}
    accessibilityLabel={(file.attachment_deleted ? "Unavailable: " : "Download ") + title}
    onPress={async () => {
      try {if (!user?.id) return; const result = await api.getAs<{url: string}>(user.id, "/attachments/" + file.attachment_id + "/download"); await openPrivateDownload(result.url);}
      catch {Alert.alert("Download failed", "Please try again.");}
    }} style={({pressed}) => [styles.fileRow, {opacity: disabled ? 0.7 : pressed ? 0.8 : 1}]}>
    <View style={styles.fileIcon}><Ionicons name={file.type === "voice" ? "musical-notes-outline" : "document-text-outline"} size={22} color={c.primaryDark}/></View>
    <View style={{flex: 1, minWidth: 0}}><Text style={styles.fileTitle} numberOfLines={1}>{title}</Text><Text style={styles.fileSub} numberOfLines={2}>{file.attachment_deleted ? "Removed from the conversation" : subtitle}</Text></View>
    {!disabled ? <Ionicons name="download-outline" size={18} color={c.textSecondary}/> : null}
  </Pressable>;
}
function EmptyHint({label, sessions = false}: {label: string; sessions?: boolean}) {
  const router = useRouter();
  return <ScreenState icon={sessions ? "planet-outline" : "folder-open-outline"} title={sessions ? "A moment to remember" : "A little room for shared things"}
    detail={label + (sessions ? " Join a Space to spend time together." : " Photos, documents and voice memos stay together here.")}
    action={{label: sessions ? "Open Spaces" : "Share a file", onPress: () => router.push(sessions ? "/(tabs)/spaces" : "/new-message?mode=file")}}/>;
}
function SessionRow({session}: {session: SpaceSession}) {
  const {c, f} = useTheme(); const styles = useMemo(() => makeStyles(c, f), [c, f]);
  const mode = session.summary?.mode || "idle";
  return <View style={styles.fileRow}>
    <View style={styles.fileIcon}><Ionicons name={mode === "video" ? "videocam-outline" : mode === "audio" ? "musical-notes-outline" : "planet-outline"} size={22} color={c.primaryDark}/></View>
    <View style={{flex: 1, minWidth: 0}}><Text style={styles.fileTitle} numberOfLines={2}>{session.summary?.title || session.space_name}</Text>
      <Text style={styles.fileSub}>{session.space_name} · {mode === "video" ? "Watched together" : mode === "audio" ? "Listened together" : "Time together"}</Text>
      <Text style={styles.fileSub}>{dateLabel(session.summary?.ended_at)}</Text></View>
  </View>;
}
const makeStyles = (c: any, f: any) => StyleSheet.create({
  safe: {flex: 1, backgroundColor: c.bg},
  intro: {paddingHorizontal: spacing.lg},
  actions: {flexDirection: "row", gap: 10, marginBottom: 8},
  shareAction: {flex: 1, minWidth: 0, minHeight: layout.touchTarget, borderRadius: radius.md, padding: 12, backgroundColor: c.surface, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center"},
  actionText: {...typography.caption, color: c.text, fontFamily: f.bodyMedium, flexShrink: 1},
  segmentWrap: {flexShrink: 0, marginBottom: spacing.sm},
  segmentRow: {paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm},
  segment: {minHeight: layout.touchTarget, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.full},
  segmentText: {...typography.caption, fontFamily: f.bodyMedium},
  list: {paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm, flexGrow: 1},
  fileRow: {minHeight: 80, flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: c.surface, borderRadius: radius.lg, gap: 12, marginBottom: spacing.sm},
  fileIcon: {width: 40, height: 40, borderRadius: radius.sm, backgroundColor: c.primaryBgSubtle, alignItems: "center", justifyContent: "center"},
  fileTitle: {...typography.body, fontFamily: f.bodyMedium, color: c.text},
  fileSub: {...typography.caption, fontFamily: f.body, color: c.textSecondary, marginTop: 3},
  catGrid: {paddingHorizontal: spacing.md, flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingBottom: spacing.xl},
  catCard: {flexBasis: "45%", flexGrow: 1, minWidth: 120, minHeight: 184, backgroundColor: c.surface, borderRadius: radius.xl, padding: 20, gap: 12},
  catIcon: {width: 48, height: 48, borderRadius: 16, backgroundColor: c.primaryBgSubtle, alignItems: "center", justifyContent: "center"},
  catLabel: {fontFamily: f.heading, fontSize: 20, lineHeight: 26, color: c.text},
  catCount: {...typography.caption, fontFamily: f.body, color: c.textSecondary},
  personCard: {backgroundColor: c.surface, borderRadius: radius.xl, padding: spacing.md, marginBottom: spacing.md},
  personName: {...typography.body, fontFamily: f.bodyBold, color: c.text},
  personMeta: {...typography.caption, fontFamily: f.body, color: c.textSecondary, marginTop: 2},
  personFiles: {marginTop: spacing.md, gap: spacing.sm},
  center: {flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: 12},
  loadingText: {...typography.caption, fontFamily: f.body, color: c.textSecondary, textAlign: "center"},
  backLink: {minHeight: layout.touchTarget, flexDirection: "row", gap: 6, alignItems: "center", paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.sm},
  backText: {...typography.caption, color: c.primaryDark, fontFamily: f.bodyMedium},
});
