import {Platform} from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {api, getSessionEpoch, getSessionUserId} from "./api";
import {browserPushAvailable, browserPushStatus, BrowserPushStatus, enableBrowserPush, disableBrowserPush} from "./browserPush";
export {testBrowserNotification as testDeviceNotification} from "./browserPush";

export const PUSH_AVAILABLE = Platform.OS === "web" ? browserPushAvailable() : process.env.EXPO_PUBLIC_ENABLE_PUSH === "true";
const pref = (uid: string) => "kuku_push_opt_in_" + uid;
const projectId = () => Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
function scoped(uid: string) {
  const epoch = getSessionEpoch();
  return () => {if (getSessionUserId() !== uid || getSessionEpoch() !== epoch) throw new Error("Your account changed. Please try again.");};
}
export async function enableNotifications(uid: string, ask = true) {
  const assertCurrent = scoped(uid); assertCurrent();
  if (!PUSH_AVAILABLE) throw new Error("Notifications are not available in this build.");
  if (!ask) {const optedIn = await AsyncStorage.getItem(pref(uid)); assertCurrent(); if (optedIn !== "true") return;}
  if (Platform.OS === "web") {
    await enableBrowserPush(uid, ask); assertCurrent();
    await AsyncStorage.setItem(pref(uid), "true"); return;
  }
  const notifications = await import("expo-notifications"); assertCurrent();
  if (Platform.OS === "android") await notifications.setNotificationChannelAsync("messages", {name: "Messages", importance: notifications.AndroidImportance.DEFAULT});
  assertCurrent();
  let permissions = await notifications.getPermissionsAsync(); assertCurrent();
  if (!permissions.granted && ask) {permissions = await notifications.requestPermissionsAsync(); assertCurrent();}
  if (!permissions.granted) {if (ask) throw new Error("Allow notifications in your phone settings to receive message alerts."); return;}
  const project = projectId();
  if (!project) throw new Error("Notifications are not available in this build.");
  const token = (await notifications.getExpoPushTokenAsync({projectId: project})).data; assertCurrent();
  await api.postAs(uid, "/devices", {token}); assertCurrent();
  await AsyncStorage.setItem(pref(uid), "true");
}
export async function disableNotifications(uid: string) {
  const assertCurrent = scoped(uid); assertCurrent();
  if (Platform.OS === "web") await disableBrowserPush(uid);
  else await api.deleteAs(uid, "/devices");
  assertCurrent();
  await AsyncStorage.setItem(pref(uid), "false");
}
export type NotificationStatus = BrowserPushStatus & {optedIn: boolean; buildConfigured: boolean};
export async function readNotificationStatus(uid: string): Promise<NotificationStatus> {
  const assertCurrent = scoped(uid); assertCurrent();
  const saved = await AsyncStorage.getItem(pref(uid)); assertCurrent();
  if (Platform.OS === "web") {
    const status = await browserPushStatus(uid); assertCurrent();
    return {...status, optedIn: saved === "true", buildConfigured: status.supported};
  }
  const configured = PUSH_AVAILABLE && !!projectId();
  if (!configured) return {supported: false, permission: "unavailable", subscribed: false, serverAvailable: null, optedIn: saved === "true", buildConfigured: false};
  const notifications = await import("expo-notifications");
  const permissions = await notifications.getPermissionsAsync(); assertCurrent();
  return {supported: true, permission: permissions.granted ? "granted" : permissions.canAskAgain ? "default" : "denied",
    subscribed: saved === "true", serverAvailable: null, optedIn: saved === "true", buildConfigured: true,
    note: "Device setup is saved locally. Background delivery still needs a real-phone check."};
}
