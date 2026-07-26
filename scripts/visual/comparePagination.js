/**
 * comparePagination — layout failures that pixels cannot report (§4.6).
 *
 * A pixel diff answers "does this page look different". It cannot answer the
 * questions a teacher actually cares about, because both of these produce a
 * *small* pixel difference on any given page:
 *
 *   - question 12 moved from page 2 to page 3
 *   - the diagram for question 4 is now on the page after the question
 *
 * The second one makes the paper unusable, and a percentage-based rule would
 * wave it through. So pagination is compared STRUCTURALLY: each fixture declares
 * semantic anchors — question numbers, diagram identifiers, marking-scheme answer
 * identifiers, sections — the renderer reports which page each landed on, and
 * this compares those maps.
 *
 * The report is then in the terms the owner asked for:
 *
 *   question_12 moved from page 2 to page 3
 *   diagram_4 separated from question_4
 *   answer_7 no longer shares a page with question_7
 *   unexpected blank page 5
 *
 * Every one of these is its own failure. None of them can be approved by a
 * pixel-tolerance rule, because none of them is a pixel question.
 *
 * Pure: takes two anchor maps, returns findings.
 */

/**
 * A page with no anchors on it that also carries almost no ink is a blank page.
 * The ink measure comes from the renderer; this only decides what to call it.
 */
export const BLANK_INK_FRACTION = 0.001

/**
 * Compare two layout maps.
 *
 * @param {object} baseline {pageCount, anchors: {id: page}, inkByPage: {page: fraction}}
 * @param {object} candidate the same
 * @param {object} [opts]
 * @param {Array<[string,string]>} [opts.together] pairs of anchor IDs that must
 *   share a page — [diagram, its question], [answer, its question]
 * @returns {{changed: boolean, pageCountChanged: boolean, findings: Array}}
 *   each finding: {kind, message, ...detail}
 */
export function comparePagination(baseline, candidate, opts = {}) {
  const findings = []
  const together = Array.isArray(opts.together) ? opts.together : []
  const out = { changed: false, pageCountChanged: false, findings }

  if (!baseline || !candidate) {
    findings.push({
      kind: 'unreadable',
      message: 'a layout map is missing, so pagination cannot be compared',
    })
    out.changed = true
    return out
  }

  // Page count first, and reported on its own. A pagination regression can move
  // very few pixels on any single page while adding a whole page to what a
  // school photocopies thirty times.
  const before = Number(baseline.pageCount) || 0
  const after = Number(candidate.pageCount) || 0
  if (before !== after) {
    out.pageCountChanged = true
    out.changed = true
    findings.push({
      kind: 'page_count',
      message: `the paper is now ${after} page${after === 1 ? '' : 's'} instead of ${before}`,
      before,
      after,
    })
  }

  const baseAnchors = baseline.anchors || {}
  const candAnchors = candidate.anchors || {}

  // An anchor that moved page.
  for (const [id, page] of Object.entries(baseAnchors)) {
    if (!(id in candAnchors)) {
      out.changed = true
      findings.push({
        kind: 'anchor_missing',
        message: `${id} is no longer on the paper at all`,
        id,
        before: page,
      })
      continue
    }
    if (candAnchors[id] !== page) {
      out.changed = true
      findings.push({
        kind: 'anchor_moved',
        message: `${id} moved from page ${page} to page ${candAnchors[id]}`,
        id,
        before: page,
        after: candAnchors[id],
      })
    }
  }
  for (const id of Object.keys(candAnchors)) {
    if (id in baseAnchors) continue
    out.changed = true
    findings.push({
      kind: 'anchor_added',
      message: `${id} appeared on the paper, on page ${candAnchors[id]}`,
      id,
      after: candAnchors[id],
    })
  }

  // Things that must stay together. Checked against the CANDIDATE only — this is
  // a standing requirement of the paper, not a comparison, so it fails even if
  // the baseline was already broken. A baseline is not a licence.
  for (const [a, b] of together) {
    const pa = candAnchors[a]
    const pb = candAnchors[b]
    if (pa == null || pb == null) continue
    if (pa !== pb) {
      out.changed = true
      findings.push({
        kind: 'separated',
        message: `${a} separated from ${b} — they are on pages ${pa} and ${pb}`,
        a,
        b,
        pages: [pa, pb],
      })
    }
  }

  // A trailing blank page. Also candidate-only: a blank last page wastes a sheet
  // per learner per paper, which in a Zambian school is the whole cost of the
  // exercise.
  const ink = candidate.inkByPage || {}
  const anchoredPages = new Set(Object.values(candAnchors))
  for (let page = 1; page <= after; page += 1) {
    if (anchoredPages.has(page)) continue
    const inked = Number(ink[page])
    if (Number.isFinite(inked) && inked > BLANK_INK_FRACTION) continue
    out.changed = true
    findings.push({
      kind: 'blank_page',
      message: `page ${page} is blank — nothing on the paper is on it`,
      page,
    })
  }

  return out
}

/** Findings grouped by kind, for a comparison summary a reviewer reads. */
export function paginationSummary(fixtureId, result) {
  if (!result || !result.findings.length) return `ok  ${fixtureId} pagination unchanged`
  return [`CHANGED  ${fixtureId} pagination`]
    .concat(result.findings.map((f) => `    ${f.kind}: ${f.message}`))
    .join('\n')
}
