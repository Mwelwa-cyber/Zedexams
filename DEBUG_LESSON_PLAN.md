# Debugging "loads and stops" on the Lesson Plan Generator

Run each of these and share the output. Top to bottom — stop at the first
command that shows a problem.

## 1. Is the function actually deployed?

```bash
npx firebase-tools@latest functions:list
```

You should see `generateLessonPlan` in the list. If it's **missing**, that's
the bug — run `npm run deploy:firebase:functions` and try again.

## 2. Is the ANTHROPIC_API_KEY secret set?

```bash
npx firebase-tools@latest functions:secrets:access ANTHROPIC_API_KEY
```

You should see the actual key value (starts with `sk-ant-`). If you get
"Secret not found" or an empty response, set it:

```bash
npx firebase-tools@latest functions:secrets:set ANTHROPIC_API_KEY
# Paste your Anthropic API key when prompted, then:
npm run deploy:firebase:functions
```

## 3. Are the Firestore rules deployed?

```bash
npx firebase-tools@latest firestore:indexes
```

Then in the Firebase console, go to Firestore → Rules and verify the new
`aiGenerations`, `usageMeters`, `teacherLibraries` blocks are present. If
they aren't: `npm run deploy:firebase:firestore`.

## 4. What does the function log say when you click Generate?

Click Generate in the UI, then immediately run:

```bash
npx firebase-tools@latest functions:log --only generateLessonPlan --limit 50
```

The last few lines will tell us exactly where it died. Typical signatures:

- `permission-denied: Teacher tools are available to approved teachers only.`
  → Your signed-in user has `role: "learner"`. Fix by setting role to
  `"teacher"` or `"admin"` in Firestore console at `users/{yourUid}`.

- `failed-precondition: AI is not configured yet.`
  → ANTHROPIC_API_KEY secret is missing (see step 2).

- `unavailable: AI is temporarily unavailable.`
  → Claude returned an error. Look for the preceding line for detail.

- `PERMISSION_DENIED: Missing or insufficient permissions` on a Firestore
  write → rules not deployed (see step 3).

- Nothing at all → the function isn't being called because it isn't
  deployed (step 1) or the client isn't reaching it.

## 5. What does your browser console say?

Open DevTools → Console tab → click Generate → watch for red error lines.
Share anything you see there. The client-side wrapper calls
`console.error('generateLessonPlan failed', error)` before returning, so
the underlying error should always be logged there.

## 6. Network-tab check

DevTools → Network tab → click Generate. Look for a POST request to
`...cloudfunctions.net/generateLessonPlan`. What's its status?

- 200 but stalls → response body issue
- 403 → auth/rules
- 404 → function not deployed
- 500 → server error (check step 4 logs)
- No request at all → client never sent it (usually an auth/init issue)
