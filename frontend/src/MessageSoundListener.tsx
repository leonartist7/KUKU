import {useEffect} from "react";
import {Platform} from "react-native";
import {useAuth} from "./AuthContext";
import {api, Chat} from "./api";
import {subscribeChatEvents} from "./chatRealtime";
import {armMessageSounds, incomingSoundTracker, playMessageSound, readSound, stopMessageSound} from "./messageSounds";

export default function MessageSoundListener() {
  const {user} = useAuth();
  useEffect(() => {
    if (Platform.OS !== "web" || !user?.email_verified) return;
    const uid = user.id;
    let active = true, busy = false;
    let track = incomingSoundTracker(uid);
    const seen = new Set<string>();
    const unlock = () => armMessageSounds();
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    const audible = () => active && !document.hidden && navigator.onLine !== false;
    async function play() {
      const settings = await readSound(uid);
      if (audible()) await playMessageSound(settings);
    }
    async function legacyRefresh() {
      if (!audible() || busy) return;
      busy = true;
      try {
        const chats = await api.getAs<Chat[]>(uid, "/chats");
        if (!audible()) return;
        const incoming = track(chats.map(chat => chat.last_message).filter((message): message is NonNullable<Chat["last_message"]> => !!message));
        if (incoming && !seen.has(incoming)) { seen.add(incoming); await play(); }
      } catch { /* Sound never prevents reading or sending a message. */ }
      finally { busy = false; }
    }
    const stop = subscribeChatEvents(uid, event => {
      if (event.type === "ready" || event.type === "reset") { track = incomingSoundTracker(uid); return; }
      if (event.type === "refresh") { void legacyRefresh(); return; }
      if (event.type !== "chat_changed" || seen.has(event.message_id)) return;
      seen.add(event.message_id);
      if (seen.size > 2_000) seen.delete(seen.values().next().value!);
      if (event.live && event.sender_id !== uid && audible()) void play().catch(() => {});
    });
    const visibility = () => { track = incomingSoundTracker(uid); if (document.hidden) stopMessageSound(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false; stop(); stopMessageSound();
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [user?.id, user?.email_verified]);
  return null;
}
