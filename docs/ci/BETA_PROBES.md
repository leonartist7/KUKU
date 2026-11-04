# Beta HTTP probes
This cloud workflow checks only the existing KUKU API and public beta alias using unauthenticated GETs.
It requires no credentials and creates no accounts, messages, uploads or notifications.

It verifies live/readiness responses, 401 responses for private routes, no-store caching, the approved
beta origin, the sign-in document and the frontend JSON proxy. Logs and the JSON artifact contain
status/headers/timings only. The timings are individual HTTP samples, not a browser performance score.

Run after an authorized API rollout and again after the matching frontend alias changes. The workflow
can be run manually or its readiness job can be rerun through GitHub Actions. This is a release check,
not an uptime schedule or an artificial keepalive for a sleeping free server.

Provider LIVE status and application startup are separate evidence. Do not mark the HTTP checks passed
unless the actual readiness job and its report pass. Keep app authentication and project protection.
