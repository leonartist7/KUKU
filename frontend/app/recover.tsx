import React, {useState} from "react";
import {useRouter} from "expo-router";
import {api} from "../src/api";
import {validEmail} from "../src/onboarding";
import {Action, Field, GentleNote, Notice, TextAction, WelcomeShell} from "../src/WelcomeUI";

export default function Recover() {
  const router = useRouter(); const [stage, setStage] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState(""); const [code, setCode] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return; setError("");
    if (!validEmail(email)) {setError("Enter the email address you use for KUKU."); return;}
    if (stage === "code" && (code.trim().length < 8 || password.length < 12)) {setError("Paste your full reset code and choose a password with at least 12 characters."); return;}
    setBusy(true);
    try {await api.post(stage === "email" ? "/auth/forgot-password" : "/auth/reset-password", stage === "email" ? {email: email.trim()} : {email: email.trim(), code: code.trim(), password}); setStage(stage === "email" ? "code" : "done"); setPassword("");}
    catch (e) {setError(e instanceof Error ? e.message : "We couldn't connect. Please try again.");}
    finally {setBusy(false);}
  }
  return <WelcomeShell image="mail" compact title={stage === "done" ? "A fresh start." : stage === "email" ? "We'll help you\nfind your way back." : "Your new beginning."}
    subtitle={stage === "done" ? "Your password is updated. Sign in again with your new password on each device." : stage === "email" ? "Forgotten passwords happen. Enter your account email and we'll help you reset yours." : "If an account exists for " + email.trim() + ", a reset code has been sent. Check your inbox and spam folder."}
    back={() => router.replace("/login")} backLabel="Sign in">
    {stage === "email" ? <Field label="Account email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" onSubmitEditing={() => void submit()}/> : stage === "code" ? <>
      <Field label="Reset code from your email" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" maxLength={128} placeholder="Paste the complete reset code" hint="The code expires after 15 minutes."/>
      <Field label="New password" value={password} onChangeText={setPassword} password autoCapitalize="none" autoCorrect={false} autoComplete="new-password" placeholder="At least 12 characters" maxLength={256} onSubmitEditing={() => void submit()}/>
    </> : <Notice success message="Password changed. You're ready to come back in."/>}
    <Notice message={error}/>
    <Action label={stage === "done" ? "Back to sign in" : stage === "email" ? "Send reset code" : "Save my new password"} busy={busy} onPress={() => stage === "done" ? router.replace("/login") : void submit()}/>
    {stage === "code" ? <TextAction label="Use another email or request a new code" disabled={busy} onPress={() => {setError(""); setCode(""); setStage("email");}}/> : null}
    <GentleNote>Your conversations stay with your account.</GentleNote>
  </WelcomeShell>;
}
