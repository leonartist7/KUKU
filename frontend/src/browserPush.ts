import {api, getSessionEpoch, getSessionUserId} from "./api";

let accountEpoch = 0;
let pushWork: Promise<unknown> = Promise.resolve();
function scoped(uid: string) {
  const epoch = getSessionEpoch();
  return () => {if (getSessionUserId() !== uid || getSessionEpoch() !== epoch) throw new Error("Your account changed. Please try again.");};
}
function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = pushWork.catch(() => {}).then(run); pushWork = result.catch(() => {}); return result;
}
async function bounded<T>(promise: Promise<T>, milliseconds = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error("Please reload KUKU and try again.")), milliseconds);})]);}
  finally {if (timer !== undefined) clearTimeout(timer);}
}
export function browserPushAvailable() {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && window.isSecureContext &&
    "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}
export async function pushRegistration() {
  const registration = await navigator.serviceWorker.register("/sw.js", {updateViaCache: "none"});
  const updating = registration.installing || registration.waiting;
  if (updating && updating.state !== "activated") await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {clearTimeout(timer); updating.removeEventListener("statechange", changed); error ? reject(error) : resolve();};
    function changed() {
      if (updating?.state === "activated") finish();
      else if (updating?.state === "redundant") finish(new Error("Please reload KUKU and try again."));
    }
    const timer = setTimeout(() => finish(new Error("Please reload KUKU and try again.")), 15000);
    updating.addEventListener("statechange", changed); changed();
  });
  await bounded(navigator.serviceWorker.ready);
  if (!registration.active) throw new Error("Please reload KUKU and try again.");
  return registration;
}
export async function setBrowserPushAccount(uid: string | null) {
  const expectedUser = getSessionUserId(), expectedSession = getSessionEpoch();
  if (uid !== null && uid !== expectedUser) return;
  const epoch = ++accountEpoch;
  if (!browserPushAvailable()) return;
  const registration = await pushRegistration();
  if (epoch !== accountEpoch || getSessionUserId() !== expectedUser || getSessionEpoch() !== expectedSession) return;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {channel.port1.close(); reject(new Error("Please reload KUKU and try again."));}, 10000);
    channel.port1.onmessage = () => {clearTimeout(timer); channel.port1.close(); resolve();};
    registration.active?.postMessage({type: "KUKU_ACCOUNT", userId: uid}, [channel.port2]);
  });
}
export async function enableBrowserPush(uid: string, ask: boolean) {
  if (!browserPushAvailable()) throw new Error("Open KUKU in Chrome on Android to enable notifications.");
  const assertCurrent = scoped(uid); assertCurrent();
  // Preserve the direct user gesture: permission is requested before storage,
  // network work or the serialization queue.
  const permission = ask && Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  assertCurrent();
  if (permission !== "granted") throw new Error("Allow notifications for KUKU in your browser's site settings, then try again.");
  return enqueue(async () => {
    assertCurrent();
    const config = await api.getAs<{available: boolean; public_key: string | null}>(uid, "/notifications/config");
    if (!config.available || !config.public_key) throw new Error("Notifications are getting ready. Please try again shortly.");
    const registration = await pushRegistration(); assertCurrent();
    const padded = config.public_key + "=".repeat((4 - config.public_key.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
    let subscription = await registration.pushManager.getSubscription(); assertCurrent();
    if (!subscription) subscription = await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: bytes});
    assertCurrent();
    await api.postAs(uid, "/web-push/subscriptions", subscription.toJSON()); assertCurrent();
    await setBrowserPushAccount(uid); assertCurrent();
  });
}
export async function disableBrowserPush(uid: string) {
  const assertCurrent = scoped(uid); assertCurrent();
  return enqueue(async () => {
    assertCurrent(); await api.deleteAs(uid, "/web-push/subscriptions"); assertCurrent();
    const registration = await navigator.serviceWorker.getRegistration(); assertCurrent();
    const subscription = await registration?.pushManager.getSubscription(); assertCurrent();
    if (subscription) await subscription.unsubscribe(); assertCurrent();
    await setBrowserPushAccount(null); assertCurrent();
  });
}
export type BrowserPushStatus = {
  supported: boolean; permission: NotificationPermission | "unavailable";
  subscribed: boolean; serverAvailable: boolean | null; note?: string;
};
export async function browserPushStatus(uid: string): Promise<BrowserPushStatus> {
  const assertCurrent = scoped(uid); assertCurrent();
  if (!browserPushAvailable()) return {supported: false, permission: "unavailable", subscribed: false, serverAvailable: null};
  const [device, server] = await Promise.allSettled([
    navigator.serviceWorker.getRegistration().then(async registration => !!await registration?.pushManager.getSubscription()),
    api.getAs<{available: boolean; public_key: string | null}>(uid, "/notifications/config"),
  ]);
  assertCurrent();
  return {supported: true, permission: Notification.permission, subscribed: device.status === "fulfilled" && device.value,
    serverAvailable: server.status === "fulfilled" ? server.value.available && !!server.value.public_key : null,
    note: server.status === "rejected" ? "Server setup couldn't be checked. Check your connection and try again." :
      device.status === "rejected" ? "This browser's notification setup couldn't be read." : undefined};
}
export async function testBrowserNotification(uid: string) {
  const assertCurrent = scoped(uid); assertCurrent();
  if (!browserPushAvailable() || Notification.permission !== "granted") throw new Error("Allow notifications before testing this device.");
  const registration = await pushRegistration(); assertCurrent();
  await registration.showNotification("KUKU · Device test", {
    body: "A little hello from KUKU. This is a local notification test.",
    icon: "/pwa-192.png", badge: "/pwa-192.png", tag: "kuku-device-test", data: {userId: uid, localTest: true},
  });
  assertCurrent();
}
