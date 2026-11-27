// Progress lives with the account; older accounts retain their existing entry point.
export function accountDestination(user: {email_verified?: boolean; onboarding_complete?: boolean} | null) {
  if (!user) return "/login" as const;
  if (!user.email_verified) return "/verify" as const;
  if (user.onboarding_complete === false) return "/onboarding" as const;
  return "/(tabs)" as const;
}
export function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
