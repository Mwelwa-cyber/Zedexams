/**
 * Public surface of Zed — the learner study assistant: the floating launcher
 * on every signed-in page, the full-screen `/zed` conversation, and the report
 * control on each answer.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4).
 *
 * ── One export, and the chunk boundary is the reason ────────────────────
 *
 * `App.jsx` imports `ZedChatLauncher` EAGERLY — it renders on every signed-in
 * page, so it is main-bundle code by design. `ZedChat` itself (481 lines, plus
 * markdown rendering, speech and the streaming client) is `lazy()`-loaded by
 * the launcher and must stay that way.
 *
 * So the front door exports the launcher and nothing else. Adding `ZedChat` or
 * `ZedChatPage` here would put the whole assistant in the main bundle for
 * every learner who never opens it — importing any name from a feature
 * evaluates every module its index re-exports, which is the import-time
 * coupling MIGRATION_TEMPLATE.md documents. `ZedChatPage` is route-mounted
 * lazily under the Phase 1 exception.
 *
 * ── `useSpeech` did NOT come along ──────────────────────────────────────
 *
 * It sat in `components/ai/` but has a second consumer: `hooks/useQuizReadAloud`,
 * which is the quiz read-aloud path and has nothing to do with Zed. A util
 * travels when the feature is its only consumer, and it is not.
 *
 * It moved to `src/hooks/useSpeech.js` rather than staying put, because
 * `components/ai/` ceased to exist with this migration and the alternative was
 * a one-file directory named after the feature that had left it. `src/hooks/`
 * is where its other consumer already lives and where a browser-API hook
 * belongs; both callers reach it as shared infrastructure, so neither crosses
 * a feature boundary to get it.
 */

export { default as ZedChatLauncher } from './components/ZedChatLauncher'
