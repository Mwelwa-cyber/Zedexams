# Runbook — ramping the Assessment Engine

> Snapshot as of 2026-08-14 — verify before acting.

The operator half of Phase 3. Every cutover is built and merged
([`phase3-plan.md`](../../phase3-plan.md) §10.1 is complete); what remains is
turning them on, and none of it is dischargeable from a pull request. This is
that sequence.

**Nothing here is automated on purpose.** Each step is a deliberate act by a
person who can see the dashboards, because the whole safety argument is that a
human notices something and reverts in seconds.

---

## 0. Before the first flip

Read this row before touching a switch: **a flag rolls back CODE, not
DOCUMENTS.** A result written by the engine stays written after a rollback.
That is why the byte-compatibility comparisons had to pass first, and why the
order below puts the zero-write route first.

| | |
|---|---|
| Where | `/admin` → Developer → Feature flags |
| What backs it | `settings/global`, subscribed with `onSnapshot` — a change reaches every open client in seconds, **with no build and no deploy** |
| Fail-closed | Anything but `=== true` is off. An unreadable `settings/global` serves the old runner |
| Allow-list | `rolloutUids` is edited through the config JSON, not a control. It does **not** survive the runner switch — turning a runner off reverts allow-listed accounts too |

Current state at the time of writing: all three switches `false`,
`rolloutPercent` `0`, `rolloutUids` empty. **No learner has met the engine.**

---

## 0a. The FAST PATH — owner decision, 2026-08-14

**The owner elected to turn all three runners on without a staged ramp, and to
fix problems forward rather than reverting.** The reason is legitimate and worth
recording: this migration has taken a long time, and a multi-day ramp per runner
adds weeks to it for a codebase whose byte-compatibility is already proven on
every fixture.

This section is that path. The staged ramp in §2–§4 remains below because it is
what the plan committed to, and because a later reader needs to know which one
was actually followed.

**The one thing the fast path does not change**, because it is a fact about the
system rather than a preference about pace:

> A flag reverts CODE. It does not revert DOCUMENTS. A `results` row with a
> wrong score is a learner's grade, already written. Turning the flag off does
> not un-write it, and there is no cleanup script for it.

So "fix forward" is fully available for a **render** problem and not available
for a **write** problem, and which one you are exposed to depends on the runner:

| runner | writes | what "fix later" actually costs |
|---|---|---|
| `pastPaperQuiz` | **nothing at all** | a bad render. Reverts in seconds, nothing to clean up |
| `quiz` | `results` | a wrong grade on a learner's record |
| `game` | `scores`, `badges`, `dailyStreaks`, `learner_profiles` | a leaderboard row no query finds |

### The sequence

1. **Do §1's rollback rehearsal anyway. It takes about two minutes and exposes
   nobody**, because `rolloutPercent` stays at 0 and only your own uid is in
   `rolloutUids`. It is not part of the ramp and skipping it saves no time — what
   it buys is knowing the switch works *before* the day you need it in a hurry.
   A switch nobody has ever thrown is not a rollback plan.
2. **`pastPaperQuiz` → on, `rolloutPercent` → 100.** Do this first and without
   hesitation: the route persists nothing, so the entire downside is a render
   that reverts in seconds. This is "migrate it and fix later" working exactly
   as intended.
3. **`quiz` → on, then `game` → on.** Both already at 100% via the shared
   percentage.
4. **Check within the first hour, not the first week.** This is the part that
   replaces the ramp and it is short: both irreversible failures show up within
   *minutes* of real traffic, not days. See §5a.

### §5a — the first hour, for the two runners that write

Three checks. If all three are clean after an hour of real traffic, the fast
path has worked and there is nothing further to watch that a normal week would
not surface.

- **Score distribution** against the pre-flip week (`results.percentage`).
  **A marking regression does not throw** — it produces plausible numbers that
  are wrong, so no error rate will show it and a shifted mean will. This is the
  single most important number on the page, and it is the one that decides
  whether documents are being written correctly.
- **A leaderboard query returning rows.** The D5 identity-field regression
  writes documents that look perfect and are found by no
  `where('grade','==',4)` query. Open any game's leaderboard and confirm new
  scores appear. No errors accompany this failure.
- **The refusal rate** — `assessment_engine_path` with `engine:false,
  latched:false`. Expected and correct at quizzes (the engine draws two of
  eleven question types); what matters is that it is not ~100%, which would mean
  the engine is serving nobody and the flip achieved nothing.

**If the score distribution has moved, turn `quiz` off immediately** — not to
"roll back the migration", but because every further minute writes more
documents that will need correcting by hand. That is the one case where
reverting is cheaper than fixing forward, and it is cheap precisely because it
is a switch rather than a deploy.

---

## 1. Rehearse the rollback FIRST (§5.1 criterion 7)

Do this before any learner is exposed. It is the one criterion no diff can
discharge, and the point is to find out that the toggle reaches production
while nothing depends on it.

1. Put your own uid in `rolloutUids`.
2. Turn **`pastPaperQuiz`** on. Leave `rolloutPercent` at `0` — the allow-list
   is checked after the runner switch, so you get the engine and nobody else
   does.
3. Open `/papers/:paperId/quiz`. Confirm the engine card: one vertical column,
   A/B/C/D letter badges.
4. Turn `pastPaperQuiz` **off**. Confirm the old card returns **without a
   reload** — this is the rollback, and it must reach a client that is already
   sitting on the page.
5. Turn it back on and confirm the engine card returns.

**If step 4 needs a reload, stop.** The rollback is the entire safety argument;
a rollback that needs a deploy or a reload is not one.

---

## 2. Past-paper first, on a ramp — the staged alternative to §0a

The canary, and the only cutover that **persists nothing** — if the engine is
wrong here there is no corrupted document and nothing to clean up. It is also
the highest-traffic route, so it produces evidence fastest. Its one risk is
that it is public and SEO-visible, which is what the percentage is for.

Leave `pastPaperQuiz` on, then raise `rolloutPercent`:

```
1  →  5  →  25  →  50  →  100
```

**Soak at least one full weekday at each step**, and compare against the *same
weekday*, not against yesterday — traffic on this route is strongly
day-shaped.

The ramp is monotonic (`bucket < percent` against a fixed hash), so raising the
number only ADDS visitors: the population at 25% contains the population at 10%.
Nobody already on the engine is moved off by a ramp-up.

The bucket is **not** salted per runner — all three share one bucketing, so
`rolloutPercent: 10` means the same ten percent of visitors everywhere.

---

## 3. Then quizzes

`/quiz/:quizId` — the first route that **writes**. Turn `quiz` on; it inherits
the same `rolloutPercent`, so consider dropping the percentage back before
flipping it if you want this route to start small.

What to know before you do:

- **The refusal rate is the number to watch, not the error rate.** The old
  runner draws eleven question types and the engine draws two, so the engine
  serves only quizzes that are entirely `mcq`/`tf`. Everything else silently
  falls back — correctly. `assessment_engine_path` with `engine:false,
  latched:false` is a refusal; `latched:true` is a watchdog hold. They are
  different numbers and the event separates them.
- A learner mid-attempt is never moved **onto** the engine by a ramp-up, and is
  always moved **off** it by a rollback.

---

## 4. Games last

`timed_quiz` — four write targets, and the one where the failure mode is
invisible in the write itself.

**Watch the leaderboard queries, not the writes.** `scores` stores grade as a
**Number** and subject **lowercased** (the D5 divergence). A regression there
writes documents that look perfect and are found by no
`where('grade','==',4)` query. The symptom is a leaderboard returning *fewer
rows than before the flip*, with no errors anywhere.

---

## 5. What to watch, at every step

`assessment_engine_path` (PostHog) carries: `runner`, `engine` (what the learner
actually MET, not what the flag said), `flagSource`, `latched`, `live`,
`heldByAttemptLatch` / `heldByRoundLatch`, `build`.

- **`live: false`** means that client's `settings/global` subscription died and
  the decision was forced closed. It reports the same `runner-off` source as a
  deliberate rollback, so without this field the two are one bucket. A rise here
  is a config-delivery problem, not a rollout signal.
- **Score distribution** (`results.percentage`, `scores.score`) against the
  pre-flip baseline. This one deserves its own line: **a marking regression does
  not throw.** It produces plausible numbers that are wrong. Error rates will
  not catch it; a shifted mean will.

---

## 6. Roll back without discussion on any of these

Flip the runner's switch off. Do not investigate first — the cost of being
wrong about a trigger is minutes.

- any write mismatch in production the harness did not predict;
- submit failure rate above its pre-flip baseline on a meaningful sample;
- **any** learner-reported lost attempt or lost marks, unreproduced — one report
  is enough;
- **any Firestore write at all from the past-paper route** (it must persist
  nothing; this is a P1);
- completion rate down materially against the same weekday;
- a mean-score shift not explained by a content change;
- for games, a leaderboard query returning fewer rows than before the flip.

Rolling back one runner does not affect the other two — that is why they are
three switches and not one.

---

## 7. After 100% on all three

The Phase 4 freeze in [`architecture.md`](../../architecture.md) §13 is keyed to
this moment, not to the cutovers being built. The old runners stay mounted and
are deleted in **Phase 6**, not here (§14.11) — a rollback has to stay possible
until the engine has soaked at full exposure.
