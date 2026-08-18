/**
 * The localStorage keys the past-paper surfaces share.
 *
 * The hub writes a bookmark and the viewer toggles the same one; before this
 * module the hub held `BOOKMARK_KEY` and the viewer repeated the literal
 * `'zx_paper_bookmarks'` inline, with a comment explaining that it "mirrors the
 * hub's list". A mirror maintained by comment is a mirror that breaks silently:
 * renaming the key on one side loses every learner's saved papers on the other,
 * and nothing fails.
 *
 * `zx_recent_papers` is additionally READ outside this feature — the learner
 * home's Continue Reading block reads it through
 * `shared/utils/paperResumeStorage`. So the value is a data contract with
 * devices in the field, not an implementation detail: changing a string here
 * forgets what learners already have.
 */

/** Paper ids the learner has bookmarked. Written by the hub and the viewer. */
export const PAPER_BOOKMARKS_KEY = 'zx_paper_bookmarks'

/** Paper ids most recently opened, newest first. Read by learner home. */
export const RECENT_PAPERS_KEY = 'zx_recent_papers'
