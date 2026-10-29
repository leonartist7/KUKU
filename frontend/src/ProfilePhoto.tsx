import React, {useState} from "react";
import {View, Text, Pressable} from "react-native";
import * as ImagePicker from "expo-image-picker";
import Avatar from "./Avatar";
import {useAuth} from "./AuthContext";
import {useTheme} from "./ThemeContext";
import {Notice} from "./WelcomeUI";
export default function ProfilePhoto({name}: {name: string}) {
  const {user, updatePhoto} = useAuth(); const {c, f} = useTheme();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  async function change(remove = false) {
    if (busy) return; setMessage(""); setSuccess(false);
    // Open the picker directly from the tap, as mobile browsers require.
    try {
      let image: string | null = null;
      if (!remove) {
        const result = await ImagePicker.launchImageLibraryAsync({mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true});
        if (result.canceled) return;
        const asset = result.assets[0];
        if (!asset.base64 || asset.base64.length > 2796204) throw new Error("Choose a JPEG, PNG or WebP photo under 2 MB.");
        image = asset.base64;
      }
      setBusy(true); await updatePhoto(image); setSuccess(true); setMessage(remove ? "Photo removed." : "Photo saved. Looking like you!");
    } catch (error) {setMessage(error instanceof Error ? error.message : "Your photo couldn’t be saved. Try again.");}
    finally {setBusy(false);}
  }
  return <View style={{gap: 10}}>
    <View style={{flexDirection: "row", alignItems: "center", gap: 15, padding: 17, borderRadius: 18, backgroundColor: c.surface}}>
      <Avatar name={name || "You"} seed={user?.id} photo={user?.avatar} size={72}/>
      <View style={{flex: 1, gap: 5}}><Text style={{fontFamily: f.heading, fontSize: 21, color: c.text}}>A familiar face</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={user?.avatar ? "Change profile photo" : "Add profile photo"} disabled={busy} onPress={() => void change()} style={{minHeight: 44, justifyContent: "center"}}><Text style={{fontFamily: f.bodyMedium, color: c.primaryDark}}>{busy ? "Saving photo…" : user?.avatar ? "Change photo" : "Add a profile photo"}</Text></Pressable>
        {user?.avatar ? <Pressable accessibilityRole="button" accessibilityLabel="Remove profile photo" disabled={busy} onPress={() => void change(true)} style={{minHeight: 44, justifyContent: "center"}}><Text style={{color: c.textSecondary}}>Remove photo</Text></Pressable> : null}
      </View>
    </View>
    <Text style={{fontFamily: f.body, fontSize: 12, color: c.textSecondary}}>Optional · JPEG, PNG or WebP up to 2 MB. Visible to your contacts. Saved separately from your name and bio.</Text>
    <Notice message={message} success={success}/>
  </View>;
}
