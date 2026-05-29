# Debugging "loads and stops" on the Lesson Plan Generator

> **Re-verified 2026-05-29.** The live lesson-plan path is **SSE**, not the plain callable: the web app POSTs to the same-origin `/api/teacher/lesson-plan/stream` (a Hosting rewrite → the `apiGenerateLessonPlan` Cloud Function). The callable `generateLessonPlan` is only a dev/native fallback. The steps below reflect that.
>
> **Functions deploy via CI only** (`deploy-firebase.yml`) — never `firebase deploy --only functions` from your workstation (off-limits per CLAUDE.md). The read-only `firebase-tools` checks below (`functions:list`, `secrets:access`, `functions:log`) are fine to run locally; the *fix* for a missing deploy is to merge a PR, not to deploy by hand.

Run these top to bottom — stop at the first command that shows a problem.

## 1. Is the function deployed?

```bash
npx firebase-tools@latest functions:list
```

You should see **`apiGenerateLessonPlan`** (the SSE endpoint the web app actually calls) and `generateLessonPlan` (the callable fallback). If either is **missing**, that's the bug — land it through CI (push your branch, merge a PR; `deploy-firebase.yml` ships functions). Do not deploy from the workstation.

## 2. Is the ANTHROPIC_API_KEY secret set?

```bash
npx firebase-tools@latest functions:secrets:access ANTHROPIC_API_KEY
```

You should see a key starting with `sk-ant-`. If it's missing or empty, set it and let CI redeploy:

```bash
npx firebase-tools@latest functions:secrets:set ANTHROPIC_API_KEY
# paste the key when prompted, then push a commit so CI redeploys functions
```

A missing key surfaces as `failed-precondition: AI is not configured yet.` (see step 4).

## 3. Are the Firestore rules deployed?

In the Firebase console → Firestore → Rules, confirm the `aiGenerations`, `usageMeters`, and `teacherLibraries` blocks are present (they live in `firestore.rules` and ship via CI). A missing block shows up as `PERMISSION_DENIED: Missing or insufficient permissions` on a Firestore write.

## 4. What do the function logs say when you click Generate?

Click Generate in the UI, then immediately:

```bash
npx firebase-tools@latest functions:log --only apiGenerateLessonPlan --limit 50
# dev/native callable path instead: --only generateLessonPlan
```

Typical signatures (all strings verified present in the functions code):

- `permission-denied: Teacher tools are available to approved teachers only.`
  → Your signed-in user isn't an approved teacher/admin. Set `role` to `"teacher"` or `"admin"` on `users/{yourUid}` in the Firestore console.
- `failed-precondition: AI is not configured yet.`
  → `ANTHROPIC_API_KEY` secret missing (step 2).
- `unavailable: AI is temporarily unavailable.`
  → Claude returned an error — check the preceding log line for detail.
- Nothing at all → the request never reached the function (auth/init, or the SSE endpoint isn't deployed — step 1).

## 5. What does the browser console say?

DevTools → Console → click Generate. The client streams via `generateLessonPlanStream`; on failure it logs a line beginning **`[zedexams] generateLessonPlanStream stream error after …`**. Share any red lines you see.

## 6. Network-tab check

DevTools → Network → click Generate. In production web, look for a POST to **`/api/teacher/lesson-plan/stream`** (same-origin; Hosting rewrites it to `apiGenerateLessonPlan`). It stays open and streams `text/event-stream`:

- Streams `data:` chunks then completes → working.
- `403` → auth/role (the `permission-denied` from step 4).
- Opens, then emits a `data: [ERROR] …` frame → server-side failure; check step 4 logs. **SSE errors arrive as an `[ERROR]` frame inside the stream, not as a clean HTTP 500** — so don't expect a red 500 row.
- No request at all → client never sent it (auth/init issue).

In dev or on native (Capacitor) there's no SSE; the app falls back to the callable, so you'll instead see a `…cloudfunctions.net/generateLessonPlan` request.
