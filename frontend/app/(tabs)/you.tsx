import React, {useMemo, useState} from "react";
import {View, Text, StyleSheet, Pressable, ScrollView, Alert, Platform, ActivityIndicator} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {useAuth} from "../../src/AuthContext";
import {useTheme} from "../../src/ThemeContext";
import {layout, Palette, radius, spacing, themeMeta, typography} from "../../src/theme";
import {ContentFrame, PageHeader} from "../../src/ScreenUI";
import {Notice} from "../../src/WelcomeUI";
import {CALLS_ENABLED} from "../../src/config";
import Avatar from "../../src/Avatar";

type Setting = {icon: keyof typeof Ionicons.glyphMap; label: string; sub: string; onPress: () => void; testID: string};

export default function YouScreen() {
  const router = useRouter(); const {user, signOut} = useAuth(); const {c, f, themeName} = useTheme();
  const styles = useMemo(() => makeStyles(c, f), [c, f]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const currentTheme = themeMeta.find(theme => theme.name === themeName)?.label ?? "Warm";
  const groups: {title: string; items: Setting[]}[] = [
    {title: "Make yourself at home", items: [
      {icon: "person-outline", label: "Edit profile", sub: "Your photo, name and a little about you", onPress: () => router.push("/onboarding?edit=1"), testID: "settings-profile"},
      {icon: "color-palette-outline", label: "Appearance", sub: currentTheme + " · Colors, type and little decorations", onPress: () => router.push("/appearance"), testID: "settings-appearance"},
      {icon: "notifications-outline", label: "Notifications", sub: "Message alerts and sounds on this device", onPress: () => router.push("/notifications"), testID: "settings-notifications"},
    ]},
    {title: "Your people", items: [
      {icon: "person-add-outline", label: "Invite someone", sub: "Share a private invitation link", onPress: () => router.push("/invite"), testID: "settings-invite"},
      {icon: "planet-outline", label: "Shared spaces", sub: "A room to spend a little time together", onPress: () => router.push("/(tabs)/spaces"), testID: "settings-spaces"},
      ...(CALLS_ENABLED ? [{icon: "call-outline" as const, label: "Call history", sub: "Your recent conversations", onPress: () => router.push("/(tabs)/calls"), testID: "settings-calls"}] : []),
      {icon: "lock-closed-outline", label: "Privacy", sub: "Blocked contacts and privacy", onPress: () => router.push("/privacy"), testID: "settings-privacy"},
      {icon: "shield-checkmark-outline", label: "Account & data", sub: "Export your data or close your account", onPress: () => router.push("/account"), testID: "settings-account"},
    ]},
    {title: "Made with care", items: [
      {icon: "heart-outline", label: "Credits", sub: "The artists behind our emotes", onPress: () => router.push("/credits"), testID: "settings-credits"},
    ]},
  ];

  function confirmSignOut() {
    if (busy) return;
    const leave = async () => {
      setBusy(true); setError("");
      try {await signOut(); router.replace("/login");}
      catch {setError("We couldn't sign you out. Check your connection and try again.");}
      finally {setBusy(false);}
    };
    if (Platform.OS === "web") {void leave(); return;}
    Alert.alert("Sign out", "You can sign back in any time.", [
      {text: "Cancel", style: "cancel"}, {text: "Sign out", style: "destructive", onPress: () => {void leave();}},
    ]);
  }

  return <SafeAreaView style={styles.safe} edges={["top"]}><ContentFrame reading>
    <PageHeader title="You" subtitle="Make a little room for yourself."/>
    <ScrollView contentContainerStyle={styles.scroll}>
      <Pressable accessibilityRole="button" accessibilityLabel="Edit your photo and profile" onPress={() => router.push("/onboarding?edit=1")}
        style={({pressed}) => [styles.profileCard, {opacity: pressed ? 0.85 : 1}]}>
        <Avatar name={user?.name} seed={user?.id} photo={user?.avatar} size={64}/>
        <View style={{flex: 1, minWidth: 0, gap: 4}}>
          <Text style={styles.name}>{user?.name || "Your profile"}</Text>
          {user?.email ? <Text style={styles.email}>{user.email}</Text> : null}
          {user?.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
          <Text style={styles.profileHint}>Edit photo and profile</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.textSecondary}/>
      </Pressable>

      {groups.map(group => <View key={group.title} style={styles.group}>
        <Text accessibilityRole="header" style={styles.groupTitle}>{group.title}</Text>
        <View style={styles.list}>{group.items.map((item, index) => <Pressable key={item.testID}
          accessibilityRole="button" accessibilityLabel={item.label} accessibilityHint={item.sub}
          onPress={item.onPress} testID={item.testID}
          style={({pressed}) => [styles.row, index > 0 && styles.rowDivider, {backgroundColor: pressed ? c.primaryBgSubtle : c.surface}]}>
          <View style={styles.rowIcon}><Ionicons name={item.icon} size={21} color={c.primaryDark}/></View>
          <View style={{flex: 1, minWidth: 0, gap: 3}}><Text style={styles.rowLabel}>{item.label}</Text><Text style={styles.rowSub}>{item.sub}</Text></View>
          <Ionicons name="chevron-forward" size={18} color={c.textSecondary}/>
        </Pressable>)}</View>
      </View>)}

      <Notice message={error}/>
      <Pressable accessibilityRole="button" accessibilityLabel="Sign out" accessibilityState={{disabled: busy, busy}}
        disabled={busy} onPress={confirmSignOut} style={({pressed}) => [styles.signOut, {opacity: busy || pressed ? 0.7 : 1}]} testID="sign-out-btn">
        {busy ? <ActivityIndicator size="small" color={c.error}/> : <Ionicons name="log-out-outline" size={20} color={c.error}/>}
        <Text style={styles.signOutText}>{busy ? "Signing out…" : "Sign out"}</Text>
      </Pressable>
      <Text style={styles.version}>KUKU · v1.0 beta</Text>
    </ScrollView>
  </ContentFrame></SafeAreaView>;
}

const makeStyles = (c: Palette, f: any) => StyleSheet.create({
  safe: {flex: 1, backgroundColor: c.bg},
  scroll: {paddingHorizontal: spacing.lg, paddingBottom: spacing.xl},
  profileCard: {flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.lg},
  name: {...typography.section, fontFamily: f.heading, color: c.text},
  email: {...typography.caption, fontFamily: f.body, color: c.textSecondary},
  bio: {...typography.caption, fontFamily: f.body, color: c.textSecondary, marginTop: 4},
  profileHint: {...typography.caption, fontFamily: f.bodyMedium, color: c.primaryDark, marginTop: 5},
  group: {marginBottom: spacing.lg},
  groupTitle: {...typography.caption, fontFamily: f.bodyMedium, color: c.textSecondary, marginBottom: 10, paddingHorizontal: 4},
  list: {borderRadius: radius.xl, overflow: "hidden", backgroundColor: c.surface},
  row: {minHeight: layout.touchTarget, flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md},
  rowDivider: {borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border},
  rowIcon: {width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryBgSubtle},
  rowLabel: {...typography.body, fontFamily: f.bodyMedium, color: c.text},
  rowSub: {...typography.caption, fontFamily: f.body, color: c.textSecondary},
  signOut: {minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: radius.md, backgroundColor: c.errorBg, paddingVertical: 14, paddingHorizontal: 16, marginTop: 4},
  signOutText: {...typography.body, fontFamily: f.bodyMedium, color: c.error},
  version: {...typography.caption, fontFamily: f.body, color: c.textTertiary, textAlign: "center", marginTop: spacing.lg},
});

