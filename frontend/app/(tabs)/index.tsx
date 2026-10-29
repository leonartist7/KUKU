import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { api, Chat } from "../../src/api";
import { Palette, radius, spacing } from "../../src/theme";
import { useTheme } from "../../src/ThemeContext";
import { useAuth } from "../../src/AuthContext";
import Avatar from "../../src/Avatar";

function timeAgo(iso?: string) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function previewText(chat: Chat) {
  const lm = chat.last_message;
  if (!lm) return "Start a conversation";
  if (lm.type === "text") return lm.text || "";
  if (lm.type === "voice") return "Voice message";
  if (lm.type === "image") return "Photo";
  if (lm.type === "file") return lm.file_name || "File";
  return "";
}

export default function HomeScreen() {
  const router = useRouter();
  const { c, f } = useTheme();
  const { user } = useAuth();
  const styles = makeStyles(c, f);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<Chat[]>("/chats");
      setChats(data);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.push("/you")}
          style={({ pressed }) => [
            styles.profileBtn,
            pressed && { transform: [{ scale: 0.96 }] },
          ]}
          testID="profile-button"
        >
          <Avatar name={user?.name} seed={user?.id} size={40} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.kicker}>Today</Text>
          <Text style={styles.title}>KUKU</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(ch) => ch.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={c.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Good things start with a hello.</Text>
              <Text style={styles.emptyText}>Invite someone close, or start a conversation with a contact who's already here.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push("/invite")} style={{padding: 15, marginTop: 16, backgroundColor: c.surface, borderRadius: 14}}><Text style={{fontFamily: f.bodyMedium, color: c.primaryDark}}>Invite someone</Text></Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/chat/${item.id}`)}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: c.primaryBgSubtle },
              ]}
              testID={`chat-row-${item.id}`}
            >
              <Avatar name={item.other?.name} seed={item.other?.id} size={52} />
              <View style={styles.rowMain}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.other?.name || "Unknown"}
                  </Text>
                  <Text style={styles.rowTime}>{timeAgo(item.updated_at)}</Text>
                </View>
                <Text style={styles.rowPreview} numberOfLines={1}>
                  {previewText(item)}
                </Text>
              </View>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette, f: any) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
    },
    profileBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      overflow: "hidden",
    },
    titleBlock: { flex: 1, alignItems: "center" },
    kicker: {
      fontFamily: f.bodyMedium,
      fontSize: 11,
      color: c.textTertiary,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      marginBottom: 2,
    },
    title: {
      fontFamily: f.heading,
      fontSize: 22,
      color: c.text,
      letterSpacing: -0.3,
    },
    list: { paddingHorizontal: spacing.md, paddingBottom: 120 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      padding: spacing.md,
      gap: spacing.md,
      borderRadius: radius.lg,
    },
    rowMain: { flex: 1 },
    rowTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    rowName: {
      fontFamily: f.bodyBold,
      fontSize: 16,
      color: c.text,
      flex: 1,
      marginRight: spacing.sm,
    },
    rowTime: { fontFamily: f.body, fontSize: 12, color: c.textTertiary },
    rowPreview: {
      fontFamily: f.body,
      fontSize: 14,
      color: c.textSecondary,
      marginTop: 4,
    },
    sep: {
      height: 1,
      backgroundColor: c.border,
      marginHorizontal: spacing.lg,
      opacity: 0.5,
    },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    empty: { padding: spacing.xl, alignItems: "center" },
    emptyTitle: { fontFamily: f.heading, fontSize: 20, color: c.text, marginBottom: 6 },
    emptyText: { fontFamily: f.body, fontSize: 14, color: c.textSecondary },
  });
