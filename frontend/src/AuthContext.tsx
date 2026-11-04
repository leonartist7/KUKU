import { clearOutbox } from "./outbox";
import {setBrowserPushAccount} from "./browserPush";
import {Platform} from "react-native";
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, getToken, setToken, acceptSession, ApiError, onSessionExpired, User } from "./api";
type AuthState = {
  user: User | null | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, invite_token?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  updatePhoto: (image_base64: string | null) => Promise<void>;
  updateProfile: (name: string, bio: string) => Promise<void>;
  connectionNotice: string | null;
  finishClosedAccount: (expectedUserId: string) => Promise<void>;
};
const AuthContext = createContext<AuthState>({} as AuthState);
const PROFILE_KEY = "kuku_profile";
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>();
  const [error, setError] = useState<string | null>(null);
  const currentUser = useRef(user);
  const intent = useRef(0);
  const profileWrites = useRef<Promise<unknown>>(Promise.resolve());
  currentUser.current = user;
  const remember = useCallback(async (next: User | null, expectedIntent = intent.current) => {
    if (intent.current !== expectedIntent) return;
    profileWrites.current = profileWrites.current.catch(() => {}).then(async () => {
      if (intent.current !== expectedIntent) return;
      if (next) await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      else await AsyncStorage.removeItem(PROFILE_KEY);
    });
    await profileWrites.current;
    if (intent.current !== expectedIntent) return;
    currentUser.current = next;
    setUser(next);
  }, []);
  const refresh = useCallback(async () => {
    const refreshIntent = ++intent.current;
    setError(null);
    // Remove legacy plaintext access tokens; existing sessions sign in once again.
    await AsyncStorage.removeItem("connect_token");
    if (intent.current !== refreshIntent) return;
    // Fresh web visitors can open sign-in without waking the API first.
    // HttpOnly cookies remain server-validated when restoring a saved account.
    if (Platform.OS === "web" && currentUser.current === undefined && !await AsyncStorage.getItem(PROFILE_KEY)) {
      await remember(null, refreshIntent);
      return;
    }
    try {
      const token = await getToken();
      if (intent.current !== refreshIntent) return;
      if (!token) { await remember(null, refreshIntent); return; }
      const next = await api.get<User>("/auth/me");
      await remember(next, refreshIntent);
    } catch (failure) {
      if (intent.current !== refreshIntent) return;
      if (failure instanceof ApiError && failure.status === 401) {
        await setToken(null); await remember(null, refreshIntent);
      } else {
        const cached = await AsyncStorage.getItem(PROFILE_KEY);
        if (intent.current !== refreshIntent) return;
        if (cached) {
          try {
            const saved = JSON.parse(cached);
            if (typeof saved?.id === "string" && typeof saved?.name === "string") {
              currentUser.current = saved; setUser(saved);
              setError("You're offline. Your session and queued messages have been kept.");
              return;
            }
          } catch { /* invalid local profile */ }
        }
        setError("KUKU couldn't connect. Your session has been kept. Please try again.");
      }
    }
  }, [remember]);
  useEffect(() => {
    void refresh();
    const stop = onSessionExpired(() => { const next = ++intent.current; void remember(null, next); });
    return () => { intent.current++; stop(); };
  }, [refresh, remember]);
  const signIn = useCallback(async (email: string, password: string) => {
    const loginIntent = ++intent.current;
    setError(null);
    const data = await api.post("/auth/login", { email, password });
    if (intent.current !== loginIntent) return;
    await acceptSession(data); await remember(data.user, loginIntent);
  }, [remember]);
  const signUp = useCallback(async (email: string, password: string, name: string, invite_token?: string) => {
    const signupIntent = ++intent.current;
    setError(null);
    const data = await api.post("/auth/register", { email, password, name, invite_token });
    if (intent.current !== signupIntent) return;
    await acceptSession(data); await remember(data.user, signupIntent);
  }, [remember]);
  // Use only after the server has confirmed logout/account closure.
  const clearLocalSession = useCallback(async (expectedUserId: string) => {
    if (currentUser.current?.id !== expectedUserId) throw new Error("Your account changed. Please try again.");
    const clearedIntent = ++intent.current;
    await setToken(null);
    const cleared = remember(null, clearedIntent);
    if (Platform.OS === "web") await setBrowserPushAccount(null).catch(() => {});
    await clearOutbox(expectedUserId);
    await cleared;
  }, [remember]);
  const signOut = useCallback(async () => {
    const logoutIntent = ++intent.current;
    const id = currentUser.current?.id;
    if (!id) return;
    // Do not claim a server logout succeeded while offline.
    await api.postAs(id, "/auth/logout", {});
    if (intent.current !== logoutIntent) return;
    await clearLocalSession(id);
  }, [clearLocalSession]);
  const updateProfile = useCallback(async (name: string, bio: string) => {
    const id = currentUser.current?.id;
    if (!id) throw new Error("Please sign in again.");
    const next = await api.postAs<User>(id, "/auth/profile", {name, bio});
    if (currentUser.current?.id !== id) throw new Error("Your account changed. Please try again.");
    await remember(next);
  }, [remember]);
  const updatePhoto = useCallback(async (image_base64: string | null) => {
    const id = currentUser.current?.id;
    if (!id) throw new Error("Please sign in again.");
    const next = await api.postAs<User>(id, "/auth/photo", {image_base64});
    if (currentUser.current?.id !== id) throw new Error("Your account changed. Please try again.");
    await remember(next);
  }, [remember]);
  if (error && user === undefined) return (
    <View style={{ flex: 1, justifyContent: "center", padding: 32, backgroundColor: "#FBF9F6" }}>
      <Text accessibilityRole="alert">{error}</Text>
      <Pressable accessibilityRole="button" onPress={() => void refresh()} style={{ paddingVertical: 20 }}><Text>Try again</Text></Pressable>
    </View>
  );
  return <AuthContext.Provider value={{ user, signIn, signUp, signOut, refresh, updateProfile, updatePhoto, connectionNotice: error, finishClosedAccount: clearLocalSession }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
