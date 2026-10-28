import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../src/AuthContext";
import { useTheme } from "../src/ThemeContext";
import { Palette, radius, spacing, themeMeta } from "../src/theme";
import Avatar from "../src/Avatar";

export default function YouScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { c, f, themeName } = useTheme();
  const styles = makeStyles(c, f);

  const currentTheme = themeMeta.find((t) => t.name === themeName)?.label ?? "Warm";

  const items: { icon: keyof typeof Ionicons.glyphMap; label: string; sub: string; onPress?: () => void; testID: string }[] = [
    {
      icon: "color-palette-outline",
      label: "Appearance",
      sub: `${currentTheme}  ·  Tap to customize`,
      onPress: () => router.push("/appearance"),
      testID: "settings-appearance",
    },
    { icon: "person-add-outline", label: "Invite someone", sub: "Share KUKU privately", onPress: () => router.push("/invite"), testID: "settings-invite" },
    { icon: "notifications-outline", label: "Notifications", sub: "Message alerts on this device", onPress: () => router.push("/notifications"), testID: "settings-notifications" },
    { icon: "lock-closed-outline", label: "Privacy", sub: "Blocked contacts and privacy", onPress: () => router.push("/privacy"), testID: "settings-privacy" },
    { icon: "sparkles-outline", label: "Spaces (soon)", sub: "Shared rooms in Phase 2", testID: "settings-spaces" },
  ];

  function confirmSignOut() {
    const doSignOut = async () => {
      try { await signOut(); router.replace("/login"); }
      catch { Alert.alert("Could not sign out", "Check your connection and try again."); }
    };
    if (Platform.OS === "web") {
      doSignOut();
      return;
    }
    Alert.alert("Sign out", "You can sign back in any time.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: doSignOut },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="you-back">
          <Ionicons name="chevron-back" size={22} color={c.text} />
        </Pressable>
        <Text style={styles.topTitle}>You</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.profileCard}>
          <Avatar name={user?.name} seed={user?.id} size={72} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
            {user?.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
          </View>
        </View>

        <View style={styles.list}>
          {items.map((it, i) => (
            <Pressable
              key={it.label}
              onPress={it.onPress}
              style={({ pressed }) => [
                styles.row,
                i > 0 && styles.rowDivider,
                pressed && { backgroundColor: c.primaryBgSubtle },
              ]}
              testID={it.testID}
            >
              <View style={styles.rowIcon}>
                <Ionicons name={it.icon} size={18} color={c.primaryDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{it.label}</Text>
                <Text style={styles.rowSub}>{it.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.textTertiary} />
            </Pressable>
          ))}
        </View>

        <Pressable onPress={confirmSignOut} style={styles.signOut} testID="sign-out-btn">
          <Ionicons name="log-out-outline" size={18} color={c.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.version}>KUKU · v1.0 beta</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette, f: any) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    back: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
    },
    topTitle: { fontFamily: f.heading, fontSize: 18, color: c.text },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
    profileCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: c.surface,
      padding: spacing.lg,
      borderRadius: radius.xl,
      marginBottom: spacing.lg,
    },
    name: { fontFamily: f.heading, fontSize: 24, color: c.text, letterSpacing: -0.3 },
    email: { fontFamily: f.body, fontSize: 13, color: c.textSecondary, marginTop: 2 },
    bio: { fontFamily: f.body, fontSize: 13, color: c.textSecondary, marginTop: 8, lineHeight: 18 },
    list: { backgroundColor: c.surface, borderRadius: radius.xl, overflow: "hidden" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      padding: spacing.md,
      gap: spacing.md,
    },
    rowDivider: { borderTopWidth: 1, borderTopColor: c.border },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: c.primaryBgSubtle,
      alignItems: "center",
      justifyContent: "center",
    },
    rowLabel: { fontFamily: f.bodyMedium, fontSize: 15, color: c.text },
    rowSub: { fontFamily: f.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
    signOut: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: c.errorBg,
      padding: spacing.md,
      borderRadius: radius.lg,
      marginTop: spacing.lg,
    },
    signOutText: { color: c.error, fontFamily: f.bodyBold, fontSize: 15 },
    version: {
      textAlign: "center",
      color: c.textTertiary,
      fontFamily: f.body,
      fontSize: 12,
      marginTop: spacing.xl,
    },
  });
