import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCall } from "../../src/CallContext";
import { callDuration, callPhaseLabel } from "../../src/callState";
import { CALLS_ENABLED } from "../../src/config";
import Avatar from "../../src/Avatar";
import { useTheme } from "../../src/ThemeContext";
import { Palette, spacing } from "../../src/theme";

export default function CallScreen() {
  const params = useLocalSearchParams<{ id: string; callId?: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const callId = typeof params.callId === "string" ? params.callId : undefined;
  const router = useRouter();
  const { c, f } = useTheme();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const { supported, session, start, join, hangUp, dismiss, toggleMute, resumeAudio, loadOutputs, selectOutput } = useCall();
  const [now, setNow] = useState(Date.now());
  const [showOutputs, setShowOutputs] = useState(false);

  useEffect(() => {
    if (!supported || !id) return;
    if (callId) void join(id, callId);
    else void start(id);
    // The provider owns media; leaving this screen minimizes rather than hangs up.
  }, [callId, id, join, start, supported]);

  useEffect(() => {
    if (session?.startedAt === null || !session || session.phase === "ended") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.callId, session?.phase, session?.startedAt]);

  const back = () => {
    if (session?.phase === "ended") dismiss();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };
  if (!supported) return <SafeAreaView style={styles.safe}>
    <View style={styles.unavailable}>
      <View style={styles.symbol}><Ionicons name="call-outline" size={30} color={c.primary} /></View>
      <Text style={styles.name}>A little closer, soon</Text>
      <Text style={styles.explanation}>{CALLS_ENABLED ? "Audio calls are available in the browser while the installed app is being prepared." : "Calls are being prepared for this beta. You can keep chatting and sharing voice messages."}</Text>
      <Pressable accessibilityRole="button" onPress={back} style={styles.primary}><Text style={styles.primaryText}>Back to KUKU</Text></Pressable>
    </View>
  </SafeAreaView>;
  const phase = session?.phase || "preparing";
  const canControl = phase === "connected" || phase === "reconnecting" || phase === "connecting";
  const canOutput = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={phase === "ended" ? "Close call" : "Minimize call"} onPress={back} style={styles.headerButton} testID="minimize-call">
        <Ionicons name={phase === "ended" ? "close" : "chevron-down"} size={24} color={c.text} />
      </Pressable>
      <Text style={styles.brand}>KUKU</Text>
      <View style={styles.headerButton} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.kicker}>{callPhaseLabel(phase)}</Text>
      <View style={styles.avatarWrap}>
        <View style={styles.halo} />
        <Avatar name={session?.other.name} seed={session?.other.id || id} photo={session?.other.avatar} size={140} />
      </View>
      <Text style={styles.name}>{session?.other.name || "Your contact"}</Text>
      <Text style={styles.status} accessibilityLiveRegion="polite" testID="call-status">
        {phase === "connected" ? callDuration(session?.startedAt ?? null, now) : session?.reason || (phase === "ringing" ? "Waiting for an answer." : phase === "preparing" ? "Checking your microphone." : "Waiting for both microphones.")}
      </Text>
      {phase === "connected" ? <View style={styles.liveRow}><View style={styles.liveDot} /><Text style={styles.liveText}>Audio connected</Text></View> : null}
      {["preparing", "connecting", "reconnecting"].includes(phase) ? <ActivityIndicator color={c.primary} style={{ marginTop: 16 }} /> : null}
      {session?.poorConnection && phase !== "ended" ? <Text style={styles.note}>The connection is weak. Audio may take a moment.</Text> : null}
      {session?.audioBlocked ? <Pressable accessibilityRole="button" onPress={() => { void resumeAudio(); }} style={styles.audioRecovery} testID="call-enable-audio">
        <Ionicons name="volume-high-outline" size={20} color={c.primaryDark} /><Text style={styles.recoveryText}>Tap to hear the call</Text>
      </Pressable> : null}
      {session?.controlError ? <Text accessibilityRole="alert" style={styles.error}>{session.controlError}</Text> : null}
      {canControl && !canOutput ? <Text style={styles.note}>Your device manages the speaker and headphones.</Text> : null}
      {showOutputs && canControl && session?.outputs.length ? <View style={styles.outputs}>
        <Text style={styles.outputHeading}>Audio output</Text>
        {session.outputs.map((output) => <Pressable key={output.id} accessibilityRole="button" accessibilityLabel={"Use " + output.label} accessibilityState={{ selected: session.outputId === output.id, disabled: session.controlPending }} disabled={session.controlPending} onPress={() => { void selectOutput(output.id); }} style={[styles.outputRow, session.outputId === output.id && { backgroundColor: c.primaryBgSubtle }]}>
          <Ionicons name={session.outputId === output.id ? "checkmark-circle" : "headset-outline"} size={20} color={c.primaryDark} />
          <Text style={styles.outputLabel}>{output.label}</Text>
        </Pressable>)}
      </View> : null}
    </ScrollView>
    {phase === "ended" ? <View style={styles.endActions}>
      <Pressable accessibilityRole="button" onPress={back} style={styles.primary} testID="close-call"><Text style={styles.primaryText}>Back to KUKU</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setShowOutputs(false); void start(id); }} style={styles.callAgain}><Text style={styles.callAgainText}>Call again</Text></Pressable>
    </View> : <View style={styles.bottom}>
      <View style={styles.controls}>
        {canControl ? <Control icon={session?.muted ? "mic-off-outline" : "mic-outline"} label={session?.muted ? "Unmute" : "Mute"} active={!!session?.muted} disabled={!!session?.controlPending} onPress={() => { void toggleMute(); }} /> : <View style={styles.controlSlot} />}
        <View style={styles.controlSlot}>
          <Pressable accessibilityRole="button" accessibilityLabel={phase === "ringing" || phase === "preparing" ? "Cancel call" : "Hang up"} onPress={() => { void hangUp(); }} style={styles.hangUp} testID={phase === "ringing" || phase === "preparing" ? "cancel-call" : "end-call"}>
            <Ionicons name="call" size={28} color={c.textInverse} style={{ transform: [{ rotate: "135deg" }] }} />
          </Pressable><Text style={styles.controlLabel}>{phase === "ringing" || phase === "preparing" ? "Cancel" : "Hang up"}</Text>
        </View>
        {canControl && canOutput ? <Control icon="headset-outline" label="Audio output" disabled={!!session?.controlPending} onPress={() => { setShowOutputs((value) => !value); void loadOutputs(); }} /> : <View style={styles.controlSlot} />}
      </View>
      <Text style={styles.footnote}>You can minimize this call and keep chatting.</Text>
    </View>}
  </SafeAreaView>;
}

function Control({ icon, label, active, disabled, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  const { c, f } = useTheme();
  const styles = makeStyles(c, f);
  return <View style={styles.controlSlot}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active, disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[styles.control, active && { backgroundColor: c.primaryBgSubtle, borderColor: c.primaryDark }, disabled && { opacity: 0.5 }]}>
      <Ionicons name={icon} size={24} color={active ? c.primaryDark : c.text} />
    </Pressable>
    <Text style={styles.controlLabel}>{label}</Text>
  </View>;
}
const makeStyles = (c: Palette, f: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24 },
  brand: { fontFamily: f.bodyMedium, fontSize: 15, letterSpacing: 3, color: c.textSecondary },
  content: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 32, minHeight: 360 },
  kicker: { fontFamily: f.bodyMedium, fontSize: 14, color: c.textSecondary, marginBottom: 28 },
  avatarWrap: { width: 192, height: 192, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  halo: { position: "absolute", width: 190, height: 190, borderRadius: 95, backgroundColor: c.primaryBgSubtle, borderWidth: 1, borderColor: c.border },
  name: { fontFamily: f.heading, fontSize: 32, lineHeight: 40, color: c.text, textAlign: "center", maxWidth: 520 },
  status: { fontFamily: f.body, fontSize: 16, lineHeight: 24, color: c.textSecondary, marginTop: 8, textAlign: "center", maxWidth: 380 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 12 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.success },
  liveText: { fontFamily: f.bodyMedium, fontSize: 13, color: c.textSecondary },
  note: { fontFamily: f.body, fontSize: 13, lineHeight: 20, color: c.textSecondary, marginTop: 14, textAlign: "center", maxWidth: 360 },
  error: { fontFamily: f.body, fontSize: 14, lineHeight: 22, color: c.error, marginTop: 16, textAlign: "center", maxWidth: 380 },
  audioRecovery: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 24, backgroundColor: c.primaryBgSubtle, marginTop: 20 },
  recoveryText: { fontFamily: f.bodyMedium, fontSize: 15, color: c.primaryDark },
  outputs: { width: "100%", maxWidth: 360, borderRadius: 20, padding: 12, marginTop: 20, backgroundColor: c.surface },
  outputHeading: { fontFamily: f.bodyMedium, fontSize: 14, color: c.textSecondary, padding: 10 },
  outputRow: { minHeight: 48, padding: 12, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12 },
  outputLabel: { fontFamily: f.body, fontSize: 14, color: c.text, flexShrink: 1 },
  bottom: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 20 },
  controls: { width: "100%", maxWidth: 420, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "space-around", gap: 8 },
  controlSlot: { width: 88, minHeight: 96, alignItems: "center", justifyContent: "flex-start", gap: 10 },
  control: { width: 60, height: 60, borderRadius: 30, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
  hangUp: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.error, alignItems: "center", justifyContent: "center" },
  controlLabel: { fontFamily: f.bodyMedium, fontSize: 13, color: c.text, textAlign: "center" },
  footnote: { fontFamily: f.body, fontSize: 12, lineHeight: 18, color: c.textSecondary, textAlign: "center", marginTop: 10 },
  endActions: { padding: 24, width: "100%", maxWidth: 420, alignSelf: "center" },
  primary: { backgroundColor: c.text, paddingHorizontal: 24, paddingVertical: 16, minHeight: 52, borderRadius: 28, alignItems: "center" },
  primaryText: { fontFamily: f.bodyMedium, color: c.bg, fontSize: 16 },
  callAgain: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 6 },
  callAgainText: { fontFamily: f.bodyMedium, color: c.primaryDark, fontSize: 15 },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 20, width: "100%", maxWidth: 520, alignSelf: "center" },
  symbol: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: c.primaryBgSubtle },
  explanation: { fontFamily: f.body, fontSize: 16, lineHeight: 25, color: c.textSecondary, textAlign: "center", marginBottom: spacing.md },
});
