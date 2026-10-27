import { CALLS_ENABLED } from "./config";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import { Palette, radius, spacing } from "./theme";
import { callsApi, openCallSocket } from "./calls";
import Avatar from "./Avatar";

type IncomingCall = {
  callId: string;
  from: { id: string; name: string };
};

type CallContextState = {
  incoming: IncomingCall | null;
  answer: () => void;
  declineIncoming: () => void;
  subscribe: (cb: (msg: any) => void) => () => void;
};

const CallCtx = createContext<CallContextState>({
  incoming: null,
  answer: () => {},
  declineIncoming: () => {},
  subscribe: () => () => {},
});

export function useCall() {
  return useContext(CallCtx);
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const listeners = useRef<Set<(msg: any) => void>>(new Set());

  const dispatch = useCallback((msg: any) => {
    listeners.current.forEach((l) => {
      try {
        l(msg);
      } catch {}
    });
  }, []);

  const handle = useCallback(
    (msg: any) => {
      if (msg?.type === "incoming_call") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        setIncoming({ callId: msg.call?.id, from: msg.from });
      }
      dispatch(msg);
    },
    [dispatch],
  );

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (!user || !CALLS_ENABLED) return;
      const sock = await openCallSocket((m) => handle(m));
      if (cancelled) {
        sock?.close();
        return;
      }
      ws = sock;
      if (!sock) return;
      sock.onclose = () => {
        if (cancelled || ws !== sock) return;
        ws = null;
        retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [user, handle]);

  const subscribe = useCallback((cb: (msg: any) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  const answer = useCallback(async () => {
    const inc = incoming;
    if (!inc) return;
    setIncoming(null);
    try {
      await callsApi.accept(inc.callId);
    } catch {}
    router.push(`/call/${inc.from.id}?callId=${inc.callId}`);
  }, [incoming, router]);

  const declineIncoming = useCallback(async () => {
    const inc = incoming;
    if (!inc) return;
    setIncoming(null);
    try {
      await callsApi.decline(inc.callId);
    } catch {}
  }, [incoming]);

  return (
    <CallCtx.Provider value={{ incoming, answer, declineIncoming, subscribe }}>
      {children}
      {incoming ? (
        <IncomingCallView
          incoming={incoming}
          onAnswer={answer}
          onDecline={declineIncoming}
        />
      ) : null}
    </CallCtx.Provider>
  );
}

function IncomingCallView({
  incoming,
  onAnswer,
  onDecline,
}: {
  incoming: IncomingCall;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  const { c, f } = useTheme();
  const styles = makeStyles(c, f);
  const [bounce, setBounce] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setBounce((b) => !b), 1400);
    return () => clearTimeout(t);
  }, [bounce]);

  return (
    <View style={styles.overlay} testID="incoming-call">
      <View style={[styles.pulse, bounce && styles.pulseOn]} />
      <Avatar name={incoming.from.name} seed={incoming.from.id} size={120} />
      <Text style={styles.name}>{incoming.from.name}</Text>
      <Text style={styles.sub}>is calling…</Text>
      <View style={styles.actions}>
        <Pressable onPress={onDecline} style={styles.decline} testID="call-decline">
          <Ionicons name="call" size={28} color="#FDF8F6" style={{ transform: [{ rotate: "135deg" }] }} />
        </Pressable>
        <Pressable onPress={onAnswer} style={styles.answer} testID="call-answer">
          <Ionicons name="call" size={28} color="#FDF8F6" />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette, f: any) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.bg,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 999,
      elevation: 999,
    },
    pulse: {
      position: "absolute",
      width: 180,
      height: 180,
      borderRadius: 90,
      borderWidth: 1,
      borderColor: c.primaryLight,
      opacity: 0.4,
      transform: [{ scale: 1 }],
    },
    pulseOn: {
      transform: [{ scale: 1.25 }],
      opacity: 0,
    },
    name: {
      fontFamily: f.heading,
      fontSize: 30,
      color: c.text,
      letterSpacing: -0.5,
      marginTop: spacing.lg,
    },
    sub: {
      fontFamily: f.bodyMedium,
      fontSize: 16,
      color: c.textSecondary,
      marginTop: 4,
      letterSpacing: 1.2,
      textTransform: "uppercase",
    },
    actions: {
      position: "absolute",
      bottom: 120,
      flexDirection: "row",
      gap: 64,
    },
    decline: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.error,
      alignItems: "center",
      justifyContent: "center",
    },
    answer: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.success,
      alignItems: "center",
      justifyContent: "center",
    },
  });
