/**
 * Public surface of the Agents console — the internal "AI company" operations
 * UI at `/admin/agents`: the fleet dashboard, the `agentJobs` queue and its
 * approval flow, per-agent profiles, Cala's CBC-alignment verdicts, Vigil's
 * platform-health panel and Dawn's briefings.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 3, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same Firestore reads
 * and writes, same callables, same four routes.
 *
 * **This front door is deliberately empty**, and the surface map is unusually
 * clear about why. Thirty-odd places in the repo mention `/admin/agents` — the
 * admin nav, the settings registry, three panels that link to it, the agent
 * roster in `src/config/agents.js` — and **every one of them is a route
 * STRING, not an import**. The only module-level consumers are the four
 * `lazy(() => import(…))` mounts in App.jsx, three of which pull named exports
 * off `pages/AgentsHome.jsx`. Nothing outside composes with any component
 * here, so there is nothing to export.
 *
 * ── No `src/utils/` slice, and no `index.css` slice ─────────────────────
 *
 * This area imports NOTHING from `src/utils/`, which no other Phase 4 feature
 * has managed. It is styled entirely in Tailwind plus the global `theme-*`
 * utilities, so it has no stylesheet to carve out either. The migration is
 * therefore the fifteen files and the four route mounts, with nothing else to
 * decide.
 *
 * ── Firebase, and why this one is the clearest case for the move rule ───
 *
 * SIX components read Firestore directly — the dashboard, the queue, the job
 * detail, the bulk-acknowledge bar, the briefing panel and the health panel —
 * and two also call callables (`runDawnBriefing`, the platform-health probe).
 * §14.2 says a feature reaches data through `services/`.
 *
 * That is NOT fixed here, and this is the migration the standing Phase 4
 * policy was written for. Extracting six components' worth of Firestore calls
 * into a repository is not a move: it is a redesign of how this console loads
 * and refreshes, in the surface that approves agent output before it reaches
 * learners. It gets its own pull request, with its own diff and its own
 * review, on a tree where the file move has already landed and cannot be
 * confused with it.
 *
 * The collections it touches — `agentJobs` and `agentControl` — already have
 * emulator coverage, so §14.12 asks nothing of the move itself.
 */

export {}
