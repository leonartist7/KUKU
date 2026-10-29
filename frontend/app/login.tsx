import React, {useState} from "react";
import {Text, View} from "react-native";
import {useRouter} from "expo-router";
import {useAuth} from "../src/AuthContext";
import {useTheme} from "../src/ThemeContext";
import {validEmail} from "../src/onboarding";
import {Action, Field, GentleNote, Notice, TextAction, WelcomeShell} from "../src/WelcomeUI";

export default function Login() {
  const router = useRouter(); const {signIn, signUp} = useAuth(); const {c, f} = useTheme();
  const [mode, setMode] = useState<"signin" | "invitation" | "account">("signin");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [name, setName] = useState(""); const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const move = (next: typeof mode) => {setError(""); setMode(next);};
  async function submit() {
    if (busy) return;
    setError("");
    if (!validEmail(email)) {setError("Enter a complete email address, like hello@example.com."); return;}
    if (mode === "invitation") {
      if (invite.trim().length < 16) {setError("Paste the full invitation code shared with you. It can include letters, numbers, - and _."); return;}
      move("account"); return;
    }
    if (!password || (mode === "account" && (password.length < 12 || !name.trim()))) {
      setError(mode === "account" ? "Add your name and a password with at least 12 characters." : "Enter your password to continue."); return;
    }
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email.trim(), password);
      else await signUp(email.trim(), password, name.trim(), invite.trim());
      router.replace("/");
    } catch (e) {setError(e instanceof Error ? e.message : "We couldn't connect. Please try again.");}
    finally {setBusy(false);}
  }
  return <WelcomeShell step={mode === "signin" ? undefined : 1} compact={mode === "account"}
    title={mode === "signin" ? "Your people,\na little closer." : mode === "invitation" ? "Someone saved\na place for you." : "Let's make it yours."}
    subtitle={mode === "signin" ? "A quieter place for everyday conversations. Come on in." : mode === "invitation" ? "Use the email your invitation was made for. We'll get you settled in, one step at a time." : "Just a name and a password for now. You can add a little more about yourself after verification."}
    back={mode === "account" ? () => move("invitation") : undefined} backLabel="Your invitation">
    {mode === "account" ? <>
      <View style={{backgroundColor: c.primaryBgSubtle, padding: 13, borderRadius: 13}}><Text style={{fontFamily: f.bodyMedium, color: c.text, fontSize: 13}}>{email.trim()}</Text><Text style={{fontFamily: f.body, color: c.textSecondary, fontSize: 12, marginTop: 4}}>Your invitation is checked when you create your account.</Text></View>
      <Field label="What should we call you?" value={name} onChangeText={setName} placeholder="Your first name" autoComplete="name" maxLength={80} testID="name-input" editable={!busy}/>
    </> : <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" editable={!busy} testID="email-input"/>}
    {mode === "invitation" ? <Field label="Your invitation code" value={invite} onChangeText={setInvite} placeholder="Paste the code shared with you" autoCapitalize="none" autoCorrect={false} maxLength={256} hint="KUKU is invitation-only. Ask the person who invited you if you need a code." testID="invite-input"/> : <Field label={mode === "account" ? "Create a password" : "Password"} value={password} onChangeText={setPassword} password autoCapitalize="none" autoCorrect={false} autoComplete={mode === "account" ? "new-password" : "current-password"} textContentType={mode === "account" ? "newPassword" : "password"} placeholder={mode === "account" ? "At least 12 characters" : "Your password"} maxLength={256} hint={mode === "account" ? "A few memorable words work well. Spaces are welcome." : undefined} onSubmitEditing={() => void submit()} editable={!busy} testID="password-input"/>}
    {mode === "signin" ? <TextAction label="Forgot your password?" onPress={() => router.push("/recover")} disabled={busy}/> : null}
    <Notice message={error}/>
    {mode === "account" && error.toLowerCase().includes("invitation") ? <TextAction label="Check my invitation and email" onPress={() => move("invitation")}/> : null}
    <Action label={mode === "signin" ? "Come on in" : mode === "invitation" ? "Continue" : "Create my account"} onPress={() => void submit()} busy={busy} testID="auth-submit"/>
    <TextAction label={mode === "signin" ? "New here? Create your account" : "Already have an account? Sign in"} onPress={() => move(mode === "signin" ? "invitation" : "signin")} disabled={busy} testID="auth-switch"/>
    <GentleNote>{mode === "signin" ? "A small space for the people who matter." : "Next: verify your email, then make your profile feel like you."}</GentleNote>
  </WelcomeShell>;
}
