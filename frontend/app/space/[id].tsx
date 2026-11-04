import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { ApiError, getSessionUserId } from "../../src/api";
import { useTheme } from "../../src/ThemeContext";
import { useAuth } from "../../src/AuthContext";
import { type Palette, radius } from "../../src/theme";
import Avatar from "../../src/Avatar";
import { spacesApi, openSpaceSocket, uploadSpaceAudio, type Space, type SpaceMessage, type AudioTrack, type AudioUpload, type SpaceState } from "../../src/spaces";
import { acceptsPlayback, formatPlayback, mergeSpaceMessages, playbackPosition, reconnectDelay, sampleServerClock, timelineNow, type ClockSample } from "../../src/spacePlayback";
import SpaceAudio from "../../src/SpaceAudio";
import SpaceYouTube from "../../src/SpaceYouTube";
import {useReducedMotion} from "../../src/useReducedMotion";

const REACTIONS = ["❤️", "👏", "✨", "😂", "🥰", "🎶"];
function connectionId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}
function messageFor(cause: unknown, fallback: string) {
  if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) return cause.status === 404 ? "This room is no longer available." : "Your access to this room has ended. Return to Spaces to continue.";
  return cause instanceof Error ? cause.message : fallback;
}

export default function SpaceRoomScreen() {
  const params = useLocalSearchParams<{ id: string }>(), id = typeof params.id === "string" ? params.id : "";
  const router = useRouter(), { c, f } = useTheme(), { user } = useAuth(), uid = user?.id || "";
  const styles = useMemo(() => makeStyles(c, f), [c, f]);
  const [space, setSpace] = useState<Space | null>(null), [messages, setMessages] = useState<SpaceMessage[]>([]);
  const [dataScope, setDataScope] = useState("");
  const messagesRef = useRef(messages); messagesRef.current = messages;
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [actionError, setActionError] = useState("");
  const [connection, setConnection] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [clock, setClock] = useState<ClockSample>(), [reload, setReload] = useState(0), [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"chat" | "content" | "members" | null>(null), [reactionsOpen, setReactionsOpen] = useState(false);
  const [reaction, setReaction] = useState(""), [tick, setTick] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const updateDuration = useCallback((seconds: number) => { if (Number.isFinite(seconds) && seconds > 0) setMediaDuration(current => Math.abs(current - seconds) < 0.1 ? current : seconds); }, []);
  const socket = useRef<WebSocket | null>(null), connectionRef = useRef(""), clockRef = useRef<ClockSample | undefined>(undefined);
  const scope = uid + ":" + id, scopeRef = useRef(scope); scopeRef.current = scope;
  const closing = useRef(false), refreshRef = useRef<() => Promise<void>>(async () => {});
  const isHost = !!space && space.state.host_id === uid, activeUsers = space?.member_users.filter(person => space.active_members.includes(person.id)) || [];
  const host = space?.member_users.find(person => person.id === space.state.host_id);

  const acceptSnapshot = useCallback((next: Space) => setSpace(current => !current || acceptsPlayback(current.state, next.state) ? next : current), []);
  const acceptState = useCallback((next: SpaceState, extra: Partial<Space> = {}) => setSpace(current => current && acceptsPlayback(current.state, next) ? { ...current, ...extra, state: next, version: next.version } : current), []);
  useEffect(() => {
    let live = true, attempt = 0, retryTimer: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
    closing.current = false; const cid = connectionId(); connectionRef.current = cid;
    setSpace(null); setMessages([]); setDataScope(""); setLoading(true); setError(""); setActionError(""); setClock(undefined); clockRef.current = undefined; setPanel(null); setReaction(""); setConnection("connecting");
    const alive = () => live && getSessionUserId() === uid && scopeRef.current === scope;
    function sample(serverTime: string | undefined, sentAt: number) {
      const next = sampleServerClock(serverTime, sentAt, timelineNow(), clockRef.current);
      if (next && alive()) { clockRef.current = next; setClock(next); }
    }
    function terminal(cause: unknown) {
      if (!alive()) return;
      closing.current = true; if (retryTimer) clearTimeout(retryTimer); if (heartbeat) clearInterval(heartbeat); socket.current?.close();
      setSpace(null); setLoading(false); setError(messageFor(cause, "This room could not be opened."));
    }
    async function refresh() {
      const sentAt = timelineNow();
      await Promise.all([
        spacesApi.get(id, uid).then(next => { if (alive()) { sample(next.server_time || next.state.server_time, sentAt); acceptSnapshot(next); } }),
        (async () => {
          let cursor = messagesRef.current[messagesRef.current.length - 1]?.id;
          for (let page = 0; page < 5; page++) {
            const next = await spacesApi.listMessages(id, uid, undefined, cursor);
            if (!alive()) return;
            setMessages(current => mergeSpaceMessages(current, next));
            if (!cursor || next.length < 100) break;
            cursor = next[next.length - 1]?.id;
          }
        })(),
      ]);
    }
    refreshRef.current = refresh;
    function scheduleReconnect() {
      if (!alive() || closing.current || retryTimer) return;
      setConnection("reconnecting");
      retryTimer = setTimeout(() => { retryTimer = undefined; void connect(); }, reconnectDelay(attempt++));
    }
    async function connect() {
      if (!alive() || closing.current) return;
      try {
        const nextSocket = await openSpaceSocket(id, event => {
          if (!alive()) return;
          if (event.type === "snapshot" && event.space?.id === id) { acceptSnapshot(event.space); setLoading(false); }
          else if (event.type === "state" && event.state) acceptState(event.state);
          else if (event.type === "content" && event.state) acceptState(event.state, { content: event.content, mode: event.mode });
          else if (event.type === "presence" || event.type === "host") void refresh().catch(cause => { if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) terminal(cause); });
          else if (event.type === "message" && event.message?.id) setMessages(current => mergeSpaceMessages(current, [event.message]));
          else if (event.type === "reaction" && REACTIONS.includes(event.emoji)) setReaction(event.emoji);
          else if (event.type === "pong" && typeof event.client_time === "number") sample(event.server_time, event.client_time);
        }, code => {
          if (!alive() || closing.current) return;
          if (heartbeat) clearInterval(heartbeat);
          if ([1008, 4401, 4403].includes(code || 0)) terminal(new ApiError("Room access ended.", 403));
          else scheduleReconnect();
        }, { uid, connectionId: cid, onOpen: () => {
          if (!alive() || closing.current) { socket.current?.close(); return; }
          attempt = 0; setConnection("connected"); setActionError("");
          const ping = () => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: "ping", client_time: timelineNow() })); };
          ping(); if (heartbeat) clearInterval(heartbeat); heartbeat = setInterval(ping, 15000);
          void refresh().catch(cause => { if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) terminal(cause); });
        } });
        if (!alive() || closing.current) { nextSocket.close(); return; }
        socket.current = nextSocket;
      } catch (cause) {
        if (!alive()) return;
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) terminal(cause); else scheduleReconnect();
      }
    }
    if (!uid || !id) { setLoading(false); setError("Return to Spaces and choose a room."); }
    else void (async () => {
      try {
        const sentAt = timelineNow(), joined = await spacesApi.join(id, cid, uid);
        if (!alive()) { if (getSessionUserId() === uid) void spacesApi.leave(id, cid, uid).catch(() => {}); return; }
        sample(joined.server_time || joined.state.server_time, sentAt); acceptSnapshot(joined); setDataScope(scope); setLoading(false);
        await connect();
      } catch (cause) { if (alive()) { setLoading(false); setError(messageFor(cause, "This room could not be opened. Try again.")); } }
    })();
    const refreshTimer = setInterval(() => { if (alive() && !closing.current) void spacesApi.get(id, uid).then(next => { if (alive()) acceptSnapshot(next); }).catch(cause => { if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) terminal(cause); }); }, 30000);
    const appState = AppState.addEventListener("change", state => { if (state === "active" && alive() && !closing.current) { void refresh().catch(() => {}); if (!socket.current || socket.current.readyState === WebSocket.CLOSED) scheduleReconnect(); } });
    return () => {
      live = false; if (retryTimer) clearTimeout(retryTimer); if (heartbeat) clearInterval(heartbeat); clearInterval(refreshTimer); appState.remove();
      socket.current?.close(); socket.current = null;
      if (uid && id && getSessionUserId() === uid) void spacesApi.leave(id, cid, uid).catch(() => {});
    };
  }, [id, uid, reload, acceptSnapshot, acceptState, scope]);

  useEffect(() => { if (!reaction) return; const timer = setTimeout(() => setReaction(""), 2200); return () => clearTimeout(timer); }, [reaction]);
  useEffect(() => { setMediaDuration(0); }, [space?.state.session_id, space?.content?.type === "audio" ? space.content.upload_id || space.content.audio_id : space?.content?.type === "youtube" ? space.content.video_id : ""]);
  useEffect(() => { if (!space?.state.is_playing) return; const timer = setInterval(() => setTick(value => value + 1), 1000); return () => clearInterval(timer); }, [space?.state.is_playing]);
  void tick;

  async function action(run: () => Promise<unknown>) {
    if (busy || !uid) return;
    const captured = scope; setBusy(true); setActionError("");
    try { await run(); if (scopeRef.current === captured) await refreshRef.current(); return true; }
    catch (cause) { if (scopeRef.current === captured) setActionError(messageFor(cause, "That change could not be saved. Try again.")); return false; }
    finally { if (scopeRef.current === captured) setBusy(false); }
  }
  function leave() {
    closing.current = true; socket.current?.close();
    void spacesApi.leave(id, connectionRef.current, uid).catch(() => {});
    router.replace("/spaces");
  }
  async function togglePlay() {
    if (!space || !isHost) return;
    const position = playbackPosition(space.state, timelineNow(), clock?.offsetMs || 0, mediaDuration || (space.content?.type === "audio" ? space.content.duration_sec : undefined));
    const duration = mediaDuration || (space.content?.type === "audio" ? space.content.duration_sec : undefined);
    const replay = !!duration && position >= duration - 0.1;
    await action(async () => { const next = await spacesApi.setState(id, { is_playing: replay || !space.state.is_playing, position_sec: replay ? 0 : position, expected_version: space.state.version }, uid); if (scopeRef.current === scope) acceptState(next); });
  }
  async function seek(delta: number) {
    if (!space || !isHost) return;
    const duration = mediaDuration || (space.content?.type === "audio" ? space.content.duration_sec : undefined);
    const position = playbackPosition(space.state, timelineNow(), clock?.offsetMs || 0, duration);
    const nextPosition = duration ? Math.min(duration, Math.max(0, position + delta)) : Math.max(0, position + delta);
    await action(async () => { const next = await spacesApi.setState(id, { is_playing: space.state.is_playing, position_sec: nextPosition, expected_version: space.state.version }, uid); if (scopeRef.current === scope) acceptState(next); });
  }
  async function chooseContent(body: { type: "youtube" | "audio"; url?: string; audio_id?: string; upload_id?: string; title?: string }) {
    if (!isHost) return;
    if (await action(() => spacesApi.setContent(id, body, uid))) setPanel(null);
  }
  if (loading || !space || dataScope !== scope) return <SafeAreaView style={styles.safe}><View style={styles.center}>
    {loading || (dataScope !== scope && !error) ? <><ActivityIndicator color={c.primaryDark} /><Text style={styles.secondary}>Opening your room…</Text></> : <>
      <Ionicons name="planet-outline" size={42} color={c.primaryDark} /><Text style={styles.heading}>A little pause.</Text><Text accessibilityRole="alert" style={styles.secondary}>{error || "This room could not be opened."}</Text>
      <Pressable accessibilityRole="button" onPress={() => setReload(value => value + 1)} style={styles.primaryButton}><Text style={styles.primaryText}>Try again</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/spaces")} style={styles.textButton}><Text style={styles.link}>Back to Spaces</Text></Pressable>
    </>}
  </View></SafeAreaView>;

  const duration = mediaDuration || (space.content?.type === "audio" ? space.content.duration_sec : undefined);
  const position = playbackPosition(space.state, timelineNow(), clock?.offsetMs || 0, duration);
  const ended = !!duration && position >= duration - 0.1;
  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
    <View style={styles.header}>
      <IconButton label="Leave room" icon="chevron-back" onPress={leave} style={styles.iconButton} color={c.text} testID="space-back" />
      <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.roomTitle} numberOfLines={1}>{space.name}</Text><Text style={styles.small}>{activeUsers.length} here · {space.members.length} members</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="View room members and hosting" onPress={() => setPanel("members")} style={{ minHeight: 48, justifyContent: "center" }}>
        <View style={{ flexDirection: "row" }}>{activeUsers.slice(0, 3).map((person, index) => <View key={person.id} style={{ marginLeft: index ? -8 : 0 }}><Avatar name={person.name} seed={person.id} photo={person.avatar} size={30} /></View>)}</View>
        {!activeUsers.length ? <Ionicons name="people-outline" size={24} color={c.textSecondary} /> : null}
      </Pressable>
    </View>
    <View style={[styles.connection, connection !== "connected" && { backgroundColor: c.surfaceElevated }]} testID="space-connection">
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: connection === "connected" ? c.success : c.primaryDark }} />
      <Text accessibilityLiveRegion="polite" style={styles.small}>{connection === "connected" ? "Room connected" : connection === "reconnecting" ? "Reconnecting · playback will resync" : "Connecting to the room…"}</Text>
    </View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      <View style={styles.hostRow}><Ionicons name="sparkles-outline" size={17} color={c.primaryDark} /><Text style={styles.hostText}>{isHost ? "You're hosting" : (host?.name || "The host") + " is hosting"}</Text>
        <Pressable accessibilityRole="button" onPress={() => setPanel("members")} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 10 }}><Text style={styles.link}>{isHost || space.creator_id === uid ? "Manage" : "People"}</Text></Pressable>
      </View>
      {space.content?.type === "youtube" ? <SpaceYouTube videoId={space.content.video_id} state={space.state} offsetMs={clock?.offsetMs || 0} onDuration={updateDuration} /> :
        space.content?.type === "audio" ? <SpaceAudio content={space.content} state={space.state} offsetMs={clock?.offsetMs || 0} uid={uid} onDuration={updateDuration} /> :
          <View style={styles.idle}>
            <View style={styles.orbit}><Ionicons name="planet-outline" size={52} color={c.primaryDark} /></View>
            <Text style={styles.heading}>A little place, together.</Text>
            <Text style={styles.secondary}>{isHost ? "Put on a song or a video. Everyone in the room can settle in with you." : "Settle in. Your host can choose a song or a video for everyone."}</Text>
            {isHost ? <Pressable accessibilityRole="button" onPress={() => setPanel("content")} style={styles.primaryButton} testID="idle-add-content"><Text style={styles.primaryText}>Choose something</Text></Pressable> : <Pressable accessibilityRole="button" onPress={() => setPanel("chat")} style={styles.textButton}><Text style={styles.link}>Say hello in the room</Text></Pressable>}
          </View>}
      {space.content ? <View style={styles.transport}>
        <Text style={styles.secondary}>{formatPlayback(position)}{duration ? " / " + formatPlayback(duration) : ""}</Text>
        {isHost ? <View style={{ flexDirection: "row", gap: 12 }}><IconButton label="Seek back ten seconds" icon="play-back" onPress={() => void seek(-10)} disabled={busy} style={styles.iconButton} color={c.textSecondary} testID="seek-back-10" /><IconButton label="Seek forward ten seconds" icon="play-forward" onPress={() => void seek(10)} disabled={busy} style={styles.iconButton} color={c.textSecondary} testID="seek-fwd-10" /></View> : <Text style={styles.small}>Your host controls shared playback.</Text>}
      </View> : null}
      {actionError ? <Text accessibilityRole="alert" style={styles.error} testID="space-action-error">{actionError}</Text> : null}
      {reaction ? <Text accessibilityLiveRegion="polite" style={{ fontSize: 32, textAlign: "center", marginVertical: 8 }} testID="space-reaction">{reaction}</Text> : null}
    </ScrollView>
    {reactionsOpen ? <View style={styles.reactions}>{REACTIONS.map(emoji => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={"Send " + emoji + " reaction"} style={{ minHeight: 44, minWidth: 40, alignItems: "center", justifyContent: "center" }} onPress={() => { setReactionsOpen(false); void action(() => spacesApi.reaction(id, emoji, uid)); }}><Text style={{ fontSize: 26 }}>{emoji}</Text></Pressable>)}</View> : null}
    <View style={styles.controls}>
      <IconButton label={isHost ? "Choose room activity" : "Only the host can choose content"} icon="add" onPress={() => setPanel("content")} disabled={!isHost || busy} style={styles.iconButton} color={c.text} testID="space-add-content" />
      <IconButton label={ended ? "Replay shared playback" : space.state.is_playing ? "Pause shared playback" : "Start shared playback"} icon={ended ? "refresh" : space.state.is_playing ? "pause" : "play"} onPress={() => void togglePlay()} disabled={!isHost || !space.content || busy} style={styles.playButton} color={c.textInverse} testID="space-play-toggle" />
      <IconButton label="Choose a reaction" icon="heart-outline" onPress={() => setReactionsOpen(value => !value)} style={styles.iconButton} color={c.text} testID="space-reactions-btn" />
      <IconButton label="Open room conversation" icon="chatbubble-outline" onPress={() => setPanel("chat")} style={styles.iconButton} color={c.text} testID="space-chat-btn" />
      <IconButton label="Leave room" icon="exit-outline" onPress={leave} style={[styles.iconButton, { backgroundColor: c.errorBg }]} color={c.error} testID="space-leave" />
    </View>

    <RoomSheet visible={panel === "members"} title="Here, together" onClose={() => setPanel(null)}>
      <Text style={styles.secondary}>Hosting controls the shared song or video. Your own volume stays yours.</Text>
      {space.member_users.map(person => { const here = space.active_members.includes(person.id), hosting = space.state.host_id === person.id; return <View key={person.id} style={styles.memberRow}><Avatar name={person.name} seed={person.id} photo={person.avatar} size={42} /><View style={{ flex: 1 }}><Text style={styles.body}>{person.name}{person.id === uid ? " (you)" : ""}</Text><Text style={styles.small}>{hosting ? "Host · " : ""}{here ? "Here now" : "Invited"}</Text></View>{(isHost || space.creator_id === uid) && here && !hosting ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void action(() => spacesApi.handoff(id, person.id, uid))} style={styles.textButton}><Text style={styles.link}>{person.id === uid ? "Host" : "Pass host"}</Text></Pressable> : null}</View>; })}
      {!isHost && space.creator_id !== uid ? <Text style={styles.small}>Ask your host in the room conversation if you'd like a turn.</Text> : null}
      {actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}
    </RoomSheet>
    <ContentSheet key={scope} visible={panel === "content"} uid={uid} onClose={() => setPanel(null)} onChoose={chooseContent} busy={busy} actionError={actionError} />
    <ChatSheet key={scope + ":chat"} visible={panel === "chat"} onClose={() => setPanel(null)} spaceId={id} uid={uid} messages={messages} onSent={message => setMessages(current => mergeSpaceMessages(current, [message]))} onHistory={older => setMessages(current => mergeSpaceMessages(current, older))} />
  </SafeAreaView>;
}

function IconButton({ label, icon, onPress, disabled, style, color, testID }: { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void; disabled?: boolean; style: any; color: string; testID?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [style, { opacity: disabled ? 0.38 : pressed ? 0.72 : 1 }]} testID={testID}><Ionicons name={icon} size={23} color={color} /></Pressable>;
}
function RoomSheet({ visible, title, onClose, children, footer }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const { c, f } = useTheme(), styles = useMemo(() => makeStyles(c, f), [c, f]);
  const reducedMotion = useReducedMotion();
  return <Modal visible={visible} transparent animationType={reducedMotion ? "none" : "fade"} onRequestClose={onClose}>
    <View style={styles.sheetFrame}><Pressable accessibilityRole="button" accessibilityLabel="Close panel" onPress={onClose} style={StyleSheet.absoluteFillObject} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheet}>
        <View style={styles.sheetHeader}><Text style={styles.heading}>{title}</Text><IconButton label="Close panel" icon="close" onPress={onClose} style={styles.iconButton} color={c.text} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 16, paddingBottom: 16 }}>{children}</ScrollView>
        {footer}
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}
function ChatSheet({ visible, onClose, spaceId, uid, messages, onSent, onHistory }: { visible: boolean; onClose: () => void; spaceId: string; uid: string; messages: SpaceMessage[]; onSent: (message: SpaceMessage) => void; onHistory: (messages: SpaceMessage[]) => void }) {
  const { c, f } = useTheme(), styles = useMemo(() => makeStyles(c, f), [c, f]);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [olderBusy, setOlderBusy] = useState(false), [hasOlder, setHasOlder] = useState(true);
  const draftIdentity = useRef({ text: "", id: "" });
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function send() {
    if (!text.trim() || busy) return;
    const draft = text.trim(); setBusy(true); setError("");
    if (draftIdentity.current.text !== draft) draftIdentity.current = { text: draft, id: connectionId() };
    try { const message = await spacesApi.sendMessage(spaceId, draft, uid, draftIdentity.current.id); if (alive.current) { onSent(message); setText(""); draftIdentity.current = { text: "", id: "" }; } }
    catch (cause) { if (alive.current) setError(messageFor(cause, "Could not confirm delivery. Check the conversation before trying again.")); }
    finally { if (alive.current) setBusy(false); }
  }
  async function loadOlder() {
    if (olderBusy || !messages[0]) return;
    setOlderBusy(true); setError("");
    try { const older = await spacesApi.listMessages(spaceId, uid, messages[0].id); if (alive.current) { onHistory(older); setHasOlder(older.length === 50); } }
    catch (cause) { if (alive.current) setError(messageFor(cause, "Earlier messages could not be loaded.")); }
    finally { if (alive.current) setOlderBusy(false); }
  }
  return <RoomSheet visible={visible} title="Room conversation" onClose={onClose} footer={<>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <View style={styles.composer}><TextInput accessibilityLabel="Message the room" value={text} onChangeText={setText} placeholder="Say something…" placeholderTextColor={c.textSecondary} maxLength={4000} style={styles.chatInput} multiline testID="space-chat-input" /><IconButton label="Send room message" icon="arrow-up" onPress={() => void send()} disabled={busy || !text.trim()} style={[styles.iconButton, { backgroundColor: c.primary }]} color={c.textInverse} testID="space-chat-send" /></View>
  </>}>
    {hasOlder && messages.length >= 50 ? <Pressable accessibilityRole="button" onPress={() => void loadOlder()} disabled={olderBusy} style={styles.textButton}><Text style={styles.link}>{olderBusy ? "Loading earlier messages…" : "Earlier messages"}</Text></Pressable> : null}
    {messages.length ? messages.map(message => <View key={message.id} style={[styles.bubble, { alignSelf: message.sender_id === uid ? "flex-end" : "flex-start", backgroundColor: message.sender_id === uid ? c.surfaceElevated : c.surface }]}>{message.sender_id !== uid ? <Text style={styles.small}>{message.sender_name}</Text> : null}<Text style={styles.body}>{message.text}</Text></View>) : <Text style={styles.secondary}>A hello is a lovely place to start.</Text>}
  </RoomSheet>;
}
function ContentSheet({ visible, uid, onClose, onChoose, busy, actionError }: { visible: boolean; uid: string; onClose: () => void; onChoose: (body: { type: "youtube" | "audio"; url?: string; audio_id?: string; upload_id?: string; title?: string }) => Promise<void>; busy: boolean; actionError: string }) {
  const { c, f } = useTheme(), styles = useMemo(() => makeStyles(c, f), [c, f]);
  const [tab, setTab] = useState<"video" | "audio">("video"), [url, setUrl] = useState(""), [tracks, setTracks] = useState<AudioTrack[]>([]), [uploads, setUploads] = useState<AudioUpload[]>([]);
  const [loading, setLoading] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!visible || tab !== "audio") return;
    let active = true; setLoading(true); setError("");
    void Promise.all([spacesApi.audioLibrary(uid), spacesApi.audioUploads(uid)]).then(([library, own]) => { if (active) { setTracks(library); setUploads(own); } }).catch(cause => { if (active) setError(messageFor(cause, "Audio choices could not be loaded.")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible, tab, uid, revision]);
  async function upload() {
    if (uploading) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0] || !alive.current) return;
      setUploading(true); setError("");
      await uploadSpaceAudio(picked.assets[0], uid);
      if (alive.current) setRevision(value => value + 1);
    } catch (cause) { if (alive.current) setError(messageFor(cause, "Audio could not be uploaded. Try again.")); }
    finally { if (alive.current) setUploading(false); }
  }
  return <RoomSheet visible={visible} title="Set the mood" onClose={onClose}>
    <Text style={styles.secondary}>Choose something to enjoy together. YouTube availability depends on the video owner.</Text>
    <View style={{ flexDirection: "row", gap: 8 }}>{(["video", "audio"] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[styles.segment, tab === value && { backgroundColor: c.primaryBgSubtle }]} testID={"add-tab-" + value}><Text style={[styles.body, { color: tab === value ? c.primaryDark : c.textSecondary }]}>{value === "video" ? "Watch together" : "Listen together"}</Text></Pressable>)}</View>
    {tab === "video" ? <>
      <TextInput accessibilityLabel="YouTube video link" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="Paste a YouTube link" placeholderTextColor={c.textSecondary} style={styles.input} testID="youtube-url-input" />
      <Pressable accessibilityRole="button" disabled={!url.trim() || busy} onPress={() => void onChoose({ type: "youtube", url: url.trim(), title: "YouTube video" })} style={[styles.primaryButton, (!url.trim() || busy) && { opacity: 0.4 }]} testID="youtube-submit"><Text style={styles.primaryText}>{busy ? "Choosing…" : "Watch together"}</Text></Pressable>
    </> : <>
      <Pressable accessibilityRole="button" disabled={uploading} onPress={() => void upload()} style={styles.upload} testID="audio-upload-btn"><Ionicons name="cloud-upload-outline" size={22} color={c.primaryDark} /><View style={{ flex: 1 }}><Text style={styles.body}>{uploading ? "Saving your audio…" : "Upload your own audio"}</Text><Text style={styles.small}>Private to you and the room · up to 10 MB</Text></View>{uploading ? <ActivityIndicator color={c.primaryDark} /> : null}</Pressable>
      {loading ? <ActivityIndicator color={c.primaryDark} /> : <>
        <Text style={styles.sectionLabel}>Your uploads</Text>
        {!uploads.length ? <Text style={styles.small}>Your saved audio will appear here.</Text> : uploads.map(item => <Pressable key={item.id} accessibilityRole="button" disabled={busy} onPress={() => void onChoose({ type: "audio", upload_id: item.id, title: item.title })} style={styles.track} testID={"upload-" + item.id}><Ionicons name="musical-note-outline" size={24} color={c.primaryDark} /><View style={{ flex: 1 }}><Text style={styles.body}>{item.title}</Text><Text style={styles.small}>{item.uploader_name || "Your upload"}</Text></View><Ionicons name="play-outline" size={20} color={c.primaryDark} /></Pressable>)}
        {tracks.length ? <Text style={styles.sectionLabel}>More sounds</Text> : <Text style={styles.small}>Upload audio you own or have permission to share.</Text>}
        {tracks.map(item => <Pressable key={item.id} accessibilityRole="button" disabled={busy} onPress={() => void onChoose({ type: "audio", audio_id: item.id, title: item.title })} style={styles.track} testID={"track-" + item.id}><Ionicons name="headset-outline" size={24} color={c.primaryDark} /><View style={{ flex: 1 }}><Text style={styles.body}>{item.title}</Text><Text style={styles.small}>{item.artist}</Text></View><Ionicons name="play-outline" size={20} color={c.primaryDark} /></Pressable>)}
      </>}
    </>}
    {error || actionError ? <><Text accessibilityRole="alert" style={styles.error}>{error || actionError}</Text><Pressable accessibilityRole="button" onPress={() => setRevision(value => value + 1)} style={styles.textButton}><Text style={styles.link}>Try again</Text></Pressable></> : null}
  </RoomSheet>;
}
const makeStyles = (c: Palette, f: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg }, center: { flex: 1, padding: 28, gap: 18, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8, width: "100%", maxWidth: 1120, alignSelf: "center" },
  roomTitle: { fontFamily: f.heading, fontSize: 23, color: c.text, lineHeight: 30 },
  heading: { fontFamily: f.heading, fontSize: 26, color: c.text, textAlign: "center" },
  body: { fontFamily: f.body, fontSize: 16, lineHeight: 23, color: c.text },
  secondary: { fontFamily: f.body, fontSize: 15, lineHeight: 23, color: c.textSecondary, textAlign: "center", maxWidth: 480 },
  small: { fontFamily: f.body, fontSize: 13, lineHeight: 19, color: c.textSecondary },
  link: { fontFamily: f.bodyBold, fontSize: 14, color: c.primaryDark },
  connection: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, minHeight: 36 },
  content: { padding: 16, paddingBottom: 24, width: "100%", maxWidth: 900, alignSelf: "center", flexGrow: 1, justifyContent: "center" },
  hostRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 12 },
  hostText: { flex: 1, color: c.primaryDark, fontFamily: f.bodyMedium, fontSize: 14 },
  idle: { alignItems: "center", paddingVertical: 32, gap: 16 },
  orbit: { width: 120, height: 120, borderRadius: 44, backgroundColor: c.surfaceElevated, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  primaryButton: { minHeight: 52, borderRadius: 26, backgroundColor: c.primary, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" },
  primaryText: { fontFamily: f.bodyBold, fontSize: 16, color: c.textInverse },
  textButton: { minHeight: 48, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  iconButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
  playButton: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  controls: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border },
  transport: { alignItems: "center", gap: 6, marginTop: 14 },
  error: { color: c.error, fontFamily: f.body, fontSize: 14, lineHeight: 21, textAlign: "center", paddingVertical: 8 },
  reactions: { alignSelf: "center", flexDirection: "row", backgroundColor: c.surfaceElevated, borderRadius: 24, padding: 4, marginBottom: 8 },
  sheetFrame: { flex: 1, backgroundColor: c.overlay, justifyContent: "flex-end", alignItems: "center" },
  sheet: { width: "100%", maxWidth: 760, maxHeight: "88%", backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 28 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  bubble: { maxWidth: "90%", borderRadius: 18, padding: 12, gap: 4 },
  composer: { flexDirection: "row", gap: 8, padding: 6, paddingLeft: 16, borderRadius: 28, backgroundColor: c.surface, alignItems: "flex-end" },
  chatInput: { flex: 1, minWidth: 0, minHeight: 48, maxHeight: 140, fontFamily: f.body, fontSize: 16, lineHeight: 23, color: c.text, paddingVertical: 12 },
  segment: { flex: 1, minHeight: 48, paddingHorizontal: 12, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: c.surface },
  input: { minHeight: 56, borderRadius: radius.lg, backgroundColor: c.surface, paddingHorizontal: 16, color: c.text, fontFamily: f.body, fontSize: 16 },
  upload: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: c.surface, borderRadius: radius.lg, minHeight: 80 },
  track: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: 64 },
  sectionLabel: { fontFamily: f.bodyBold, fontSize: 14, color: c.textSecondary, marginTop: 8 },
});
