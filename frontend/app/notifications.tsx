import React, {useCallback, useRef, useState} from "react";
import {View, Text, Pressable, ScrollView, ActivityIndicator, Platform, AppState} from "react-native";
import {Ionicons} from "@expo/vector-icons";
import {SafeAreaView} from "react-native-safe-area-context";
import {useRouter, useFocusEffect} from "expo-router";
import {useAuth} from "../src/AuthContext";
import {useTheme} from "../src/ThemeContext";
import {PUSH_AVAILABLE, enableNotifications, disableNotifications, readNotificationStatus, testDeviceNotification, NotificationStatus} from "../src/notifications";
import {getSessionEpoch, getSessionUserId} from "../src/api";
import {layout, typography} from "../src/theme";
import {IconButton} from "../src/ScreenUI";
import {Notice} from "../src/WelcomeUI";
import NotificationSoundSettings from "../src/NotificationSoundSettings";

export default function NotificationsScreen() {
  const {c, f} = useTheme(); const {user} = useAuth(); const uid = user?.id; const router = useRouter();
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<NotificationStatus | null>(null); const [error, setError] = useState("");
  const current = useRef(0); const visible = useRef(false); const operation = useRef(0);
  const refresh = useCallback(async () => {
    if (!uid) return;
    const request = ++current.current; setChecking(true); setError("");
    try {const value = await readNotificationStatus(uid); if (visible.current && request === current.current) setStatus(value);}
    catch (failure) {if (visible.current && request === current.current) setError(failure instanceof Error ? failure.message : "We couldn't check this device. Please try again.");}
    finally {if (visible.current && request === current.current) setChecking(false);}
  }, [uid]);
  useFocusEffect(useCallback(() => {
    visible.current = true; operation.current++; setStatus(null); setMessage(""); setBusy(false); void refresh();
    const resume = () => {if (AppState.currentState !== "background" && (Platform.OS !== "web" || document.visibilityState !== "hidden")) void refresh();};
    const subscription = AppState.addEventListener("change", resume);
    if (Platform.OS === "web") {document.addEventListener("visibilitychange", resume); window.addEventListener("focus", resume);}
    return () => {
      visible.current = false; current.current++; operation.current++; subscription.remove();
      if (Platform.OS === "web") {document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", resume);}
    };
  }, [uid, refresh]));

  async function change(on: boolean) {
    if (!uid || busy) return;
    const epoch = getSessionEpoch(), intent = ++operation.current; setBusy(true); setMessage("");
    const active = () => visible.current && intent === operation.current && uid === getSessionUserId() && epoch === getSessionEpoch();
    try {
      if (on) await enableNotifications(uid); else await disableNotifications(uid);
      if (active()) {setMessage(on ? "Device setup saved. Try the device test, then ask a contact to send a message." : "Notifications turned off on this device."); await refresh();}
    } catch (failure) {if (active()) setMessage(failure instanceof Error ? failure.message : "Please try again.");}
    finally {if (active()) setBusy(false);}
  }
  async function test() {
    if (!uid || busy) return;
    const epoch = getSessionEpoch(), intent = ++operation.current; setBusy(true); setMessage("");
    const active = () => visible.current && intent === operation.current && uid === getSessionUserId() && epoch === getSessionEpoch();
    try {await testDeviceNotification(uid); if (active()) setMessage("Test requested. Check your notification tray. This tests display on this device; it doesn't verify server or background delivery.");}
    catch (failure) {if (active()) setMessage(failure instanceof Error ? failure.message : "The device test couldn't start.");}
    finally {if (active()) setBusy(false);}
  }
  const enabled = !!status && status.permission === "granted" && status.subscribed && status.optedIn;
  const permission = status?.permission === "granted" ? "Allowed" : status?.permission === "denied" ? "Blocked in device settings" :
    status?.permission === "default" ? "Not asked yet" : "Unavailable here";
  const rows = status ? [
    {label: Platform.OS === "web" ? "Browser support" : "Installed build", value: status.buildConfigured ? "Available" : "Not available in this build"},
    {label: "Permission", value: permission},
    {label: "This account", value: enabled ? "Device setup saved" : status.optedIn ? "Reconnect setup" : "Off on this device"},
    ...(Platform.OS === "web" ? [{label: "Server setup", value: status.serverAvailable === true ? "Configured" : status.serverAvailable === false ? "Not configured yet" : "Couldn't check"}] : []),
  ] : [];
  const body = {fontFamily: f.body, color: c.textSecondary, fontSize: 16, lineHeight: 24};
  return <SafeAreaView edges={["top", "bottom"]} style={{flex: 1, backgroundColor: c.bg}}>
    <ScrollView contentContainerStyle={{padding: 24, gap: 20, maxWidth: layout.readingMaxWidth, width: "100%", alignSelf: "center"}}>
      <View style={{alignSelf: "flex-start"}}><IconButton label="Back" icon="arrow-back" quiet onPress={() => router.back()}/></View>
      <View style={{width: 64, height: 64, borderRadius: 24, backgroundColor: c.primaryBgSubtle, alignItems: "center", justifyContent: "center"}}><Ionicons name="notifications-outline" size={30} color={c.primaryDark}/></View>
      <View style={{gap: 10}}><Text accessibilityRole="header" style={[typography.title, {fontFamily: f.heading, color: c.text}]}>Stay a little closer.</Text>
        <Text style={body}>A gentle heads-up when someone sends a message. Let's check what this device can do.</Text></View>
      <View style={{padding: 20, gap: 16, borderRadius: 24, backgroundColor: c.surface}} testID="notification-device-status">
        <Text style={[typography.section, {fontFamily: f.heading, color: c.text}]}>{enabled ? "A little hello, even from afar" : "Let your messages find you"}</Text>
        <Text style={body}>Alerts say “You have a new message.” Your conversation and filenames stay private.</Text>
        {checking && !status ? <View accessibilityLiveRegion="polite" style={{flexDirection: "row", gap: 10, alignItems: "center"}}><ActivityIndicator color={c.primaryDark}/><Text style={body}>Checking this device…</Text></View> : null}
        {rows.map(row => <View key={row.label} style={{flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16}}>
          <Text style={{fontFamily: f.body, fontSize: 14, lineHeight: 21, color: c.textSecondary, flex: 1}}>{row.label}</Text>
          <Text style={{fontFamily: f.bodyMedium, fontSize: 14, lineHeight: 21, color: c.text, flex: 1, textAlign: "right"}}>{row.value}</Text>
        </View>)}
        {error ? <Notice message={error}/> : null}
        {status?.note ? <Text style={{...body, fontSize: 14, lineHeight: 21}}>{status.note}</Text> : null}
        {PUSH_AVAILABLE ? <>
          <Pressable accessibilityRole="button" accessibilityLabel={enabled ? "Reconnect notifications" : "Enable notifications"} accessibilityState={{disabled: busy, busy}}
            disabled={busy} onPress={() => {void change(true);}} testID="enable-notifications"
            style={({pressed}) => ({minHeight: 52, padding: 16, borderRadius: 16, backgroundColor: c.text, alignItems: "center", opacity: busy || pressed ? 0.7 : 1})}>
            {busy ? <ActivityIndicator color={c.bg}/> : <Text style={{fontFamily: f.bodyMedium, color: c.bg, fontSize: 16, textAlign: "center"}}>{enabled ? "Reconnect notifications" : "Enable notifications"}</Text>}
          </Pressable>
          {Platform.OS === "web" && status?.permission === "granted" ? <Pressable accessibilityRole="button" accessibilityLabel="Test notification on this device" testID="test-notification" disabled={busy}
            onPress={() => {void test();}} style={{minHeight: 48, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center", opacity: busy ? 0.6 : 1}}>
            <Text style={{fontFamily: f.bodyMedium, color: c.text, fontSize: 15}}>Test on this device</Text>
          </Pressable> : null}
          {status && (status.optedIn || status.subscribed) ? <Pressable accessibilityRole="button" accessibilityLabel="Turn off notifications on this device" disabled={busy}
            onPress={() => {void change(false);}} style={{minHeight: 48, alignItems: "center", justifyContent: "center"}}><Text style={{fontFamily: f.bodyMedium, color: c.textSecondary, fontSize: 14}}>Turn off on this device</Text></Pressable> : null}
        </> : <Text style={body}>{Platform.OS === "web" ? "Open this KUKU link in Chrome on Android. An embedded browser may not support notifications." : "Push notifications need a configured installed build. They aren't available in this build yet."}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Check notification status again" disabled={busy || checking} onPress={() => {void refresh();}}
          style={{minHeight: 48, alignItems: "center", justifyContent: "center", opacity: busy || checking ? 0.6 : 1}}>
          <Text style={{fontFamily: f.bodyMedium, color: c.primaryDark, fontSize: 14}}>{checking ? "Checking…" : "Check again"}</Text>
        </Pressable>
      </View>
      {message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{...body, color: c.text}}>{message}</Text> : null}
      {status?.permission === "denied" ? <Text style={body}>Permission is blocked. Open this site's notification settings in your browser or Android settings, allow KUKU, then return here and tap Check again.</Text> : null}
      <NotificationSoundSettings/>
      {Platform.OS === "web" ? <Text style={{...body, fontSize: 14, lineHeight: 22}}>On Android, allow notifications for this site in Chrome. You can add KUKU to your Home screen from Chrome's menu. Lock-screen display, background sounds, Do Not Disturb and battery restrictions are controlled by Android. Device setup and a successful local test do not prove that a background message arrived.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}
