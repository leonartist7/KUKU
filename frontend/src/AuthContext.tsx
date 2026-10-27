import { clearOutbox } from "./outbox";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, getToken, setToken, acceptSession, ApiError, onSessionExpired, User } from "./api";
type AuthState = {
  user: User | null | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, invite_token?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};
const AuthContext = createContext<AuthState>({} as AuthState);
const PROFILE_KEY = "kuku_profile";
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>();
  const [error, setError] = useState<string | null>(null);
  const remember = useCallback(async (next: User | null) => {
    if (next) await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    else await AsyncStorage.removeItem(PROFILE_KEY);
    setUser(next);
  }, []);
  const refresh = useCallback(async () => {
    setError(null);
    // Remove legacy plaintext access tokens; existing sessions sign in once again.
    await AsyncStorage.removeItem("connect_token");
    try {
      const token = await getToken();
      if (!token) { await remember(null); return; }
      await remember(await api.get<User>("/auth/me"));
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        await setToken(null); await remember(null);
      } else {
        const cached = await AsyncStorage.getItem(PROFILE_KEY);
        if (cached) {
          try { setUser(JSON.parse(cached)); return; } catch { /* invalid local profile */ }
        }
        setError("KUKU couldn't connect. Your session has been kept. Please try again.");
      }
    }
  }, [remember]);
  useEffect(() => { void refresh(); return onSessionExpired(() => { void remember(null); }); }, [refresh, remember]);
  const signIn = useCallback(async (email: string, password: string) => {
    const data = await api.post("/auth/login", { email, password });
    await acceptSession(data); await remember(data.user);
  }, [remember]);
  const signUp = useCallback(async (email: string, password: string, name: string, invite_token?: string) => {
    const data = await api.post("/auth/register", { email, password, name, invite_token });
    await acceptSession(data); await remember(data.user);
  }, [remember]);
  const signOut = useCallback(async () => {
    // Do not claim a server logout succeeded while offline.
    await api.post("/auth/logout");
    if (user) await clearOutbox(user.id);
    await setToken(null); await remember(null);
  }, [remember, user]);
  if (error && user === undefined) return (
    <View style={{ flex: 1, justifyContent: "center", padding: 32, backgroundColor: "#FBF9F6" }}>
      <Text accessibilityRole="alert">{error}</Text>
      <Pressable accessibilityRole="button" onPress={() => void refresh()} style={{ paddingVertical: 20 }}><Text>Try again</Text></Pressable>
    </View>
  );
  return <AuthContext.Provider value={{ user, signIn, signUp, signOut, refresh }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
