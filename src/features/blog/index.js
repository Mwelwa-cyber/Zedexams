/**
 * Public surface of the blog — the signed-out `/blog` index and `/blog/:slug`
 * post, built from markdown files under `content/blog/`.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4).
 *
 * **This front door is deliberately empty.** Both pages are route-mounted with
 * `lazy(() => import(…))` under the route-mount exception and nothing else in
 * the tree imports them.
 *
 * ── `blogPosts.js` travelled, and its Vite glob is the reason to check ──
 *
 * The two pages were its only consumers (`zedChat`'s `chatMarkdown` mentions
 * it in a COMMENT — a shared `marked.setOptions` note — which a `grep -l`
 * reports identically to an import; the difference is the whole finding).
 *
 * It carries `import.meta.glob('…/content/blog/*.md')`, resolved by Vite at
 * BUILD time against the importing file's own location. Moving the file
 * silently changes what that glob matches, and the failure mode is not an
 * error: an unmatched glob yields an empty record, so the blog index renders
 * with no posts and every `/blog/:slug` 404s, on a public SEO surface, with a
 * green build. The path was re-derived for the new depth and checked against
 * the real directory — six markdown files, same set as before.
 */

export {}
