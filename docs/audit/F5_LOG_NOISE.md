# F5 — the console noise, checked

> Snapshot as of 2026-08-20 — verify before acting.
> F5 reported ~46 console messages per session, "most ERROR-level through the
> Sentry bundle", for states working as designed, plus buffered logs replaying
> on every boot. Checked from source. **Most of it does not hold, and acting on
> it as written would remove the one signal that matters.**

## 1. Sentry does not ingest console output at all

`src/utils/sentry.js` declares exactly one integration:

```js
integrations: [
  Sentry.browserTracingIntegration(),
],
```

There is **no `captureConsoleIntegration`**. Sentry receives unhandled
exceptions and explicit `capture*` calls — never `console.error` / `console.warn`.

So: console volume does not inflate Sentry error counts, changing a log level
would not change any Sentry number, and "every new signup re-reports history"
cannot happen through this path.

This also confirms, from the other direction, why the App Check placeholder was
invisible: `resilientGetToken` never throws and nothing captured, so there was
nothing for Sentry to see. Console noise was never the reason.

## 2. Two of the three named lines are already `warn`

| Line | Level |
|---|---|
| `[notifications] feed subscribe failed:` | `console.warn` (NotificationContext) |
| `[push] getToken failed:` | `console.warn` (`services/notifications/fcm.js:107`) |
| `profile subscription:` | `console.error` (AuthContext) |

Only one is ERROR, and it is the one that should stay ERROR — see below.

## 3. The denials are NOT "working as designed", so do not quieten them

F5 records these as correct limited-mode enforcement for an unapproved minor.
`firestore.rules:519` does not support that:

```
match /users/{userId} {
  allow read: if isAuthed() && (isOwner(userId) || isAdmin());
```

`isAuthed()` is `request.auth != null`; `isOwner(uid)` is a uid match. **No
guardian, approval, minor or verification predicate.** A signed-in learner may
read their own profile unconditionally.

So `permission-denied` there never means "this learner lacks permission". It
means the request did not arrive authenticated — and the usual cause is App
Check failing open with a placeholder token the enforced backends reject
(fixed downstream in #2523).

**Downgrading this line would hide the single clearest symptom of that bug.**
It stays `console.error`, and now says why when attestation was degraded at the
time:

> `[auth] App Check attestation was degraded when this failed — the request
> almost certainly carried a placeholder token the backend rejected. This is
> NOT a rules/limited-mode denial.`

That one line would have saved this entire investigation.

## 4. The replay: no mechanism found in this repo

Nothing in `src/` buffers and replays console output. The obvious suspect is
clean: `src/utils/clientErrorReporting.js` is module-scoped with **no**
`localStorage` / `sessionStorage` persistence, caps at 5 events per page
session, and dedups identical messages inside 60s. It cannot carry anything
across a boot.

An older embedded timestamp reappearing is consistent with the browser
console's **"Preserve log"** setting, which keeps entries across full page
loads — and every step of the F1 reproduction was a full page load.

**Unresolved, and stated rather than guessed:** confirm with Preserve log OFF
before treating this as a defect. If old timestamps still reappear on a clean
console, it is real and this section is wrong — but there is no code here to
fix on the strength of the current evidence.

## What actually changed

One line, in `AuthContext`'s profile-snapshot error handler. Nothing was
quietened.
