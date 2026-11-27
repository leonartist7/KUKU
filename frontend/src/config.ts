import { Platform } from "react-native";
const isDev = typeof __DEV__ !== "undefined" && __DEV__;
const configured = process.env.EXPO_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
if (!isDev && (!configured || !configured.startsWith("https://"))) {
  throw new Error("Configure EXPO_PUBLIC_BACKEND_URL with the deployed HTTPS API origin before building KUKU.");
}
export const API_ORIGIN = configured || (Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://127.0.0.1:8000");
export const CALLS_ENABLED = process.env.EXPO_PUBLIC_ENABLE_CALLS === "true";
