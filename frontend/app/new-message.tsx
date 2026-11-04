import VoiceComposer from "../src/VoiceComposer";
import FileSharingStatus from "../src/FileSharingStatus";
import {isImageFilename} from "../src/imagePreview";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import {useAuth} from "../src/AuthContext";
import {queueMessage} from "../src/outbox";
import {Notice} from "../src/WelcomeUI";
import * as DocumentPicker from "expo-document-picker";
import { api, User, uploadAttachment } from "../src/api";
import { useTheme } from "../src/ThemeContext";
import { Palette, radius, spacing } from "../src/theme";
import Avatar from "../src/Avatar";

export default function QuickMessage() {
  const router = useRouter();
  const {user} = useAuth();
  const [sendError, setSendError] = useState("");
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { c, f } = useTheme();
  const styles = makeStyles(c, f);
  const inputRef = useRef<TextInput>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<User | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; uri: string; size: number | null } | null>(null);

  const voiceMode = mode === "voice";
  const photoMode = mode === "photo";
  const fileMode = mode === "file" || photoMode;


  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.get<User[]>("/users");
      setUsers(list);
    } catch {
      setError("Couldn't load people — check your connection");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      if (!voiceMode && !fileMode) {
        const t = setTimeout(() => inputRef.current?.focus(), 100);
        return () => clearTimeout(t);
      }
    }, [load, voiceMode, fileMode]),
  );

  async function sendMessage(payload: Record<string, any>) {
    if (!selected || sending || !user) return;
    setSending(true); setSendError("");
    const uid = user.id;
    try {
      const chat = await api.postAs<{id: string}>(uid, "/chats", {other_user_id: selected.id});
      if (fileMode && file) {
        const uploaded = await uploadAttachment(chat.id, file.uri, file.name, uid);
        payload = {type: photoMode ? "image" : "file", attachment_id: uploaded.id};
      }
      await queueMessage(uid, {chat_id: chat.id, ...payload});
      router.replace(`/chat/${chat.id}`);
    } catch (e) {setSendError(e instanceof Error ? e.message : "Couldn’t send. Your selected file is still here; try again.");}
    finally {setSending(false);}
  }

  async function pickFile() {
    setSendError("");
    try {
      if (photoMode) {
        const result = await ImagePicker.launchImageLibraryAsync({mediaTypes: ["images"], quality: 0.8});
        if (result.canceled) return;
        const a = result.assets[0];
        if (a.fileSize && a.fileSize > 25 * 1024 * 1024) throw new Error("Choose a photo up to 25 MB.");
        setFile({uri: a.uri, name: a.fileName || "photo.jpg", size: a.fileSize || null});
      } else {
        const result = await DocumentPicker.getDocumentAsync({multiple: false, copyToCacheDirectory: true});
        if (result.canceled) return;
        const a = result.assets[0];
        if (a.size && a.size > 25 * 1024 * 1024) throw new Error("Choose a file up to 25 MB.");
        setFile({uri: a.uri, name: a.name, size: a.size ?? null});
      }
    } catch (e) {setSendError(e instanceof Error ? e.message : "Couldn’t open the picker. Try again.");}
  }

  async function sendIt() {
    if (fileMode) {
      if (!file) return;
      await sendMessage({ type: "file" });
    } else {
      if (!text.trim()) return;
      await sendMessage({ type: "text", text: text.trim() });
    }
  }

  const canSend = fileMode
      ? !!selected && !!file
      : !!selected && !!text.trim();

  const title = voiceMode ? "Voice memo" : fileMode ? (photoMode ? "Share a photo" : "Upload a file") : "Quick message";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* Dismiss area */}
        <Pressable style={styles.dismissArea} onPress={() => router.back()} />

        <ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight: "92%", backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28}} contentContainerStyle={styles.card}>
          <View style={styles.cardHandle} />

          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Pressable onPress={() => router.back()} style={styles.close} testID="new-msg-close">
              <Ionicons name="close" size={20} color={c.text} />
            </Pressable>
          </View>

          {fileMode ? <FileSharingStatus/> : null}
          <Notice message={sendError}/>
          {fileMode ? <Text style={{fontFamily: f.body, color: c.textSecondary, marginVertical: 12}}>Choose someone, then pick a {photoMode ? "photo" : "file"} up to 25 MB. Uploaded files are shared in that conversation and appear in Files.</Text> : null}
          <Text style={styles.sectionLabel}>To</Text>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : error ? (
            <Pressable onPress={load} style={styles.loadingRow} testID="new-msg-retry">
              <Text style={styles.errorText}>{error}</Text>
            </Pressable>
          ) : users.length === 0 ? <View style={{paddingVertical: 18, gap: 8}}><Text style={{color: c.text}}>Invite someone first, then share a file with them.</Text><Pressable accessibilityRole="button" accessibilityLabel="Invite someone" onPress={() => router.push("/invite")} style={{minHeight: 44, justifyContent: "center"}}><Text style={{color: c.primaryDark}}>Create an invitation link</Text></Pressable></View> : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.contactRow}
            >
              {users.map((u) => {
                const isOn = selected?.id === u.id;
                return (
                  <Pressable
                    key={u.id}
                    onPress={() => setSelected(isOn ? null : u)}
                    style={styles.contact}
                    testID={`contact-${u.id}`}
                  >
                    <View
                      style={[
                        styles.avatarRing,
                        isOn && { borderColor: c.primary },
                      ]}
                    >
                      <Avatar name={u.name} seed={u.id} photo={u.avatar} size={56} />
                      {isOn ? (
                        <View style={styles.checkDot}>
                          <Ionicons name="checkmark" size={12} color={c.textInverse} />
                        </View>
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.contactName,
                        isOn && { color: c.primary, fontFamily: f.bodyBold },
                      ]}
                      numberOfLines={1}
                    >
                      {u.name.split(" ")[0]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <Text style={styles.sectionLabel}>
            {voiceMode ? "Voice memo" : fileMode ? "File" : "Message"}
          </Text>
          {voiceMode ? (
            <VoiceComposer key={selected?.id || "none"} getChatId={async()=>{if(!selected || !user)throw new Error("Choose someone above first.");const chat=await api.postAs<{id:string}>(user.id,"/chats",{other_user_id:selected.id});return chat.id;}} onSent={chatId=>router.replace(`/chat/${chatId}`)}/>
          ) : fileMode ? (
            <>
            {file && (photoMode || isImageFilename(file.name)) ? <View style={{backgroundColor:c.surface,borderRadius:18,overflow:"hidden",marginBottom:12,padding:8}}><Image source={{uri:file.uri}} accessibilityLabel="Selected image preview" testID="selected-image-preview" resizeMode="contain" style={{width:"100%",height:220}}/><Text style={{fontFamily:f.body,color:c.textSecondary,fontSize:12,textAlign:"center",padding:8}}>Ready to share with {selected?.name || "someone you choose"}</Text></View> : null}
            <View style={styles.inputRow}>
              {file ? (
                <>
                  <View style={styles.chip}>
                    <Ionicons name="document-text-outline" size={16} color={c.primary} />
                    <Text style={styles.chipText} numberOfLines={1}>
                      {file.name}
                      {file.size ? " · " + (file.size < 1024 ? file.size + " B" : file.size < 1048576 ? (file.size / 1024).toFixed(1) + " KB" : (file.size / 1048576).toFixed(1) + " MB") : ""}
                    </Text>
                  </View>
                  <Pressable disabled={sending} accessibilityLabel="Remove selected file" onPress={() => setFile(null)} style={styles.cancelBtn} testID="file-remove">
                    <Ionicons name="close" size={18} color={c.textSecondary} />
                  </Pressable>
                </>
              ) : (
                <Pressable disabled={sending} accessibilityRole="button" accessibilityLabel={photoMode ? "Choose a photo" : "Choose a file"} onPress={pickFile} style={[styles.attachBtn, {width: "auto", paddingHorizontal: 14, gap: 8, flexDirection: "row"}]} testID="file-pick">
                  <Ionicons name="document-attach-outline" size={20} color={c.textInverse} /><Text style={{color: c.textInverse}}>{photoMode ? "Choose photo" : "Choose file"}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={sendIt}
                disabled={!canSend || sending}
                style={({ pressed }) => [
                  styles.sendBtn,
                  !canSend && { opacity: 0.4 },
                  pressed && { transform: [{ scale: 0.95 }] },
                ]}
                accessibilityRole="button" accessibilityLabel={sending ? "Sending" : "Send"} testID="quick-send"
              >
                {sending ? (
                  <ActivityIndicator color={c.textInverse} />
                ) : (
                  <Ionicons name="arrow-up" size={20} color={c.textInverse} />
                )}
              </Pressable>
            </View>
            </>
          ) : (
            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder={selected ? `Say hi to ${selected.name.split(" ")[0]}…` : "Type a message…"}
                placeholderTextColor={c.textTertiary}
                style={styles.input}
                multiline
                testID="quick-message-input"
              />
              <Pressable
                onPress={sendIt}
                disabled={!canSend || sending}
                style={({ pressed }) => [
                  styles.sendBtn,
                  !canSend && { opacity: 0.4 },
                  pressed && { transform: [{ scale: 0.95 }] },
                ]}
                accessibilityRole="button" accessibilityLabel={sending ? "Sending" : "Send"} testID="quick-send"
              >
                {sending ? (
                  <ActivityIndicator color={c.textInverse} />
                ) : (
                  <Ionicons name="arrow-up" size={20} color={c.textInverse} />
                )}
              </Pressable>
            </View>
          )}

          <Pressable
            onPress={() => {
              if (!selected) return;
              api.post<{ id: string }>("/chats", { other_user_id: selected.id }).then((chat) => {
                router.replace(`/chat/${chat.id}`);
              });
            }}
            style={styles.openChat}
            disabled={!selected}
            testID="open-full-chat"
          >
            <Text style={[styles.openChatText, !selected && { opacity: 0.4 }]}>
              Or open the full chat  ›
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette, f: any) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.overlay },
    dismissArea: { flex: 1 },
    card: {
      backgroundColor: c.bg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
    },
    cardHandle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginVertical: spacing.sm,
    },
    cardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing.md,
    },
    cardTitle: { fontFamily: f.heading, fontSize: 22, color: c.text, letterSpacing: -0.3 },
    close: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    sectionLabel: {
      fontFamily: f.bodyBold,
      fontSize: 11,
      color: c.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 1.3,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    loadingRow: { height: 80, alignItems: "center", justifyContent: "center" },
    errorText: { fontFamily: f.body, fontSize: 13, color: c.textSecondary, textAlign: "center" },
    contactRow: { gap: spacing.md, paddingBottom: spacing.sm, paddingRight: spacing.lg },
    contact: { alignItems: "center", width: 72 },
    avatarRing: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: "transparent",
      marginBottom: 6,
    },
    checkDot: {
      position: "absolute",
      right: 0,
      bottom: 0,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: c.bg,
    },
    contactName: {
      fontFamily: f.body,
      fontSize: 12,
      color: c.textSecondary,
      maxWidth: 72,
      textAlign: "center",
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      paddingLeft: spacing.md,
      paddingRight: 6,
      paddingVertical: 6,
    },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      fontFamily: f.body,
      fontSize: 15,
      color: c.text,
      paddingVertical: 10,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    attachBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    hintText: {
      flex: 1,
      fontFamily: f.body,
      fontSize: 14,
      color: c.textTertiary,
      paddingVertical: 12,
      paddingLeft: 4,
    },
    recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.error },
    recordText: { flex: 1, fontFamily: f.bodyMedium, fontSize: 14, color: c.text, paddingVertical: 12 },
    cancelBtn: {
      paddingHorizontal: 10,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    cancelText: { color: c.textSecondary, fontFamily: f.bodyMedium, fontSize: 13 },
    chip: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: c.bg,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: 10,
      minHeight: 40,
    },
    chipText: { flex: 1, fontFamily: f.bodyMedium, fontSize: 13, color: c.text },
    openChat: { marginTop: spacing.md, alignSelf: "center", padding: spacing.sm },
    openChatText: { fontFamily: f.bodyMedium, color: c.textSecondary, fontSize: 13 },
  });
