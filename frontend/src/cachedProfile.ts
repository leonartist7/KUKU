import type {User} from "./api";

// This is display data only. It never establishes an authenticated session.
export function readCachedProfile(raw: string | null): User | null {
  if (!raw || raw.length > 150_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const profile = value as Record<string, unknown>;
    if (typeof profile.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(profile.id) ||
        typeof profile.name !== "string" || !profile.name.trim() || profile.name.length > 100 ||
        typeof profile.email_verified !== "boolean" || typeof profile.onboarding_complete !== "boolean") return null;
    const result: User = {id: profile.id, name: profile.name.trim(), email_verified: profile.email_verified, onboarding_complete: profile.onboarding_complete};
    if (typeof profile.email === "string" && profile.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) result.email = profile.email;
    if (typeof profile.bio === "string" && profile.bio.length <= 500) result.bio = profile.bio;
    // Only our normalized embedded profile photos are safe to paint before
    // authorization. Never turn a modified cache into an external image request.
    result.avatar = typeof profile.avatar === "string" && profile.avatar.length <= 120_000 &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(profile.avatar) ? profile.avatar : null;
    if (typeof profile.created_at === "string" && profile.created_at.length <= 40 && Number.isFinite(Date.parse(profile.created_at))) result.created_at = profile.created_at;
    return result;
  } catch {return null;}
}

export function canShowCachedShell(profile: User | null): profile is User {
  // Verification/onboarding screens have their own active workflows. Resume
  // those only after the server check, never from stale cached flags.
  return profile?.email_verified === true && profile.onboarding_complete === true;
}

