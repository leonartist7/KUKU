import React, {useState} from "react";
import {View, Text, Share, Platform} from "react-native";
import {useRouter} from "expo-router";
import {api} from "../src/api";
import {useTheme} from "../src/ThemeContext";
import {validEmail} from "../src/onboarding";
import {Action, Field, GentleNote, Notice, TextAction, WelcomeShell} from "../src/WelcomeUI";
export default function InviteScreen() {
  const {c, f} = useTheme(); const router = useRouter();
  const [email, setEmail] = useState(""); const [link, setLink] = useState("");
  const [error, setError] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  async function create() {
    if (busy) return; setError(""); setStatus("");
    if (email.trim() && !validEmail(email)) {setError("Enter a complete email, or leave it blank for a shareable link."); return;}
    setBusy(true);
    try {const data = await api.post<{invite_url: string}>("/invites", {email: email.trim() || null}); setLink(data.invite_url);}
    catch (e) {setError(e instanceof Error ? e.message : "Couldn’t create your invitation. Try again.");}
    finally {setBusy(false);}
  }
  async function share() {
    setError("");
    try {await Share.share({message: "Join me on KUKU, our little place to chat and share. This invitation is for one person: " + link});}
    catch {setError("Sharing isn’t available here. Copy the link below instead.");}
  }
  return <WelcomeShell compact title={"Save someone\na little place."} subtitle="Send a link in any messaging app. They’ll create their own account and verify their email." back={() => router.back()}>
    <Field label="Their email · optional" value={email} onChangeText={value => {setEmail(value); setLink(""); setStatus("");}} placeholder="Leave blank to invite with a link" autoCapitalize="none" keyboardType="email-address" hint="Add an email to make the invitation work only for that address."/>
    <Action label={busy ? "Making your link…" : link ? "Create another invitation" : "Create invitation link"} onPress={() => void create()} busy={busy}/>
    {link ? <View style={{gap: 12, padding: 16, backgroundColor: c.surface, borderRadius: 16}}>
      <Text style={{fontFamily: f.bodyMedium, color: c.text}}>A little welcome, ready to share.</Text>
      <Text selectable style={{fontFamily: f.body, color: c.textSecondary, fontSize: 12, lineHeight: 19}}>{link}</Text>
      <Action label="Share invitation link" icon="share-outline" onPress={() => void share()}/>
      {Platform.OS === "web" ? <TextAction label="Copy invitation link" onPress={() => {void navigator.clipboard.writeText(link).then(() => setStatus("Invitation link copied.")).catch(() => setError("Select the link above and copy it manually."));}}/> : null}
    </View> : null}
    <Notice message={error}/><Notice message={status} success/>
    <GentleNote>Each link works once and expires in seven days. Share it privately with the person you want to invite. Creating a link does not send an email.</GentleNote>
  </WelcomeShell>;
}
