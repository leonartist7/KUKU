import {api} from "./api";
let accountEpoch = 0;
export function browserPushAvailable() {
  return typeof window !== "undefined" && window.isSecureContext && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}
export async function pushRegistration() {
  const registration = await navigator.serviceWorker.register("/sw.js", {updateViaCache: "none"});
  const updating = registration.installing || registration.waiting;
  if(updating && updating.state !== "activated") await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {updating.removeEventListener("statechange", changed); reject(new Error("Please reload KUKU and try again."));}, 15000);
    function changed() {
      if(updating?.state === "activated") {clearTimeout(timer); updating.removeEventListener("statechange", changed); resolve();}
      else if(updating?.state === "redundant") {clearTimeout(timer); updating.removeEventListener("statechange", changed); reject(new Error("Please reload KUKU and try again."));}
    }
    updating.addEventListener("statechange", changed); changed();
  });
  await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("Please reload KUKU and try again.")), 15000))]);
  return registration;
}
export async function setBrowserPushAccount(uid: string | null) {
  const epoch = ++accountEpoch;
  if (!browserPushAvailable()) return;
  const registration = await pushRegistration();
  if(epoch !== accountEpoch)return;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {channel.port1.close(); reject(new Error("Please reload KUKU and try again."));}, 10000);
    channel.port1.onmessage = () => {clearTimeout(timer); channel.port1.close(); resolve();};
    registration.active?.postMessage({type: "KUKU_ACCOUNT", userId: uid}, [channel.port2]);
  });
}
export async function enableBrowserPush(uid: string, ask: boolean) {
  if (!browserPushAvailable()) throw new Error("Open KUKU in Chrome on Android to enable notifications.");
  // Ask directly from the tap, before network or storage work.
  const permission = ask && Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") throw new Error("Allow notifications for KUKU in Chrome’s site settings, then try again.");
  const config = await api.get<{available: boolean; public_key: string}>("/notifications/config");
  if (!config.available) throw new Error("Notifications are getting ready. Please try again shortly.");
  const registration = await pushRegistration();
  const padded = config.public_key + "=".repeat((4 - config.public_key.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: bytes});
  await api.postAs(uid, "/web-push/subscriptions", subscription.toJSON());
  await setBrowserPushAccount(uid);
}
export async function disableBrowserPush() {
  await api.delete("/web-push/subscriptions");
  const registration = await navigator.serviceWorker.getRegistration();
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
  await setBrowserPushAccount(null);
}
