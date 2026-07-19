# 10 — Performance & Scalability

> Snapshot as of 2026-07-19. Layer 11. Finding IDs: `PERF-*`.

## Verdict

Client performance engineering is **strong** — a hand-tuned lazy bundle, 157 code-split routes,
sharded high-frequency counters, and cron-recomputed global stats that avoid write hotspots. The
scaling risk is not raw throughput; it is **structural**: admin views cap at 200 rows, and the
core data model has no `schoolId`, so multi-school aggregation is impossible without a schema
rollout (see [`05`](./05-data-and-firestore.md) DATA-001).

## Strengths (evidence)

- **Bundle** — `vite.config.js:393-500` isolates `pdfjs`/`firebase-firestore`/`react-vendor`/
  `posthog`/`sentry`/`docx-vendor`/`pdf-vendor`/`capacitor-vendor`; per-chunk budgets; 157
  `lazy()` routes.
- **Region placement** — 89 `us-central1` (HTTP/callable), 12 `africa-south1` (Firestore triggers),
  matching the Eventarc contract; memory tiers 256 MiB–2 GiB, sensible.
- **No write hotspots** — sharded AI counters; cron'd `publicStats`; per-user locks.
- **Indexes** — leaderboard/results/library/pagination all covered.

## Scale-degradation estimate (bottleneck-by-population, grounded in the caps above)

| Population | State | First bottleneck |
|---|---|---|
| **~100** | No degradation | — |
| **~1,000** | Fine | A busy class approaching `MAX_LEARNERS_PER_CLASS=200` sees write contention on the single class doc during a signup rush (DATA-003) |
| **~10,000** | Admin views break first | `ADMIN_QUERY_LIMIT=200` (DATA-002) hides surplus learners/results; server cursor pagination built but unwired |
| **~100,000 / multi-school** | Hard bottleneck | `schoolId`-less data model (DATA-001) — no per-school query/aggregation path; global `questionBank` + per-teacher `classes` islands don't partition. Secondary: `onSnapshot`-heavy admin dashboards; client `html2canvas` export on low-end Android |

*Numbers are population bands, not certified capacities — the bottleneck reasoning is the point.*

## Findings

### PERF-001 — Admin list ceiling (200 rows) breaks at ~10k users
- **Severity:** Medium · **Confidence:** High confidence
- Same root as DATA-002. Wire `functions/paginationCore.js` into admin callables.
- **Launch blocker:** No (small deployments). **Complexity:** Medium.

### PERF-002 — `schoolId`-less model is the multi-school scaling wall
- **Severity:** High (for multi-school) · **Confidence:** High confidence
- Same root as DATA-001. **Launch blocker:** Yes before selling to multi-teacher schools.

### PERF-003 — Class-doc write contention during signup bursts
- **Severity:** Medium · **Confidence:** High confidence
- Same root as DATA-003 (in-doc roster array, ~1 write/sec/doc). Move roster to a subcollection.

### PERF-004 — Client-side PDF/Word export is CPU-heavy on low-end Android
- **Severity:** Low–Medium · **Confidence:** Moderate confidence
- **Affected:** `src/utils/htmlToPdf.js` (`html2canvas` + `jsPDF`), `assessmentToDocx.js` — DOM
  rasterization in-browser, loaded lazily (`pdf-vendor` chunk).
- **Current:** Heavy on the low-end devices typical of the market, but device-side (not server cost)
  and correctly lazy. Assessment exports now also have a server-side branded export pipeline.
- **Correction:** Consider server-side export for large papers on low-end devices. **Blocker:** No.

### PERF-005 — No `minInstances`/concurrency tuning on heavy AI callables (cold starts)
- **Severity:** Low · **Confidence:** Moderate confidence
- **Affected:** generator callables — no `minInstances`; Anthropic-streaming functions cold-start.
- **Current:** Latency cost at low traffic, not a correctness issue.
- **Correction:** Set `minInstances`/`concurrency` on the hottest generators once traffic warrants.
- **Launch blocker:** No.

### PERF-006 — Cosmetic memory-unit inconsistency
- **Severity:** Informational · one `memory:"256MB"` and one `"128MiB"` vs the `MiB` standard. Trivial.

## Cross-references
- Data-model root cause: [`05-data-and-firestore.md`](./05-data-and-firestore.md).
