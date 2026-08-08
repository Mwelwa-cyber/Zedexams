/**
 * The curriculum Diagram Library (§4b).
 *
 * These are the figures a Zambian syllabus topic asks for by name — the
 * digestive system, a flowering plant, leaf structure, the heart, the water
 * cycle, a simple electric circuit. They are catalogue entries like every other
 * shape: `DIAGRAM_CATALOG` in `diagramCatalogCore.js` merges them in, so there
 * is still exactly ONE catalogue and one `getDiagram()`. They live in their own
 * file because they carry something the geometric shapes do not, and that
 * contract is what the tests here hold.
 *
 * ## One asset, three consumers
 *
 * Each entry stores:
 *   - the LINE ART, with no labels drawn into it;
 *   - LABEL ANCHORS — for every part, the point on the art the leader line
 *     touches and the box the label sits in, both normalised 0–1;
 *   - a WORD BANK, the part names.
 *
 * From those three, `renderCurriculumDiagram` draws either variant. The study
 * diagram names every part. The label-it exercise draws the same art with
 * numbered leader lines running to empty boxes, and the names appear only on
 * the teacher's answer page. Nothing is a second drawing of the first: a
 * correction to the art corrects both, and the numbering the learner writes
 * against is the numbering the answer page reads back.
 *
 * The same three fields are what the learner app's drag-the-label activity
 * needs (unlabelled art + box coordinates + the words to drag). That is why
 * the anchors are normalised rather than expressed in this file's viewBox: a
 * consumer that draws the art at a different size still knows where the boxes
 * go. Author once, use everywhere.
 *
 * ## Print rules are in the art, not in a note about the art
 *
 * Black-and-white line work, no solid fills (`#f4f4f4` at most, for a shade the
 * copier keeps), stroke weights that survive a third-generation photocopy, and
 * label boxes sized for a child's handwriting — 74 × 20 units, which is roughly
 * 18 mm at the size these print. `test:curriculum-diagrams` fails on a fill
 * that is neither `none` nor the one permitted grey.
 */

const INK = '#1c1612'
const SHADE = '#f4f4f4'

/** The one permitted non-`none` fill. Exported so the print test can assert it. */
export const DIAGRAM_SHADE = SHADE

/** Label boxes a Grade 4 hand can write inside, in viewBox units. */
export const LABEL_BOX = Object.freeze({ width: 74, height: 20 })

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/* ── The art ──────────────────────────────────────────────────────────────
 *
 * Each `art(ink)` returns the SVG body — no <svg> wrapper, no labels, no
 * leader lines. Schematic rather than anatomical: this is the drawing a
 * Zambian primary textbook prints, which is the drawing the learner is
 * examined on.
 */

const digestiveArt = (ink) => `
  <circle cx="170" cy="52" r="30" fill="none" stroke="${ink}" stroke-width="2"/>
  <path d="M158 66 Q170 74 182 66" fill="none" stroke="${ink}" stroke-width="2"/>
  <path d="M105 96 C 96 128 93 182 97 240 C 101 322 109 382 116 412 L 224 412
           C 231 382 239 322 243 240 C 247 182 244 128 235 96 Z"
        fill="none" stroke="${ink}" stroke-width="2"/>
  <line x1="162" y1="80" x2="162" y2="172" stroke="${ink}" stroke-width="1.8"/>
  <line x1="178" y1="80" x2="178" y2="168" stroke="${ink}" stroke-width="1.8"/>
  <path d="M162 172 C 134 178 118 198 123 224 C 128 250 154 260 174 247
           C 188 238 190 219 180 211 C 172 205 167 196 178 168 Z"
        fill="${SHADE}" stroke="${ink}" stroke-width="2"/>
  <path d="M190 166 C 218 162 238 172 241 187 C 243 199 227 208 207 206
           C 194 204 186 194 190 166 Z"
        fill="${SHADE}" stroke="${ink}" stroke-width="2"/>
  <path d="M214 366 L 214 272 Q 214 258 200 258 L 138 258 Q 124 258 124 272
           L 124 350 Q 124 366 139 366 L 172 366 L 172 398"
        fill="none" stroke="${ink}" stroke-width="2.4"/>
  <path d="M172 252 C 146 262 196 276 150 290 C 196 300 146 314 190 326
           C 146 336 196 348 160 358"
        fill="none" stroke="${ink}" stroke-width="1.8"/>
`

const floweringPlantArt = (ink) => `
  <line x1="150" y1="128" x2="150" y2="336" stroke="${ink}" stroke-width="2.6"/>
  <circle cx="150" cy="96" r="20" fill="${SHADE}" stroke="${ink}" stroke-width="2"/>
  <ellipse cx="150" cy="52" rx="20" ry="30" fill="none" stroke="${ink}" stroke-width="2"/>
  <ellipse cx="192" cy="80" rx="20" ry="30" fill="none" stroke="${ink}" stroke-width="2"
           transform="rotate(72 192 80)"/>
  <ellipse cx="176" cy="130" rx="20" ry="30" fill="none" stroke="${ink}" stroke-width="2"
           transform="rotate(144 176 130)"/>
  <ellipse cx="124" cy="130" rx="20" ry="30" fill="none" stroke="${ink}" stroke-width="2"
           transform="rotate(216 124 130)"/>
  <ellipse cx="108" cy="80" rx="20" ry="30" fill="none" stroke="${ink}" stroke-width="2"
           transform="rotate(288 108 80)"/>
  <path d="M150 214 C 118 196 88 208 82 240 C 108 258 138 246 150 214 Z"
        fill="none" stroke="${ink}" stroke-width="2"/>
  <line x1="150" y1="214" x2="92" y2="242" stroke="${ink}" stroke-width="1.2"/>
  <path d="M150 178 C 182 160 212 172 218 204 C 192 222 162 210 150 178 Z"
        fill="none" stroke="${ink}" stroke-width="2"/>
  <line x1="150" y1="178" x2="208" y2="206" stroke="${ink}" stroke-width="1.2"/>
  <path d="M150 336 L 108 386 M150 336 L 132 392 M150 336 L 168 392
           M150 336 L 192 386 M132 360 L 112 372 M168 360 L 188 372"
        fill="none" stroke="${ink}" stroke-width="1.8"/>
  <path d="M60 336 Q 150 322 240 336" fill="none" stroke="${ink}" stroke-width="1.2"
        stroke-dasharray="6 5"/>
`

const leafArt = (ink) => `
  <path d="M74 130 C 110 62 210 54 278 108 C 236 186 132 200 74 130 Z"
        fill="none" stroke="${ink}" stroke-width="2.2"/>
  <line x1="74" y1="130" x2="278" y2="108" stroke="${ink}" stroke-width="2"/>
  <path d="M112 122 L 128 84 M148 118 L 168 78 M186 114 L 206 78
           M222 112 L 240 84 M120 138 L 136 172 M158 134 L 176 174
           M196 130 L 212 168 M230 126 L 244 152"
        fill="none" stroke="${ink}" stroke-width="1.2"/>
  <line x1="26" y1="146" x2="74" y2="130" stroke="${ink}" stroke-width="3"/>
`

const heartArt = (ink) => `
  <path d="M160 300 C 96 250 62 208 62 162 C 62 118 92 90 128 90
           C 146 90 158 100 160 112 C 162 100 174 90 192 90
           C 228 90 258 118 258 162 C 258 208 224 250 160 300 Z"
        fill="none" stroke="${ink}" stroke-width="2.4"/>
  <line x1="160" y1="112" x2="160" y2="286" stroke="${ink}" stroke-width="2"/>
  <path d="M78 168 Q 160 152 244 168" fill="none" stroke="${ink}" stroke-width="2"/>
  <path d="M150 92 C 148 56 178 40 206 52" fill="none" stroke="${ink}" stroke-width="2.6"/>
  <path d="M170 92 C 170 62 190 52 206 58" fill="none" stroke="${ink}" stroke-width="2.6"/>
  <path d="M120 96 C 112 66 92 58 76 62" fill="none" stroke="${ink}" stroke-width="2.2"/>
  <path d="M104 200 L 118 214 M104 220 L 118 234" fill="none" stroke="${ink}" stroke-width="1.2"/>
  <path d="M202 200 L 216 214 M202 220 L 216 234" fill="none" stroke="${ink}" stroke-width="1.2"/>
`

const waterCycleArt = (ink) => `
  <circle cx="62" cy="52" r="22" fill="${SHADE}" stroke="${ink}" stroke-width="2"/>
  <path d="M62 20 L62 8 M62 96 L62 84 M30 52 L18 52 M106 52 L94 52
           M40 30 L32 22 M84 74 L92 82 M84 30 L92 22 M40 74 L32 82"
        fill="none" stroke="${ink}" stroke-width="1.6"/>
  <path d="M196 82 C 196 62 216 50 234 58 C 242 40 272 40 280 60
           C 302 60 306 88 286 94 L 200 94 C 186 94 186 84 196 82 Z"
        fill="none" stroke="${ink}" stroke-width="2.2"/>
  <path d="M212 108 L 204 130 M238 108 L 230 132 M264 108 L 256 130 M288 108 L 280 128"
        fill="none" stroke="${ink}" stroke-width="1.6"/>
  <path d="M20 250 L 150 250 L 150 286 L 20 286 Z" fill="${SHADE}" stroke="none"/>
  <path d="M20 250 Q 40 242 60 250 T 100 250 T 140 250" fill="none"
        stroke="${ink}" stroke-width="1.8"/>
  <path d="M20 266 Q 40 258 60 266 T 100 266 T 140 266" fill="none"
        stroke="${ink}" stroke-width="1.4"/>
  <path d="M150 286 L 260 286 L 330 176 L 400 286 Z" fill="none"
        stroke="${ink}" stroke-width="2.2"/>
  <path d="M330 176 L 306 232 L 268 286" fill="none" stroke="${ink}" stroke-width="1.4"/>
  <path d="M108 236 C 112 196 126 168 150 148" fill="none" stroke="${ink}" stroke-width="2"/>
  <polygon points="152,140 142,156 158,158" fill="${ink}"/>
  <path d="M300 268 C 250 282 210 284 176 280" fill="none" stroke="${ink}" stroke-width="2"/>
  <polygon points="166,278 182,272 180,286" fill="${ink}"/>
`

const circuitArt = (ink) => `
  <path d="M60 60 L 300 60 L 300 200 L 60 200 Z" fill="none" stroke="${ink}" stroke-width="2.2"/>
  <line x1="120" y1="60" x2="160" y2="60" stroke="#ffffff" stroke-width="7"/>
  <line x1="126" y1="46" x2="126" y2="74" stroke="${ink}" stroke-width="2.6"/>
  <line x1="138" y1="52" x2="138" y2="68" stroke="${ink}" stroke-width="2.6"/>
  <line x1="148" y1="46" x2="148" y2="74" stroke="${ink}" stroke-width="2.6"/>
  <line x1="158" y1="52" x2="158" y2="68" stroke="${ink}" stroke-width="2.6"/>
  <line x1="164" y1="200" x2="200" y2="200" stroke="#ffffff" stroke-width="7"/>
  <circle cx="182" cy="200" r="16" fill="none" stroke="${ink}" stroke-width="2.2"/>
  <line x1="171" y1="189" x2="193" y2="211" stroke="${ink}" stroke-width="1.6"/>
  <line x1="193" y1="189" x2="171" y2="211" stroke="${ink}" stroke-width="1.6"/>
  <line x1="300" y1="112" x2="300" y2="148" stroke="#ffffff" stroke-width="7"/>
  <circle cx="300" cy="112" r="3.5" fill="${ink}"/>
  <circle cx="300" cy="148" r="3.5" fill="${ink}"/>
  <line x1="300" y1="148" x2="324" y2="112" stroke="${ink}" stroke-width="2.4"/>
  <line x1="60" y1="112" x2="60" y2="148" stroke="#ffffff" stroke-width="7"/>
  <rect x="48" y="112" width="24" height="36" fill="none" stroke="${ink}" stroke-width="2.2"/>
`

/**
 * The library.
 *
 * `topics` is what makes a diagram PROPOSE itself: the runner matches the
 * teacher's topic/sub-topic against these strings, so "Digestive System" or
 * "Digestion in humans" both land on the same figure without the model getting
 * a say in which picture the paper carries.
 *
 * `boardArt` is the §4b simplification — the few lines a teacher can realistically
 * copy onto a chalkboard. An entry without one falls back to its full art,
 * which is honest: pretending a simplified version exists when it does not
 * would put an undrawable figure on a board-notes sheet.
 */
export const CURRICULUM_DIAGRAMS = Object.freeze({
  digestivesystem: {
    cat: 'Curriculum',
    name: 'Digestive system',
    curriculum: true,
    subjects: ['integrated_science', 'biology', 'science', 'environmental_science'],
    topics: ['digestive system', 'digestion', 'human digestive system', 'the digestive system',
      'digestion in humans', 'alimentary canal', 'food and digestion'],
    viewBox: { x: -120, y: 10, width: 520, height: 420 },
    art: digestiveArt,
    boardParts: ['mouth', 'stomach', 'small-intestine', 'large-intestine'],
    parts: [
      { id: 'mouth', name: 'mouth', at: [170, 72], box: [10, 50], side: 'left' },
      { id: 'oesophagus', name: 'oesophagus', at: [170, 130], box: [280, 108], side: 'right' },
      { id: 'liver', name: 'liver', at: [215, 185], box: [280, 168], side: 'right' },
      { id: 'stomach', name: 'stomach', at: [145, 215], box: [0, 200], side: 'left' },
      { id: 'small-intestine', name: 'small intestine', at: [168, 320], box: [-20, 330], side: 'left' },
      { id: 'large-intestine', name: 'large intestine', at: [214, 300], box: [280, 292], side: 'right' },
    ],
  },

  floweringplant: {
    cat: 'Curriculum',
    name: 'Flowering plant',
    curriculum: true,
    subjects: ['integrated_science', 'biology', 'science', 'environmental_science', 'agricultural_science'],
    topics: ['flowering plant', 'flowering plants', 'parts of a plant', 'parts of a flower',
      'plant parts', 'the flower', 'flowers', 'plants'],
    viewBox: { x: -110, y: 10, width: 500, height: 400 },
    art: floweringPlantArt,
    boardParts: ['flower', 'stem', 'leaf', 'roots'],
    parts: [
      { id: 'petal', name: 'petal', at: [140, 34], box: [0, 22], side: 'left' },
      { id: 'flower', name: 'flower', at: [150, 96], box: [260, 62], side: 'right' },
      { id: 'leaf', name: 'leaf', at: [110, 232], box: [-30, 246], side: 'left' },
      { id: 'stem', name: 'stem', at: [150, 284], box: [260, 272], side: 'right' },
      { id: 'roots', name: 'roots', at: [150, 378], box: [250, 368], side: 'right' },
    ],
  },

  leafstructure: {
    cat: 'Curriculum',
    name: 'Leaf structure',
    curriculum: true,
    subjects: ['integrated_science', 'biology', 'science', 'environmental_science', 'agricultural_science'],
    topics: ['leaf structure', 'the leaf', 'parts of a leaf', 'leaves', 'leaf'],
    viewBox: { x: -110, y: -10, width: 520, height: 290 },
    art: leafArt,
    boardParts: ['blade', 'midrib', 'petiole'],
    parts: [
      { id: 'blade', name: 'blade (lamina)', at: [212, 84], box: [300, 16], side: 'right' },
      { id: 'vein', name: 'vein', at: [158, 98], box: [-60, 16], side: 'left' },
      { id: 'midrib', name: 'midrib', at: [200, 116], box: [300, 200], side: 'right' },
      { id: 'petiole', name: 'petiole', at: [46, 140], box: [-90, 200], side: 'left' },
      { id: 'margin', name: 'margin', at: [250, 150], box: [300, 112], side: 'right' },
    ],
  },

  humanheart: {
    cat: 'Curriculum',
    name: 'The heart',
    curriculum: true,
    subjects: ['integrated_science', 'biology', 'science'],
    topics: ['the heart', 'heart', 'circulatory system', 'blood circulation', 'circulation',
      'the human heart', 'blood and circulation'],
    viewBox: { x: -120, y: 0, width: 540, height: 330 },
    art: heartArt,
    boardParts: ['right-atrium', 'left-atrium', 'right-ventricle', 'left-ventricle'],
    parts: [
      { id: 'aorta', name: 'aorta', at: [190, 58], box: [290, 18], side: 'right' },
      { id: 'vena-cava', name: 'vena cava', at: [96, 72], box: [-40, 28], side: 'left' },
      { id: 'right-atrium', name: 'right atrium', at: [110, 145], box: [-50, 132], side: 'left' },
      { id: 'left-atrium', name: 'left atrium', at: [212, 145], box: [290, 132], side: 'right' },
      { id: 'right-ventricle', name: 'right ventricle', at: [112, 232], box: [-60, 242], side: 'left' },
      { id: 'left-ventricle', name: 'left ventricle', at: [210, 232], box: [290, 242], side: 'right' },
    ],
  },

  watercycle: {
    cat: 'Curriculum',
    name: 'The water cycle',
    curriculum: true,
    subjects: ['integrated_science', 'science', 'social_studies', 'geography', 'environmental_science'],
    topics: ['water cycle', 'the water cycle', 'rainfall', 'weather and water', 'evaporation',
      'water in the environment', 'sources of water'],
    viewBox: { x: -130, y: -20, width: 660, height: 350 },
    art: waterCycleArt,
    boardParts: ['evaporation', 'condensation', 'precipitation'],
    parts: [
      { id: 'sun', name: 'the sun', at: [62, 52], box: [-120, 42], side: 'left' },
      { id: 'evaporation', name: 'evaporation', at: [124, 200], box: [-120, 196], side: 'left' },
      { id: 'condensation', name: 'condensation', at: [250, 66], box: [430, 20], side: 'right' },
      { id: 'precipitation', name: 'rain (precipitation)', at: [252, 120], box: [430, 108], side: 'right' },
      { id: 'collection', name: 'collection', at: [240, 276], box: [430, 266], side: 'right' },
    ],
  },

  simplecircuit: {
    cat: 'Curriculum',
    name: 'Simple electric circuit',
    curriculum: true,
    subjects: ['integrated_science', 'physics', 'science', 'technology_studies',
      'design_and_technology_studies'],
    topics: ['simple electric circuit', 'electric circuit', 'electricity', 'circuits',
      'electrical circuits', 'current electricity'],
    viewBox: { x: -120, y: -30, width: 580, height: 300 },
    art: circuitArt,
    boardParts: ['cell', 'bulb', 'switch'],
    parts: [
      { id: 'cell', name: 'cell (battery)', at: [142, 58], box: [10, -20], side: 'left' },
      { id: 'bulb', name: 'bulb', at: [182, 216], box: [300, 208], side: 'right' },
      { id: 'switch', name: 'switch', at: [312, 130], box: [360, 120], side: 'right' },
      { id: 'wire', name: 'wire', at: [60, 90], box: [-120, 80], side: 'left' },
      { id: 'resistor', name: 'resistor', at: [60, 130], box: [-120, 150], side: 'left' },
    ],
  },
})

/* ── Rendering ────────────────────────────────────────────────────────────── */

/**
 * Where a leader line touches a label box.
 *
 * The EDGE facing the art, never the centre — a line drawn to the middle of a
 * pill runs out from under the text and strikes through it, which is the defect
 * `figureLabelLayout` fixed for assessment figures. Same rule, same reason.
 */
function boxAttachPoint(box, side) {
  const midY = box[1] + LABEL_BOX.height / 2
  return side === 'left'
    ? { x: box[0] + LABEL_BOX.width, y: midY }
    : { x: box[0], y: midY }
}

/**
 * Draw a curriculum diagram.
 *
 * `mode`:
 *   'study'    — every part named (what the learner learns from).
 *   'label-it' — the same art, numbered leader lines, empty boxes. The names
 *                are NOT in this SVG at any strength: not as text, not as a
 *                title, not as an aria-label. A learner exercise whose answers
 *                are one "view source" away is not an exercise.
 *   'answer'   — the marking copy: numbers AND names, so the teacher reads the
 *                learner's sheet without re-deriving the numbering.
 *
 * `board` keeps only the parts a teacher can realistically copy onto a
 * chalkboard (§4b). An entry that declares no board subset keeps all of them,
 * which is honest: silently dropping labels nobody chose would leave a figure
 * the answer page still numbers.
 */
export function renderCurriculumDiagram(entry, { mode = 'study', ink = INK, board = false } = {}) {
  if (!entry || !entry.viewBox) return ''
  const vb = entry.viewBox
  const parts = visibleParts(entry, board)

  let out = entry.art(ink)

  parts.forEach((part) => {
    const attach = boxAttachPoint(part.box, part.side)
    out += `<line x1="${part.at[0]}" y1="${part.at[1]}" x2="${attach.x}" y2="${attach.y}"`
      + ` stroke="${ink}" stroke-width="1.1"/>`
      + `<circle cx="${part.at[0]}" cy="${part.at[1]}" r="2.6" fill="${ink}"/>`

    if (mode === 'label-it') {
      // `data-label-box` marks this rect as a write-in box rather than part of
      // the drawing — the circuit's resistor is a rect too, and a consumer
      // counting rectangles to find the exercise's boxes would count it.
      out += `<rect data-label-box="${part.number}" x="${part.box[0]}" y="${part.box[1]}"`
        + ` width="${LABEL_BOX.width}" height="${LABEL_BOX.height}" rx="3"`
        + ` fill="none" stroke="${ink}" stroke-width="1.2"/>`
        + `<text x="${part.box[0] + 6}" y="${part.box[1] + 15}"`
        + ` font-family="Lora,serif" font-size="12" font-weight="700" fill="${ink}">${part.number}.</text>`
    } else {
      // A label to the LEFT of the art grows leftwards, away from the drawing.
      // Anchored at `start` it would run back over the figure it names, which
      // is how a leader line ends up pointing at its own label's text.
      const label = mode === 'answer' ? `${part.number}. ${part.name}` : part.name
      const rightAligned = part.side === 'left'
      out += `<text x="${rightAligned ? part.box[0] + LABEL_BOX.width : part.box[0]}"`
        + ` y="${part.box[1] + 15}" font-family="Lora,serif" font-size="12"`
        + ` text-anchor="${rightAligned ? 'end' : 'start'}" fill="${ink}">${esc(label)}</text>`
    }
  })

  return `<svg viewBox="${vb.x} ${vb.y} ${vb.width} ${vb.height}"`
    + ` xmlns="http://www.w3.org/2000/svg" width="${vb.width}" role="img">${out}</svg>`
}

/** The parts one variant draws, numbered in authoring order. */
function visibleParts(entry, board) {
  const numbered = entry.parts.map((p, i) => ({ ...p, number: i + 1 }))
  if (!board || !Array.isArray(entry.boardParts) || entry.boardParts.length === 0) return numbered
  // Renumbered for the board copy: a learner copying four labels off a board
  // writes 1-4, not 1, 3, 5, 6.
  return numbered
    .filter((p) => entry.boardParts.includes(p.id))
    .map((p, i) => ({ ...p, number: i + 1 }))
}

/**
 * The label anchors, NORMALISED — the cross-consumer half of the asset contract.
 *
 * The learner app's drag-the-label activity draws this art at whatever size the
 * phone gives it, so a box position in this file's viewBox units would be
 * meaningless there. `x`/`y` is the point on the art the leader line touches;
 * `boxX`/`boxY` is the corner of the box, and `boxWidth`/`boxHeight` its size —
 * all as fractions of the rendered figure, so one asset serves teacher print,
 * worksheet/exam use and the app.
 */
export function diagramLabelAnchors(entry) {
  if (!entry || !entry.viewBox || !Array.isArray(entry.parts)) return []
  const { x: ox, y: oy, width, height } = entry.viewBox
  const round = (n) => Math.round(n * 1e4) / 1e4
  return entry.parts.map((p, i) => ({
    id: p.id,
    name: p.name,
    number: i + 1,
    x: round((p.at[0] - ox) / width),
    y: round((p.at[1] - oy) / height),
    boxX: round((p.box[0] - ox) / width),
    boxY: round((p.box[1] - oy) / height),
    boxWidth: round(LABEL_BOX.width / width),
    boxHeight: round(LABEL_BOX.height / height),
    side: p.side,
  }))
}

/** The word bank a label-it exercise prints under the figure, A–Z. */
export function diagramWordBank(entry, { board = false } = {}) {
  if (!entry || !Array.isArray(entry.parts)) return []
  // Alphabetical, deliberately: the authored order is the order the parts
  // appear on the art, and printing that order hands the learner the answer.
  return visibleParts(entry, board).map((p) => p.name).sort((a, b) => a.localeCompare(b))
}

/** number → name, for the teacher's answer page (§3.7). */
export function diagramAnswerKey(entry, { board = false } = {}) {
  if (!entry || !Array.isArray(entry.parts)) return []
  return visibleParts(entry, board).map((p) => ({ number: p.number, id: p.id, name: p.name }))
}

const normSubject = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '_')
const normText = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Propose the library diagram a topic asks for (§4b).
 *
 * Deterministic, and deliberately not the model's decision: "Topic = Digestive
 * System" must produce the digestive figure every time, not a picture the
 * generator felt like drawing. Returns null when nothing matches confidently —
 * a wrong figure on a printed handout is worse than no figure.
 *
 * The subject filter is a guard, not a requirement: a topic that names the
 * figure outright still matches when the subject is missing, because a saved
 * document does not always carry one.
 */
export function matchCurriculumDiagram({ topic, subtopic, subject } = {}) {
  const haystack = `${normText(topic)} ${normText(subtopic)}`.trim()
  if (!haystack) return null
  const subj = normSubject(subject)

  let best = null
  for (const [key, entry] of Object.entries(CURRICULUM_DIAGRAMS)) {
    if (subj && entry.subjects && !entry.subjects.includes(subj)) continue
    for (const candidate of entry.topics) {
      const needle = normText(candidate)
      if (!haystack.includes(needle)) continue
      // Longest match wins: "the digestive system" beats "digestion" when both
      // appear, and "parts of a flower" beats the bare "plants".
      if (!best || needle.length > best.matchedLength) {
        best = { key, entry, matched: candidate, matchedLength: needle.length }
      }
    }
  }
  return best ? { key: best.key, entry: best.entry, matched: best.matched } : null
}
