import {Platform, Share} from "react-native";
import {api, getSessionUserId} from "./api";

export const EXPORT_SECTIONS = ["profile", "messages", "attachments", "audio_uploads", "spaces", "space_messages", "calls"] as const;
export type ExportSection = typeof EXPORT_SECTIONS[number];
type ExportPage = {schema_version: number; section: ExportSection; items: unknown[]; next_cursor: string | null};
const MAX_RECORDS = 5_000;
const MAX_BYTES = 4 * 1024 * 1024;

function utf8Bytes(text: string) {
  let size = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return size;
}
function current(uid: string, isActive?: () => boolean) {
  if (getSessionUserId() !== uid) throw new Error("Your account changed. Start the export again.");
  if (isActive && !isActive()) throw new Error("Export cancelled.");
}

export async function collectAccountExport(uid: string, progress?: (section: ExportSection) => void, isActive?: () => boolean) {
  current(uid, isActive);
  const sections: Partial<Record<ExportSection, unknown[]>> = {};
  let count = 0, bytes = 0;
  for (const section of EXPORT_SECTIONS) {
    current(uid, isActive); progress?.(section);
    sections[section] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page: ExportPage = await api.getAs<ExportPage>(uid, "/account/export?section=" + section +
        "&limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
      current(uid, isActive);
      if (page.schema_version !== 1 || page.section !== section || !Array.isArray(page.items) ||
          page.items.length > 100 || (page.next_cursor !== null && typeof page.next_cursor !== "string")) {
        throw new Error("The export could not be read. Please try again.");
      }
      count += page.items.length;
      bytes += utf8Bytes(JSON.stringify(page.items));
      if (count > MAX_RECORDS || bytes > MAX_BYTES) {
        throw new Error("This account is larger than the beta export limit. Contact the app operator for a complete export.");
      }
      sections[section]!.push(...page.items);
      cursor = page.next_cursor;
      if (cursor) {
        if (seen.has(cursor) || seen.size >= 100) throw new Error("The export could not advance. Please start again.");
        seen.add(cursor);
      }
    } while (cursor);
  }
  current(uid, isActive);
  return {
    schema_version: 1, generated_at: new Date().toISOString(),
    scope: "Your profile, authored content, private upload metadata, authorized Space metadata and call history. Original media bytes and device-local preferences are not included.",
    sections,
  };
}

export async function saveAccountExport(uid: string, data: Awaited<ReturnType<typeof collectAccountExport>>) {
  current(uid);
  const json = JSON.stringify(data, null, 2);
  if (Platform.OS !== "web") {
    if (utf8Bytes(json) > 200 * 1024) throw new Error("This export is too large for a text share. Open KUKU in a browser to download the JSON file.");
    const result = await Share.share({title: "KUKU personal data", message: json}, {dialogTitle: "Share your KUKU JSON export"});
    current(uid);
    return result.action === Share.dismissedAction ? "cancelled" : "shared";
  }
  const url = URL.createObjectURL(new Blob([json], {type: "application/json;charset=utf-8"}));
  try {
    current(uid);
    const link = document.createElement("a");
    link.href = url;
    link.download = "kuku-personal-data-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Leave the URL alive briefly so the browser can start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return "downloaded";
}

