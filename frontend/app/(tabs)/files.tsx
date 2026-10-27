import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Linking,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, Message, User } from "../../src/api";
import { radius, spacing } from "../../src/theme";
import { useTheme } from "../../src/ThemeContext";
import { spacesApi, SpaceSession } from "../../src/spaces";

type FileMsg = Message & { sender: User | null };

const SECTIONS = ["Recent", "By person", "Categories", "Sessions"] as const;
type Section = (typeof SECTIONS)[number];

const CATEGORIES: { key: "image" | "file" | "voice"; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "image", label: "Images", icon: "image-outline" },
  { key: "file", label: "Documents", icon: "document-text-outline" },
  { key: "voice", label: "Audio", icon: "musical-notes-outline" },
];

function fmtBytes(b?: number | null) {
  if (!b) return "";
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b > 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

function dateLabel(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function FilesScreen() {
  const { c, f } = useTheme();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const [section, setSection] = useState<Section>("Recent");
  const [files, setFiles] = useState<FileMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<null | "image" | "file" | "voice">(null);
  const [sessions, setSessions] = useState<SpaceSession[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [data, sess] = await Promise.all([
        api.get<FileMsg[]>("/files"),
        spacesApi.sessions().catch(() => [] as SpaceSession[]),
      ]);
      setFiles(data);
      setSessions(sess);
    } catch {
      setError("Couldn't load your library");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const byPerson = useMemo(() => {
    const map = new Map<string, { user: User; items: FileMsg[] }>();
    for (const f of files) {
      if (!f.sender) continue;
      const k = f.sender.id;
      if (!map.has(k)) map.set(k, { user: f.sender, items: [] });
      map.get(k)!.items.push(f);
    }
    return Array.from(map.values());
  }, [files]);

  const filtered = useMemo(() => {
    if (section === "Categories" && activeCat) return files.filter((f) => f.type === activeCat);
    return files;
  }, [files, section, activeCat]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Library</Text>
        <Text style={styles.title}>Files</Text>
      </View>

      <View style={styles.segmentRow}>
        {SECTIONS.map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              setSection(s);
              setActiveCat(null);
            }}
            style={[styles.segment, section === s && styles.segmentActive]}
            testID={`files-segment-${s}`}
          >
            <Text style={[styles.segmentText, section === s && styles.segmentTextActive]}>
              {s}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : error ? (
        <Pressable onPress={load} style={styles.center} testID="files-retry">
          <Text style={styles.errorTitle}>{error}</Text>
          <Text style={styles.errorRetry}>Tap to retry</Text>
        </Pressable>
      ) : section === "Categories" && !activeCat ? (
        <ScrollView contentContainerStyle={styles.catGrid}>
          {CATEGORIES.map((cat) => {
            const count = files.filter((f) => f.type === cat.key).length;
            return (
              <Pressable
                key={cat.key}
                onPress={() => setActiveCat(cat.key)}
                style={({ pressed }) => [
                  styles.catCard,
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
                testID={`category-${cat.key}`}
              >
                <View style={styles.catIcon}>
                  <Ionicons name={cat.icon} size={26} color={c.primaryDark} />
                </View>
                <Text style={styles.catLabel}>{cat.label}</Text>
                <Text style={styles.catCount}>{count} items</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setSection("Sessions")}
            style={({ pressed }) => [
              styles.catCard,
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
            testID="category-sessions"
          >
            <View style={styles.catIcon}>
              <Ionicons name="planet-outline" size={26} color={c.primaryDark} />
            </View>
            <Text style={styles.catLabel}>Sessions</Text>
            <Text style={styles.catCount}>{sessions.length} shared moments</Text>
          </Pressable>
        </ScrollView>
      ) : section === "By person" ? (
        <FlatList
          data={byPerson}
          keyExtractor={(p) => p.user.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.personCard}>
              <Text style={styles.personName}>{item.user.name}</Text>
              <Text style={styles.personMeta}>{item.items.length} items</Text>
              <View style={styles.personFiles}>
                {item.items.slice(0, 3).map((f) => (
                  <FileRow key={f.id} f={f} />
                ))}
              </View>
            </View>
          )}
          ListEmptyComponent={<EmptyHint label="No shared files yet." />}
        />
      ) : section === "Sessions" ? (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <SessionRow session={item} />}
          ListEmptyComponent={
            <EmptyHint label="Past shared sessions will collect here." />
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <FileRow f={item} showSender />}
          ListEmptyComponent={<EmptyHint label="Nothing here yet." />}
          ListHeaderComponent={
            section === "Categories" && activeCat ? (
              <Pressable onPress={() => setActiveCat(null)} style={styles.backLink}>
                <Ionicons name="chevron-back" size={16} color={c.primary} />
                <Text style={styles.backText}>All categories</Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

function FileRow({ f: fileItem, showSender = false }: { f: FileMsg; showSender?: boolean }) {
  const { c, f: font } = useTheme();
  const styles = React.useMemo(() => makeStyles(c, font), [c, font]);
  const icon =
    fileItem.type === "image" ? "image-outline" : fileItem.type === "voice" ? "musical-notes-outline" : "document-text-outline";
  const title =
    fileItem.file_name || (fileItem.type === "voice" ? "Voice message" : fileItem.type === "image" ? "Image" : "File");
  return (
    <Pressable disabled={!fileItem.attachment_id} accessibilityLabel={"Download " + title} onPress={async () => {
      try { const result = await api.get<{url:string}>("/attachments/" + fileItem.attachment_id + "/download"); await Linking.openURL(result.url); }
      catch { Alert.alert("Download failed", "Please try again."); }
    }} style={styles.fileRow}>
      <View style={styles.fileIcon}>
        <Ionicons name={icon as any} size={20} color={c.primaryDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fileTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.fileSub} numberOfLines={1}>
          {showSender && fileItem.sender ? `${fileItem.sender.name} · ` : ""}
          {fmtBytes(fileItem.file_size) || dateLabel(fileItem.created_at)}
        </Text>
      </View>
      <Text style={styles.fileDate}>{dateLabel(fileItem.created_at)}</Text>
    </Pressable>
  );
}

function EmptyHint({ label }: { label: string }) {
  const { c, f } = useTheme();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  );
}

function SessionRow({ session }: { session: SpaceSession }) {
  const { c, f } = useTheme();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const mode = session.summary?.mode || "idle";
  const title = session.summary?.title || session.space_name;
  const when = session.summary?.ended_at
    ? new Date(session.summary.ended_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
  return (
    <View style={styles.fileRow}>
      <View style={[styles.fileIcon, { backgroundColor: c.primaryBgSubtle }]}>
        <Ionicons
          name={mode === "video" ? "videocam-outline" : mode === "audio" ? "musical-notes-outline" : "planet-outline"}
          size={20}
          color={c.primaryDark}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fileTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.fileSub} numberOfLines={1}>
          {session.space_name} · {mode === "video" ? "watched together" : mode === "audio" ? "listened together" : "session"}
        </Text>
      </View>
      <Text style={styles.fileDate}>{when}</Text>
    </View>
  );
}

const makeStyles = (c: any, f: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  kicker: {
    fontFamily: f.bodyMedium,
    fontSize: 12,
    color: c.textTertiary,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: { fontFamily: f.heading, fontSize: 32, color: c.text, letterSpacing: -0.5 },
  segmentRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  segment: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: c.surface,
  },
  segmentActive: { backgroundColor: c.primary },
  segmentText: { color: c.textSecondary, fontFamily: f.bodyMedium, fontSize: 13 },
  segmentTextActive: { color: c.textInverse },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: c.primaryBgSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  fileTitle: { fontFamily: f.bodyMedium, fontSize: 15, color: c.text },
  fileSub: { fontFamily: f.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  fileDate: { fontFamily: f.body, fontSize: 12, color: c.textTertiary },
  catGrid: {
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  catCard: {
    width: "48%",
    aspectRatio: 1,
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    justifyContent: "space-between",
  },
  catIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: c.primaryBgSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  catLabel: { fontFamily: f.heading, fontSize: 22, color: c.text },
  catCount: { fontFamily: f.body, fontSize: 13, color: c.textSecondary },
  personCard: {
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  personName: { fontFamily: f.bodyBold, fontSize: 16, color: c.text },
  personMeta: { fontFamily: f.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  personFiles: { marginTop: spacing.sm, gap: spacing.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorTitle: { fontFamily: f.bodyMedium, fontSize: 15, color: c.textSecondary, textAlign: "center" },
  errorRetry: { fontFamily: f.body, fontSize: 13, color: c.primary, marginTop: 8 },
  empty: { padding: spacing.xl, alignItems: "center" },
  emptyText: { fontFamily: f.body, color: c.textSecondary },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  backText: { color: c.primary, fontFamily: f.bodyMedium, fontSize: 14, marginLeft: 4 },
});
