import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { Palette, radius, spacing } from "../../src/theme";
import { useTheme } from "../../src/ThemeContext";
import { useAuth } from "../../src/AuthContext";
import Avatar from "../../src/Avatar";
import { spacesApi, Space } from "../../src/spaces";

function activityLabel(s: Space): string {
  if (s.mode === "video") return "Watching";
  if (s.mode === "audio") return "Listening";
  return "Idle";
}

export default function SpacesScreen() {
  const router = useRouter();
  const { c, f } = useTheme();
  const { user } = useAuth();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const [active, setActive] = useState<Space[]>([]);
  const [saved, setSaved] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await spacesApi.list();
      setActive(data.active);
      setSaved(data.saved);
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
        <Pressable onPress={() => router.push("/you")} style={styles.profileBtn} testID="profile-button">
          <Avatar name={user?.name} seed={user?.id} photo={user?.avatar} size={40} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.kicker}>Together</Text>
          <Text style={styles.title}>Spaces</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
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
        >
          {/* Create card — prominent */}
          <Pressable
            onPress={() => router.push("/space/create")}
            style={({ pressed }) => [
              styles.createCard,
              pressed && { transform: [{ scale: 0.99 }], opacity: 0.96 },
            ]}
            testID="create-space-button"
          >
            <View style={styles.createIconWrap}>
              <Ionicons name="add" size={26} color={c.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.createTitle}>Create a Space</Text>
              <Text style={styles.createSub}>
                A small room for the people who matter. Watch, listen, be together.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.primary} />
          </Pressable>

          {/* Active Now */}
          <SectionHeader title="Active now" count={active.length} />
          {active.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>Nothing happening right now. Quiet, calm.</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeRow}>
              {active.map((s) => (
                <ActiveCard key={s.id} space={s} onOpen={() => router.push(`/space/${s.id}`)} />
              ))}
            </ScrollView>
          )}

          {/* Your Rooms */}
          <SectionHeader title="Your rooms" count={saved.length} />
          {saved.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>Spaces you create show up here.</Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {saved.map((s) => (
                <RoomRow
                  key={s.id}
                  space={s}
                  onOpen={() => router.push(`/space/${s.id}`)}
                />
              ))}
            </View>
          )}

          <Text style={styles.footnote}>
            Phase 2 · shared presence · synced together
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  const { c, f } = useTheme();
  return (
    <View style={{ marginTop: spacing.lg, marginBottom: spacing.sm, flexDirection: "row", alignItems: "baseline" }}>
      <Text
        style={{
          fontFamily: f.bodyBold,
          fontSize: 12,
          color: c.textTertiary,
          textTransform: "uppercase",
          letterSpacing: 1.3,
          marginRight: 8,
        }}
      >
        {title}
      </Text>
      <Text style={{ fontFamily: f.body, fontSize: 12, color: c.textTertiary }}>· {count}</Text>
    </View>
  );
}

function ActiveCard({ space, onOpen }: { space: Space; onOpen: () => void }) {
  const { c, f } = useTheme();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const activeUsers = space.member_users.filter((u) => space.active_members.includes(u.id));
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.activeCard, pressed && { transform: [{ scale: 0.98 }] }]}
      testID={`active-space-${space.id}`}
    >
      <View style={styles.activeBadge}>
        <View style={styles.activeDot} />
        <Text style={styles.activeBadgeText}>{activityLabel(space)}</Text>
      </View>
      <Text style={styles.activeTitle} numberOfLines={2}>
        {space.name}
      </Text>
      {space.content?.title ? (
        <Text style={styles.activeSub} numberOfLines={1}>
          {space.content.type === "audio" ? "🎧 " : "▶  "}
          {space.content.title}
        </Text>
      ) : null}
      <View style={styles.avatarStack}>
        {activeUsers.slice(0, 4).map((u, i) => (
          <View key={u.id} style={[styles.stackedAvatar, { marginLeft: i === 0 ? 0 : -10 }]}>
            <Avatar name={u.name} seed={u.id} photo={u.avatar} size={28} />
          </View>
        ))}
        {activeUsers.length > 4 ? (
          <View style={[styles.stackedAvatar, styles.stackedMore, { marginLeft: -10 }]}>
            <Text style={styles.stackedMoreText}>+{activeUsers.length - 4}</Text>
          </View>
        ) : null}
        <Text style={styles.activeCount}>
          {activeUsers.length} {activeUsers.length === 1 ? "person" : "people"}
        </Text>
      </View>
    </Pressable>
  );
}

function RoomRow({ space, onOpen }: { space: Space; onOpen: () => void }) {
  const { c, f } = useTheme();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.roomRow, pressed && { backgroundColor: c.primaryBgSubtle }]}
      testID={`room-row-${space.id}`}
    >
      <View style={styles.roomAvatarStack}>
        {space.member_users.slice(0, 3).map((u, i) => (
          <View key={u.id} style={[styles.stackedAvatar, { marginLeft: i === 0 ? 0 : -10 }]}>
            <Avatar name={u.name} seed={u.id} photo={u.avatar} size={36} />
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.roomTitle} numberOfLines={1}>
          {space.name}
        </Text>
        <Text style={styles.roomSub} numberOfLines={1}>
          {space.member_users.map((u) => u.name.split(" ")[0]).join(", ") || "Just you"}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textTertiary} />
    </Pressable>
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
      paddingBottom: spacing.sm,
    },
    profileBtn: { width: 40, height: 40, borderRadius: 20, overflow: "hidden" },
    titleBlock: { flex: 1, alignItems: "center" },
    kicker: {
      fontFamily: f.bodyMedium,
      fontSize: 11,
      color: c.textTertiary,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      marginBottom: 2,
    },
    title: { fontFamily: f.heading, fontSize: 22, color: c.text, letterSpacing: -0.3 },
    scroll: { padding: spacing.lg, paddingBottom: 140 },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    createCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.xl,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    createIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    createTitle: { fontFamily: f.heading, fontSize: 18, color: c.text, marginBottom: 2 },
    createSub: { fontFamily: f.body, fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    emptyRow: {
      backgroundColor: c.surface,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderStyle: "dashed",
      borderWidth: 1,
      borderColor: c.border,
    },
    emptyText: { fontFamily: f.body, fontSize: 13, color: c.textSecondary, textAlign: "center" },
    activeRow: { gap: spacing.md, paddingBottom: 4, paddingRight: spacing.md },
    activeCard: {
      width: 240,
      backgroundColor: c.surfaceElevated,
      padding: spacing.md,
      borderRadius: radius.xl,
      gap: spacing.sm,
    },
    activeBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      backgroundColor: c.primaryBgSubtle,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
    },
    activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.success },
    activeBadgeText: { fontFamily: f.bodyBold, fontSize: 10, color: c.primaryDark, letterSpacing: 0.4 },
    activeTitle: { fontFamily: f.heading, fontSize: 18, color: c.text, lineHeight: 22 },
    activeSub: { fontFamily: f.body, fontSize: 13, color: c.textSecondary },
    avatarStack: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
    stackedAvatar: {
      borderRadius: 999,
      borderWidth: 2,
      borderColor: c.surfaceElevated,
    },
    stackedMore: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.primaryBgSubtle,
      alignItems: "center",
      justifyContent: "center",
    },
    stackedMoreText: { fontFamily: f.bodyBold, fontSize: 11, color: c.primaryDark },
    activeCount: { marginLeft: 10, fontFamily: f.body, fontSize: 12, color: c.textSecondary },
    roomRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
    },
    roomAvatarStack: { flexDirection: "row", alignItems: "center" },
    roomTitle: { fontFamily: f.bodyBold, fontSize: 16, color: c.text },
    roomSub: { fontFamily: f.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
    footnote: {
      marginTop: spacing.xl,
      textAlign: "center",
      color: c.textTertiary,
      fontFamily: f.body,
      fontSize: 11,
      letterSpacing: 0.3,
    },
  });
