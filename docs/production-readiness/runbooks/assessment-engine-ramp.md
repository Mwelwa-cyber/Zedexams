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

## 2. Past-paper first, on a ramp

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
