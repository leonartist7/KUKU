export function invitationFromUrl(url: string | null): string {
  if (!url) return "";
  const fragment = url.split("#")[1] || "";
  const token = new URLSearchParams(fragment).get("invite") || "";
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : "";
}
