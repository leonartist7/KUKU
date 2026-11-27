const u = process.env.EXPO_PUBLIC_BACKEND_URL;
if (!u || !u.startsWith("https://") || /localhost|127\.0\.0\.1|preview\.emergent/.test(u)) {
  throw new Error("Set EXPO_PUBLIC_BACKEND_URL to the production HTTPS API origin before building.");
}
