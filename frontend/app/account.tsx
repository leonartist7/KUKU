import React, {useEffect, useRef, useState} from "react";
import {ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {Ionicons} from "@expo/vector-icons";
import {useRouter} from "expo-router";
import {api} from "../src/api";
import {useAuth} from "../src/AuthContext";
import {useTheme} from "../src/ThemeContext";
import {collectAccountExport, saveAccountExport, ExportSection} from "../src/accountExport";

const sectionNames: Record<ExportSection, string> = {
  profile: "profile", messages: "messages", attachments: "file details", audio_uploads: "Space audio details",
  spaces: "Spaces", space_messages: "Space messages", calls: "call history",
};

export default function AccountScreen() {
  const {c, f} = useTheme();
  const {user, finishClosedAccount} = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<"export" | "close" | null>(null);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const activeAccount = useRef(user?.id);
  const exportGeneration = useRef(0);
  activeAccount.current = user?.id;

  useEffect(() => {
    exportGeneration.current++;
    activeAccount.current = user?.id;
    setPassword(""); setConfirmation(""); setCloseOpen(false);
    setNotice(""); setFailed(false); setBusy(null);
    return () => {exportGeneration.current++; activeAccount.current = undefined;};
  }, [user?.id]);

  async function exportData() {
    if (!user || busy) return;
    const uid = user.id;
    const generation = ++exportGeneration.current;
    const active = () => activeAccount.current === uid && exportGeneration.current === generation;
    setBusy("export"); setFailed(false); setNotice("Preparing your export…");
    try {
      const data = await collectAccountExport(uid, section => {
        if (active()) setNotice("Collecting your " + sectionNames[section] + "…");
      }, active);
      if (!active()) return;
      const result = await saveAccountExport(uid, data);
      if (!active()) return;
      setNotice(result === "cancelled" ? "Export sharing was cancelled." : result === "shared" ?
        "Your JSON export was passed to your device’s share sheet." : "Your JSON download has started.");
    } catch (error) {
      if (active()) {setFailed(true); setNotice(error instanceof Error ? error.message : "Your export could not be prepared. Please try again.");}
    } finally {
      if (active()) setBusy(null);
    }
  }

  async function closeAccount() {
    if (!user || busy || confirmation !== "DELETE" || !password) return;
    const uid = user.id;
    setBusy("close"); setFailed(false); setNotice("");
    try {
      const result = await api.postAs<{status: string; data_deletion: string; physical_erasure_completed: boolean}>(uid, "/account/close", {password, confirmation});
      if (activeAccount.current !== uid) return;
      if (result.status !== "closed" || result.data_deletion !== "awaiting_operator_cleanup" || result.physical_erasure_completed !== false) {
        throw new Error("The closure result could not be confirmed. Refresh your account before trying again.");
      }
      setPassword(""); setConfirmation("");
      await finishClosedAccount(uid);
    } catch (error) {
      if (activeAccount.current === uid) {setFailed(true); setNotice(error instanceof Error ? error.message : "We could not confirm closure. Please try again.");}
    } finally {
      if (activeAccount.current === uid) {setPassword(""); setBusy(null);}
    }
  }

  const body = {fontFamily: f.body, fontSize: 16, lineHeight: 25, color: c.textSecondary};
  const card = {padding: 22, gap: 16, borderRadius: 24, backgroundColor: c.surface};
  const field = {minHeight: 52, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.bg, color: c.text, fontFamily: f.body, fontSize: 16};
  const action = {minHeight: 52, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 16,
    alignItems: "center" as const, justifyContent: "center" as const};

  return <SafeAreaView edges={["top", "bottom"]} style={{flex: 1, backgroundColor: c.bg}}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 24, gap: 24, maxWidth: 620, width: "100%", alignSelf: "center"}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}
        style={{minHeight: 44, minWidth: 44, alignSelf: "flex-start", justifyContent: "center"}}>
        <Ionicons name="arrow-back" size={24} color={c.text}/>
      </Pressable>
      <View style={{gap: 10}}>
        <View style={{width: 60, height: 60, borderRadius: 22, backgroundColor: c.surface, alignItems: "center", justifyContent: "center"}}>
          <Ionicons name="shield-checkmark-outline" size={28} color={c.primaryDark}/>
        </View>
        <Text accessibilityRole="header" style={{fontFamily: f.heading, fontSize: 32, lineHeight: 39, color: c.text}}>Your account, in your hands.</Text>
        <Text style={body}>Keep a copy of what you’ve shared, or close your account when you’re ready.</Text>
      </View>

      <View style={card}>
        <Text accessibilityRole="header" style={{fontFamily: f.bodyBold, fontSize: 19, color: c.text}}>Take a copy with you</Text>
        <Text style={body}>Export your profile, messages you wrote, file details, Space information and call history as JSON.</Text>
        <Text style={{...body, fontSize: 14, lineHeight: 22}}>Original photos, recordings and files stay separate. Download any you want to keep from their conversations. This beta export supports up to 5,000 records and 4 MB of source data.</Text>
        <Pressable testID="account-export" accessibilityRole="button" disabled={!!busy} onPress={() => void exportData()}
          style={[action, {backgroundColor: c.primaryDark, opacity: busy ? 0.6 : 1, flexDirection: "row", gap: 10}]}>
          {busy === "export" ? <ActivityIndicator color={c.textInverse}/> : <Ionicons name="download-outline" size={19} color={c.textInverse}/>}
          <Text style={{fontFamily: f.bodyBold, fontSize: 16, color: c.textInverse}}>{busy === "export" ? "Preparing your copy" : Platform.OS === "web" ? "Download my data" : "Share my JSON data"}</Text>
        </Pressable>
        {busy === "export" ? <Pressable accessibilityRole="button" accessibilityLabel="Cancel data export"
          onPress={() => {exportGeneration.current++; setBusy(null); setNotice("Export cancelled."); setFailed(false);}}
          style={action}><Text style={{fontFamily: f.bodyBold, color: c.textSecondary}}>Cancel export</Text></Pressable> : null}
        {Platform.OS !== "web" ? <Text style={{...body, fontSize: 14, lineHeight: 22}}>On this device, smaller exports open as JSON text in the share sheet. Use KUKU in a browser for a larger file download.</Text> : null}
      </View>

      <View style={card}>
        <Text accessibilityRole="header" style={{fontFamily: f.bodyBold, fontSize: 19, color: c.text}}>Close your account</Text>
        <Text style={body}>Closing signs you out everywhere, disables new sign-ins and alerts, removes your public profile photo and records a data-deletion request.</Text>
        <Text style={{...body, fontSize: 14, lineHeight: 22}}>In this beta, the app operator must complete data cleanup. Shared history, stored files and backups are not fully erased by this button. Export first if you want a copy.</Text>
        {!closeOpen ? <Pressable testID="account-close-open" accessibilityRole="button" disabled={!!busy}
          onPress={() => {setCloseOpen(true); setNotice(""); setFailed(false);}}
          style={[action, {backgroundColor: c.errorBg, opacity: busy ? 0.6 : 1}]}>
          <Text style={{fontFamily: f.bodyBold, fontSize: 16, color: c.text}}>Review account closure</Text>
        </Pressable> : <View style={{gap: 14}}>
          <Text style={{...body, color: c.text}}>This closes your account immediately. The beta has no self-service reopening. Enter your password and type DELETE to continue.</Text>
          <Text style={{fontFamily: f.bodyBold, color: c.text}}>Current password</Text>
          <TextInput testID="account-close-password" accessibilityLabel="Current password" value={password} onChangeText={setPassword}
            secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="current-password"
            editable={!busy} maxLength={256} style={field}/>
          <Text style={{fontFamily: f.bodyBold, color: c.text}}>Type DELETE</Text>
          <TextInput testID="account-close-confirmation" accessibilityLabel="Type DELETE to confirm account closure"
            value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" autoCorrect={false}
            editable={!busy} maxLength={6} style={field}/>
          <Pressable testID="account-close-submit" accessibilityRole="button"
            disabled={!!busy || !password || confirmation !== "DELETE"} onPress={() => void closeAccount()}
            style={[action, {backgroundColor: c.errorBg, opacity: busy || !password || confirmation !== "DELETE" ? 0.5 : 1}]}>
            {busy === "close" ? <ActivityIndicator color={c.text}/> : <Text style={{fontFamily: f.bodyBold, fontSize: 16, color: c.text}}>Close account and request deletion</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => {setCloseOpen(false); setPassword(""); setConfirmation("");}}
            style={[action, {opacity: busy ? 0.6 : 1}]}>
            <Text style={{fontFamily: f.bodyBold, color: c.textSecondary}}>Keep my account</Text>
          </Pressable>
        </View>}
      </View>
      {notice ? <Text testID="account-notice" accessibilityRole={failed ? "alert" : undefined} accessibilityLiveRegion="polite"
        style={{...body, color: failed ? c.text : c.textSecondary}}>{notice}</Text> : null}
      <Text style={{...body, fontSize: 14, lineHeight: 22}}>KUKU uses private access controls and encrypted transport. It is not end-to-end encrypted.</Text>
    </ScrollView>
  </SafeAreaView>;
}

