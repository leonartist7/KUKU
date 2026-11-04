import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useTheme } from "./ThemeContext";
import { privateAudioUrl, spacesApi, type SpaceContent, type SpaceState } from "./spaces";
import { playbackCorrection, playbackPosition, timelineNow } from "./spacePlayback";

type AudioContent = Extract<SpaceContent, { type: "audio" }>;
type Status = "loading" | "ready" | "playing" | "blocked" | "buffering" | "ended" | "error";
type Player = HTMLAudioElement | AudioPlayer;
export default function SpaceAudio({ content, state, offsetMs, uid, onDuration }: { content: AudioContent; state: SpaceState; offsetMs: number; uid: string; onDuration?: (seconds: number) => void }) {
  const { c, f } = useTheme();
  const player = useRef<Player | null>(null), latest = useRef({ state, offsetMs, onDuration });
  latest.current = { state, offsetMs, onDuration };
  const [status, setStatus] = useState<Status>("loading"), [error, setError] = useState(""), [muted, setMuted] = useState(false), [revision, setRevision] = useState(0);
  const gestureRequired = useRef(false), busy = useRef(false), live = useRef(false);
  const mutedRef = useRef(muted); mutedRef.current = muted;
  const key = content.source === "upload" || content.upload_id ? "upload:" + content.upload_id : content.audio_id + ":" + content.url;

  useEffect(() => {
    let active = true, nativeListener: { remove: () => void } | undefined;
    let interval: ReturnType<typeof setInterval> | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
    live.current = true; gestureRequired.current = false; busy.current = false;
    setStatus("loading"); setError("");
    const alive = () => active;
    const ready = () => {
      if (!alive()) return;
      if (timeout) clearTimeout(timeout);
      const duration = player.current?.duration;
      if (duration && Number.isFinite(duration)) latest.current.onDuration?.(duration);
      setStatus("ready"); void synchronize(true);
    };
    async function synchronize(force = false) {
      const current = player.current;
      if (!alive() || !current || busy.current) return;
      const loaded = Platform.OS === "web" ? (current as HTMLAudioElement).readyState >= 1 : (current as AudioPlayer).isLoaded;
      if (!loaded) return;
      if (Number.isFinite(current.duration) && current.duration > 0) latest.current.onDuration?.(current.duration);
      const target = playbackPosition(latest.current.state, timelineNow(), latest.current.offsetMs, current.duration);
      if (current.duration > 0 && target >= current.duration - 0.05) { current.pause(); setStatus("ended"); return; }
      busy.current = true;
      try {
        if (playbackCorrection(current.currentTime, target, force) === "seek") {
          if (Platform.OS === "web") current.currentTime = target;
          else await (current as AudioPlayer).seekTo(target);
        }
        if (!alive()) return;
        if (!latest.current.state.is_playing) { current.pause(); setStatus("ready"); }
        else if (!gestureRequired.current) {
          if (Platform.OS === "web") {
            const media = current as HTMLAudioElement;
            if (media.paused && !media.ended) await media.play();
            if (alive()) setStatus(media.paused ? "ready" : "playing");
          } else {
            const media = current as AudioPlayer;
            if (!media.playing) media.play();
            if (alive()) setStatus(media.isBuffering ? "buffering" : "playing");
          }
        }
      } catch (cause) {
        if (!alive()) return;
        if (cause instanceof Error && cause.name === "NotAllowedError") { gestureRequired.current = true; setStatus("blocked"); }
        else { gestureRequired.current = true; setError("Playback paused. Reopen this audio to try again."); setStatus("error"); }
      } finally { busy.current = false; }
    }
    void (async () => {
      try {
        let uri = content.url;
        if (content.upload_id) uri = privateAudioUrl((await spacesApi.audioDownload(content.upload_id, uid)).url);
        if (!uri || !/^https?:\/\//.test(uri)) throw new Error("This audio is unavailable.");
        if (!alive()) return;
        if (Platform.OS === "web") {
          const media = new Audio(uri);
          media.muted = mutedRef.current;
          media.preload = "metadata"; player.current = media;
          media.onloadedmetadata = ready;
          media.oncanplay = () => { if (alive()) { setStatus(gestureRequired.current ? "blocked" : "ready"); void synchronize(); } };
          media.onwaiting = () => { if (alive()) setStatus("buffering"); };
          media.onplaying = () => { if (alive()) setStatus("playing"); };
          media.onerror = () => { if (alive()) { setError("This audio could not be opened. Try reopening it."); setStatus("error"); } };
          media.onended = () => { if (alive()) setStatus("ended"); };
        } else {
          await setAudioModeAsync({ playsInSilentMode: true });
          if (!alive()) return;
          const media = createAudioPlayer({ uri }); player.current = media;
          media.muted = mutedRef.current;
          nativeListener = media.addListener("playbackStatusUpdate", status => {
            if (!alive()) return;
            if (status.isLoaded) {
              if (timeout) clearTimeout(timeout);
              setStatus(status.isBuffering ? "buffering" : status.playing ? "playing" : "ready");
              void synchronize();
            }
          });
          if (media.isLoaded) ready();
        }
        timeout = setTimeout(() => { const media = player.current; const loaded = media && (Platform.OS === "web" ? (media as HTMLAudioElement).readyState >= 1 : (media as AudioPlayer).isLoaded); if (alive() && !loaded) { setStatus("error"); setError("Audio is taking too long to load. Try reopening it."); } }, 15000);
        interval = setInterval(() => void synchronize(), 1000);
      } catch (cause) {
        if (alive()) { setError(cause instanceof Error ? cause.message : "This audio could not be opened."); setStatus("error"); }
      }
    })();
    return () => {
      active = false; live.current = false;
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      nativeListener?.remove();
      const media = player.current; player.current = null;
      if (!media) return;
      media.pause();
      if (Platform.OS === "web") {
        const element = media as HTMLAudioElement;
        element.onloadedmetadata = element.oncanplay = element.onwaiting = element.onplaying = element.onerror = element.onended = null;
        element.removeAttribute("src"); element.load();
      } else (media as AudioPlayer).remove();
    };
  }, [key, uid, revision]);

  useEffect(() => { if (player.current) player.current.muted = muted; }, [muted, revision]);

  async function joinPlayback() {
    const media = player.current;
    if (!media) return;
    // Call play before awaiting anything so browser gesture ownership is retained.
    try {
      const started = media.play(); gestureRequired.current = false;
      await started;
      if (live.current) setStatus("playing");
    } catch (cause) {
      if (live.current) { gestureRequired.current = true; setStatus("blocked"); }
    }
  }
  const label = status === "loading" ? "Opening audio…" : status === "blocked" ? "Tap to join playback" : status === "buffering" ? "Buffering…" : status === "ended" ? "Track finished" : state.is_playing && status === "playing" ? "Listening together" : state.is_playing ? "Ready to listen" : "Playback paused";
  return <View style={{ alignItems: "center", paddingVertical: 24, gap: 12 }}>
    <View style={{ width: 148, height: 148, borderRadius: 36, backgroundColor: c.surfaceElevated, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="musical-notes-outline" size={60} color={c.primaryDark} />
    </View>
    <Text style={{ color: c.text, fontFamily: f.heading, fontSize: 26, textAlign: "center" }}>{content.title}</Text>
    <Text style={{ color: c.textSecondary, fontFamily: f.body, fontSize: 15, textAlign: "center" }}>{content.artist || "A little music, together."}</Text>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {status === "loading" || status === "buffering" ? <ActivityIndicator size="small" color={c.primaryDark} /> : null}
      <Text accessibilityLiveRegion="polite" style={{ color: c.textSecondary, fontFamily: f.body, fontSize: 14 }}>{label}</Text>
    </View>
    {status === "blocked" && state.is_playing ? <Pressable accessibilityRole="button" accessibilityLabel="Join audio playback" onPress={() => void joinPlayback()} testID="space-resume-audio" style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 24, borderRadius: 24, backgroundColor: c.primary }}>
      <Text style={{ color: c.textInverse, fontFamily: f.bodyBold }}>Join playback</Text>
    </Pressable> : null}
    {status === "error" ? <View style={{ gap: 8, alignItems: "center" }}>
      <Text accessibilityRole="alert" style={{ color: c.error, fontFamily: f.body, textAlign: "center" }}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={() => setRevision(value => value + 1)} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 20 }}><Text style={{ color: c.primaryDark, fontFamily: f.bodyBold }}>Reopen audio</Text></Pressable>
    </View> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={muted ? "Unmute playback on this device" : "Mute playback on this device"} onPress={() => setMuted(value => !value)} style={{ minHeight: 48, flexDirection: "row", gap: 8, alignItems: "center", paddingHorizontal: 16 }}>
      <Ionicons name={muted ? "volume-mute-outline" : "volume-medium-outline"} size={20} color={c.textSecondary} /><Text style={{ color: c.textSecondary, fontFamily: f.body }}>{muted ? "Muted on your device" : "Sound on your device"}</Text>
    </Pressable>
  </View>;
}
