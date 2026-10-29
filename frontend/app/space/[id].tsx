import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  TextInput,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import Animated, {
  useSharedValue,
  withTiming,
  withSequence,
  useAnimatedStyle,
  Easing,
  withDelay,
  runOnJS,
} from "react-native-reanimated";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import {
  spacesApi,
  Space,
  SpaceMessage,
  AudioTrack,
  AudioUpload,
  openSpaceSocket,
} from "../../src/spaces";
import * as DocumentPicker from "expo-document-picker";
import { useTheme } from "../../src/ThemeContext";
import { useAuth } from "../../src/AuthContext";
import { Palette, radius, spacing } from "../../src/theme";
import Avatar from "../../src/Avatar";

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get("window");
const REACTIONS = ["❤️", "😂", "🔥", "👏", "🌙", "✨"];

export default function SpaceRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { c, f } = useTheme();
  const { user } = useAuth();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);

  const [space, setSpace] = useState<Space | null>(null);
  const [loading, setLoading] = useState(true);
  const [presence, setPresence] = useState<{ id: string; text: string }[]>([]);
  const [floatReactions, setFloatReactions] = useState<{ id: string; emoji: string }[]>([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [addContent, setAddContent] = useState(false);
  const [reactionsBar, setReactionsBar] = useState(false);
  const [messages, setMessages] = useState<SpaceMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const youtubeRef = useRef<WebView | null>(null);
  const soundRef = useRef<AudioPlayer | null>(null);
  const soundUrlRef = useRef<string | null>(null);
  const lastJoinIdRef = useRef<string | null>(null);

  const isHost = space?.state.host_id === user?.id;

  const addPresence = useCallback((text: string) => {
    const id = Math.random().toString(36).slice(2);
    setPresence((cur) => [...cur, { id, text }]);
    setTimeout(() => setPresence((cur) => cur.filter((p) => p.id !== id)), 3200);
  }, []);

  const addReaction = useCallback((emoji: string) => {
    const id = Math.random().toString(36).slice(2);
    setFloatReactions((cur) => [...cur, { id, emoji }]);
    setTimeout(() => setFloatReactions((cur) => cur.filter((r) => r.id !== id)), 2200);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [s, ms] = await Promise.all([
        spacesApi.get(id),
        spacesApi.listMessages(id),
      ]);
      setSpace(s);
      setMessages(ms);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Initial load + open WebSocket
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    (async () => {
      const ws = await openSpaceSocket(id, (msg) => {
        if (!mounted) return;
        if (msg.type === "snapshot") {
          setSpace(msg.space);
        } else if (msg.type === "presence") {
          if (msg.user_id === user?.id) return; // ignore self
          if (msg.event === "join") addPresence(`${msg.user_name} joined`);
          if (msg.event === "leave") addPresence(`${msg.user_name} left`);
          load();
        } else if (msg.type === "content") {
          setSpace((prev) =>
            prev ? { ...prev, content: msg.content, mode: msg.mode, state: msg.state } : prev,
          );
          addPresence(`${msg.by_name} shared ${msg.content?.title ?? "something"}`);
        } else if (msg.type === "state") {
          setSpace((prev) => (prev ? { ...prev, state: msg.state } : prev));
          if (msg.by !== user?.id) {
            addPresence(
              `${msg.by_name} ${msg.state.is_playing ? "pressed play" : "paused"}`,
            );
          }
        } else if (msg.type === "message") {
          setMessages((cur) => [...cur, msg.message]);
        } else if (msg.type === "reaction") {
          addReaction(msg.emoji);
        }
      });
      wsRef.current = ws;
    })();

    return () => {
      mounted = false;
      try {
        wsRef.current?.close();
      } catch {}
    };
  }, [id, load, addPresence, addReaction, user?.id]);

  // Audio sync — drive expo-audio player from server state
  useEffect(() => {
    let cancelled = false;
    async function sync() {
      if (!space || space.mode !== "audio" || !space.content) return;
      const url = (space.content as any).url;
      if (!url) return;
      // Setup player only if URL changed
      if (!soundRef.current || soundUrlRef.current !== url) {
        try {
          await setAudioModeAsync({ playsInSilentMode: true });
        } catch {}
        if (soundRef.current) {
          try {
            soundRef.current.remove();
          } catch {}
        }
        const player = createAudioPlayer({ uri: url });
        if (cancelled) {
          try {
            player.remove();
          } catch {}
          return;
        }
        soundRef.current = player;
        soundUrlRef.current = url;
      }
      try {
        // Project position
        const elapsed = (Date.now() - new Date(space.state.updated_at).getTime()) / 1000;
        const target = space.state.position_sec + (space.state.is_playing ? Math.max(0, elapsed) : 0);
        await soundRef.current!.seekTo(target);
        if (space.state.is_playing) soundRef.current!.play();
        else soundRef.current!.pause();
      } catch {}
    }
    sync();
    return () => {
      cancelled = true;
    };
  }, [space?.id, space?.mode, space?.content, space?.state.is_playing, space?.state.position_sec, space?.state.updated_at]);

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        try {
          soundRef.current.remove();
        } catch {}
        soundRef.current = null;
        soundUrlRef.current = null;
      }
    };
  }, []);

  // YouTube — push play/pause/seek when state changes (host or remote)
  useEffect(() => {
    if (!space || space.mode !== "video" || !youtubeRef.current) return;
    const elapsed = (Date.now() - new Date(space.state.updated_at).getTime()) / 1000;
    const target = space.state.position_sec + (space.state.is_playing ? Math.max(0, elapsed) : 0);
    const js = `
      if (window.YTPlayer) {
        try { YTPlayer.seekTo(${target}, true); } catch(e){}
        try { ${space.state.is_playing ? "YTPlayer.playVideo()" : "YTPlayer.pauseVideo()"}; } catch(e){}
      }
      true;
    `;
    youtubeRef.current.injectJavaScript(js);
  }, [space?.id, space?.mode, space?.content, space?.state.is_playing, space?.state.position_sec, space?.state.updated_at]);

  async function leaveAndExit() {
    try {
      await spacesApi.leave(id!);
    } catch {}
    try {
      wsRef.current?.close();
    } catch {}
    router.back();
  }

  async function togglePlay() {
    if (!space || !space.content) return;
    let pos = space.state.position_sec;
    if (space.state.is_playing) {
      const elapsed = (Date.now() - new Date(space.state.updated_at).getTime()) / 1000;
      pos = space.state.position_sec + Math.max(0, elapsed);
    }
    try {
      await spacesApi.setState(id!, { is_playing: !space.state.is_playing, position_sec: pos });
    } catch {}
  }

  async function handleSeek(newPositionSec: number) {
    if (!space || !isHost) return;
    try {
      await spacesApi.setState(id!, {
        is_playing: space.state.is_playing,
        position_sec: Math.max(0, newPositionSec),
      });
    } catch {}
  }

  async function setYoutube(url: string) {
    if (!url.trim()) return;
    setAddContent(false);
    try {
      await spacesApi.setContent(id!, { type: "youtube", url, title: "YouTube video" });
    } catch {}
  }

  async function setAudio(track: AudioTrack) {
    setAddContent(false);
    try {
      await spacesApi.setContent(id!, { type: "audio", audio_id: track.id, title: track.title });
    } catch {}
  }

  async function setUploadedAudio(upload: AudioUpload) {
    setAddContent(false);
    try {
      await spacesApi.setContent(id!, { type: "audio", upload_id: upload.id, title: upload.title });
    } catch {}
  }

  async function react(emoji: string) {
    setReactionsBar(false);
    addReaction(emoji); // optimistic
    try {
      await spacesApi.reaction(id!, emoji);
    } catch {}
  }

  if (loading || !space) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={c.primary} />
      </SafeAreaView>
    );
  }

  const activeUsers = space.member_users.filter((u) => space.active_members.includes(u.id));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Floating header */}
      <View style={styles.header}>
        <Pressable onPress={leaveAndExit} style={styles.headerBtn} testID="space-back">
          <Ionicons name="chevron-back" size={20} color={c.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {space.name}
          </Text>
          <Text style={styles.headerSub}>
            {activeUsers.length} {activeUsers.length === 1 ? "person" : "people"} together
          </Text>
        </View>
        <View style={styles.avatarStack}>
          {activeUsers.slice(0, 3).map((u, i) => (
            <View key={u.id} style={[styles.stackedAvatar, { marginLeft: i === 0 ? 0 : -10 }]}>
              <Avatar name={u.name} seed={u.id} photo={u.avatar} size={28} />
            </View>
          ))}
        </View>
      </View>

      {/* Main content area */}
      <View style={styles.content}>
        {space.mode === "video" && space.content?.type === "youtube" ? (
          <View style={{ width: "100%" }}>
            <View style={styles.videoWrap}>
              {Platform.OS === "web" ? (
                React.createElement("iframe", {
                  src: `https://www.youtube.com/embed/${(space.content as any).video_id}?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1`,
                  style: { width: "100%", height: "100%", border: 0 },
                  allow: "autoplay; encrypted-media; fullscreen; picture-in-picture",
                  allowFullScreen: true,
                  "data-testid": "youtube-player",
                })
              ) : (
                <WebView
                  ref={youtubeRef}
                  source={{ html: youtubeHtml((space.content as any).video_id) }}
                  style={styles.video}
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  javaScriptEnabled
                  onMessage={() => {}}
                  testID="youtube-player"
                />
              )}
            </View>
            <SeekBar space={space} isHost={isHost} onSeek={handleSeek} c={c} f={f} />
          </View>
        ) : space.mode === "audio" && space.content?.type === "audio" ? (
          <AudioVisual content={space.content as any} c={c} f={f} isPlaying={space.state.is_playing} />
        ) : (
          <IdleHero c={c} f={f} onAdd={() => setAddContent(true)} />
        )}
      </View>

      {/* Presence overlay */}
      <View pointerEvents="none" style={styles.presenceOverlay}>
        {presence.map((p) => (
          <PresenceToast key={p.id} text={p.text} c={c} f={f} />
        ))}
      </View>

      {/* Floating reactions */}
      <View pointerEvents="none" style={styles.reactionLayer}>
        {floatReactions.map((r) => (
          <FloatingReaction key={r.id} emoji={r.emoji} />
        ))}
      </View>

      {/* Bottom controls */}
      <View style={styles.controls}>
        <Pressable
          onPress={() => setAddContent(true)}
          style={styles.controlBtn}
          testID="space-add-content"
        >
          <Ionicons name="add" size={22} color={c.text} />
        </Pressable>
        <Pressable
          onPress={togglePlay}
          disabled={!space.content || !isHost}
          style={[
            styles.playBtn,
            (!space.content || !isHost) && { opacity: 0.4 },
          ]}
          testID="space-play-toggle"
        >
          <Ionicons
            name={space.state.is_playing ? "pause" : "play"}
            size={26}
            color={c.textInverse}
          />
        </Pressable>
        <Pressable onPress={() => setReactionsBar((v) => !v)} style={styles.controlBtn} testID="space-reactions-btn">
          <Ionicons name="heart-outline" size={22} color={c.text} />
        </Pressable>
        <Pressable onPress={() => setChatVisible(true)} style={styles.controlBtn} testID="space-chat-btn">
          <Ionicons name="chatbubble-outline" size={20} color={c.text} />
        </Pressable>
        <Pressable onPress={leaveAndExit} style={[styles.controlBtn, styles.leaveBtn]} testID="space-leave">
          <Ionicons name="exit-outline" size={20} color={c.error} />
        </Pressable>
      </View>

      {/* Reactions strip */}
      {reactionsBar ? (
        <View style={styles.reactionsBar}>
          {REACTIONS.map((e) => (
            <Pressable
              key={e}
              onPress={() => react(e)}
              style={({ pressed }) => [
                styles.reactionItem,
                pressed && { transform: [{ scale: 0.9 }] },
              ]}
              testID={`reaction-${e}`}
            >
              <Text style={{ fontSize: 26 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Chat overlay */}
      <ChatOverlay
        visible={chatVisible}
        onClose={() => setChatVisible(false)}
        spaceId={id!}
        messages={messages}
        currentUserId={user?.id || ""}
        c={c}
        f={f}
      />

      {/* Add content modal */}
      <AddContentModal
        visible={addContent}
        onClose={() => setAddContent(false)}
        onYoutube={setYoutube}
        onAudio={setAudio}
        onUploadedAudio={setUploadedAudio}
        c={c}
        f={f}
      />
    </SafeAreaView>
  );
}

function youtubeHtml(videoId: string) {
  return `
<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}#p{width:100%;height:100%}</style>
</head>
<body>
<div id="p"></div>
<script>
  var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';document.head.appendChild(tag);
  function onYouTubeIframeAPIReady(){
    window.YTPlayer=new YT.Player('p',{
      videoId:'${videoId}',
      playerVars:{autoplay:1,controls:0,rel:0,modestbranding:1,playsinline:1},
      events:{onReady:function(){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));}catch(e){}}}
    });
  }
</script>
</body></html>`;
}

function IdleHero({ c, f, onAdd }: { c: Palette; f: any; onAdd: () => void }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: spacing.xl }}>
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: c.primaryBgSubtle,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: spacing.lg,
        }}
      >
        <Ionicons name="planet-outline" size={36} color={c.primaryDark} />
      </View>
      <Text
        style={{
          fontFamily: f.heading,
          fontSize: 24,
          color: c.text,
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        The room is open.
      </Text>
      <Text
        style={{
          fontFamily: f.body,
          fontSize: 14,
          color: c.textSecondary,
          textAlign: "center",
          marginBottom: spacing.lg,
          lineHeight: 20,
        }}
      >
        Add a video or a song and you&apos;ll be watching together in seconds.
      </Text>
      <Pressable
        onPress={onAdd}
        style={({ pressed }) => [
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: c.primary,
            paddingHorizontal: 18,
            paddingVertical: 12,
            borderRadius: radius.lg,
          },
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
        testID="idle-add-content"
      >
        <Ionicons name="add" size={18} color={c.textInverse} />
        <Text style={{ color: c.textInverse, fontFamily: f.bodyBold, fontSize: 15 }}>
          Add content
        </Text>
      </Pressable>
    </View>
  );
}

function AudioVisual({
  content,
  c,
  f,
  isPlaying,
}: {
  content: any;
  c: Palette;
  f: any;
  isPlaying: boolean;
}) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isPlaying) {
      pulse.value = withTiming(1.06, { duration: 1200, easing: Easing.inOut(Easing.ease) });
      const i = setInterval(() => {
        pulse.value = withTiming(pulse.value > 1 ? 1 : 1.06, { duration: 1200 });
      }, 1200);
      return () => clearInterval(i);
    }
    pulse.value = withTiming(1);
  }, [isPlaying, pulse]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <View style={{ alignItems: "center", padding: spacing.xl }}>
      <Animated.View
        style={[
          {
            width: 220,
            height: 220,
            borderRadius: 28,
            backgroundColor: c.surfaceElevated,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: spacing.lg,
            shadowColor: "#000",
            shadowOpacity: 0.08,
            shadowOffset: { width: 0, height: 12 },
            shadowRadius: 28,
            elevation: 6,
          },
          aStyle,
        ]}
      >
        <Text style={{ fontSize: 80 }}>{content.cover_emoji || "🎧"}</Text>
      </Animated.View>
      <Text style={{ fontFamily: f.heading, fontSize: 22, color: c.text }}>{content.title}</Text>
      <Text style={{ fontFamily: f.body, fontSize: 13, color: c.textSecondary, marginTop: 4 }}>
        {content.artist || "Listening together"}
      </Text>
    </View>
  );
}

function PresenceToast({ text, c, f }: { text: string; c: Palette; f: any }) {
  const op = useSharedValue(0);
  const ty = useSharedValue(8);
  useEffect(() => {
    op.value = withTiming(1, { duration: 220 });
    ty.value = withTiming(0, { duration: 220 });
    op.value = withDelay(2400, withTiming(0, { duration: 600 }));
  }, [op, ty]);
  const aStyle = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateY: ty.value }],
  }));
  return (
    <Animated.View style={[presenceStyles(c, f).toast, aStyle]}>
      <Text style={presenceStyles(c, f).toastText}>{text}</Text>
    </Animated.View>
  );
}

const presenceStyles = (c: Palette, f: any) =>
  StyleSheet.create({
    toast: {
      backgroundColor: c.surfaceElevated,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      marginBottom: 6,
      alignSelf: "center",
      borderWidth: 1,
      borderColor: c.border,
    },
    toastText: { fontFamily: f.bodyMedium, fontSize: 12, color: c.textSecondary },
  });

function FloatingReaction({ emoji }: { emoji: string }) {
  const ty = useSharedValue(0);
  const op = useSharedValue(0);
  const tx = useSharedValue(Math.random() * 60 - 30);
  useEffect(() => {
    op.value = withSequence(withTiming(1, { duration: 180 }), withDelay(800, withTiming(0, { duration: 900 })));
    ty.value = withTiming(-220, { duration: 2100, easing: Easing.out(Easing.cubic) });
  }, [op, ty]);
  const aStyle = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateY: ty.value }, { translateX: tx.value }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          bottom: 110,
          left: SCREEN_W / 2 - 18,
        },
        aStyle,
      ]}
    >
      <Text style={{ fontSize: 36 }}>{emoji}</Text>
    </Animated.View>
  );
}

function ChatOverlay({
  visible,
  onClose,
  spaceId,
  messages,
  currentUserId,
  c,
  f,
}: {
  visible: boolean;
  onClose: () => void;
  spaceId: string;
  messages: SpaceMessage[];
  currentUserId: string;
  c: Palette;
  f: any;
}) {
  const [text, setText] = useState("");
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    try {
      await spacesApi.sendMessage(spaceId, t);
    } catch {}
  }

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.chatBackdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.chatSheet}
      >
        <View style={styles.chatHandleWrap}>
          <View style={styles.chatHandle} />
        </View>
        <View style={styles.chatHeader}>
          <Text style={styles.chatTitle}>Side conversation</Text>
          <Pressable onPress={onClose} style={styles.chatClose} testID="space-chat-close">
            <Ionicons name="close" size={18} color={c.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.chatBody}>
          {messages.length === 0 ? (
            <Text style={styles.chatEmpty}>Be the first to say something.</Text>
          ) : (
            messages.map((m) => {
              const mine = m.sender_id === currentUserId;
              return (
                <View
                  key={m.id}
                  style={[
                    styles.chatBubble,
                    mine ? styles.chatBubbleMine : styles.chatBubbleOther,
                  ]}
                >
                  {!mine ? <Text style={styles.chatSender}>{m.sender_name}</Text> : null}
                  <Text style={styles.chatText}>{m.text}</Text>
                </View>
              );
            })
          )}
        </ScrollView>
        <View style={styles.chatComposer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Whisper something…"
            placeholderTextColor={c.textTertiary}
            style={styles.chatInput}
            testID="space-chat-input"
          />
          <Pressable onPress={send} style={styles.chatSend} testID="space-chat-send">
            <Ionicons name="arrow-up" size={18} color={c.textInverse} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SeekBar({
  space,
  isHost,
  onSeek,
  c,
  f,
}: {
  space: Space;
  isHost: boolean;
  onSeek: (positionSec: number) => void;
  c: Palette;
  f: any;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!space.state.is_playing) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [space.state.is_playing]);

  const duration = (space.content as any)?.duration_sec || 0;
  const elapsed = (now - new Date(space.state.updated_at).getTime()) / 1000;
  const current =
    space.state.position_sec + (space.state.is_playing ? Math.max(0, elapsed) : 0);
  const pct = duration > 0 ? Math.min(1, current / duration) : 0;
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <View style={{ paddingHorizontal: spacing.md, paddingTop: 8, paddingBottom: 4 }}>
      <View
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: c.surfaceElevated,
          overflow: "hidden",
        }}
        onStartShouldSetResponder={() => isHost}
        onResponderRelease={(e) => {
          if (!isHost || !duration) return;
          const w = e.nativeEvent.locationX;
          const targetLayout = (e.currentTarget as any)?._nativeTag;
          void targetLayout;
          // Layout width fallback via measure — use screen approximation
          const barWidth = e.currentTarget && (e as any).currentTarget?.offsetWidth
            ? (e as any).currentTarget.offsetWidth
            : e.nativeEvent.pageX
              ? Math.max(1, e.nativeEvent.pageX / (w / Math.max(0.001, e.nativeEvent.locationX)))
              : 300;
          const clampedPct = Math.max(0, Math.min(1, w / barWidth));
          onSeek(clampedPct * duration);
        }}
        testID="video-seek-bar"
      >
        <View style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: c.primary }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
        <Text style={{ fontFamily: f.body, fontSize: 11, color: c.textSecondary }}>
          {fmt(current)}
        </Text>
        <Text style={{ fontFamily: f.body, fontSize: 11, color: c.textSecondary }}>
          {duration ? fmt(duration) : "live"}
        </Text>
      </View>
      {isHost ? (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 12, marginTop: 6 }}>
          <Pressable
            onPress={() => onSeek(Math.max(0, current - 10))}
            style={{ padding: 6 }}
            testID="seek-back-10"
          >
            <Ionicons name="play-back" size={16} color={c.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => onSeek(current + 10)}
            style={{ padding: 6 }}
            testID="seek-fwd-10"
          >
            <Ionicons name="play-forward" size={16} color={c.textSecondary} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function AddContentModal({
  visible,
  onClose,
  onYoutube,
  onAudio,
  onUploadedAudio,
  c,
  f,
}: {
  visible: boolean;
  onClose: () => void;
  onYoutube: (url: string) => void;
  onAudio: (track: AudioTrack) => void;
  onUploadedAudio: (upload: AudioUpload) => void;
  c: Palette;
  f: any;
}) {
  const [tab, setTab] = useState<"video" | "audio">("video");
  const [audioSubtab, setAudioSubtab] = useState<"library" | "yours">("library");
  const [url, setUrl] = useState("");
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [uploads, setUploads] = useState<AudioUpload[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);

  useEffect(() => {
    if (visible && tab === "audio" && audioSubtab === "library" && tracks.length === 0) {
      setLoading(true);
      spacesApi.audioLibrary().then(setTracks).finally(() => setLoading(false));
    }
    if (visible && tab === "audio" && audioSubtab === "yours") {
      setLoading(true);
      spacesApi.audioUploads().then(setUploads).finally(() => setLoading(false));
    }
  }, [visible, tab, audioSubtab, tracks.length]);

  async function pickAndUpload() {
    if (uploading) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "audio/*",
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      // rough size guard on client
      if (a.size && a.size > 10 * 1024 * 1024) {
        alert("Please pick an audio file under 10MB.");
        return;
      }
      setUploading(true);
      // Read as base64
      const resp = await fetch(a.uri);
      const blob = await resp.blob();
      const data_url: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error("read failed"));
        r.onload = () => resolve(r.result as string);
        r.readAsDataURL(blob);
      });
      const title = a.name?.replace(/\.[^.]+$/, "") || "Uploaded audio";
      await spacesApi.uploadAudio(title, data_url);
      // Refresh list
      const fresh = await spacesApi.audioUploads();
      setUploads(fresh);
      setAudioSubtab("yours");
    } catch (e) {
      // best-effort
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.chatBackdrop} onPress={onClose} />
      <View style={styles.addSheet}>
        <View style={styles.chatHandleWrap}>
          <View style={styles.chatHandle} />
        </View>
        <Text style={styles.addTitle}>Add content</Text>

        <View style={styles.segmentRow}>
          <Pressable
            onPress={() => setTab("video")}
            style={[styles.segment, tab === "video" && styles.segmentOn]}
            testID="add-tab-video"
          >
            <Text style={[styles.segmentText, tab === "video" && styles.segmentTextOn]}>
              YouTube
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab("audio")}
            style={[styles.segment, tab === "audio" && styles.segmentOn]}
            testID="add-tab-audio"
          >
            <Text style={[styles.segmentText, tab === "audio" && styles.segmentTextOn]}>
              Audio
            </Text>
          </Pressable>
        </View>

        {tab === "video" ? (
          <View>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="Paste a YouTube link"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              style={styles.input}
              testID="youtube-url-input"
            />
            <Pressable
              onPress={() => {
                onYoutube(url);
                setUrl("");
              }}
              disabled={!url.trim()}
              style={({ pressed }) => [
                styles.cta,
                !url.trim() && { opacity: 0.4 },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
              testID="youtube-submit"
            >
              <Text style={styles.ctaText}>Watch together</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            {/* Library / Yours sub-tabs + Upload */}
            <View style={[styles.segmentRow, { marginBottom: spacing.sm }]}>
              <Pressable
                onPress={() => setAudioSubtab("library")}
                style={[styles.pillSegment, audioSubtab === "library" && styles.pillOn]}
                testID="audio-subtab-library"
              >
                <Text style={[styles.pillText, audioSubtab === "library" && styles.pillTextOn]}>
                  Curated
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAudioSubtab("yours")}
                style={[styles.pillSegment, audioSubtab === "yours" && styles.pillOn]}
                testID="audio-subtab-yours"
              >
                <Text style={[styles.pillText, audioSubtab === "yours" && styles.pillTextOn]}>
                  Your uploads
                </Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={pickAndUpload}
                disabled={uploading}
                style={({ pressed }) => [
                  styles.uploadBtn,
                  uploading && { opacity: 0.6 },
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}
                testID="audio-upload-btn"
              >
                {uploading ? (
                  <ActivityIndicator color={c.textInverse} size="small" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={14} color={c.textInverse} />
                    <Text style={styles.uploadBtnText}>Upload</Text>
                  </>
                )}
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {loading ? (
                <ActivityIndicator color={c.primary} style={{ margin: spacing.lg }} />
              ) : audioSubtab === "library" ? (
                tracks.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => onAudio(t)}
                    style={({ pressed }) => [
                      styles.trackRow,
                      pressed && { backgroundColor: c.primaryBgSubtle },
                    ]}
                    testID={`track-${t.id}`}
                  >
                    <View style={styles.trackCover}>
                      <Text style={{ fontSize: 22 }}>{t.cover_emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.trackTitle}>{t.title}</Text>
                      <Text style={styles.trackArtist}>{t.artist}</Text>
                    </View>
                    <Ionicons name="play" size={18} color={c.primary} />
                  </Pressable>
                ))
              ) : uploads.length === 0 ? (
                <View style={{ padding: spacing.lg, alignItems: "center" }}>
                  <Text style={{ color: c.textSecondary, fontFamily: f.body, textAlign: "center" }}>
                    No uploads yet. Tap Upload to add an audio file.
                  </Text>
                </View>
              ) : (
                uploads.map((u) => (
                  <Pressable
                    key={u.id}
                    onPress={() => onUploadedAudio(u)}
                    style={({ pressed }) => [
                      styles.trackRow,
                      pressed && { backgroundColor: c.primaryBgSubtle },
                    ]}
                    testID={`upload-${u.id}`}
                  >
                    <View style={styles.trackCover}>
                      <Text style={{ fontSize: 22 }}>{u.cover_emoji || "🎙"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.trackTitle}>{u.title}</Text>
                      <Text style={styles.trackArtist}>
                        {u.uploader_name}
                        {u.duration_sec ? ` · ${Math.round(u.duration_sec)}s` : ""}
                      </Text>
                    </View>
                    <Ionicons name="play" size={18} color={c.primary} />
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette, f: any) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    headerBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    headerCenter: { flex: 1 },
    headerTitle: { fontFamily: f.heading, fontSize: 18, color: c.text, letterSpacing: -0.3 },
    headerSub: { fontFamily: f.body, fontSize: 11, color: c.textSecondary, marginTop: 2 },
    avatarStack: { flexDirection: "row", alignItems: "center" },
    stackedAvatar: { borderRadius: 999, borderWidth: 2, borderColor: c.bg },
    content: { flex: 1, alignItems: "stretch", justifyContent: "center" },
    videoWrap: { width: "100%", aspectRatio: 16 / 9, maxHeight: 320, backgroundColor: "#000", alignSelf: "center" },
    video: { flex: 1, backgroundColor: "#000" },
    presenceOverlay: {
      position: "absolute",
      top: 80,
      left: 0,
      right: 0,
      alignItems: "center",
      pointerEvents: "none" as any,
    },
    reactionLayer: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      pointerEvents: "none" as any,
    },
    controls: {
      position: "absolute",
      bottom: 24,
      left: 0,
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    controlBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 6 },
      shadowRadius: 14,
      elevation: 4,
    },
    leaveBtn: { backgroundColor: c.errorBg },
    playBtn: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: c.primaryDark,
      shadowOpacity: 0.3,
      shadowOffset: { width: 0, height: 8 },
      shadowRadius: 16,
      elevation: 6,
    },
    reactionsBar: {
      position: "absolute",
      bottom: 92,
      alignSelf: "center",
      flexDirection: "row",
      gap: 8,
      backgroundColor: c.surfaceElevated,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 999,
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowOffset: { width: 0, height: 8 },
      shadowRadius: 16,
      elevation: 6,
    },
    reactionItem: { padding: 4 },
    chatBackdrop: { flex: 1, backgroundColor: c.overlay },
    chatSheet: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      maxHeight: SCREEN_H * 0.7,
      backgroundColor: c.bg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
    },
    chatHandleWrap: { alignItems: "center", paddingVertical: spacing.sm },
    chatHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border },
    chatHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing.sm,
    },
    chatTitle: { fontFamily: f.heading, fontSize: 18, color: c.text },
    chatClose: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    chatBody: { paddingVertical: spacing.sm, gap: 8 },
    chatEmpty: { color: c.textSecondary, fontFamily: f.body, textAlign: "center", padding: spacing.lg },
    chatBubble: {
      maxWidth: "78%",
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 16,
      marginBottom: 6,
    },
    chatBubbleMine: { backgroundColor: c.surfaceElevated, alignSelf: "flex-end", borderBottomRightRadius: 4 },
    chatBubbleOther: { backgroundColor: c.surface, alignSelf: "flex-start", borderBottomLeftRadius: 4 },
    chatSender: { fontFamily: f.bodyBold, fontSize: 11, color: c.primaryDark, marginBottom: 2 },
    chatText: { fontFamily: f.body, fontSize: 14, color: c.text },
    chatComposer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: c.surface,
      borderRadius: 999,
      paddingLeft: spacing.md,
      paddingRight: 6,
      paddingVertical: 6,
    },
    chatInput: { flex: 1, fontFamily: f.body, fontSize: 14, color: c.text, paddingVertical: 8 },
    chatSend: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    addSheet: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: c.bg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
    },
    addTitle: { fontFamily: f.heading, fontSize: 22, color: c.text, marginBottom: spacing.md },
    segmentRow: { flexDirection: "row", gap: 8, marginBottom: spacing.md },
    segment: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 999,
      backgroundColor: c.surface,
    },
    segmentOn: { backgroundColor: c.primary },
    segmentText: { fontFamily: f.bodyMedium, fontSize: 13, color: c.textSecondary },
    segmentTextOn: { color: c.textInverse },
    pillSegment: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: c.surface,
    },
    pillOn: { backgroundColor: c.primaryBgSubtle },
    pillText: { fontFamily: f.bodyMedium, fontSize: 12, color: c.textSecondary },
    pillTextOn: { color: c.primaryDark },
    uploadBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: c.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
    },
    uploadBtnText: { color: c.textInverse, fontFamily: f.bodyBold, fontSize: 12 },
    input: {
      height: 52,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontFamily: f.body,
      fontSize: 15,
      color: c.text,
      marginBottom: spacing.md,
    },
    cta: {
      height: 52,
      borderRadius: radius.lg,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    ctaText: { color: c.textInverse, fontFamily: f.bodyBold, fontSize: 15 },
    trackRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.sm,
      borderRadius: radius.lg,
      marginBottom: 4,
    },
    trackCover: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: c.primaryBgSubtle,
      alignItems: "center",
      justifyContent: "center",
    },
    trackTitle: { fontFamily: f.bodyBold, fontSize: 15, color: c.text },
    trackArtist: { fontFamily: f.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
  });
