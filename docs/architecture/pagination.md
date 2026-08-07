# Scalable pagination & incremental loading

> Snapshot as of 2026-07-18 — verify before acting.

ZedExams must never load an entire Firestore collection, a large array, or an
unbounded result set into the browser. This document describes the shared
cursor-pagination system that enforces that, how to use it, and what is still
outstanding.

The rules, in one line: **load a small first page → show it immediately → load
more only on request → stable Firestore cursors → cache completed pages → dedup
active requests → drop stale responses.** No client-side slicing of a
full-collection download; no offset-based pagination.

---

## Shared infrastructure

### Pure logic (framework- and Firestore-agnostic)

| Module | Responsibility |
|--------|----------------|
| `src/utils/pagination/cursors.js` | page-size clamping, over-fetch (`pageSize+1`) end-of-results detection, id de-dup / merge, cursor fingerprints & per-page lock keys |
| `src/utils/pagination/queryKeys.js` | `createPaginationKey({ scope, tenant, curriculum facets, filters, search, sort, pageSize })` — a session identity where every result-affecting field is encoded |
| `src/utils/pagination/pageCache.js` | short-TTL cache of completed pages keyed `queryKey::cursorId`, built on the existing `MemoryCache` (TTL + LRU + in-flight dedup + never-cache-a-rejection) |

### Firestore binding

`src/utils/pagination/firestorePage.js` — `createFirestorePageFetcher(spec)`
turns a declarative spec (`db`, `path`, `where` constraints, `orderByFields`)
into the `fetchPage({ pageSize, cursor })` the hook drives. It always appends a
`documentId()` tiebreaker (matching the primary sort direction, so it reuses the
existing implicit `__name__` index ordering), over-fetches by one row, and hands
back the last **document snapshot** as the cursor so `startAfter(snapshot)`
resolves multi-field ordering exactly.

### React hooks

- `src/hooks/usePaginatedQuery.js` — the engine. Separate initial vs. next-page
  loading, request de-dup (shared in-flight promise per `queryKey+cursor`),
  stale-response protection (a page whose `queryKey` is no longer active is
  dropped), id de-dup on merge, reset-on-`queryKey`-change, end-of-results from
  the fetcher (never from a total count), optional page caching, unmount safety,
  and React Strict Mode safety (the double-invoke joins one in-flight read).
- `src/hooks/useInfiniteFirestoreQuery.js` — the same, plus an
  `IntersectionObserver` sentinel for infinite scroll with a manual Load-More
  fallback (`autoLoad` toggle).

### UI

`src/components/ui/PaginationFooter.jsx` — the shared list footer: Load-More
button, next-page spinner, next-page error + retry (existing items stay
visible), and an accessible (`aria-live`) end-of-results marker.

### Server-side guard

`functions/paginationCore.js` — pure, for any callable/HTTP list endpoint:
`clampPageSize` (hard server max 50), `resolveSort` (allow-list), and opaque,
optionally HMAC-signed **cursor tokens** bound to `(scope, sort, filters)`. A
cursor minted for a different tenant / collection / filter / sort / endpoint
version is rejected (`resolvePageRequest`). Wire new list callables through
`resolvePageRequest` before building the query.

---

## Page-size standards

Defined in `cursors.js` (`PAGE_SIZES`): mobile 15, tablet/desktop/learner
25–30, question bank 25, past papers 24, notifications 25, AI operations 20,
payments 25, audit logs 50. Hard client ceiling `MAX_PAGE_SIZE = 50`; the server
clamps independently.

## Usage

```jsx
const fetchPage = useMemo(() => createFirestorePageFetcher({
  db, path: 'assessments',
  constraints: [where('createdBy', '==', uid)],
  orderByFields: [{ field: 'createdAt', direction: 'desc' }],
}), [uid])

const queryKey = useMemo(() => createPaginationKey({
  scope: 'assessment-list', userId: uid,
  sortField: 'createdAt', sortDirection: 'desc', pageSize,
}), [uid, pageSize])

const { items, loadNextPage, hasNextPage, isInitialLoading,
        isLoadingNextPage, error, removeItem } =
  usePaginatedQuery({ queryKey, fetchPage, pageSize, enabled: Boolean(uid) })
```

Then render `<PaginationFooter … />`. Delete a row with `removeItem(id)` — no
refetch. Changing any filter/sort/search **must** change `queryKey`; the hook
resets the session automatically.

## Reference integration

`src/components/teacher/AssessmentList.jsx` — the teacher assessment library. Was
a single `getMyAssessments(uid)` capped at 300 docs (silent truncation for
prolific authors); now a 30-row first page + Load-More, cursor-based, with the
Test/Examination and Needs-review filters applied as client-side view narrowing
over loaded pages. No new index required (the `createdBy + createdAt DESC`
composite already exists and the `__name__ DESC` tiebreaker matches Firestore's
implicit ordering).

## Tests

- `src/utils/pagination/*.test.js` (node) — cursors, query keys, page cache
- `functions/paginationCore.test.js` (node) — clamp, sort allow-list, cursor
  token round-trip + tenant/sort/filter rejection + tamper detection
- `src/hooks/usePaginatedQuery.spec.jsx` / `useInfiniteFirestoreQuery.spec.jsx`
  (vitest) — first-page-once, append, duplicate-next-page blocked, id de-dup,
  reset-on-key-change, stale-response dropped, unmount safety, refresh no-dup,
  next-page-error preserves list, disabled gating, observer intersection

## Remaining work (audit backlog)

The shared system is in place and proven on one surface. The highest-risk
unbounded reads still to migrate (from the repo audit), roughly in priority
order:

1. `src/utils/questionBankImport.js` — whole-collection `getDocs` over `quizzes`
   / `aiGenerations` / `questionBank` plus per-doc subcollection fan-out (admin
   import; worst offender).
2. Unbounded real-time `onSnapshot` listeners on growing collections:
   `features/lessons/lib/firestore.js`, `features/notes/lib/firestore.js`,
   `utils/lessonMemoryService.js` — convert to a bounded first-page listener +
   paginated older pages (§17).
3. `features/announcements/components/AnnouncementBanner.jsx` — unbounded listener open for
   every visitor; bound with `limit()` + `where('active','==',true)`.
4. `features/announcements/pages/AnnouncementsAdmin.jsx`,
   `utils/adminCbcKbService.js` (pastPapers/approvedSyllabi), `utils/classes.js`,
   `utils/assignments.js`, `utils/classRecords.js`, `utils/attendanceService.js`
   — route through `usePaginatedQuery` / add `limit()`.

Already-disciplined (bounded) surfaces: `hooks/useFirestore.js` (explicit caps +
count aggregations), `utils/pastPapers.js` (index doc + SWR cache),
`contexts/NotificationContext.jsx` (already cursor-paginated — a candidate to
refactor onto the shared hook), admin user/payment/analytics lists.
