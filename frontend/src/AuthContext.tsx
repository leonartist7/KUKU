import {clearOutbox} from "./outbox";
import {setBrowserPushAccount} from "./browserPush";
import React, {createContext, useContext, useEffect, useState, useCallback, useRef} from "react";
import {Platform, View, Text, Pressable, ActivityIndicator} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {api, getToken, setToken, acceptSession, ApiError, onSessionExpired, User, getSessionEpoch, setExpectedRestoredUser} from "./api";
import {readCachedProfile, canShowCachedShell} from "./cachedProfile";
import {useTheme} from "./ThemeContext";

type AuthState = {
  user: User | null | undefined;
  // True while a cached identity still awaits server proof, including offline
  // retries. Cached profile flags never authorize background operations.
  restoring: boolean;
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
const RESTORE_NOTICE = "Reconnecting securely. Your saved profile is shown while we check your account.";

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [user, setUser] = useState<User | null | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [checking, setChecking] = useState(false);
  const currentUser = useRef(user); currentUser.current = user;
  const validatedUser = useRef<string | null>(null);
  const restoringRef = useRef(true);
  const intent = useRef(0);
  const profileWrites = useRef<Promise<unknown>>(Promise.resolve());

  const markRestoring = useCallback((value: boolean, expectedIntent: number) => {
    if (intent.current !== expectedIntent) return;
    restoringRef.current = value; setRestoring(value);
  }, []);
  const remember = useCallback(async (next: User | null, expectedIntent = intent.current) => {
    if (intent.current !== expectedIntent) return;
    profileWrites.current = profileWrites.current.catch(() => {}).then(async () => {
      if (intent.current !== expectedIntent) return;
      if (next) await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      else await AsyncStorage.removeItem(PROFILE_KEY);
    });
    await profileWrites.current;
    if (intent.current !== expectedIntent) return;
    currentUser.current = next; setUser(next);
  }, []);
  const forget = useCallback(async (expectedIntent: number) => {
    if (intent.current !== expectedIntent) return;
    validatedUser.current = null;
    currentUser.current = null; setUser(null);
    markRestoring(false, expectedIntent); setChecking(false); setError(null);
    await remember(null, expectedIntent);
  }, [markRestoring, remember]);

  const refresh = useCallback(async () => {
    const refreshIntent = ++intent.current;
    const sessionEpoch = getSessionEpoch();
    const wasValidated = !!validatedUser.current && currentUser.current?.id === validatedUser.current;
    if (!wasValidated) markRestoring(true, refreshIntent);
    setChecking(true); setError(null);
    try {
      const existing = currentUser.current;
      const raw = existing ? null : await AsyncStorage.getItem(PROFILE_KEY);
      if (intent.current !== refreshIntent) return;
      const saved = existing || readCachedProfile(raw);
      const expectedUser = saved?.id;
      if (!wasValidated && expectedUser) {
        // Bind identity before painting children that may make private requests.
        // The API still has no authenticated user until server validation.
        if (!setExpectedRestoredUser(expectedUser, sessionEpoch)) return;
        if (canShowCachedShell(saved)) {
          currentUser.current = saved; setUser(saved); setError(RESTORE_NOTICE);
        }
      }
      await AsyncStorage.removeItem("connect_token");
      if (intent.current !== refreshIntent) return;
      // A fresh web visit does not need to wake the API. Invalid cache shape is
      // treated as no saved profile; cookie-only restore requires explicit login.
      if (Platform.OS === "web" && !existing && !saved) {
        await forget(refreshIntent); return;
      }
      const token = await getToken();
      if (intent.current !== refreshIntent) return;
      if (!token) {await forget(refreshIntent); return;}
      const next = expectedUser ? await api.getAs<User>(expectedUser, "/auth/me") : await api.get<User>("/auth/me");
      if (intent.current !== refreshIntent) return;
      if (!next || typeof next.id !== "string" || typeof next.name !== "string" ||
          (expectedUser && next.id !== expectedUser)) throw new ApiError("Your account changed. Please sign in again.", 401);
      await remember(next, refreshIntent);
      if (intent.current !== refreshIntent) return;
      validatedUser.current = next.id;
      setExpectedRestoredUser(null, sessionEpoch);
      markRestoring(false, refreshIntent); setError(null);
    } catch (failure) {
      if (intent.current !== refreshIntent) return;
      if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
        await setToken(null);
        if (intent.current === refreshIntent) await forget(refreshIntent);
      } else if (wasValidated) {
        // A background profile refresh failure cannot revoke earlier server
        // proof or tear down an active call, outbox runner or realtime channel.
        setError("KUKU couldn't refresh your account. Your current session has been kept.");
      } else {
        markRestoring(true, refreshIntent);
        setError(currentUser.current ? "Your saved profile is here. Reconnect to verify your account and load new messages." :
          "KUKU couldn't connect. Your saved session has been kept. Please try again.");
      }
    } finally {
      if (intent.current === refreshIntent) setChecking(false);
    }
  }, [forget, markRestoring, remember]);

  useEffect(() => {
    const stop = onSessionExpired(() => {
      const expiredIntent = ++intent.current;
      validatedUser.current = null; setChecking(false);
      void forget(expiredIntent).catch(() => {});
    });
    void refresh();
    return () => {intent.current++; stop();};
  }, [forget, refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const loginIntent = ++intent.current; setError(null);
    try {
      const data = await api.post("/auth/login", {email, password});
      if (intent.current !== loginIntent) return;
      markRestoring(true, loginIntent);
      await acceptSession(data);
      if (intent.current !== loginIntent) return;
      await remember(data.user, loginIntent);
      if (intent.current !== loginIntent) return;
      validatedUser.current = data.user.id; markRestoring(false, loginIntent); setChecking(false);
    } catch (failure) {
      if (intent.current === loginIntent) setChecking(false);
      throw failure;
    }
  }, [markRestoring, remember]);
  const signUp = useCallback(async (email: string, password: string, name: string, invite_token?: string) => {
    const signupIntent = ++intent.current; setError(null);
    try {
      const data = await api.post("/auth/register", {email, password, name, invite_token});
      if (intent.current !== signupIntent) return;
      markRestoring(true, signupIntent);
      await acceptSession(data);
      if (intent.current !== signupIntent) return;
      await remember(data.user, signupIntent);
      if (intent.current !== signupIntent) return;
      validatedUser.current = data.user.id; markRestoring(false, signupIntent); setChecking(false);
    } catch (failure) {
      if (intent.current === signupIntent) setChecking(false);
      throw failure;
    }
  }, [markRestoring, remember]);

  // Use only after the server has confirmed logout/account closure.
  const clearLocalSession = useCallback(async (expectedUserId: string) => {
    if (currentUser.current?.id !== expectedUserId) throw new Error("Your account changed. Please try again.");
    const clearedIntent = ++intent.current;
    validatedUser.current = null;
    await setToken(null);
    if (intent.current !== clearedIntent) return;
    const cleared = forget(clearedIntent);
    if (Platform.OS === "web") await setBrowserPushAccount(null).catch(() => {});
    await clearOutbox(expectedUserId); await cleared;
  }, [forget]);
  const signOut = useCallback(async () => {
    const logoutIntent = ++intent.current;
    const id = currentUser.current?.id;
    if (!id) return;
    // Do not claim a server logout succeeded while offline.
    try {
      await api.postAs(id, "/auth/logout", {});
      if (intent.current !== logoutIntent) return;
      await clearLocalSession(id);
    } catch (failure) {
      if (intent.current === logoutIntent) setChecking(false);
      throw failure;
    }
  }, [clearLocalSession]);
  const updateProfile = useCallback(async (name: string, bio: string) => {
    const id = currentUser.current?.id;
    if (!id) throw new Error("Please sign in again.");
    if (restoringRef.current || validatedUser.current !== id) throw new Error("We're reconnecting. Please wait for your account to be verified.");
    const next = await api.postAs<User>(id, "/auth/profile", {name, bio});
    if (currentUser.current?.id !== id) throw new Error("Your account changed. Please try again.");
    await remember(next);
  }, [remember]);
  const updatePhoto = useCallback(async (image_base64: string | null) => {
    const id = currentUser.current?.id;
    if (!id) throw new Error("Please sign in again.");
    if (restoringRef.current || validatedUser.current !== id) throw new Error("We're reconnecting. Please wait for your account to be verified.");
    const next = await api.postAs<User>(id, "/auth/photo", {image_base64});
    if (currentUser.current?.id !== id) throw new Error("Your account changed. Please try again.");
    await remember(next);
  }, [remember]);

  if (error && user === undefined) return <View style={{flex: 1, justifyContent: "center", padding: 32, backgroundColor: "#FBF9F6"}}>
    <Text accessibilityRole="alert">{error}</Text>
    <Pressable accessibilityRole="button" onPress={() => {void refresh();}} style={{paddingVertical: 20}}><Text>Try again</Text></Pressable>
  </View>;
  const connectionNotice = error || (restoring && user ? RESTORE_NOTICE : null);
  return <AuthContext.Provider value={{user, restoring, signIn, signUp, signOut, refresh, updateProfile, updatePhoto,
    connectionNotice, finishClosedAccount: clearLocalSession}}>
    <View style={{flex: 1}}>
      {restoring && user ? <RestoreNotice message={connectionNotice || RESTORE_NOTICE} busy={checking} onRetry={() => {void refresh();}}/> : null}
      <View style={{flex: 1}}>{children}</View>
    </View>
  </AuthContext.Provider>;
}
function RestoreNotice({message, busy, onRetry}: {message: string; busy: boolean; onRetry: () => void}) {
  const {c, f} = useTheme();
  return <SafeAreaView edges={["top"]} style={{backgroundColor: c.surface}} testID="session-restore-notice">
    <View style={{paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12}}>
      {busy ? <ActivityIndicator size="small" color={c.primaryDark}/> : null}
      <Text accessibilityLiveRegion="polite" style={{flex: 1, minWidth: 0, fontFamily: f.body, fontSize: 14, lineHeight: 20, color: c.text}}>{message}</Text>
      {!busy ? <Pressable accessibilityRole="button" accessibilityLabel="Retry account connection" testID="session-restore-retry" onPress={onRetry}
        style={{minHeight: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center"}}>
        <Text style={{fontFamily: f.bodyMedium, fontSize: 14, color: c.primaryDark}}>Retry</Text>
      </Pressable> : null}
    </View>
  </SafeAreaView>;
}
export const useAuth = () => useContext(AuthContext);
