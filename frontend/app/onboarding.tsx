import ProfilePhoto from "../src/ProfilePhoto";
import React, {useRef, useState} from "react";
import {Pressable, Text, View} from "react-native";
import {Redirect, useLocalSearchParams, useRouter} from "expo-router";
import {Ionicons} from "@expo/vector-icons";
import {useAuth} from "../src/AuthContext";
import {useTheme} from "../src/ThemeContext";
import {palettes, ThemeName} from "../src/theme";
import Avatar from "../src/Avatar";
import {Action, Field, GentleNote, Notice, TextAction, WelcomeShell} from "../src/WelcomeUI";

export default function Onboarding() {
  const {user, updateProfile} = useAuth(); const {c, f, themeName, setTheme} = useTheme(); const router = useRouter();
  const {edit} = useLocalSearchParams<{edit?: string}>(); const editing = edit === "1" && user?.onboarding_complete !== false;
  const [name, setName] = useState(user?.name || ""); const [bio, setBio] = useState(user?.bio || "");
  const completedAtEntry = useRef(user?.onboarding_complete !== false).current;
  const [done, setDone] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return; setError("");
    if (!name.trim()) {setError("Add the name you'd like your people to see."); return;}
    setBusy(true);
    try {await updateProfile(name.trim(), bio.trim()); if (editing) router.replace("/you"); else setDone(true);}
    catch (e) {setError(e instanceof Error ? e.message : "Your profile couldn't be saved. Please try again.");}
    finally {setBusy(false);}
  }
  if (completedAtEntry && !editing) return <Redirect href="/(tabs)"/>;
  if (done) return <WelcomeShell step={3} title={"You're home,\n" + name.trim().split(/\s+/)[0] + "."} subtitle="Your little corner is ready. Start with someone you'd love to hear from.">
    <View style={{padding: 20, borderRadius: 18, backgroundColor: c.surface, gap: 12}}>
      <View style={{flexDirection: "row", gap: 12, alignItems: "center"}}><Avatar name={name} seed={user?.id} photo={user?.avatar} size={48}/><View style={{flex: 1}}><Text style={{fontFamily: f.bodyMedium, color: c.text, fontSize: 16}}>{name.trim()}</Text><Text style={{fontFamily: f.body, color: c.textSecondary, fontSize: 12, marginTop: 4}}>Email verified · Profile ready</Text></View><Ionicons name="checkmark-circle" size={24} color={c.success}/></View>
      <Text style={{fontFamily: f.body, color: c.textSecondary, lineHeight: 21, fontSize: 14}}>Invite someone close. They'll create their own account, and you'll find each other in KUKU.</Text>
    </View>
    <Action label="Invite someone I care about" icon="person-add-outline" onPress={() => router.replace("/invite")}/>
    <TextAction label="Take a look around first" onPress={() => router.replace("/(tabs)")}/>
    <GentleNote>Change your profile and appearance any time from You.</GentleNote>
  </WelcomeShell>;
  return <WelcomeShell step={editing ? undefined : 3} compact title={editing ? "A little more you." : "Make yourself\nat home."}
    subtitle="Choose the name your people will see. A few words about you are entirely optional."
    back={editing ? () => router.replace("/you") : undefined} backLabel="Your profile">
    <ProfilePhoto name={name}/>
    <Field label="Your display name" value={name} onChangeText={setName} placeholder="What your people call you" autoComplete="name" maxLength={80} editable={!busy} testID="profile-name"/>
    <Field label="A little about you · optional" value={bio} onChangeText={setBio} placeholder="Usually making something, always up for a chat." maxLength={160} multiline hint={bio.length + "/160 · Visible to your contacts"} editable={!busy} testID="profile-bio"/>
    <View style={{gap: 10}}><Text style={{fontFamily: f.bodyMedium, fontSize: 13, color: c.text}}>{c.isDark ? "Pick your night atmosphere" : "Pick your day atmosphere"}</Text>
      <View style={{flexDirection: "row", gap: 9}}>{((c.isDark ? [["evening", "Evening"], ["forest", "Forest"], ["midnight", "Midnight"]] : [["warm", "Warm"], ["sage", "Sage"], ["ocean", "Ocean"]]) as [ThemeName, string][]).map(([theme, label]) => <Pressable key={theme} onPress={() => setTheme(theme)} accessibilityRole="radio" accessibilityLabel={label + " appearance"} accessibilityState={{checked: themeName === theme}} style={{flex: 1, minHeight: 68, padding: 11, borderRadius: 14, borderWidth: 1.5, borderColor: themeName === theme ? c.primaryDark : c.border, backgroundColor: palettes[theme].surface, gap: 7}}><View style={{flexDirection: "row", justifyContent: "space-between"}}><View style={{width: 15, height: 15, borderRadius: 8, backgroundColor: palettes[theme].primary}}/>{themeName === theme ? <Ionicons name="checkmark" size={15} color={palettes[theme].text}/> : null}</View><Text style={{fontFamily: f.bodyMedium, color: palettes[theme].text, fontSize: 12}}>{label}</Text></Pressable>)}</View>
      <Text style={{fontFamily: f.body, fontSize: 12, color: c.textSecondary}}>Light by day, dark from 7 p.m. Change the schedule and both palettes in You → Appearance.</Text>
    </View>
    <Notice message={error}/>
    <Action label={editing ? "Save my profile" : "This feels like me"} busy={busy} onPress={() => void save()} testID="profile-submit"/>
    {!editing ? <GentleNote>Nothing has to be perfect. You can change it all later.</GentleNote> : null}
  </WelcomeShell>;
}
