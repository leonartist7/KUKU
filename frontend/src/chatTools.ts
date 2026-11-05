import type {Message} from "./api";
export const CHAT_REACTIONS = ["❤️", "😂", "🥰", "👍", "😮", "😢"] as const;
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export function messageRevision(message: Pick<Message, "revision">): number {
  return Number.isSafeInteger(message.revision) && (message.revision || 0) >= 0 ? message.revision || 0 : 0;
}
export function messageRemoved(message: Message): boolean { return !!message.deleted_at; }
export function messagePreview(message: Message | null | undefined, limit = 100): string {
  if (!message) return "Message unavailable";
  if (messageRemoved(message)) return "Message removed";
  const value = message.type === "text" ? message.text || "" : message.type === "voice" ? "Voice memo"
    : message.type === "image" ? "Photo" : message.type === "file" ? message.file_name || "File"
    : message.type === "space_invite" ? message.space_name || "Shared space" : "Emote";
  const clean = value.replace(/\s+/g, " ").trim(), letters = Array.from(clean);
  return letters.length > limit ? letters.slice(0, limit).join("") + "…" : clean || "Message";
}
export function canEditMessage(message: Message, userId: string, clock = Date.now()): boolean {
  const age = clock - new Date(message.created_at).getTime();
  return message.sender_id === userId && message.type === "text" && !messageRemoved(message)
    && Number.isFinite(age) && age >= 0 && age < EDIT_WINDOW_MS;
}
export function canRemoveMessage(message: Message, userId: string): boolean {
  return message.sender_id === userId && (message.type === "text" || message.type === "emote") && !messageRemoved(message);
}
export function ownReaction(message: Message, userId: string): string | null {
  return message.reactions?.find(reaction => CHAT_REACTIONS.some(emoji => emoji === reaction.emoji) && reaction.user_ids.includes(userId))?.emoji || null;
}
export function mergeChatMessages(chatId: string, existing: Message[], incoming: Message[]): Message[] {
  const items = new Map<string, Message>();
  for (const message of [...existing, ...incoming]) {
    if (message.chat_id !== chatId) continue;
    const previous = items.get(message.id);
    if (!previous || messageRevision(message) >= messageRevision(previous)) items.set(message.id, message);
  }
  return Array.from(items.values()).sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
export function currentMessage(id: string, loaded: Message[], resolved: Record<string, Message | null>): Message | null {
  if (resolved[id] === null) return null;
  const visible = loaded.find(message => message.id === id), fetched = resolved[id];
  if (!visible) return fetched || null;
  return fetched && messageRevision(fetched) > messageRevision(visible) ? fetched : visible;
}
// Replies persist an ID, never a copied quote that could survive deletion or editing.
export function replyFields(replyToId: string | null): {reply_to_id?: string} {
  return replyToId ? {reply_to_id: replyToId} : {};
}
