/**
 * Which teacher studios a teacher may still OPEN — the one declaration every
 * navigation surface asks before it renders a tile, a menu row, a quick-create
 * card, a usage bar or a cross-studio link.
 *
 * Two studios left the launch surface in 2026-08, for different reasons, and
 * the difference is the whole reason this file exists rather than a pair of
 * deletions:
 *
 *   • **Rubric Studio is RETIRED.** Four-level descriptor rubrics are not part
 *     of the Zambian curriculum or the school teaching file — teachers neither
 *     use them nor look for them. There is no flag: it is gone, and a flag
 *     would only be a switch nobody is ever going to flip.
 *
 *   • **Worksheet Studio is WITHDRAWN, not deleted.** Its picture-dependent
 *     output (tracing sheets, labelled diagrams, story-with-picture) cannot be
 *     generated reliably — the model mislabels diagrams, which is not
 *     acceptable in children's materials. It returns once the curated Diagram
 *     Library exists, so the module stays and the surface is gated on
 *     `settings/global.featureFlags.worksheetStudioEnabled` (default OFF,
 *     remotely toggleable). Flipping it on restores every entry point below —
 *     which is only true because no surface deletes its worksheet entry.
 *
 * **Nothing here touches saved documents.** A retired tool's documents stay in
 * My Library, open, render and export exactly as before; what they lose is the
 * paths back INTO the studio ("Generate similar", "Create worksheet from this
 * plan", editing the saved inputs). `retiredNoticeForTool` supplies the label
 * those documents carry so a teacher knows why the tool is not offered.
 *
 * Pure — no React, no Firebase — so `scripts/test-studio-availability.mjs`
 * runs it under plain `node` and the launcher's own pure core can call it.
 */

/**
 * @typedef {object} StudioAvailabilityDef
 * @property {string} tool        the tool id studios/library documents use
 * @property {string} route       the studio route that is no longer offered
 * @property {'retired'|'withdrawn'} status
 * @property {string|null} flag   featureFlags key that can restore it, or null
 * @property {string} notice      shown once, on the page the route redirects to
 * @property {string} libraryLabel  what a saved document of this tool is called
 */

/** The studios that are not on the launch surface, keyed by tool id. */
export const UNAVAILABLE_STUDIOS = Object.freeze({
  rubric: Object.freeze({
    tool: 'rubric',
    route: '/teacher/generate/rubric',
    status: 'retired',
    flag: null,
    notice: 'This tool is no longer available.',
    libraryLabel: 'Rubric (retired tool)',
  }),
  worksheet: Object.freeze({
    tool: 'worksheet',
    route: '/teacher/generate/worksheet',
    status: 'withdrawn',
    flag: 'worksheetStudioEnabled',
    notice: 'Worksheet Studio is being rebuilt and will return.',
    libraryLabel: 'Worksheet (tool returning soon)',
  }),
})

/** route → tool id, for the surfaces that only know a destination. */
const TOOL_BY_ROUTE = Object.freeze(
  Object.fromEntries(Object.values(UNAVAILABLE_STUDIOS).map((s) => [s.route, s.tool])),
)

/** Where a teacher lands when they open a route that is no longer offered. */
export const STUDIOS_LIST_ROUTE = '/teacher'

/** The query parameter carrying the notice to the studios list. */
export const RETIRED_NOTICE_PARAM = 'unavailable'

/**
 * The tool a destination opens, if it is one of the gated ones.
 * Tolerates a query string and a trailing slash, because the entry points
 * store `/teacher/generate/worksheet?grade=5` as readily as the bare path.
 */
export function gatedToolForRoute(to) {
  if (!to) return null
  const path = String(to).split('?')[0].split('#')[0].replace(/\/+$/, '')
  return TOOL_BY_ROUTE[path] || null
}

/**
 * May this studio be opened?
 *
 * `featureFlags` is `settings/global.featureFlags`; pass `undefined` when the
 * settings subscription is dead or has not resolved. Every gate here is
 * fail-CLOSED, so an unknown flag state hides a withdrawn studio rather than
 * flashing it — the failure mode of hiding a tool for a few frames is a tool
 * that appears late, and the other way round is a teacher landing in a studio
 * we know produces mislabelled material.
 *
 * A tool that is not gated at all is always available: this function answers
 * only for the two studios above, and must never become a general allow-list.
 */
export function isToolAvailable(tool, featureFlags) {
  const def = UNAVAILABLE_STUDIOS[tool]
  if (!def) return true
  if (!def.flag) return false
  return featureFlags?.[def.flag] === true
}

/** The same question, asked with a route instead of a tool id. */
export function isRouteAvailable(to, featureFlags) {
  const tool = gatedToolForRoute(to)
  return tool ? isToolAvailable(tool, featureFlags) : true
}

/**
 * Drop the entries of a navigation list whose destination is not available.
 * `key` names the field holding the destination — the surfaces disagree
 * (`to` on the nav configs and tiles, `route` on the studio registry), which
 * is exactly why this takes the field rather than guessing.
 */
export function filterAvailableEntries(items, featureFlags, key = 'to') {
  if (!Array.isArray(items)) return items
  return items.filter((item) => isRouteAvailable(item?.[key], featureFlags))
}

/**
 * The label a SAVED document of a gated tool carries in My Library, or null
 * when the tool is available and its documents need no explanation.
 */
export function retiredLabelForTool(tool, featureFlags) {
  if (isToolAvailable(tool, featureFlags)) return null
  return UNAVAILABLE_STUDIOS[tool]?.libraryLabel || null
}

/**
 * The one-line notice shown after a redirect away from a gated route.
 * Looked up by tool id, which is what the redirect puts in the URL.
 */
export function noticeForTool(tool) {
  return UNAVAILABLE_STUDIOS[tool]?.notice || null
}

/** The destination a gated route redirects to, notice included. */
export function redirectTargetForTool(tool) {
  return `${STUDIOS_LIST_ROUTE}?${RETIRED_NOTICE_PARAM}=${encodeURIComponent(tool)}`
}
