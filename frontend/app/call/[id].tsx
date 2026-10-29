import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  withRepeat,
  withTiming,
  useAnimatedStyle,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Room } from "livekit-client";
import { api, User } from "../../src/api";
import { callsApi } from "../../src/calls";
import { useCall } from "../../src/CallContext";
import Avatar from "../../src/Avatar";
import { useTheme } from "../../src/ThemeContext";
import { Palette, spacing } from "../../src/theme";

type Phase = "setup" | "ringing" | "connected" | "ended";

export default function CallScreen() {
  const { id, callId } = useLocalSearchParams<{ id: string; callId?: string }>();
  const router = useRouter();
  const { c, f } = useTheme();
  const { subscribe } = useCall();
  const styles = makeStyles(c, f);
  const [other, setOther] = useState<User | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [reason, setReason] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [audioState, setAudioState] = useState<"off" | "connecting" | "live" | "error">("off");
  const callIdRef = useRef<string | null>(callId ?? null);
  const roomRef = useRef<Room | null>(null);
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function disconnectRoom() {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        room.disconnect();
      } catch {}
    }
  }

  async function connectLiveKit() {
    const callId = callIdRef.current;
    if (!callId) return;
    setAudioState("connecting");
    try {
      const join = await callsApi.token(callId);
      const room = new Room();
      roomRef.current = room;
      await room.connect(join.url, join.token, { autoSubscribe: true });
      if (roomRef.current !== room) {
        try {
          room.disconnect();
        } catch {}
        return;
      }
      await room.localParticipant.setMicrophoneEnabled(true);
      try {
        room.startAudio();
      } catch {}
      if (roomRef.current !== room) {
        try {
          room.disconnect();
        } catch {}
        return;
      }
      setAudioState("live");
    } catch {
      disconnectRoom();
      setAudioState("error");
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    Haptics.selectionAsync().catch(() => {});
    if (roomRef.current) {
      roomRef.current.localParticipant.setMicrophoneEnabled(!next).catch(() => {});
    }
  }

  function finish(msg: string) {
    setPhase("ended");
    setReason(msg);
    backTimer.current = setTimeout(() => router.back(), 1300);
  }

  // Load the other user's info
  useEffect(() => {
    api
      .get<User[]>("/users")
      .then((list) => setOther(list.find((x) => x.id === id) || null))
      .catch(() => {});
  }, [id]);

  // Start or join the call
  useEffect(() => {
    if (callId) {
      setPhase("connected");
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const call = await callsApi.start(id);
        if (!mounted) return;
        callIdRef.current = call.id;
        setPhase("ringing");
      } catch (e: any) {
        if (!mounted) return;
        setPhase("ended");
        setReason(e?.message === "User is busy" ? "Busy" : e?.message || "Call failed");
        backTimer.current = setTimeout(() => router.back(), 1300);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id, callId, router]);

  // Connect LiveKit media once the call is active
  useEffect(() => {
    if (phase !== "connected") return;
    connectLiveKit();
    return () => disconnectRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Listen for signaling events for this call
  useEffect(() => {
    return subscribe((msg: any) => {
      if (!msg?.call_id || msg.call_id !== callIdRef.current) return;
      if (msg.type === "call_accepted") {
        setPhase("connected");
      } else if (msg.type === "call_declined") {
        disconnectRoom();
        finish("Declined");
      } else if (msg.type === "call_missed") {
        disconnectRoom();
        finish("No answer");
      } else if (msg.type === "call_ended") {
        disconnectRoom();
        finish("Call ended");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  // Ringing timeout → cancel after 45s
  useEffect(() => {
    if (phase !== "ringing") return;
    const t = setTimeout(() => {
      if (callIdRef.current) callsApi.cancel(callIdRef.current).catch(() => {});
      finish("No answer");
    }, 45000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Call timer
  useEffect(() => {
    if (phase !== "connected") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => {
    if (backTimer.current) clearTimeout(backTimer.current);
  }, []);

  async function endCall() {
    disconnectRoom();
    if (callIdRef.current) {
      try {
        await callsApi.end(callIdRef.current);
      } catch {}
    }
    finish("Call ended");
  }

  async function cancelCall() {
    disconnectRoom();
    if (callIdRef.current) {
      try {
        await callsApi.cancel(callIdRef.current);
      } catch {}
    }
    finish("");
  }

  const ringScale1 = useSharedValue(1);
  const ringScale2 = useSharedValue(1);
  useEffect(() => {
    ringScale1.value = withRepeat(
      withTiming(1.4, { duration: 1800, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    ringScale2.value = withRepeat(
      withTiming(1.7, { duration: 2400, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, [ringScale1, ringScale2]);

  const ring1Style = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale1.value }],
    opacity: 1 - (ringScale1.value - 1) / 0.4,
  }));
  const ring2Style = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale2.value }],
    opacity: 1 - (ringScale2.value - 1) / 0.7,
  }));

  const timerLabel = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
  const kicker =
    phase === "setup"
      ? "Connecting…"
      : phase === "ringing"
        ? "Calling…"
        : phase === "connected"
          ? "On call"
          : "Call ended";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.top}>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.name}>{other?.name || "…"}</Text>
        <Text style={styles.timer}>
          {phase === "connected"
            ? timerLabel
            : phase === "ringing"
              ? "ringing softly"
              : phase === "setup"
                ? ""
                : reason || "goodbye"}
        </Text>
        {phase === "connected" && audioState === "connecting" ? (
          <Text style={styles.audioStatus}>connecting audio…</Text>
        ) : null}
        {phase === "connected" && audioState === "live" ? (
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text style={styles.audioStatus}>audio live</Text>
          </View>
        ) : null}
        {phase === "connected" && audioState === "error" ? (
          <Text style={styles.audioErr}>audio unavailable</Text>
        ) : null}
      </View>

      <View style={styles.center}>
        {phase === "setup" ? (
          <ActivityIndicator color={c.primary} />
        ) : (
          <View style={styles.avatarWrap}>
            {(phase === "ringing" || phase === "connected") && (
              <>
                <Animated.View style={[styles.ring, ring2Style]} />
                <Animated.View style={[styles.ring, ring1Style]} />
              </>
            )}
            <Avatar name={other?.name} seed={other?.id} photo={other?.avatar} size={140} />
          </View>
        )}
        {other?.bio && phase !== "ended" ? <Text style={styles.bio}>{other.bio}</Text> : null}
      </View>

      {phase === "ringing" ? (
        <View style={styles.controls}>
          <View style={{ width: 56 }} />
          <Pressable onPress={cancelCall} style={[styles.btn, styles.endBtn]} testID="cancel-call">
            <Ionicons name="call" size={26} color={c.textInverse} style={{ transform: [{ rotate: "135deg" }] }} />
          </Pressable>
          <View style={{ width: 56 }} />
        </View>
      ) : phase === "connected" ? (
        <View style={styles.controls}>
          <RoundBtn
            icon={muted ? "mic-off-outline" : "mic-outline"}
            label="Mute"
            active={muted}
            onPress={toggleMute}
          />
          <RoundBtn
            icon={speaker ? "volume-high" : "volume-high-outline"}
            label="Speaker"
            active={speaker}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setSpeaker((s) => !s);
            }}
          />
          <Pressable onPress={endCall} style={[styles.btn, styles.endBtn]} testID="end-call">
            <Ionicons name="call" size={26} color={c.textInverse} style={{ transform: [{ rotate: "135deg" }] }} />
          </Pressable>
          <RoundBtn icon="videocam-outline" label="Video" />
          <RoundBtn icon="ellipsis-horizontal" label="More" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function RoundBtn({
  icon,
  label,
  active = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const { c, f } = useTheme();
  const styles = makeStyles(c, f);
  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.btn,
          active && { backgroundColor: c.primaryBgSubtle, borderWidth: 1.5, borderColor: c.primary },
          pressed && { transform: [{ scale: 0.94 }] },
        ]}
      >
        <Ionicons name={icon} size={22} color={active ? c.primary : c.text} />
      </Pressable>
      <Text style={styles.btnLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Palette, f: any) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.surface },
    top: {
      paddingTop: spacing.lg,
      alignItems: "center",
    },
    kicker: {
      fontFamily: f.bodyMedium,
      fontSize: 12,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      color: c.textTertiary,
      marginBottom: 6,
    },
    name: { fontFamily: f.heading, fontSize: 32, color: c.text, letterSpacing: -0.5 },
    timer: { fontFamily: f.body, fontSize: 14, color: c.textSecondary, marginTop: 4 },
    liveRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.success },
    audioStatus: {
      fontFamily: f.bodyMedium,
      fontSize: 12,
      color: c.success,
      marginTop: 6,
      textTransform: "lowercase",
    },
    audioErr: {
      fontFamily: f.bodyMedium,
      fontSize: 12,
      color: c.error,
      marginTop: 6,
    },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    avatarWrap: { width: 220, height: 220, alignItems: "center", justifyContent: "center" },
    ring: {
      position: "absolute",
      width: 140,
      height: 140,
      borderRadius: 70,
      borderWidth: 1.5,
      borderColor: c.primaryLight,
    },
    bio: {
      marginTop: spacing.lg,
      fontFamily: f.body,
      color: c.textSecondary,
      fontSize: 14,
      paddingHorizontal: spacing.xl,
      textAlign: "center",
    },
    controls: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
    },
    btn: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.bg,
      alignItems: "center",
      justifyContent: "center",
    },
    endBtn: { backgroundColor: c.error, width: 64, height: 64, borderRadius: 32 },
    btnLabel: { fontFamily: f.body, fontSize: 11, color: c.textSecondary },
  });
