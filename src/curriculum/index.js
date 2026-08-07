/**
 * src/curriculum — the Curriculum Engine (docs/architecture.md §5).
 *
 * It sits beside `src/engines/`, not inside it, because everything else in the
 * product is downstream of it: which curriculum years exist, what each is
 * called, which subjects a level has, which topics a term covers, and which
 * outcome a question grounds on.
 *
 * The one hard rule (§14.4): the taxonomy has a single root —
 * `src/config/canonicalEducation.js`, with `src/config/educationLevels.js` as
 * its derived level registry. This directory holds RESOLUTION LOGIC over that
 * root and re-exports it through `catalog/`. It must never declare a second
 * grade, subject or curriculum registry; that duplication is what
 * `canonicalEducation.js` was written to end.
 *
 * A namespace marker, not a barrel — import the area (`src/curriculum/catalog`,
 * `src/curriculum/resolvers`). Only `catalog/` has content in Phase 1.
 */

export {}
