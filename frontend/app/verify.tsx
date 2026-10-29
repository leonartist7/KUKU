import React, {useEffect, useState} from "react";
import {Text, View} from "react-native";
import {useRouter} from "expo-router";
import {useAuth} from "../src/AuthContext";
import {api} from "../src/api";
import {useTheme} from "../src/ThemeContext";
import {Action, Field, GentleNote, Notice, TextAction, WelcomeShell} from "../src/WelcomeUI";

export default function Verify() {
  const {c, f} = useTheme(); const {user, refresh, signOut} = useAuth(); const router = useRouter();
  const [code, setCode] = useState(""); const [sent, setSent] = useState(false); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); const [wait, setWait] = useState(0);
  useEffect(() => {if (wait <= 0) return; const id = setTimeout(() => setWait(v => Math.max(0, v - 1)), 1000); return () => clearTimeout(id);}, [wait]);
  async function send() {
    if (busy || wait) return; setError(""); setBusy(true);
    try {await api.post("/auth/verification"); setSent(true); setWait(60);}
    catch (e) {setError(e instanceof Error ? e.message : "We couldn't send your code. Please try again.");}
    finally {setBusy(false);}
  }
  async function verify() {
    if (busy) return; setError("");
    if (code.trim().length < 8) {setError("Paste the complete code from your KUKU email."); return;}
    setBusy(true);
    try {await api.post("/auth/verify", {email: user?.email, code: code.trim()}); await refresh(); router.replace("/");}
    catch (e) {setError(e instanceof Error ? e.message : "That didn't go through. Please try again.");}
    finally {setBusy(false);}
  }
  return <WelcomeShell step={2} image="mail" title={sent ? "A little hello\nin your inbox." : "Let's make sure\nit's really you."}
    subtitle={sent ? "Copy the full code from your email and paste it below. It keeps your account yours." : "We'll send a one-time verification code. Once you're verified, you can finish your profile."}>
    <View style={{padding: 15, borderRadius: 15, backgroundColor: c.surface, gap: 5}}><Text style={{fontFamily: f.body, fontSize: 12, color: c.textSecondary}}>Sending to</Text><Text selectable style={{fontFamily: f.bodyMedium, fontSize: 15, color: c.text}}>{user?.email}</Text></View>
    {sent ? <Notice message="Code sent. Check your inbox or spam folder. A new code replaces the previous one." success/> : null}
    <Field label="Verification code" value={code} onChangeText={setCode} placeholder="Paste your code here" autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" maxLength={128} hint="Use the email verification code, not your invitation code. It expires after 15 minutes." onSubmitEditing={() => void verify()} editable={!busy} testID="verification-code"/>
    <Notice message={error}/>
    {!sent && !code.trim() ? <Action label="Send my code" icon="mail-outline" onPress={() => void send()} busy={busy} testID="send-verification"/> : <Action label="Verify and continue" onPress={() => void verify()} busy={busy} testID="verify-submit"/>}
    {sent || code.trim() ? <TextAction label={wait ? "Send a new code in " + wait + "s" : "Didn't get it? Send a new code"} onPress={() => void send()} disabled={busy || wait > 0}/> : null}
    <GentleNote>You can close KUKU and come back to this step later.</GentleNote>
    <TextAction label="Wrong email? Sign out and use another account" disabled={busy} onPress={() => {setBusy(true); void signOut().then(() => router.replace("/login")).catch(() => setError("Could not sign out. Check your connection and try again.")).finally(() => setBusy(false));}}/>
  </WelcomeShell>;
}
