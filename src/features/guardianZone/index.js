/**
 * guardianZone — the parent/guardian area inside a learner's session.
 *
 * ── An empty front door, on purpose ─────────────────────────────────────
 *
 * `GuardianZonePage` is route-mounted lazily by App.jsx under the Phase 1
 * exception, so it is deliberately NOT exported: a page behind a front door
 * lands in the chunk of every consumer of that door, and this one pulls in the
 * learner dashboard hook, the Functions SDK and lucide.
 *
 * Nothing else is exported either, and that is the measured answer rather than
 * an oversight. The one thing another feature needs is the row that navigates
 * here from the learner's Settings — and that row is a `LinkRow`, a
 * learnerSettings primitive, rendered inside a learnerSettings panel. Putting
 * it here would have meant guardianZone importing learnerSettings so that
 * learnerSettings could import guardianZone back. It lives with the panel that
 * renders it; the only thing crossing the boundary is the URL string, which is
 * what a route is for.
 *
 * Same shape as `features/quiz`: three screens the router owns and no public
 * surface at all.
 */
export {}
