import Decor from "../../src/Decor";
import { getOutbox, queueMessage, retryMessage, removePending, subscribeOutbox, PendingMessage } from "../../src/outbox";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { api, Message, User, uploadAttachment } from "../../src/api";
import { CALLS_ENABLED } from "../../src/config";
import { radius, spacing } from "../../src/theme";
import { useTheme } from "../../src/ThemeContext";
import Avatar from "../../src/Avatar";
import { useAuth } from "../../src/AuthContext";
import { VoiceMessageBubble, FilePreviewCard } from "../../src/MessageParts";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { c, f } = useTheme();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const [chatInfo, setChatInfo] = useState<{ other: User | null } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  useEffect(() => {
    let active = true;
    const sync = async () => { if (user) { const all = await getOutbox(user.id); if(active)setPending(all.filter(m=>m.chat_id===id)); } };
    void sync().catch(()=>setError("Could not read queued messages")); const stop=subscribeOutbox(()=>void sync().catch(()=>setError("Could not read queued messages")));
    return()=>{active=false;stop();};
  },[user?.id,id]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const loadingRef = useRef(false);
  const activeChat = useRef(id);
  activeChat.current = id;

  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  const load = useCallback(async () => {
    if (!id || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [info, msgs] = await Promise.all([
        api.get<{ other: User | null }>(`/chats/${id}`),
        api.get<Message[]>("/chats/"+id+"/messages?limit=100"+(messagesRef.current.length ? "&after="+messagesRef.current[messagesRef.current.length-1].id : "")),
      ]);
      if (activeChat.current !== id) return;
      setChatInfo(info);
      setMessages((previous) => Array.from(new Map([...previous, ...msgs].map(m => [m.id, m])).values()).sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)));
      setError(null);
    } catch {
      setError("Couldn't load messages — check your connection");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setMessages([]); setChatInfo(null); setLoading(true);
    messagesRef.current = []; loadingRef.current = false;
    load();
  }, [load]);

  // Lightweight polling for new messages — only while this screen is focused
  useFocusEffect(
    useCallback(() => {
      const t = setInterval(load, 4000);
      return () => clearInterval(t);
    }, [load]),
  );

  useEffect(() => {
    if (messages.length > 0) {
      const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
      return () => clearTimeout(t);
    }
  }, [messages[messages.length - 1]?.id]);

  useEffect(() => () => {
    if (recordTimer.current) clearInterval(recordTimer.current);
  }, []);

  async function send(payload: Record<string,unknown>): Promise<boolean> {
    if (!user) return false;
    setSending(true);
    try { await queueMessage(user.id,payload); return true; }
    catch(e) { setError(e instanceof Error ? e.message : "Could not save this message for sending");return false; }
    finally {setSending(false);}
  }
  async function sendText() {
    const t = text.trim();
    if (!t) return;
    const ok = await send({ chat_id: id, type: "text", text: t });
    if (ok) setText("");
  }

  async function shareFile(uri: string, name: string, type: "file" | "image" = "file") {
    setSending(true);
    try {
      const file = await uploadAttachment(id, uri, name);
      await send({ chat_id: id, type, attachment_id: file.id });
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed. Try again."); }
    finally { setSending(false); }
  }
  async function attachImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      await shareFile(a.uri, a.fileName || "image.jpg", "image");
    }
  }
  async function attachFile() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (!result.canceled && result.assets[0]) await shareFile(result.assets[0].uri, result.assets[0].name);
  }
  function startRecording() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRecording(true);
    setRecordSec(0);
    recordTimer.current = setInterval(() => setRecordSec((s) => s + 1), 1000);
  }

  async function stopRecording(cancel = false) {
    if (recordTimer.current) clearInterval(recordTimer.current);
    const sec = recordSec;
    setRecording(false);
    setRecordSec(0);
    if (cancel || sec < 1) return;
    await send({
      chat_id: id,
      type: "voice",
      duration_ms: sec * 1000,
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="chat-back">
          <Ionicons name="chevron-back" size={22} color={c.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Avatar name={chatInfo?.other?.name} seed={chatInfo?.other?.id} photo={chatInfo?.other?.avatar} size={36} />
          <View>
            <Text style={styles.headerName} numberOfLines={1}>
              {chatInfo?.other?.name || "Chat"}
            </Text>
            <Text style={styles.headerSub}>Private conversation</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Contact privacy and reporting" onPress={()=>chatInfo?.other && router.push(("/privacy?contact="+chatInfo.other.id) as never)} style={styles.iconBtn}><Ionicons name="ellipsis-horizontal" size={22} color={c.text}/></Pressable>
        {CALLS_ENABLED && <Pressable
          onPress={() => chatInfo?.other && router.push(`/call/${chatInfo.other.id}`)}
          style={styles.iconBtn}
          testID="chat-call"
        >
          <Ionicons name="call-outline" size={20} color={c.primaryDark} />
        </Pressable>}
      </View>

      {/* Phase 2 — Start a shared space */}
      <Pressable
        style={styles.spacesPill}
        onPress={async () => {
          if (!chatInfo?.other) return;
          try {
            const space = await api.post<{ id: string; name?: string }>("/spaces", {
              name: `${chatInfo.other.name.split(" ")[0]} & you`,
              member_ids: [chatInfo.other.id],
            });
            await api.post(`/chats/${id}/messages`, {
              chat_id: id,
              type: "space_invite",
              text: "Started a space",
              space_id: space.id,
              space_name: space.name || "Shared space",
            });
            router.push(`/space/${space.id}`);
          } catch {}
        }}
        testID="shared-space-pill"
      >
        <Ionicons name="sparkles-outline" size={14} color={c.textSecondary} />
        <Text style={styles.spacesText}>Start a shared space</Text>
        <Ionicons name="arrow-forward" size={12} color={c.primary} />
      </Pressable>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
        style={{ flex: 1 }}
      >
        {error ? (
          <Pressable
            onPress={() => {
              setError(null);
              load();
            }}
            style={styles.errorBanner}
            testID="chat-error"
          >
            <Ionicons name="cloud-offline-outline" size={14} color={c.error} />
            <Text style={styles.errorText}>{error}  ·  Tap to retry</Text>
          </Pressable>
        ) : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={c.primary} />
          </View>
        ) : (
          <View style={{flex: 1}}><Decor/><FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.msgList}
            renderItem={({ item }) => (
              <MessageRow msg={item} mine={item.sender_id === user?.id} />
            )}
            ListHeaderComponent={messages.length >= 50 ? <Pressable onPress={async () => {
              try {
                const older = await api.get<Message[]>("/chats/" + id + "/messages?before=" + messages[0].id);
                setMessages(prev => Array.from(new Map([...older, ...prev].map(m => [m.id, m])).values()));
              } catch { setError("Could not load older messages"); }
            }}><Text style={{ color: c.primary, padding: 12 }}>Load older messages</Text></Pressable> : null}
            ListFooterComponent={<View>{pending.filter(p => !messages.some(m=>m.client_message_id===p.id)).map(p => <View key={p.id} style={{padding:12,alignSelf:"flex-end"}}>
              <Text style={{color:c.text}}>{String(p.payload.text || "File waiting to send")}</Text>
              <Text style={{color:c.textSecondary}}>{p.state==="failed"?p.error:"Waiting to send…"}</Text>
              {p.state==="failed" ? <Pressable onPress={()=>user && retryMessage(user.id,p.id)}><Text style={{color:c.primary}}>Retry</Text></Pressable>:null}
              <Pressable onPress={()=>user && removePending(user.id,p.id)}><Text style={{color:c.textSecondary}}>Remove from queue</Text></Pressable>
            </View>)}</View>}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Say something gentle.</Text>
              </View>
            }
          /></View>
        )}

        {recording ? (
          <View style={styles.recordBar}>
            <View style={styles.recordDot} />
            <Text style={styles.recordText}>
              Recording  ·  0:{recordSec.toString().padStart(2, "0")}
            </Text>
            <Pressable onPress={() => stopRecording(true)} style={styles.recordCancel}>
              <Text style={styles.recordCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => stopRecording(false)}
              style={styles.recordSend}
              testID="voice-send"
            >
              <Ionicons name="send" size={16} color={c.textInverse} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.composer}>
            <Pressable onPress={attachFile} style={styles.attachBtn} testID="attach-file">
              <Ionicons name="add" size={22} color={c.text} />
            </Pressable>
            <Pressable onPress={attachImage} style={styles.attachBtn} testID="attach-image">
              <Ionicons name="image-outline" size={20} color={c.text} />
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor={c.textTertiary}
              style={styles.input}
              multiline
              testID="message-input"
            />
            {text.trim().length > 0 ? (
              <Pressable
                onPress={sendText}
                disabled={sending}
                style={styles.sendBtn}
                testID="send-button"
              >
                <Ionicons name="arrow-up" size={20} color={c.textInverse} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setError("Voice messages are coming in a later release")}
                style={styles.sendBtn}
                testID="mic-button"
              >
                <Ionicons name="mic-outline" size={20} color={c.textInverse} />
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageRow({ msg, mine }: { msg: Message; mine: boolean }) {
  const { c, f } = useTheme();
  const router = useRouter();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const bubbleStyle = [
    styles.bubble,
    mine
      ? { backgroundColor: c.surfaceElevated, borderBottomRightRadius: 4 }
      : { backgroundColor: c.surface, borderBottomLeftRadius: 4 },
  ];
  return (
    <View style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]}>
      <View style={bubbleStyle}>
        {msg.type === "text" && (
          <Text style={styles.msgText}>{msg.text}</Text>
        )}
        {msg.type === "voice" && (
          <VoiceMessageBubble durationMs={msg.duration_ms || 0} outgoing={mine} media={msg.media} />
        )}
        {msg.type === "image" && msg.media ? (
          <Image
            source={{ uri: msg.media }}
            style={styles.imageMsg}
            resizeMode="cover"
          />
        ) : msg.type === "image" ? (
          <FilePreviewCard unavailable={msg.attachment_deleted} canDelete={mine} attachmentId={msg.attachment_id} fileName={msg.file_name} fileSize={msg.file_size} type="image" />
        ) : null}
        {msg.type === "file" && (
          <FilePreviewCard unavailable={msg.attachment_deleted} canDelete={mine} attachmentId={msg.attachment_id} fileName={msg.file_name} fileSize={msg.file_size} type="file" />
        )}
        {msg.type === "space_invite" && (
          <Pressable
            onPress={() => msg.space_id && router.push(`/space/${msg.space_id}`)}
            style={{
              backgroundColor: c.primaryBgSubtle,
              padding: 12,
              borderRadius: 16,
              minWidth: 220,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
            testID={`join-space-${msg.space_id}`}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: c.primary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="planet-outline" size={20} color={c.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: f.bodyBold, fontSize: 13, color: c.text }}>
                {msg.space_name || "Shared space"}
              </Text>
              <Text style={{ fontFamily: f.body, fontSize: 11, color: c.textSecondary, marginTop: 2 }}>
                Tap to join
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={c.primary} />
          </Pressable>
        )}
        <Text style={styles.msgTime}>
          {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (c: any, f: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerName: { fontFamily: f.heading, fontSize: 18, color: c.text },
  headerSub: { fontFamily: f.body, fontSize: 11, color: c.textTertiary, marginTop: 2 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surface,
  },
  spacesPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: "dashed",
    marginVertical: spacing.sm,
  },
  spacesText: { fontFamily: f.body, fontSize: 12, color: c.textSecondary },
  spacesSoon: {
    fontFamily: f.bodyMedium,
    fontSize: 10,
    color: c.primary,
    backgroundColor: c.primaryBgSubtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
    marginLeft: 2,
  },
  msgList: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg },
  msgRow: { flexDirection: "row", marginBottom: spacing.sm },
  msgLeft: { justifyContent: "flex-start" },
  msgRight: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "80%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  msgText: { fontFamily: f.body, fontSize: 15, color: c.text, lineHeight: 22 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    backgroundColor: c.errorBg,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 999,
    marginVertical: spacing.sm,
  },
  errorText: { fontFamily: f.bodyMedium, fontSize: 12, color: c.error },
  msgTime: {
    fontFamily: f.body,
    fontSize: 10,
    color: c.textTertiary,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  imageMsg: {
    width: 220,
    height: 220,
    borderRadius: 16,
    backgroundColor: c.primaryBgSubtle,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bg,
  },
  attachBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: c.surface,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: f.body,
    fontSize: 15,
    color: c.text,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  recordBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.error },
  recordText: { flex: 1, fontFamily: f.bodyMedium, color: c.text },
  recordCancel: { paddingHorizontal: 10, paddingVertical: 6 },
  recordCancelText: { color: c.textSecondary, fontFamily: f.bodyMedium },
  recordSend: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", padding: spacing.xl },
  emptyText: { fontFamily: f.body, color: c.textSecondary },
});
