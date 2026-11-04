import React, {createContext, useContext, useEffect, useState} from "react";
import {AppState, Platform} from "react-native";
import {useAuth} from "./AuthContext";
import {createChatConnection, ChatConnectionStatus} from "./chatRealtime";

const ConnectionContext = createContext<ChatConnectionStatus>("idle");
export const useChatConnection = () => useContext(ConnectionContext);
export default function ChatRealtimeProvider({children}: {children: React.ReactNode}) {
  const {user} = useAuth();
  const [status, setStatus] = useState<ChatConnectionStatus>("idle");
  useEffect(() => {
    if (!user?.email_verified) { setStatus("idle"); return; }
    const connection = createChatConnection(user.id, setStatus);
    let appActive = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    const resume = () => {
      const offline = Platform.OS === "web" && typeof navigator !== "undefined" && navigator.onLine === false;
      const visible = Platform.OS !== "web" || typeof document === "undefined" || !document.hidden;
      connection.setActive(appActive && visible && !offline, offline);
    };
    const app = AppState.addEventListener("change", state => { appActive = state === "active"; resume(); });
    if (Platform.OS === "web") {
      document.addEventListener("visibilitychange", resume);
      window.addEventListener("online", resume);
      window.addEventListener("offline", resume);
    }
    resume();
    return () => {
      connection.stop(); app.remove();
      if (Platform.OS === "web") {
        document.removeEventListener("visibilitychange", resume);
        window.removeEventListener("online", resume);
        window.removeEventListener("offline", resume);
      }
    };
  }, [user?.id, user?.email_verified]);
  return <ConnectionContext.Provider value={status}>{children}</ConnectionContext.Provider>;
}

