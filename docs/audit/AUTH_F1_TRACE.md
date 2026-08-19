# F1 — the cold-load logout, traced in code

> Snapshot as of 2026-08-19 — verify before acting.
> Answers the four questions raised against the browser reproduction of F1.
> No browser was used for this; every claim is a file:line in this repo.

## Short answer

**The hypothesis as stated does not hold — but its conclusion does, one layer
down.** The boot check never reads Firestore. However a denied Firestore
profile read *can* end the session, through a different path, and that path is
the second session-clearing code path the reproduction inferred must exist.

## Q1 — where the two log lines come from

| Log line | Written by |
|---|---|
| `[auth] refused to delete the stored session at boot — the account was never rejected` | `src/firebase/authSessionGuard.js:179` |
| `[auth] boot check kept failing after every rescue — revealing as signed out` | `src/contexts/AuthContext.jsx:1211` |

## Q2 — does the boot check await a Firestore read of the profile? **No.**

The rescue branch is `if (!user && sessionRescued && hasAuthSessionHint())`
(`AuthContext.jsx:1146`). Its only input is `user === null` from
`onAuthStateChanged`, plus the verdict recorded by the session guard.

That verdict comes from `src/firebase/authBootVerdict.js`, which classifies
**exactly two URLs** (`:75-77`):

- `https://securetoken.googleapis.com/v1/token`
- `https://identitytoolkit.googleapis.com/v1/accounts:lookup`

Firestore is not observed anywhere in that module.

## Q3 — does `permission-denied` fall through to the invalid-token branch? **No.**

`classifyVerificationResponse` (`authBootVerdict.js:135-147`) only ever sees the
two auth URLs above, so a Firestore error cannot reach it. Its own comment at
`:31` names `401/403 — App Check enforcement` as **INFRASTRUCTURAL**, and
`shouldPreserveStoredSession` (`:169-180`) returns `false` only for `TERMINAL`.
Unknown and `OK` both mean *keep*.

So at the boot layer the design is already the fix that was proposed: a data
read cannot invalidate an auth session, because a data read is never consulted.

## Q4 — what clears `firebase:authUser:*`, and why the log is not lying

**The refusal is real but boot-window-scoped.** `shouldPreserveStoredSession`
starts with `if (!armed) return false` (`authBootVerdict.js:170`).
`disarmAuthSessionGuard()` sets `armed = false` and restores `window.fetch`
(`authSessionGuard.js:118-129`), and it is called at **`AuthContext.jsx:1145`**
— the top of the first `onAuthStateChanged` callback, *before* the rescue
decision is taken.

So the sequence is:

1. Boot: the SDK tries to delete the record, the guard refuses, the line is
   logged. **The record is still on disk, exactly as the log says.**
2. `onAuthStateChanged(null)` fires → `disarmAuthSessionGuard()` → the guard is
   off for the rest of the page's life.
3. Rescue budget exhausts → `revealAsSignedOut()`, which is only
   `setLoading(false)` (`AuthContext.jsx:785-788`) — it does **not** sign out.
4. Any deletion after step 2 succeeds unopposed.

**The path that deletes it.** `expireSession()` (`AuthContext.jsx:730-735`)
calls `signOut(auth)`, which removes the record. Its docblock names its callers:
terminal token-refresh failures on resume, **and snapshot auth errors that
survive a refresh attempt**. Three call sites: `:830` (init), **`:1076`
(profile snapshot)**, `:1323` (resume).

`:1076` is the one that matters here. The profile-snapshot error handler
(`:1048-1076`) does this on `permission-denied` / `unauthenticated`:

- throttled, force one `getIdToken(true)`;
- if that **succeeds** → re-subscribe and return (no sign-out);
- if it **throws** → `shouldExpireSession(refreshErr.code, online)` decides.

`shouldExpireSession` (`src/hooks/authRecoveryPolicy.js:56-62`) is an
allowlist — it expires only on the nine codes in `TERMINAL_AUTH_ERRORS`
(`:15-25`) and keeps the session for anything unrecognised, offline, or
transient.

**So a Firestore denial alone does not log anyone out. A Firestore denial whose
forced token refresh then fails with a terminal code does.**

Other `signOut` paths, for completeness: `AuthContext.jsx:553` (deliberate),
`:994` (admin suspended/deleted the account), `Login.jsx:257` (MFA challenge
cancelled), `utils/accountService.js:145` (account deletion).

## The correction that matters more than any of the above

The reproduction records the Firestore denials as *"correctly denied by the
limited-mode rules, because this learner has no guardian approval"*, and lists
"limited mode is enforced server-side" under **Confirmed working**.

**`firestore.rules:519` does not support that reading:**

```
match /users/{userId} {
  allow read: if isAuthed() && (isOwner(userId) || isAdmin());
```

`isAuthed()` is `request.auth != null` (`:6`) and `isOwner(uid)` is
`request.auth.uid == uid` (`:52`). There is **no guardian, approval, minor or
verification predicate on that read.** A signed-in learner reading their own
profile is permitted unconditionally, approved or not.

So `profile subscription: Missing or insufficient permissions` cannot be
limited mode working as designed. It means the request did not reach Firestore
as an authenticated owner at all.

### The single root cause that fits every symptom

App Check is **enforced on Auth** for `examsprepzambia` — a direct
`accounts:signInWithPassword` returns `401 "Firebase App Check token is
invalid."`

When reCAPTCHA is slow, blocked or down, `src/firebase/appCheckResilient.js`
fails **open** by design, returning `APPCHECK_PLACEHOLDER_TOKEN =
'appcheck-recaptcha-unavailable'` (`:55`) with a 60s TTL. Its own comment
(`:52-54`) states the consequence: *"the enforced backends reject it."*

One placeholder token therefore produces, simultaneously:

- `accounts:lookup` → 401 → INFRASTRUCTURAL → guard preserves → rescue ×3 →
  exhausted → `/login` (the ~10s and the console signature);
- Firestore → `permission-denied` on the profile, the notifications feed and
  the push token — three reads a learner is otherwise entitled to make;
- and, if the subsequent forced `getIdToken(true)` also fails with a terminal
  code, `expireSession` → `signOut` → **the stored record is deleted.**

This also fits the route asymmetry: `/games` renders because the games hub
falls back to the bundled seed catalogue when its Firestore read fails, and
`/papers` has a public path. The routes that bounced are the ones with no
fallback for a denied read.

## The one link this trace cannot close

Whether step 3 actually fires depends on the error code returned by the failed
`getIdToken(true)` — `shouldExpireSession` expires only on the nine terminal
codes. That code is not derivable from source; it comes from the SDK at
runtime.

**One line in the browser console during a failing cold load settles it:**

```js
firebase.auth().currentUser?.getIdToken(true).catch(e => console.log('CODE:', e.code))
```

- a code in `TERMINAL_AUTH_ERRORS` → the snapshot path is the deleter, and
  `shouldExpireSession` should stop treating an App-Check rejection as a dead
  credential;
- anything else → the deletion came from elsewhere and the remaining `signOut`
  call sites above are the place to look.

## Fix shape

1. **Do not let an App Check rejection read as a dead credential.** It is
   already INFRASTRUCTURAL at the boot layer (`authBootVerdict.js:31`); the
   same classification needs to hold in `shouldExpireSession`, which today
   knows nothing about App Check.
2. **Reconsider the fail-open placeholder.** Sending a token the enforced
   backends are documented to reject converts a reCAPTCHA outage into a logout
   plus three denied reads. Sending *no* token, or holding the request, fails
   in a way the retry ladders above already handle.
3. **The boot guard's lifetime is the smaller half of the bug.** Refusing the
   deletion for the boot window only, then handing the record to a path that
   deletes it, is why the log and the observed state disagree.
