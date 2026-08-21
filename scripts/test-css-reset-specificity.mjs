/**
 * A design system's element reset must carry ZERO specificity
 * ==========================================================
 *
 * Both learner design systems scope a reset to their root class — `.lhx` in
 * `shared/styles/learnerTheme.css`, `.pq` in the past-paper quiz — so that a
 * <button> inside them starts from `background: none; border: 0` instead of
 * the browser's grey chrome. Nearly every surface in both systems IS a
 * <button>: the answer options, the mode cards, the start button, the review
 * grid's cells, the icon buttons, the chips.
 *
 * Written as `.pq button` that reset scores one class + one type, which
 * OUTRANKS every single-class component rule in the same file. `.pq-cta`,
 * `.pq-mode`, `.pq-opt`, `.pq-icon-btn`, `.pq-flag-btn`, `.pq-nav-btn` and
 * `.pq-cell` therefore lost their `background` and their `border` to the
 * reset, and the cascade said nothing, because a declaration losing is not
 * an error.
 *
 * What that looked like in the product (reported 2026-08-21, on the ECZ Grade
 * 7 English paper): "Start the exam" rendered transparent with dark text and a
 * coral glow cast by a fill that was never painted; the four answer options
 * rendered as bare text rows with no card and no outline, so choosing one
 * changed a background sitting behind a border of zero width; "Flag" lost its
 * pill. Only the two-class rules survived, so the damage read as
 * inconsistency rather than as breakage — `.pq-nav-btn.is-primary` was indigo
 * while `.pq-nav-btn` beside it was transparent.
 *
 * `.lhx` had it right (`:where(.lhx) :where(button)`) and `.pq` did not, which
 * is the whole reason this is a guard rather than a one-line fix: the two
 * files are written to read as one product, and the form that breaks is the
 * one that looks more normal.
 *
 * A zero-specificity author rule still beats the user-agent stylesheet, since
 * origin outranks specificity — so `:where()` costs the reset nothing.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let checks = 0
const ok = (actual, expected, what) => { assert.deepEqual(actual, expected, what); checks += 1 }

/**
 * Specificity as [ids, classes, types], enough for the selectors these two
 * files actually use.
 *
 * `:where()` contributes nothing — including its arguments, which is the whole
 * point of it. `:is()` / `:not()` contribute the highest specificity among
 * their arguments. Everything else is counted the ordinary way.
 */
export function specificity(selector) {
  let s = String(selector).trim()
  const total = [0, 0, 0]
  const add = (v) => { total[0] += v[0]; total[1] += v[1]; total[2] += v[2] }
  const max = (a, b) => (a[0] !== b[0] ? (a[0] > b[0] ? a : b) : a[1] !== b[1] ? (a[1] > b[1] ? a : b) : a[2] >= b[2] ? a : b)

  // Pull out the functional pseudo-classes first, innermost-last, so their
  // arguments are never counted by the flat scan below.
  const FUNCTIONAL = /:(where|is|not|has)\(/
  let guard = 0
  while (FUNCTIONAL.test(s)) {
    if ((guard += 1) > 200) throw new Error(`runaway selector parse: ${selector}`)
    const m = FUNCTIONAL.exec(s)
    const name = m[1]
    // Find the matching close paren for this open paren.
    let depth = 0
    let end = -1
    for (let i = m.index + m[0].length - 1; i < s.length; i += 1) {
      if (s[i] === '(') depth += 1
      else if (s[i] === ')') { depth -= 1; if (depth === 0) { end = i; break } }
    }
    if (end === -1) throw new Error(`unbalanced parens: ${selector}`)
    const args = s.slice(m.index + m[0].length, end)
    if (name !== 'where') {
      add(args.split(',').map((a) => specificity(a)).reduce(max, [0, 0, 0]))
    }
    s = `${s.slice(0, m.index)} ${s.slice(end + 1)}`
  }

  add([(s.match(/#[\w-]+/g) || []).length, 0, 0])
  // Classes, attribute selectors and non-functional pseudo-classes.
  const classLike = (s.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) || []).length
  add([0, classLike, 0])
  // Type selectors and pseudo-elements. Strip everything already counted, then
  // read the bare names that remain.
  const stripped = s
    .replace(/\.[\w-]+/g, ' ')
    .replace(/#[\w-]+/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/(?<!:):(?!:)[\w-]+/g, ' ')
  const types = (stripped.match(/::[\w-]+|(?<![\w-])[a-zA-Z][\w-]*/g) || []).length
  add([0, 0, types])
  return total
}

/* ── 1. The checker can tell the two forms apart ───────────────────────────
 *
 * Without this arm the guard could be a rule that passes because it measures
 * nothing. The broken form is the one that shipped; the fixed form is what
 * both files carry now.
 */
ok(specificity('.pq button'), [0, 1, 1], 'the form that shipped outranks a single class')
ok(specificity(':where(.pq) :where(button)'), [0, 0, 0], 'the fixed form outranks nothing')
ok(specificity('.pq-cta'), [0, 1, 0], 'a component class is one class')
ok(specificity('.pq-nav-btn.is-primary'), [0, 2, 0], 'the two-class rules that survived')
ok(specificity('.pq-mode[aria-pressed="true"]'), [0, 2, 0], 'an attribute counts as a class')
// `html[data-theme='night'] body` is (0,1,2) and beats `body.theme-midnight`'s
// (0,1,1); the trailing ` .pq` adds a class.
ok(specificity(":is(body.theme-midnight, html[data-theme='night'] body) .pq"),
  [0, 2, 2], ':is() takes the highest of its arguments')
assert.ok(
  specificity('.pq button')[1] * 10 + specificity('.pq button')[2]
    > specificity('.pq-cta')[1] * 10 + specificity('.pq-cta')[2],
  'the broken reset really does outrank the button it paints over',
)
checks += 1

/* ── 2. The real stylesheets ───────────────────────────────────────────── */

/**
 * The roots of the two learner design systems. A rule scoped to one of these
 * and ending in a bare element name matches EVERY such element in the system,
 * which is what makes it a reset rather than a component rule — `.lhx-lbl-
 * actions button` styles one component's buttons and is none of this guard's
 * business.
 */
const SYSTEMS = [
  { root: 'lhx', file: 'src/shared/styles/learnerTheme.css' },
  { root: 'pq', file: 'src/features/papers/quiz/paperQuiz.css' },
]

for (const { root, file } of SYSTEMS) {
  const css = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const rules = []
  postcss.parse(css).walkRules((rule) => {
    for (const raw of rule.selectors) {
      // Strip `:where()` wrappers to see the SHAPE, then ask whether what is
      // left is "the root, then a bare element name".
      const shape = raw.replace(/:where\(([^()]*)\)/g, '$1').trim()
      if (new RegExp(`^\\.${root}\\s+[a-zA-Z][\\w-]*(\\s*,\\s*[a-zA-Z][\\w-]*)*$`).test(shape)) {
        rules.push({ raw, decls: rule.nodes.filter((n) => n.type === 'decl').map((n) => n.prop) })
      }
    }
  })

  assert.ok(rules.length > 0, `${file}: found no element reset scoped to .${root} — has the root been renamed?`)
  checks += 1

  for (const { raw, decls } of rules) {
    ok(specificity(raw), [0, 0, 0],
      `${file}: the reset \`${raw}\` must carry zero specificity, or it silently strips `
      + `${decls.join('/')} from every single-class component rule in the file`)
  }
}

/**
 * And the surfaces the bug actually removed are still asked for by name. If a
 * later cleanup deletes `.pq-cta { background }` instead of restoring the
 * cascade, the reset guard above would still pass and the button would still
 * be invisible.
 */
const pq = fs.readFileSync(path.join(ROOT, 'src/features/papers/quiz/paperQuiz.css'), 'utf8')
const painted = {}
postcss.parse(pq).walkRules((rule) => {
  for (const sel of rule.selectors) {
    rule.walkDecls((d) => {
      if (d.prop === 'background' || d.prop === 'border') (painted[sel] ||= new Set()).add(d.prop)
    })
  }
})
for (const [sel, prop] of [
  ['.pq-cta', 'background'],       // "Start the exam"
  ['.pq-opt', 'background'],       // an answer option's card
  ['.pq-opt', 'border'],           // and its outline, which the chosen state colours
  ['.pq-mode', 'background'],      // Exam / Practice
  ['.pq-icon-btn', 'background'],
  ['.pq-flag-btn', 'background'],
  ['.pq-nav-btn', 'background'],   // Back, beside the primary that never broke
  ['.pq-cell', 'background'],      // the review grid
]) {
  assert.ok(painted[sel]?.has(prop), `paperQuiz.css: ${sel} must still declare a ${prop}`)
  checks += 1
}

console.log(`css reset specificity: ${checks} checks passed`)
