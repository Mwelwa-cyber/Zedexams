/**
 * The invariant: a PUBLISHED past paper must have something a learner can
 * actually open.
 *
 * `publish()` already refuses to go live with no files (`if (!assets.length)`),
 * but nothing guarded the other direction — removing files afterwards. Taking
 * the last one off a published paper left it listed in the archive, readable
 * per the Firestore rules, and blank when a learner opened it.
 *
 * WHAT COUNTS AS "SOMETHING TO READ" — this is not `assets.length`, and the
 * difference is why the naive check is wrong in both directions:
 *
 *   - `pdfPath` is a LIVE legacy field, and it takes PRECEDENCE over `assets`
 *     in both readers (PastPaperViewer.jsx `buildPreview`, PastPaperPractice.jsx
 *     `pickPreviewSource`). A paper carrying one renders from it whether or not
 *     `assets` is empty, so an empty `assets` array is NOT by itself a broken
 *     paper. Treating it as one would unpublish working papers from the older
 *     archive.
 *
 *   - Both readers build the paper preview from assets with
 *     `role !== 'mark-scheme'`. A published paper whose only remaining asset is
 *     the mark scheme therefore has nothing to show as the PAPER — the same
 *     blank screen, reached by removing the second-to-last file rather than the
 *     last one. Counting raw length would allow exactly that removal.
 *
 * So the question this module answers is "would this removal leave a learner
 * with nothing?", not "how many rows are in the array?".
 *
 * Pure — no React, no Firebase. `scripts/test-published-paper-assets.mjs`
 * covers it, and `scripts/repair-published-papers-without-assets.mjs` reuses
 * `hasReadablePaperSource` so the repair and the guard cannot disagree about
 * what "broken" means.
 */

export const MARK_SCHEME_ROLE = 'mark-scheme'

export const PUBLISHED_STATUS = 'published'

/**
 * Shown when a removal is refused. Says what the rule is and offers the two
 * ways forward, because "you can't do that" without a route out is why people
 * reach for the console.
 *
 * Deliberately NOT paired with an automatic unpublish: flipping a paper off
 * the shelf as a side effect of a file removal is a state change the admin did
 * not ask for and would not see, which is worse than refusing the action.
 */
export const PUBLISHED_PAPER_NEEDS_A_FILE =
  'A published paper must have at least one file. Unpublish it first, or replace this file.'

/** Papers are published under exactly one status string; everything else is editable freely. */
export function isPublishedPaper(status) {
  return status === PUBLISHED_STATUS
}

/**
 * The assets a learner sees as THE PAPER. Mark schemes are deliberately
 * excluded — they render in their own slot, and a paper that is only a mark
 * scheme shows the learner a blank preview.
 *
 * An asset with no `role` counts: the field post-dates the first uploads, and
 * `splitAssetsByRole` in src/utils/pastPapers.js reads an absent role as the
 * paper itself.
 */
export function paperRoleAssets(assets) {
  if (!Array.isArray(assets)) return []
  return assets.filter((asset) => asset && asset.role !== MARK_SCHEME_ROLE)
}

/**
 * True when the paper has any source a reader would render.
 *
 * `pdfPath` is checked first because that is the order the readers check it
 * in — a non-empty string there is sufficient on its own.
 */
export function hasReadablePaperSource(paper) {
  if (!paper) return false
  if (typeof paper.pdfPath === 'string' && paper.pdfPath.length > 0) return true
  return paperRoleAssets(paper.assets).length > 0
}

/**
 * A published paper that nothing can render. This is the exact population the
 * repair script unpublishes, and the state the guard below exists to prevent
 * anyone reaching again.
 */
export function isPublishedWithoutReadableSource(paper) {
  if (!paper) return false
  return isPublishedPaper(paper.status) && !hasReadablePaperSource(paper)
}

/**
 * Decide whether asset `index` may be removed from `paper`.
 *
 * Answers the question by constructing the post-removal paper and asking
 * whether it would still render, rather than by counting — which is what keeps
 * the mark-scheme case and the `pdfPath` case correct without either being
 * special-cased here.
 *
 * A draft is never blocked: emptying a draft is how an admin replaces the
 * wrong upload, and `publish()` refuses an empty paper at the other end.
 *
 * @returns {{allowed: boolean, message: string}}
 */
export function canRemovePaperAsset(paper, index) {
  const assets = Array.isArray(paper?.assets) ? paper.assets : []
  if (!isPublishedPaper(paper?.status)) return { allowed: true, message: '' }

  const remaining = { ...paper, assets: assets.filter((_, i) => i !== index) }
  if (hasReadablePaperSource(remaining)) return { allowed: true, message: '' }

  return { allowed: false, message: PUBLISHED_PAPER_NEEDS_A_FILE }
}
