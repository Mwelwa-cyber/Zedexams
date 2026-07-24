# Runbook — deploy rollback (hosting / functions / rules / indexes)

> Snapshot as of 2026-07-24 — verify before acting.

Closes production-readiness finding **CICD-005** (no documented rollback
runbook). ZedExams ships through GitHub Actions — `deploy-hosting.yml`
(`firebase deploy --only hosting`) and `deploy-firebase.yml`
(`firebase deploy --only firestore,storage,functions`, or a subset by changed
path). This runbook is the step-by-step reverse for each surface, the fast
emergency paths, and a safe rehearsal drill.

**Golden rule:** the audit-trailed rollback is **`git revert` → PR → merge → CI
re-deploys the prior state**. The console fast-paths below are for a live P0
outage where you can't wait for CI; always reconcile them back into git
afterwards so the repo stays the source of truth.

Two constraints from [`CLAUDE.md`](../../../CLAUDE.md) / [`DEPLOY.md`](../../../DEPLOY.md) still hold during an incident:
- `firebase deploy --only hosting` and `--only functions` are **CI-only** — never run them by hand. (A Hosting *release rollback* is a pointer swap, **not** a deploy, so it is allowed — see below.)
- `firebase deploy --only firestore:indexes` is the one allowed direct CLI deploy.

---

## 0. Decide the path (30-second triage)

| Symptom | Broken surface | Go to |
|---|---|---|
| White screen / crash card / bad UI on zedexams.com | **Hosting** (frontend bundle) | §1 |
| A callable/HTTP function errors, or an agent misbehaves | **Cloud Functions** | §2 |
| Legit reads/writes suddenly `permission-denied` (or data over-exposed) | **Firestore / Storage rules** | §3 |
| A new query fails with "requires an index" / a bad index | **Indexes** | §4 |
| Not sure / multiple | Start with the fastest safe revert (§1 or §3 console), then §5 revert-all |

First, check `/status` (Vigil's `publicStatus`) and the last merged PR — the
offending change is almost always the most recent deploy.

---

## 1. Hosting (frontend) — fastest, zero-downtime

**Emergency fast path (seconds, no CI):**
```bash
firebase hosting:rollback           # re-points the live channel at the previous release
```
or Console → **Hosting** → the `examsprepzambia` site → **Release history** →
last good release → **⋮** → **Rollback**. The prior build is live in seconds;
the broken one is preserved for diagnosis. This is a release-pointer swap, not a
`firebase deploy`, so it does **not** violate the CI-only rule.

**Clean path (audit-trailed):**
```bash
git revert <bad-commit-sha>         # or revert the merge commit with -m 1
# open a PR, let required checks pass, merge → deploy-hosting.yml republishes the prior bundle
```
Use the clean path once the fire is out (or instead of the fast path if the
outage isn't user-visible).

---

## 2. Cloud Functions — revert via CI

There is **no one-click functions rollback**, and manual `firebase deploy
--only functions` is off-limits. Options, in order of preference:

1. **Feature flag / kill-switch first (fastest, no deploy).** Many risky paths
   are already gated at runtime — flip them instead of rolling back the whole
   deploy:
   - Pause a misbehaving agent: set `agentControl/{agentId}.paused = true`.
   - Disable a gated feature: `settings/global.featureFlags.*` (e.g. passkeys,
     `content.autoPublish`, region routing).
   - Turn off learner moderation blocking: `LEARNER_MODERATION_ENABLED=false`
     (env) if a false-positive is blocking chat.
2. **`git revert` → PR → merge.** `deploy-firebase.yml` redeploys the reverted
   code (it retries per-function on transient failures). This is the standard
   functions rollback.
3. **Revert to a prior known-good tag** only if the tip is unrevertable —
   `git revert` a range or `git checkout <good-tag> -- functions/` into a PR.

Never hand-deploy functions to "get ahead of CI" — a half-deployed manual push
is harder to reason about than a 3-minute CI redeploy.

---

## 3. Firestore / Storage rules — revert (console for a P0)

Rules changes are the highest-blast-radius deploy (a wrong `allow` can lock out
every user or over-expose data).

**Emergency fast path (P0 lockout, no CI):** Console → **Firestore Database** →
**Rules** → the version history → select the last good version → **Publish**.
(Storage rules: Console → **Storage** → **Rules** → history → publish.) Firebase
keeps rules history, so this is instant. **Then reconcile in git** (§ below) so
the repo doesn't silently drift from production.

**Clean path:**
```bash
git revert <bad-commit-sha>         # touches firestore.rules / storage.rules
# PR → merge → deploy-firebase.yml runs `--only firestore` / `--only storage`
```
Before merging a rules revert, run the emulator locally to confirm the prior
behaviour: `npm run test:rules-emulator` (+ `test:storage-rules-emulator`).

**Reconcile a console hotfix back to git:** copy the published rule text into
`firestore.rules` / `storage.rules`, open a PR, and let CI redeploy the
identical rules — this makes the deploy pipeline and the repo agree again.

---

## 4. Firestore indexes — usually no rollback needed

Composite indexes are **additive** — an extra index never breaks an existing
query, so a bad *code* deploy that added an index can be rolled back (§1/§2)
without touching the index. To remove an unwanted index: revert
`firestore.indexes.json`, then run the one allowed direct deploy:
```bash
npx firebase deploy --only firestore:indexes
```
Do **not** let an in-progress index build block a code rollback — roll the code
back first; the index finishes (or is deleted) independently. A query that
"requires an index" is fixed by *adding* the index (deploy indexes **before**
the code that needs them), not by rolling back.

---

## 5. Roll everything back (uncertain blast radius)

When you can't isolate the surface, revert the whole merge and let CI
re-deploy every surface to the prior state:
```bash
git revert -m 1 <bad-merge-commit-sha>   # -m 1 = revert a squash/merge commit to its first parent
# PR → merge → deploy-hosting.yml + deploy-firebase.yml both re-run
```
This is the safest catch-all; it costs one CI cycle (~3–8 min) but restores a
known-good, fully-consistent state with an audit trail.

---

## 6. Verify after any rollback

1. The specific broken behaviour is gone (repro the original symptom).
2. `/status` (Vigil `publicStatus`) is green; no new Sentry spike.
3. Run the **authed smoke** from [`DEPLOY.md`](../../../DEPLOY.md#smoke-test-after-a-user-facing-deploy):
   landing loads incognito, a `/teachers/samples` renders + DOCX downloads,
   admin dashboard shows the AI cards, a Grade 5 Maths lesson plan generates < 30s.
4. If you used a console fast-path, confirm the git reconcile PR merged so the
   repo matches production.
5. Record the incident: what broke, which path, and the **RTO** (time from
   detection to verified-good) for the next drill.

---

## 7. Rehearsal drill (do this once, then quarterly)

The acceptance criterion for CICD-005 is a *rehearsed* runbook. Practice
without risking prod:

- **Hosting (safe):** push a trivial, obviously-different change (e.g. a footer
  text tweak) through the normal pipeline to prod, confirm it's live, then run
  `firebase hosting:rollback` (or the console rollback) and confirm the prior
  build returns in seconds. Record the RTO. (Or rehearse against a Hosting
  **preview channel** if you'd rather not touch prod at all.)
- **Rules (safe, no prod):** in the emulator, make a deliberately-too-strict
  rules edit, watch `npm run test:rules-emulator` fail, `git revert` it, and
  watch the suite pass — proving the revert path restores behaviour before it
  would ever reach prod.
- **Functions (tabletop):** walk the team through §2 — which flag/kill-switch
  covers which failure — and confirm each `agentControl` / `featureFlags` toggle
  exists and is reachable from `/admin`.

Log the drill date + measured hosting RTO at the top of this file on each
rehearsal.
