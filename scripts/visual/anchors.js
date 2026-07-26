/**
 * anchors — turning a rendered page back into the paper's structure (§4.6).
 *
 * `comparePagination` compares two maps of "which page did this land on", and
 * this is where those maps come from. The requirement that shapes every decision
 * here is that the SAME extractor must work on both renderer families: a
 * Chromium PDF and a LibreOffice PDF of the same paper have nothing in common at
 * the file level, so anything that reads a renderer's internals would give two
 * incomparable maps and the structural check would quietly compare nothing.
 *
 * So an anchor is derived from what is ON the page:
 *
 *  - `question_N`  — the ascending run of numbered lines
 *  - `answer_N`    — an answer block, filed under the question it prints beneath
 *  - `section_a`   — a section heading
 *  - `marking_key` — the marking-key title
 *  - `header`      — the school header block
 *  - `diagram_N`   — a placed image, or failing that ink that no text explains
 *
 * That last one is the interesting one. A figure has no text to read, so it is
 * found first from the page's own image placements — which both families emit for
 * an embedded raster — and only then from ink no text accounts for. Both are
 * questions about the printed page rather than about the file, which is what makes
 * the two families comparable; the ink pass is the fallback because vector art
 * arrives as paths and places no image at all.
 *
 * Pure by design: everything here takes decoded pixels plus text and image
 * positions and returns plain data, so it is tested under plain `node` with no
 * renderer.
 */

/** Ink threshold. A pixel darker than this on any channel counts as ink. */
export const INK_LEVEL = 235

/** Grid cell for figure detection, in pixels at the suite's render dpi. */
export const FIGURE_CELL = 8

/**
 * Smallest thing we are willing to call a figure, in cells of ink.
 *
 * Line art is sparse, so this is an ink-quantity floor rather than an area: a
 * 30mm diagram of thin strokes may only darken a hundred cells.
 */
export const MIN_FIGURE_CELLS = 40

/**
 * A figure must be this many cells across AND down.
 *
 * This is the rule that separates a figure from the rest of the non-text ink on a
 * paper, and it took a real false positive to find. Ink-minus-text on a fractions
 * paper with no diagrams at all reported SEVEN figures: fraction bars, answer
 * rules, table borders and the school logo are all ink that no text explains.
 * Every one of them is thin in at least one direction — a rule is one cell tall,
 * a fraction bar one or two — while the smallest figure the paper is allowed to
 * print is 30mm ≈ 22 cells each way (`minFigureMm` in figureSizing.js).
 *
 * 12 cells (≈16mm) sits below that floor, so a figure slightly under the band
 * minimum is still SEEN — reporting it is the point — and well above anything
 * structural.
 */
export const MIN_FIGURE_EXTENT_CELLS = 12

/** Text bounding boxes are padded by this many pixels before being subtracted. */
export const TEXT_PAD = 2

/**
 * Ink clusters this close together are one figure, in cells.
 *
 * A line drawing is mostly white. LibreOffice draws a vector figure as paths, and
 * a protractor came back as TWO figures — its arc and its inner scale — because
 * eight-connectivity cannot join strokes separated by the figure's own white
 * space. That produced a `diagram_1.2` anchor for a paper with one figure, which
 * reads as an added anchor rather than as one drawing.
 *
 * 3 cells (24px ≈ 4mm) closes the gaps inside a figure and not the gap between
 * two figures: papers stack figures with question text between them, which is far
 * wider than this and is also text, so it is subtracted either way.
 */
export const FIGURE_MERGE_GAP_CELLS = 3

/** Lines within this many pixels vertically are the same line. */
export const LINE_TOLERANCE = 4

/**
 * Group text items into lines, top to bottom.
 *
 * Both renderers emit text in runs rather than in lines — a question number, its
 * text and its mark allocation arrive as separate items — so the leading token of
 * a LINE is only visible once the runs are reassembled.
 */
export function groupIntoLines(textItems = []) {
  const items = textItems
    .filter((i) => i && typeof i.text === 'string' && i.text.trim())
    .slice()
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const lines = []
  for (const item of items) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(item.y - last.y) <= LINE_TOLERANCE) {
      last.items.push(item)
      last.x = Math.min(last.x, item.x)
      continue
    }
    lines.push({ y: item.y, x: item.x, items: [item] })
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    // Joined with a space because a run boundary is a word boundary often enough
    // that concatenating produces "1.Simplify"; the patterns below allow for it.
    line.text = line.items.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim()
  }
  return lines
}

const MARKING_KEY = /\b(marking\s+key|marking\s+scheme|answer\s+key|marking\s+guide)\b/i
const SECTION = /^section\s+([a-z])\b/i
const NUMBERED = /^\(?(\d{1,2})\s*[.)]/
/**
 * The marking key's answer label, as the exporters actually print it.
 *
 * This rule replaced a wrong model of the document. The first version assumed one
 * paper containing a marking-key section, and renumbered everything after the
 * heading — so `answer_1` meant "the line numbered 1 after the heading". The
 * studio does not produce that document: `mode: 'scheme'` renders the WHOLE paper
 * again with an answer block under each question, which is why `answer_1` and
 * `question_1` are expected on the same page. Reading the label instead of
 * counting is also why the same rule works for both renderers.
 */
const ANSWER_LABEL = /^(answers?|correct\s+answers?|expected\s+answers?)\s*[:.]/i

/**
 * Label each line of a document with the anchor it establishes, if any.
 *
 * One walk over the whole document, in order, because two of the rules are
 * positional: an answer block belongs to the question it is printed under, and a
 * repeated question number is the same question rather than a new one. Both the
 * anchor map and the strict-region resolver read this, so the two cannot disagree
 * about which line `answer_3` is — they did while each carried its own copy of
 * the patterns.
 *
 * @param {Array} pages [{pageNumber, textItems}]
 * @returns {Array<{pageNumber, lines: Array<{y, x, text, items, anchor}>}>}
 */
export function labelDocumentLines(pages = []) {
  const seen = new Set()
  let currentQuestion = null
  // Question numbers are the ASCENDING RUN, and the run is sealed by the first
  // number that breaks it. A paper prints other numbered things — the four
  // numbered answer spaces under an identify-the-parts diagram restart at 1 — and
  // taking every "N." as a question read that fixture as four questions when it
  // has one, then filed its "Answers:" line under the last of them. So the run
  // must be contiguous from 1, and once broken no later number is a question.
  let expected = 1
  let sealed = false
  return pages.map((page) => ({
    pageNumber: page.pageNumber,
    lines: groupIntoLines(page.textItems).map((line) => {
      let anchor = null
      const numbered = NUMBERED.exec(line.text)
      if (MARKING_KEY.test(line.text)) {
        anchor = 'marking_key'
      } else if (SECTION.test(line.text)) {
        anchor = `section_${SECTION.exec(line.text)[1].toLowerCase()}`
      } else if (numbered) {
        if (!sealed && Number(numbered[1]) === expected) {
          currentQuestion = expected
          expected += 1
          anchor = `question_${currentQuestion}`
        } else {
          sealed = true
        }
      } else if (currentQuestion != null && ANSWER_LABEL.test(line.text)) {
        anchor = `answer_${currentQuestion}`
      }
      // Only the FIRST sighting counts. A question number printed again in a
      // running header would otherwise move the anchor to the last page it
      // appears on, and "question 3 is on page 4" would be true and useless.
      if (anchor && seen.has(anchor)) return { ...line, anchor: null }
      if (anchor) seen.add(anchor)
      return { ...line, anchor }
    }),
  }))
}

/** Which page each textual anchor landed on. */
export function extractTextAnchors(pages = []) {
  const anchors = {}
  for (const page of labelDocumentLines(pages)) {
    for (const line of page.lines) {
      if (line.anchor && !(line.anchor in anchors)) anchors[line.anchor] = page.pageNumber
    }
  }
  return anchors
}

/**
 * The school header block, which is only ever on page 1 — and whose ABSENCE is
 * the finding, so it is recorded as an anchor rather than assumed.
 */
export function extractHeaderAnchor(pages = [], { schoolName } = {}) {
  if (!schoolName) return {}
  const needle = String(schoolName).toLowerCase().replace(/\s+/g, ' ')
  for (const page of pages) {
    for (const line of groupIntoLines(page.textItems)) {
      if (line.text.toLowerCase().replace(/\s+/g, ' ').includes(needle)) {
        return { header: page.pageNumber }
      }
    }
  }
  return {}
}

/**
 * Ink coverage per page, as a fraction of the page area.
 *
 * `comparePagination` uses this to tell an unexpected blank page from a page that
 * is simply sparse, so it is measured rather than inferred from anchor counts: a
 * continuation page holding one long answer line has no anchors and is not blank.
 */
export function pageInk({ data, width, height }) {
  if (!data || !width || !height) return 0
  let ink = 0
  for (let i = 0; i < width * height; i += 1) {
    const p = i * 4
    // Transparent pixels are paper, not ink — a PNG from a canvas can carry
    // alpha, and treating a transparent pixel as dark would report every page
    // as solid ink.
    if (data[p + 3] < 8) continue
    if (data[p] < INK_LEVEL || data[p + 1] < INK_LEVEL || data[p + 2] < INK_LEVEL) ink += 1
  }
  return ink / (width * height)
}

/**
 * Ink that no text accounts for: the figures on a page.
 *
 * Coarse on purpose. The question is "is there a figure here, and where", not
 * "what does it look like" — the pixel comparator answers the second one. A
 * coarse grid also makes the answer stable across renderers, which is the whole
 * point: a hairline difference in how a stroke lands must not change which cell
 * it falls in often enough to move a figure's reported page.
 *
 * @returns {Array<{x, y, width, height, cells}>} boxes in page pixels, ordered
 *   top-to-bottom then left-to-right — reading order, so the Nth figure on the
 *   page is the Nth figure a teacher sees.
 */
export function detectFigures({ data, width, height, textItems = [], images = [] }) {
  // An image the renderer actually placed beats anything inferred from pixels, and
  // it is the only signal that survives a labelled figure: on a marking key the
  // answer labels sit ON the diagram and fragment its ink into pieces too small
  // to be a figure, so the learner copy would report a diagram and the marking
  // key would report none — the exact drift §4.3 exists to catch.
  const placed = (images || [])
    .filter((i) => i && i.width >= MIN_FIGURE_EXTENT_CELLS * FIGURE_CELL
      && i.height >= MIN_FIGURE_EXTENT_CELLS * FIGURE_CELL)
    .map((i) => ({
      x: Math.max(0, Math.round(i.x)),
      y: Math.max(0, Math.round(i.y)),
      width: Math.round(i.width),
      height: Math.round(i.height),
      cells: Math.round((i.width * i.height) / (FIGURE_CELL * FIGURE_CELL)),
      source: 'placement',
    }))
  if (placed.length) return placed.sort((a, b) => (a.y - b.y) || (a.x - b.x))

  if (!data || !width || !height) return []
  const cols = Math.ceil(width / FIGURE_CELL)
  const rows = Math.ceil(height / FIGURE_CELL)
  const cells = new Uint8Array(cols * rows)

  for (let y = 0; y < height; y += 1) {
    const rowBase = Math.floor(y / FIGURE_CELL) * cols
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4
      if (data[p + 3] < 8) continue
      if (data[p] < INK_LEVEL || data[p + 1] < INK_LEVEL || data[p + 2] < INK_LEVEL) {
        cells[rowBase + Math.floor(x / FIGURE_CELL)] = 1
      }
    }
  }

  // Subtract every cell a text run explains. Padded, because glyph antialiasing
  // and italic overhang put ink slightly outside the reported box, and a leftover
  // fringe of text cells is exactly what would be mistaken for a small figure.
  for (const item of textItems) {
    if (!item || !item.text || !item.text.trim()) continue
    const x0 = Math.floor((item.x - TEXT_PAD) / FIGURE_CELL)
    const x1 = Math.floor((item.x + (item.width || 0) + TEXT_PAD) / FIGURE_CELL)
    const y0 = Math.floor((item.y - (item.height || 0) - TEXT_PAD) / FIGURE_CELL)
    const y1 = Math.floor((item.y + TEXT_PAD) / FIGURE_CELL)
    for (let r = Math.max(0, y0); r <= Math.min(rows - 1, y1); r += 1) {
      for (let c = Math.max(0, x0); c <= Math.min(cols - 1, x1); c += 1) cells[r * cols + c] = 0
    }
  }

  const seen = new Uint8Array(cols * rows)
  const clusters = []
  for (let start = 0; start < cells.length; start += 1) {
    if (!cells[start] || seen[start]) continue
    seen[start] = 1
    const stack = [start]
    let minC = cols; let maxC = -1; let minR = rows; let maxR = -1; let count = 0
    while (stack.length) {
      const idx = stack.pop()
      const c = idx % cols
      const r = (idx - c) / cols
      count += 1
      if (c < minC) minC = c
      if (c > maxC) maxC = c
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      // Eight-neighbour, for the same reason the pixel comparator uses it: a
      // diagonal leader line is diagonally connected, and four-connectivity
      // would split one figure into several.
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (!dr && !dc) continue
          const nr = r + dr; const nc = c + dc
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
          const n = nr * cols + nc
          if (!cells[n] || seen[n]) continue
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    // Kept even when small: a fragment of a figure is merged below, and only the
    // MERGED cluster is measured against the floors. Filtering here would discard
    // the very pieces that make one figure whole.
    clusters.push({ minC, maxC, minR, maxR, count })
  }

  // Merge clusters that are near each other, then measure. A figure's own white
  // space fragments it, so the floors have to apply to the drawing rather than to
  // whichever piece of it happened to be walked first.
  const merged = mergeNearbyClusters(clusters)
  const boxes = []
  for (const cluster of merged) {
    if (cluster.count < MIN_FIGURE_CELLS) continue
    const across = cluster.maxC - cluster.minC + 1
    const down = cluster.maxR - cluster.minR + 1
    if (across < MIN_FIGURE_EXTENT_CELLS || down < MIN_FIGURE_EXTENT_CELLS) continue
    boxes.push({
      x: cluster.minC * FIGURE_CELL,
      y: cluster.minR * FIGURE_CELL,
      width: across * FIGURE_CELL,
      height: down * FIGURE_CELL,
      cells: cluster.count,
      source: 'ink',
    })
  }
  return boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x))
}

/**
 * Merge clusters whose bounding boxes are within the merge gap of each other.
 *
 * Repeated until nothing changes, because merging two clusters can bring a third
 * within range — a chain of strokes across a figure is exactly that case, and one
 * pass would leave it in pieces.
 */
export function mergeNearbyClusters(clusters, gap = FIGURE_MERGE_GAP_CELLS) {
  const out = clusters.map((c) => ({ ...c }))
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < out.length && !changed; i += 1) {
      for (let j = i + 1; j < out.length && !changed; j += 1) {
        const a = out[i]
        const b = out[j]
        const near = a.minC - gap <= b.maxC && b.minC - gap <= a.maxC
          && a.minR - gap <= b.maxR && b.minR - gap <= a.maxR
        if (!near) continue
        out[i] = {
          minC: Math.min(a.minC, b.minC),
          maxC: Math.max(a.maxC, b.maxC),
          minR: Math.min(a.minR, b.minR),
          maxR: Math.max(a.maxR, b.maxR),
          // Summed, not recomputed: the ink quantity of the whole drawing is the
          // ink of its parts, and the white space between them is not ink.
          count: a.count + b.count,
        }
        out.splice(j, 1)
        changed = true
      }
    }
  }
  return out
}

/**
 * The complete layout map for one render, in the shape `comparePagination` takes.
 *
 * @param {Array} pages [{pageNumber, width, height, data, textItems}]
 * @param {object} [opts] {schoolName}
 * @returns {{pageCount, anchors, inkByPage, figureBoxes}}
 */
export function buildLayoutMap(pages = [], opts = {}) {
  const labelled = labelDocumentLines(pages)
  const anchors = {}
  const lineAnchors = {}
  for (const page of labelled) {
    lineAnchors[page.pageNumber] = page.lines
    for (const line of page.lines) {
      if (line.anchor && !(line.anchor in anchors)) anchors[line.anchor] = page.pageNumber
    }
  }
  Object.assign(anchors, extractHeaderAnchor(pages, opts))

  const inkByPage = {}
  const figureBoxes = {}
  // A figure is named after the QUESTION it belongs to, not its position in the
  // document. `diagram_2` means "question 2's diagram", which is what makes
  // `together: [['diagram_2', 'question_2']]` mean anything — and it is what the
  // fixtures already say. Numbering figures 1, 2, 3 in document order looked
  // equivalent and was not: a fixture whose only figure belongs to question 2 got
  // `diagram_1`, and the togetherness check it declared had nothing to check.
  let currentQuestion = null
  for (const page of pages) {
    inkByPage[page.pageNumber] = pageInk(page)
    const boxes = detectFigures(page)
    figureBoxes[page.pageNumber] = boxes
    const questionLines = (lineAnchors[page.pageNumber] || [])
      .filter((line) => /^question_\d+$/.test(line.anchor || ''))
      .map((line) => ({ y: line.y, number: Number(line.anchor.slice('question_'.length)) }))
    for (const box of boxes) {
      // The question in force where the figure sits: the last question heading
      // above it, carried across the page break when a figure starts a page.
      for (const q of questionLines) if (q.y <= box.y + box.height) currentQuestion = q.number
      if (currentQuestion == null) continue
      let id = `diagram_${currentQuestion}`
      // A second figure under one question is given its own ID rather than being
      // folded into the first — an unexpected ID is reported as an added anchor,
      // whereas a collapsed one would be reported as nothing.
      let suffix = 2
      while (id in anchors) { id = `diagram_${currentQuestion}.${suffix}`; suffix += 1 }
      anchors[id] = page.pageNumber
      box.anchor = id
    }
  }
  return { pageCount: pages.length, anchors, inkByPage, figureBoxes, lineAnchors }
}

/**
 * The anchors a fixture's own declarations say this copy must contain.
 *
 * Mode-aware, because the two copies of a paper legitimately differ: `answer_N`
 * exists only in the marking key, so expecting it on the learner copy would fail
 * a correct render — and NOT expecting it on the marking key would let the
 * togetherness check pass by having nothing to check.
 */
export function expectedAnchorsFor(fixture, mode) {
  const ids = new Map()
  for (const region of fixture.regions || []) if (region?.anchor) ids.set(region.anchor, true)
  for (const pair of fixture.together || []) for (const id of pair) ids.set(id, true)
  // A fixture may also state which page an anchor belongs on. That is a stronger
  // claim than existence and is kept as the declared page, so a fixture saying
  // "question 7 is on page 2" is checked rather than merely counted.
  for (const [id, page] of Object.entries(fixture.expectedAnchorPages || {})) ids.set(id, page)
  const scheme = mode === 'scheme'
  const out = {}
  for (const [id, value] of ids) {
    if (!scheme && id.startsWith('answer_')) continue
    out[id] = value
  }
  return out
}

/**
 * Anchors whose page differs from the page the fixture declared.
 *
 * `assertRenderComplete` checks that a declared anchor EXISTS; this checks where
 * it landed, which is the claim a fixture with `expectedAnchorPages` is actually
 * making. Reported as findings rather than thrown, because a moved anchor is a
 * pagination result — the kind a reviewer looks at diffs for — and not a broken
 * render.
 */
export function declaredPageMismatches(expected = {}, anchors = {}) {
  const out = []
  for (const [id, page] of Object.entries(expected)) {
    if (page === true) continue
    const actual = anchors[id]
    if (actual != null && Number(actual) !== Number(page)) {
      out.push({ id, declared: Number(page), actual: Number(actual) })
    }
  }
  return out
}

/**
 * Resolve a fixture's declared strict regions to pixel rectangles on one page.
 *
 * A fixture says "the maths is at question_1"; the comparator needs a rectangle.
 * The rectangle is the anchor's own line down to whatever comes next, across the
 * text column — that is the area the anchor's content actually occupies, and it
 * is derived from this render rather than stored, because a region recorded as
 * fixed pixels would still be pointing at question 1 after question 1 moved.
 *
 * A declared region this render cannot place is reported as `unresolved` rather
 * than dropped. Dropping it would mean the fixture's maths region is no longer
 * being held to the strict cluster limit while the fixture still says it is —
 * the suite would report green having quietly stopped checking.
 *
 * @param {Array} declared [{type, anchor}] from the fixture
 * @param {object} page {pageNumber, width, height, textItems}
 * @param {object} layout the map from buildLayoutMap, whose `lineAnchors` carry
 *   the document-wide labelling — passing the page alone would re-derive it from
 *   one page and get the positional rules wrong.
 * @returns {{regions: Array<{x, y, width, height, type, anchor}>, unresolved: string[]}}
 */
export function resolveStrictRegions(declared = [], page, layout = {}) {
  const regions = []
  const unresolved = []
  if (!page) return { regions, unresolved: declared.map((r) => r?.anchor).filter(Boolean) }
  const lines = (layout.lineAnchors || {})[page.pageNumber] || groupIntoLines(page.textItems)
  const figures = (layout.figureBoxes || {})[page.pageNumber] || []

  for (const region of declared) {
    const id = region?.anchor
    if (!id) continue
    // An anchor on another page is not unresolved — it is simply not on this one.
    if ((layout.anchors || {})[id] !== page.pageNumber) continue

    const figure = figures.find((f) => f.anchor === id)
    if (figure) {
      regions.push({ ...pad(figure, page), type: region.type, anchor: id })
      continue
    }
    if (id === 'header') {
      // The header block runs from the top of the page to the first numbered
      // line — there is no heading text common to every school to search for.
      const firstNumbered = lines.find((line) => NUMBERED.test(line.text))
      const bottom = firstNumbered
        ? firstNumbered.y - (firstNumbered.items[0].height || 12)
        : page.height
      regions.push({
        x: 0, y: 0, width: page.width, height: Math.max(1, Math.round(bottom)),
        type: region.type, anchor: id,
      })
      continue
    }
    const index = lines.findIndex((line) => line.anchor === id)
    if (index === -1) {
      unresolved.push(id)
      continue
    }
    const top = lines[index].y - (lines[index].items[0].height || 12)
    const next = lines[index + 1]
    const bottom = next ? next.y - (next.items[0].height || 12) : page.height
    regions.push({
      x: 0,
      y: Math.max(0, Math.round(top)),
      width: page.width,
      height: Math.max(1, Math.round(bottom - top)),
      type: region.type,
      anchor: id,
    })
  }
  return { regions, unresolved }
}

/** A figure's strict region includes a margin, because labels sit outside it. */
function pad(box, page) {
  const m = FIGURE_CELL * 2
  const x = Math.max(0, box.x - m)
  const y = Math.max(0, box.y - m)
  return {
    x,
    y,
    width: Math.min(page.width - x, box.width + m * 2),
    height: Math.min(page.height - y, box.height + m * 2),
  }
}

