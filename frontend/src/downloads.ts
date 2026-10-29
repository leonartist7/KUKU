import {Linking, Platform} from "react-native";

export async function openPrivateDownload(url: string): Promise<void> {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("This download address isn’t valid. Please try again.");
  if (Platform.OS === "web") {
    // Attachment responses start a download without opening a popup after an async request.
    window.location.assign(target.href);
    return;
  }
  await Linking.openURL(target.href);
}
