import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CALLS_ENABLED } from "./config";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import {useReducedMotion} from "./useReducedMotion";
import { Palette, spacing } from "./theme";
import { ApiError, User } from "./api";
import { callsApi, openCallSocket, Call, CallSignal } from "./calls";
import { createCallMedia, CallMedia, AudioOutput } from "./callMedia";
import { CallPhase, callEndLabel, callIsTerminal, mediaTimestamp } from "./callState";
import Avatar from "./Avatar";

type IncomingCall = { callId: string; from: Pick<User, "id" | "name"> };
export type CallSession = {
  ownerId: string; callId: string | null; other: User; phase: CallPhase;
  direction: "outgoing" | "incoming"; startedAt: number | null;
  reason: string; muted: boolean; audioBlocked: boolean; poorConnection: boolean;
  controlPending: boolean; controlError: string | null;
  outputs: AudioOutput[]; outputId: string | null;
};
type CallContextState = {
  supported: boolean; incoming: IncomingCall | null; incomingBusy: boolean; incomingError: string | null;
  session: CallSession | null;
  start: (otherId: string) => Promise<void>;
  join: (otherId: string, callId: string) => Promise<void>;
  answer: () => Promise<void>; declineIncoming: () => Promise<void>;
  hangUp: () => Promise<void>; dismiss: () => void;
  toggleMute: () => Promise<void>; resumeAudio: () => Promise<void>;
  loadOutputs: () => Promise<void>; selectOutput: (id: string) => Promise<void>;
  subscribe: (cb: (msg: CallSignal) => void) => () => void;
};
const CallCtx = createContext<CallContextState | null>(null);
export function useCall() {
  const value = useContext(CallCtx);
  if (!value) throw new Error("Calls require CallProvider.");
  return value;
}
const supported = CALLS_ENABLED && Platform.OS === "web";
const failureText = (error: unknown, fallback: string) => {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was blocked. Allow it in your browser settings, then try again.";
  if (name === "NotFoundError") return "No microphone was found. Connect one and try again.";
  if (name === "NotReadableError") return "Your microphone is in use or unavailable. Check other apps and try again.";
  return error instanceof Error ? error.message : fallback;
};
function initialSession(uid: string, other: User, direction: CallSession["direction"]): CallSession {
  return { ownerId: uid, callId: null, other, phase: "preparing", direction, startedAt: null, reason: "",
    muted: false, audioBlocked: false, poorConnection: false, controlPending: false, controlError: null, outputs: [], outputId: null };
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user, restoring } = useAuth();
  const reducedMotion=useReducedMotion();
  const uid = !restoring && user?.email_verified ? user.id : null;
  const uidRef = useRef(uid); uidRef.current = uid;
  const router = useRouter();
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const incomingRef = useRef<IncomingCall | null>(null);
  const [incomingBusy, setIncomingBusy] = useState(false);
  const incomingBusyRef = useRef(false);
  const [incomingError, setIncomingError] = useState<string | null>(null);
  const [session, setSession] = useState<CallSession | null>(null);
  const sessionRef = useRef<CallSession | null>(null);
  const mediaRef = useRef<CallMedia | null>(null);
  const epoch = useRef(0);
  const connectingId = useRef<string | null>(null);
  const mediaReady = useRef(false);
  const listeners = useRef(new Set<(message: CallSignal) => void>());
  const heartbeatRef = useRef<() => Promise<void>>(async () => {});
  const signalRef = useRef<(message: unknown) => void>(() => {});
  const reconcileRef = useRef<() => Promise<void>>(async () => {});
  const heartbeatFlight = useRef(false);
  const heartbeatQueued = useRef(false);

  const replace = useCallback((next: CallSession | null) => { sessionRef.current = next; setSession(next); }, []);
  const patch = useCallback((change: Partial<CallSession>) => {
    const state = sessionRef.current;
    if (state && state.ownerId === uidRef.current) replace({ ...state, ...change });
  }, [replace]);
  const incomingChange = useCallback((next: IncomingCall | null) => {
    incomingRef.current = next; setIncoming(next); setIncomingError(null);
  }, []);
  const disposeMedia = useCallback(() => {
    epoch.current++; connectingId.current = null; mediaReady.current = false;
    const media = mediaRef.current; mediaRef.current = null; media?.dispose();
  }, []);
  const finish = useCallback((reason: string, expectedId?: string) => {
    const state = sessionRef.current;
    if (!state || (expectedId && state.callId !== expectedId)) return;
    disposeMedia();
    if (state.ownerId === uidRef.current) replace({ ...state, phase: "ended", reason, audioBlocked: false, controlPending: false });
  }, [disposeMedia, replace]);
  const endOnServer = useCallback(async (state: CallSession) => {
    if (!state.callId || uidRef.current !== state.ownerId) return;
    if (state.phase === "ringing" || state.phase === "preparing") await callsApi.cancel(state.callId, state.ownerId);
    else await callsApi.end(state.callId, state.ownerId);
  }, []);
  const beginMedia = useCallback(async (call: Call) => {
    const state = sessionRef.current, owner = uidRef.current;
    if (!state || !owner || state.ownerId !== owner || state.callId !== call.id || state.phase === "ended") return;
    if (call.can_join_media === false) { finish("This call is open on another device.", call.id); return; }
    if (connectingId.current === call.id || mediaRef.current) return;
    connectingId.current = call.id;
    patch({ phase: "connecting", reason: "Waiting for both microphones.", controlError: null });
    const attempt = ++epoch.current;
    const current = () => epoch.current === attempt && uidRef.current === owner && sessionRef.current?.callId === call.id && sessionRef.current?.phase !== "ended";
    try {
      const join = await callsApi.token(call.id, owner);
      if (!current()) return;
      const media = await createCallMedia(join, {
        ready: () => {
          if (!current()) return;
          mediaReady.current = true;
          patch({ phase: "connected", reason: "", audioBlocked: false, startedAt: sessionRef.current?.startedAt ?? Date.now() });
          void heartbeatRef.current();
        },
        reconnecting: (message) => { if (current()) { mediaReady.current = false; patch({ phase: "reconnecting", reason: message }); } },
        disconnected: () => {
          if (!current()) return;
          const prior = sessionRef.current;
          finish("The audio connection ended.", call.id);
          if (prior) void endOnServer(prior).catch(() => {});
        },
        playbackBlocked: (blocked) => { if (current()) patch({ audioBlocked: blocked }); },
        muted: (muted) => { if (current()) patch({ muted }); },
        quality: (poorConnection) => { if (current()) patch({ poorConnection }); },
      }, { expectedParticipant: state.other.id, isCurrent: current });
      if (!current()) { media.dispose(); return; }
      mediaRef.current = media;
      await media.connect();
    } catch (error) {
      if (!current()) return;
      const prior = sessionRef.current;
      finish(failureText(error, "Audio could not connect. Please try another call."), call.id);
      if (prior) void endOnServer(prior).catch(() => {});
    } finally { if (connectingId.current === call.id) connectingId.current = null; }
  }, [endOnServer, finish, patch]);

  const applySnapshot = useCallback(async (call: Call) => {
    const state = sessionRef.current;
    if (!state || state.callId !== call.id || state.ownerId !== uidRef.current || state.phase === "ended") return;
    if (callIsTerminal(call)) { finish(callEndLabel(call.end_reason), call.id); return; }
    if (call.other) patch({ other: call.other });
    if (call.status === "active") {
      const stamp = mediaTimestamp(call);
      if (stamp !== null && mediaReady.current) patch({ startedAt: stamp });
      await beginMedia(call);
    }
  }, [beginMedia, finish, patch]);

  const heartbeat = useCallback(async () => {
    const state = sessionRef.current;
    if (!state?.callId || state.ownerId !== uidRef.current || !["connecting", "connected", "reconnecting"].includes(state.phase)) return;
    if (heartbeatFlight.current) { heartbeatQueued.current = true; return; }
    heartbeatFlight.current = true;
    try {
      const call = await callsApi.heartbeat(state.callId, state.ownerId, mediaReady.current);
      if (uidRef.current === state.ownerId) await applySnapshot(call);
    } catch (error) {
      if (sessionRef.current?.callId !== state.callId || uidRef.current !== state.ownerId) return;
      if (error instanceof ApiError && [401, 403, 404, 409].includes(error.status)) finish("This call is no longer available to this session.", state.callId);
      else patch({ controlError: "Call status could not refresh. Reconnecting…" });
    } finally {
      heartbeatFlight.current = false;
      if (heartbeatQueued.current) { heartbeatQueued.current = false; void heartbeatRef.current(); }
    }
  }, [applySnapshot, finish, patch]);
  heartbeatRef.current = heartbeat;

  const reconcile = useCallback(async () => {
    const owner = uidRef.current;
    if (!owner || !supported) return;
    const state = sessionRef.current;
    if (state?.callId && state.phase !== "ended") {
      try {
        const call = await callsApi.get(state.callId, owner);
        if (uidRef.current === owner) await applySnapshot(call);
      } catch (error) {
        if (uidRef.current === owner && error instanceof ApiError && [401, 403, 404].includes(error.status)) finish("This call is no longer available.", state.callId);
      }
      return;
    }
    try {
      const list = await callsApi.list(owner);
      if (uidRef.current !== owner || (sessionRef.current && sessionRef.current.phase !== "ended")) return;
      const ringing = list.find((call) => call.status === "ringing" && call.initiator_id !== owner && call.other);
      if (ringing?.other) incomingChange({ callId: ringing.id, from: ringing.other });
      else if (!incomingBusyRef.current) incomingChange(null);
    } catch { /* The reconnect loop retries; no call is fabricated. */ }
  }, [applySnapshot, finish, incomingChange]);
  reconcileRef.current = reconcile;

  signalRef.current = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const msg = raw as CallSignal;
    const callId = msg.call_id || msg.call?.id;
    if (typeof callId !== "string" || !callId || !uidRef.current) return;
    if (msg.type === "incoming_call" && msg.from && typeof msg.from.id === "string" && typeof msg.from.name === "string" && msg.from.id !== uidRef.current) {
      const active = sessionRef.current;
      if (!active || active.phase === "ended") {
        incomingChange({ callId, from: msg.from });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
    } else if (msg.type === "call_accepted") {
      if (incomingRef.current?.callId === callId && !incomingBusyRef.current) incomingChange(null);
      if (sessionRef.current?.callId === callId) void reconcileRef.current();
    } else if (["call_declined", "call_missed", "call_ended"].includes(msg.type)) {
      if (incomingRef.current?.callId === callId) incomingChange(null);
      finish(msg.type === "call_declined" ? "The call was declined." : msg.type === "call_missed" ? "No answer this time." : "Call ended.", callId);
    }
    listeners.current.forEach((listener) => { try { listener(msg); } catch { /* Independent subscribers. */ } });
  };

  // Reset ownership before route effects can start work for the new account.
  useLayoutEffect(() => {
    disposeMedia(); incomingChange(null); replace(null);
    incomingBusyRef.current = false; setIncomingBusy(false);
    return () => {
      disposeMedia(); incomingRef.current = null; sessionRef.current = null;
    };
  }, [uid, disposeMedia, incomingChange, replace]);

  useEffect(() => {
    let cancelled = false, attempt = 0;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let openingTimer: ReturnType<typeof setTimeout> | null = null;
    let socketHeartbeat: ReturnType<typeof setInterval> | null = null;
    const retry = () => {
      if (cancelled || !uid || uidRef.current !== uid || timer) return;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) * (0.8 + Math.random() * 0.4);
      timer = setTimeout(() => { timer = null; void connect(); }, delay);
    };
    async function connect() {
      if (!uid || !supported || cancelled || uidRef.current !== uid) return;
      try {
        let lastInbound = Date.now();
        const next = await openCallSocket(uid, (message) => {
          lastInbound = Date.now();
          if (!cancelled && uidRef.current === uid) signalRef.current(message);
        });
        if (cancelled || uidRef.current !== uid) { next.close(); return; }
        socket = next;
        openingTimer = setTimeout(() => { if (next.readyState !== WebSocket.OPEN) next.close(); }, 20000);
        next.onopen = () => {
          if (openingTimer) { clearTimeout(openingTimer); openingTimer = null; }
          attempt = 0; void reconcileRef.current();
          if (socketHeartbeat) clearInterval(socketHeartbeat);
          socketHeartbeat = setInterval(() => {
            if (Date.now() - lastInbound > 60000) { next.close(); return; }
            if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ type: "ping" }));
          }, 20000);
        };
        next.onerror = () => { try { next.close(); } catch { retry(); } };
        next.onclose = () => {
          if (openingTimer) { clearTimeout(openingTimer); openingTimer = null; }
          if (socketHeartbeat) clearInterval(socketHeartbeat);
          if (socket === next) { socket = null; retry(); }
        };
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) return;
        retry();
      }
    }
    void connect();
    const resume = () => { if (typeof document === "undefined" || document.visibilityState === "visible") void reconcileRef.current(); };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("online", resume); document.addEventListener("visibilitychange", resume);
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (openingTimer) clearTimeout(openingTimer);
      if (socketHeartbeat) clearInterval(socketHeartbeat);
      socket?.close();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume);
      }
    };
  }, [uid, disposeMedia, incomingChange, replace]);

  useEffect(() => {
    if (!session?.callId || !["connecting", "connected", "reconnecting"].includes(session.phase)) return;
    void heartbeatRef.current();
    const timer = setInterval(() => { void heartbeatRef.current(); }, 25000);
    return () => clearInterval(timer);
  }, [session?.callId, session?.phase]);

  useEffect(() => {
    if (!incoming) return;
    const id = incoming.callId, owner = uidRef.current;
    // Recover a missed terminal signal without polling when no call is ringing.
    const timer = setTimeout(() => {
      if (!owner || uidRef.current !== owner || incomingRef.current?.callId !== id) return;
      void callsApi.get(id, owner).then((call) => {
        if (uidRef.current === owner && incomingRef.current?.callId === id && call.status !== "ringing") incomingChange(null);
      }).catch((error) => {
        if (uidRef.current === owner && incomingRef.current?.callId === id && error instanceof ApiError && [401, 403, 404].includes(error.status)) incomingChange(null);
      });
    }, 48000);
    return () => clearTimeout(timer);
  }, [incoming?.callId, incomingChange]);

  useEffect(() => {
    if (!session || !["ringing", "connecting", "reconnecting"].includes(session.phase)) return;
    const state = session;
    const timeout = state.phase === "ringing" ? 50000 : state.phase === "connecting" ? 45000 : 30000;
    const timer = setTimeout(() => {
      if (sessionRef.current?.callId !== state.callId || sessionRef.current?.phase !== state.phase) return;
      finish(state.phase === "ringing" ? "No answer this time." : "Audio could not reconnect. Please try another call.", state.callId || undefined);
      void endOnServer(state).catch(() => {});
    }, timeout);
    return () => clearTimeout(timer);
  }, [session?.callId, session?.phase, endOnServer, finish]);

  const checkMicrophone = useCallback(async () => {
    if (!supported) throw new Error(CALLS_ENABLED ? "Calls need the supported browser version. Native calling is being prepared." : "Calls are not available in this beta yet.");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access needs a supported browser and a secure connection.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((track) => track.stop());
  }, []);

  const start = useCallback(async (otherId: string) => {
    const owner = uidRef.current;
    if (!owner) return;
    const old = sessionRef.current;
    if (old && old.phase !== "ended") return;
    disposeMedia();
    const attempt = epoch.current;
    replace(initialSession(owner, { id: otherId, name: "Your contact" }, "outgoing"));
    const current = () => uidRef.current === owner && epoch.current === attempt;
    try {
      await checkMicrophone();
      if (!current()) return;
      const call = await callsApi.start(otherId, owner);
      if (!current()) { if (uidRef.current === owner) void callsApi.cancel(call.id, owner).catch(() => {}); return; }
      patch({ callId: call.id, other: call.other || sessionRef.current!.other, phase: "ringing" });
      await applySnapshot(call);
      void reconcileRef.current();
    } catch (error) { if (current()) finish(failureText(error, "The call could not start.")); }
  }, [applySnapshot, checkMicrophone, disposeMedia, finish, patch, replace]);

  const join = useCallback(async (otherId: string, id: string) => {
    const owner = uidRef.current;
    if (!owner) return;
    const old = sessionRef.current;
    if (old?.callId === id) return;
    if (old && old.phase !== "ended") return;
    disposeMedia();
    const attempt = epoch.current;
    replace({ ...initialSession(owner, { id: otherId, name: "Your contact" }, "incoming"), callId: id });
    try {
      const call = await callsApi.get(id, owner);
      if (uidRef.current !== owner || epoch.current !== attempt) return;
      if (callIsTerminal(call)) { finish(callEndLabel(call.end_reason), id); return; }
      patch({ other: call.other || sessionRef.current!.other, direction: call.initiator_id === owner ? "outgoing" : "incoming" });
      if (call.status === "ringing") {
        if (call.initiator_id === owner) patch({ phase: "ringing" });
        else { replace(null); if (call.other) incomingChange({ callId: id, from: call.other }); }
        return;
      }
      await checkMicrophone();
      if (uidRef.current === owner && epoch.current === attempt) await applySnapshot(call);
    } catch (error) {
      if (uidRef.current === owner && epoch.current === attempt) finish(failureText(error, "This call could not be opened."), id);
    }
  }, [applySnapshot, checkMicrophone, disposeMedia, finish, incomingChange, patch, replace]);

  const answer = useCallback(async () => {
    const inc = incomingRef.current, owner = uidRef.current;
    if (!inc || !owner || incomingBusyRef.current) return;
    incomingBusyRef.current = true; setIncomingBusy(true); setIncomingError(null);
    const attempt = epoch.current;
    try {
      await checkMicrophone();
      if (uidRef.current !== owner || incomingRef.current?.callId !== inc.callId || epoch.current !== attempt) return;
      const call = await callsApi.accept(inc.callId, owner);
      if (uidRef.current !== owner || incomingRef.current?.callId !== inc.callId || epoch.current !== attempt) return;
      incomingChange(null); disposeMedia();
      replace({ ...initialSession(owner, call.other || inc.from, "incoming"), callId: call.id, phase: "connecting" });
      router.push({ pathname: "/call/[id]", params: { id: inc.from.id, callId: call.id } });
      await applySnapshot(call);
    } catch (error) {
      if (uidRef.current === owner && incomingRef.current?.callId === inc.callId) setIncomingError(failureText(error, "This call could not be answered. Please try again."));
    } finally { if (uidRef.current === owner) { incomingBusyRef.current = false; setIncomingBusy(false); } }
  }, [applySnapshot, checkMicrophone, disposeMedia, incomingChange, replace, router]);

  const declineIncoming = useCallback(async () => {
    const inc = incomingRef.current, owner = uidRef.current;
    if (!inc || !owner || incomingBusyRef.current) return;
    incomingBusyRef.current = true; setIncomingBusy(true); setIncomingError(null);
    try {
      await callsApi.decline(inc.callId, owner);
      if (uidRef.current === owner && incomingRef.current?.callId === inc.callId) incomingChange(null);
    } catch (error) {
      if (uidRef.current === owner) setIncomingError(failureText(error, "The decline could not reach KUKU. Please try again."));
    } finally { if (uidRef.current === owner) { incomingBusyRef.current = false; setIncomingBusy(false); } }
  }, [incomingChange]);

  const hangUp = useCallback(async () => {
    const state = sessionRef.current;
    if (!state || state.phase === "ended") return;
    finish("Call ended.", state.callId || undefined);
    try { await endOnServer(state); }
    catch {
      if (uidRef.current === state.ownerId && sessionRef.current?.callId === state.callId) patch({ reason: "Your microphone is off. The end signal could not reach KUKU; the call will expire automatically." });
    }
  }, [endOnServer, finish, patch]);
  const dismiss = useCallback(() => {
    if (sessionRef.current?.phase === "ended") { disposeMedia(); replace(null); }
  }, [disposeMedia, replace]);
  const toggleMute = useCallback(async () => {
    const state = sessionRef.current, media = mediaRef.current;
    if (!state || !media || state.controlPending || state.phase === "ended") return;
    patch({ controlPending: true, controlError: null });
    try { await media.mute(!state.muted); void Haptics.selectionAsync().catch(() => {}); }
    catch (error) { if (mediaRef.current === media) patch({ controlError: failureText(error, "The microphone could not change.") }); }
    finally { if (mediaRef.current === media) patch({ controlPending: false }); }
  }, [patch]);
  const resumeAudio = useCallback(async () => {
    const media = mediaRef.current;
    if (!media) return;
    patch({ controlError: null });
    try { await media.resumeAudio(); }
    catch (error) { if (mediaRef.current === media) patch({ controlError: failureText(error, "Audio is still blocked. Check this site's audio permission.") }); }
  }, [patch]);
  const loadOutputs = useCallback(async () => {
    const media = mediaRef.current;
    if (!media) return;
    patch({ controlError: null });
    try {
      const outputs = await media.outputs();
      if (mediaRef.current === media) patch({ outputs, controlError: outputs.length ? null : "Your browser manages audio output. Use your phone or computer's audio controls." });
    } catch (error) { if (mediaRef.current === media) patch({ controlError: failureText(error, "Audio outputs could not be listed.") }); }
  }, [patch]);
  const selectOutput = useCallback(async (id: string) => {
    const media = mediaRef.current;
    if (!media || sessionRef.current?.controlPending) return;
    patch({ controlPending: true, controlError: null });
    try { await media.output(id); if (mediaRef.current === media) patch({ outputId: id }); }
    catch (error) { if (mediaRef.current === media) patch({ controlError: failureText(error, "The audio output could not change.") }); }
    finally { if (mediaRef.current === media) patch({ controlPending: false }); }
  }, [patch]);
  const subscribe = useCallback((listener: (message: CallSignal) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);

  return <CallCtx.Provider value={{ supported, incoming, incomingBusy, incomingError, session, start, join, answer, declineIncoming, hangUp, dismiss, toggleMute, resumeAudio, loadOutputs, selectOutput, subscribe }}>
    {children}
    <Modal visible={!!incoming} transparent animationType={reducedMotion?"none":"fade"} onRequestClose={() => { if (!incomingBusy) void declineIncoming(); }}>
      {incoming ? <IncomingCallView incoming={incoming} busy={incomingBusy} error={incomingError} onAnswer={() => { void answer(); }} onDecline={() => { void declineIncoming(); }} /> : null}
    </Modal>
  </CallCtx.Provider>;
}

function IncomingCallView({ incoming, busy, error, onAnswer, onDecline }: {
  incoming: IncomingCall; busy: boolean; error: string | null; onAnswer: () => void; onDecline: () => void;
}) {
  const { c, f } = useTheme();
  const styles = makeStyles(c, f);
  return <View style={styles.overlay} testID="incoming-call" accessibilityViewIsModal>
    <View style={styles.card}>
      <Text style={styles.kicker}>A little closer</Text>
      <Avatar name={incoming.from.name} seed={incoming.from.id} size={112} />
      <Text style={styles.name}>{incoming.from.name}</Text>
      <Text style={styles.sub}>Incoming audio call</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {busy ? <ActivityIndicator color={c.primary} style={{ marginTop: 16 }} /> : null}
      <View style={styles.actions}>
        <View style={styles.action}>
          <Pressable accessibilityRole="button" accessibilityLabel="Decline call" disabled={busy} accessibilityState={{ disabled: busy }} onPress={onDecline} style={[styles.round, { backgroundColor: c.error, opacity: busy ? 0.5 : 1 }]} testID="call-decline">
            <Ionicons name="call" size={28} color={c.textInverse} style={{ transform: [{ rotate: "135deg" }] }} />
          </Pressable><Text style={styles.label}>Decline</Text>
        </View>
        <View style={styles.action}>
          <Pressable accessibilityRole="button" accessibilityLabel="Answer call" disabled={busy} accessibilityState={{ disabled: busy }} onPress={onAnswer} style={[styles.round, { backgroundColor: c.success, opacity: busy ? 0.5 : 1 }]} testID="call-answer">
            <Ionicons name="call" size={28} color={c.textInverse} />
          </Pressable><Text style={styles.label}>Answer</Text>
        </View>
      </View>
      <Text style={styles.note}>KUKU will ask to use your microphone.</Text>
    </View>
  </View>;
}
const makeStyles = (c: Palette, f: any) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: c.overlay, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { width: "100%", maxWidth: 420, padding: spacing.xl, borderRadius: 28, backgroundColor: c.bg, alignItems: "center" },
  kicker: { fontFamily: f.bodyMedium, fontSize: 14, color: c.textSecondary, marginBottom: spacing.xl },
  name: { fontFamily: f.heading, fontSize: 30, color: c.text, textAlign: "center", marginTop: spacing.lg },
  sub: { fontFamily: f.body, fontSize: 16, color: c.textSecondary, marginTop: 8 },
  actions: { flexDirection: "row", justifyContent: "space-around", gap: 48, marginVertical: spacing.xl },
  action: { alignItems: "center", gap: 10 },
  round: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: f.bodyMedium, fontSize: 14, color: c.text },
  error: { fontFamily: f.body, fontSize: 14, lineHeight: 22, color: c.error, textAlign: "center", marginTop: 16 },
  note: { fontFamily: f.body, fontSize: 13, lineHeight: 20, color: c.textSecondary, textAlign: "center" },
});
