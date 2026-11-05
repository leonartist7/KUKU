# KUKU onboarding

The entry flow is invitation + email, name + password, email verification, profile, then a welcome with an invitation action. Existing verified accounts keep their entry point. New accounts resume unfinished verification or profile setup using private server-backed progress. Profile editing remains available from You.

The profile endpoint only accepts a display name (1–80 characters) and optional bio (0–160 characters), requires a verified session, checks browser origin and ignores no arbitrary fields: extra keys are rejected. Completion is idempotent. No invitation, verification or password rules are relaxed.

The generated brand masters live in frontend/assets/brand. The deterministic Node export script derives app/adaptive/splash/favicon/PWA sizes and optimized in-app artwork before web and EAS builds. Navigation controls continue using the existing vector icon library. No photo upload is offered before private file storage is configured.

Email is sent only after the user selects the send action. Verification supports pasting the complete existing alphanumeric code, expiry guidance, resend cooldown and errors. Recovery preserves the same response for known and unknown accounts.

CI exercises 26 backend regressions, frontend infrastructure/routing checks, TypeScript, real web export, and a synthetic browser journey at 320/390/768/1440px. Browser traffic is mocked; it does not create real accounts or send real email. Provider delivery and physical Android acceptance remain separate release gates.
