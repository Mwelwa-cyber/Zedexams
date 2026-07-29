/**
 * The mathematics notation contract — one definition, three consumers.
 *
 * Part of the shared assessment package (see ../README.md). Environment-neutral:
 * no React, no DOM, no Firebase, no docx.
 *
 * ## What this is
 *
 * The generator is told to write mathematics as printable markup rather than as
 * ASCII: `\frac{a}{b}` for a fraction, `c\frac{a}{b}` for a mixed number,
 * `$…$` for other inline maths, and a `[[vmath …]]` token for a column sum.
 * Three separate things then depend on that agreement:
 *
 *   1. the PROMPT, which asks the model for it;
 *   2. the SERVER VALIDATOR, which has to notice when the model ignored the ask;
 *   3. the CLIENT CONVERTER, which turns the markup into editor nodes.
 *
 * Before this file the agreement existed only as prose inside the prompt, so
 * the validator did not exist at all and the converter's idea of the contract
 * was whatever `importRichText.js` happened to parse. A rule stated in one
 * place and depended on in three is a rule that drifts.
 *
 * ## Why the prompt is TESTED against this rather than generated from it
 *
 * Cloud Functions is CommonJS and this package is ESM, and the prompt is a
 * module-level `const` string, so it cannot `await import()` anything. Rather
 * than fork the contract to get a synchronous copy — the exact failure this
 * file prevents — the prompt keeps its prose and `mathsNotationMirror.test.js`
 * asserts that every rule declared here is actually stated in it. Same idiom
 * the repo already uses for the paper-terminology and Play-catalogue mirrors.
 *
 * ## The line this module will not cross
 *
 * Repair is mechanical, never interpretive. `x^2` and `sqrt(49)` have exactly
 * one reading in a school paper and are rewritten on sight. A bare `a/b` does
 * NOT: "3/5" is a fraction, a ratio, a date and a range, and the generator
 * emits all four. It is repaired only where the surrounding text has already
 * proved the context is fractional, and reported otherwise. Getting that
 * backwards turns a ratio question into a fraction question silently, across
 * a whole generated paper, with nobody watching.
 */

/* ------------------------------------------------------------------ *
 * 1. The forms the model may emit
 * ------------------------------------------------------------------ */

/**
 * Every markup form in the contract, with the rule the prompt must state and
 * the node it converts to. `promptRule` is what the mirror test looks for.
 */
export const NOTATION_FORMS = Object.freeze([
  Object.freeze({
    id: 'fraction',
    markup: '\\frac{a}{b}',
    becomes: 'a stacked fraction (mathFraction)',
    promptRule: /\\+frac\{a\}\{b\}/,
  }),
  Object.freeze({
    id: 'mixedNumber',
    markup: 'c\\frac{a}{b}',
    becomes: 'a mixed number — whole number beside a stacked fraction',
    promptRule: /c\\+frac\{a\}\{b\}/,
  }),
  Object.freeze({
    id: 'inlineMath',
    markup: '$…$',
    becomes: 'an inline maths node (KaTeX)',
    promptRule: /dollar signs?/i,
  }),
  Object.freeze({
    id: 'verticalArithmetic',
    markup: '[[vmath op=… lines=… answer=…]]',
    becomes: 'a column calculation (verticalArithmetic)',
    promptRule: /\[\[vmath\b/,
  }),
])

export const NOTATION_FORM_IDS = Object.freeze(NOTATION_FORMS.map((f) => f.id))

/**
 * Every operator a `[[vmath]]` token may carry.
 *
 * Addition and subtraction were the only ones the prompt's prose named, while
 * the token and the editor node have always accepted all four. A Grade 5
 * long-multiplication paper is set out in columns exactly like an addition, so
 * the omission read as "multiplication cannot be a column sum".
 */
export const VMATH_OPERATORS = Object.freeze(['+', '-', '×', '÷'])

/* ------------------------------------------------------------------ *
 * 2. The fields the forms may appear in
 * ------------------------------------------------------------------ */

/**
 * Every field of a generated question that may carry mathematics, and must
 * therefore be converted on the way into the studio.
 *
 * This list IS the §2 audit. `aiPaperToSections.js` is tested against it, so a
 * field added to the generator schema without a conversion route fails a test
 * rather than delivering `\frac{3}{5}` to a teacher as literal text.
 *
 * `inline` fields are single-value (an option, an answer) and take the inline
 * converter; `block` fields may hold paragraphs, tables and column sums.
 */
export const NOTATION_FIELDS = Object.freeze([
  Object.freeze({ path: 'prompt', kind: 'block', what: 'question text' }),
  Object.freeze({ path: 'options[]', kind: 'inline', what: 'multiple-choice options' }),
  Object.freeze({ path: 'answer', kind: 'inline', what: 'the expected answer' }),
  Object.freeze({ path: 'markingGuide', kind: 'block', what: 'the marking guide' }),
  Object.freeze({ path: 'parts[].text', kind: 'block', what: 'a sub-question part' }),
  Object.freeze({ path: 'parts[].answer', kind: 'inline', what: "a sub-question part's answer" }),
  Object.freeze({ path: 'statements[].text', kind: 'inline', what: 'a fill-in-the-blank statement' }),
  Object.freeze({ path: 'statements[].answers[]', kind: 'inline', what: 'a fill-in-the-blank answer' }),
  Object.freeze({ path: 'wordBank[]', kind: 'inline', what: 'a word-bank entry' }),
  Object.freeze({ path: 'passage.text', kind: 'block', what: 'a passage or stimulus' }),
  Object.freeze({ path: 'solution', kind: 'block', what: 'a worked solution' }),
])

export const NOTATION_FIELD_PATHS = Object.freeze(NOTATION_FIELDS.map((f) => f.path))

/* ------------------------------------------------------------------ *
 * 3. Detection — computer-style mathematics that broke the contract
 * ------------------------------------------------------------------ */

/**
 * `x^2`, `10^-3`. `^` carries no other meaning in a school paper, so this is
 * unambiguous — but only OUTSIDE `$…$`, where it is already correct.
 */
const POWER_RE = /(?<![\w^])([A-Za-z0-9)\]]+)\^(-?\d+|\{[^{}]{1,12}\})/g

/** `sqrt(49)`, `sqrt 49`. A function name with exactly one reading. */
const SQRT_RE = /\bsqrt\s*(?:\(([^()]{1,24})\)|(\d+(?:\.\d+)?))/gi

/** `2 3/7`. A date, a ratio and a range never carry a leading whole number. */
const MIXED_RE = /(?<![\w.])(\d{1,4})\s+(\d{1,4})\/(\d{1,4})(?![\w/]|\.\d)/g

/** A bare `a/b` — reported, and repaired only in a proven fractional context. */
const BARE_FRACTION_RE = /(?<![\w./])(\d{1,4})\/(\d{1,4})(?![\w/]|\.\d)/g

/**
 * A LaTeX command sitting outside any `$…$` and outside `\frac`, which the
 * contract allows bare. `\sqrt{49}` written without dollars renders as the
 * literal characters, which is the "raw LaTeX visible as text" failure.
 */
const UNWRAPPED_LATEX_RE = /\\(?!frac\b)([a-zA-Z]{2,12})\b/g

/** `[[vmath` that never closes, or closes without the operands it needs. */
const VMATH_TOKEN_RE = /\[\[\s*vmath\b([^\]]*)\]\]/gi
const VMATH_OPEN_RE = /\[\[\s*vmath\b/gi

/**
 * Two or more lines of digits followed by a rule of dashes — a column sum the
 * model drew in ASCII instead of emitting as a token. It prints as monospace
 * rubble on an A4 page.
 */
const ASCII_COLUMN_RE = /^[ \t]*[-+×÷*x]?[ \t]*\d[\d ,]*[ \t]*$\n^[ \t]*[-+×÷*x]?[ \t]*\d[\d ,]*[ \t]*$\n^[ \t]*[-_=]{3,}[ \t]*$/m

/** Spans of a string that are already inside `$…$` and so out of scope. */
function dollarSpans(text) {
  const spans = []
  const re = /\$[^$\n]+\$/g
  let m
  while ((m = re.exec(text)) !== null) spans.push([m.index, m.index + m[0].length])
  return spans
}

function inSpans(index, spans) {
  return spans.some(([start, end]) => index >= start && index < end)
}

/**
 * Does the surrounding text prove a bare `a/b` is a FRACTION rather than a
 * ratio, a date or a range?
 *
 * Deliberately narrow. It asks for a word that only appears when fractions are
 * the subject, and refuses when a competing reading is named — "ratio",
 * "scale", "odds" — because a question can say "fraction" and "ratio" in the
 * same breath and then neither of us knows.
 */
const FRACTION_CONTEXT_RE = /\b(fraction|fractions|numerator|denominator|lowest terms|simplest form|improper|mixed number|proper fraction)\b/i
const COMPETING_CONTEXT_RE = /\b(ratio|ratios|scale|odds|proportion of \d|date|dated|per|out of \d)\b/i

export function bareFractionIsSafeToRepair(text) {
  const s = String(text || '')
  if (COMPETING_CONTEXT_RE.test(s)) return false
  return FRACTION_CONTEXT_RE.test(s)
}

/**
 * Every contract violation in one field's text.
 *
 * Returns `{ violations: [{ code, sample, repairable }], ok }`. Codes are
 * stable strings so a generation's compliance can be counted over time without
 * parsing prose.
 */
export function detectNotationViolations(text) {
  const s = String(text ?? '')
  const violations = []
  if (!s) return { ok: true, violations }

  const spans = dollarSpans(s)
  const push = (code, sample, repairable) => {
    violations.push({ code, sample: String(sample).slice(0, 60), repairable })
  }

  let m
  POWER_RE.lastIndex = 0
  while ((m = POWER_RE.exec(s)) !== null) {
    if (!inSpans(m.index, spans)) push('POWER_ASCII', m[0], true)
  }

  SQRT_RE.lastIndex = 0
  while ((m = SQRT_RE.exec(s)) !== null) {
    if (!inSpans(m.index, spans)) push('SQRT_ASCII', m[0], true)
  }

  MIXED_RE.lastIndex = 0
  while ((m = MIXED_RE.exec(s)) !== null) {
    if (!inSpans(m.index, spans)) push('MIXED_NUMBER_ASCII', m[0], true)
  }

  // Bare fractions, minus the ones already claimed by a mixed number.
  const mixedSpans = []
  MIXED_RE.lastIndex = 0
  while ((m = MIXED_RE.exec(s)) !== null) mixedSpans.push([m.index, m.index + m[0].length])
  BARE_FRACTION_RE.lastIndex = 0
  while ((m = BARE_FRACTION_RE.exec(s)) !== null) {
    if (inSpans(m.index, spans) || inSpans(m.index, mixedSpans)) continue
    push('FRACTION_ASCII', m[0], bareFractionIsSafeToRepair(s))
  }

  UNWRAPPED_LATEX_RE.lastIndex = 0
  while ((m = UNWRAPPED_LATEX_RE.exec(s)) !== null) {
    if (!inSpans(m.index, spans)) push('LATEX_UNWRAPPED', m[0], true)
  }

  // A [[vmath opener with no well-formed token at the same place.
  const wellFormed = []
  VMATH_TOKEN_RE.lastIndex = 0
  while ((m = VMATH_TOKEN_RE.exec(s)) !== null) {
    const body = m[1] || ''
    if (!/\blines\s*=/.test(body)) push('VMATH_MALFORMED', m[0], false)
    else wellFormed.push(m.index)
  }
  VMATH_OPEN_RE.lastIndex = 0
  while ((m = VMATH_OPEN_RE.exec(s)) !== null) {
    if (!wellFormed.includes(m.index) && !s.slice(m.index).match(/^\[\[\s*vmath\b[^\]]*\]\]/i)) {
      push('VMATH_UNCLOSED', s.slice(m.index, m.index + 40), false)
    }
  }

  if (ASCII_COLUMN_RE.test(s)) push('ASCII_COLUMN_SUM', 'a column sum drawn in text', false)

  return { ok: violations.length === 0, violations }
}

/* ------------------------------------------------------------------ *
 * 4. Repair — mechanical only
 * ------------------------------------------------------------------ */

/**
 * Rewrite the violations that have exactly one reading into contract markup.
 *
 * Returns `{ text, repaired, remaining }` — `remaining` being the violations
 * this refused to touch, which is what decides whether a corrective model call
 * is worth making.
 *
 * Order matters: mixed numbers before bare fractions (so `2 3/7` is not read as
 * a whole number beside a separate fraction), and both before the LaTeX
 * wrapper (so a `\frac` this pass emits is not then re-wrapped in dollars).
 */
export function repairNotation(text) {
  let s = String(text ?? '')
  if (!s) return { text: s, repaired: 0, remaining: [] }

  let repaired = 0
  const spans = () => dollarSpans(s)

  // `2 3/7` → `2\frac{3}{7}`
  s = s.replace(MIXED_RE, (whole, w, num, den, offset) => {
    if (inSpans(offset, spans()) || Number(den) === 0) return whole
    repaired += 1
    return `${w}\\frac{${num}}{${den}}`
  })

  // `sqrt(49)` → `$\sqrt{49}$`
  s = s.replace(SQRT_RE, (whole, paren, bare, offset) => {
    if (inSpans(offset, spans())) return whole
    const operand = paren ?? bare ?? ''
    if (!operand) return whole
    repaired += 1
    return `$\\sqrt{${operand}}$`
  })

  // `x^2` → `$x^{2}$`
  s = s.replace(POWER_RE, (whole, base, exp, offset) => {
    if (inSpans(offset, spans())) return whole
    const exponent = exp.startsWith('{') ? exp.slice(1, -1) : exp
    repaired += 1
    return `$${base}^{${exponent}}$`
  })

  // A bare `a/b`, ONLY where the text has proved it is a fraction.
  if (bareFractionIsSafeToRepair(s)) {
    s = s.replace(BARE_FRACTION_RE, (whole, num, den, offset) => {
      if (inSpans(offset, spans()) || Number(den) === 0) return whole
      repaired += 1
      return `\\frac{${num}}{${den}}`
    })
  }

  // A bare LaTeX command outside dollars → wrapped, so it renders instead of
  // printing as its own source. `\frac` is exempt: the contract allows it bare.
  s = s.replace(/\\(?!frac\b)([a-zA-Z]{2,12})(\{[^{}]{0,24}\})?/g, (whole, name, arg, offset) => {
    if (inSpans(offset, dollarSpans(s))) return whole
    repaired += 1
    return `$\\${name}${arg || ''}$`
  })

  const { violations } = detectNotationViolations(s)
  return { text: s, repaired, remaining: violations }
}

/* ------------------------------------------------------------------ *
 * 5. The plain-text floor
 * ------------------------------------------------------------------ */

const GREEK = Object.freeze({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ',
  mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω', Delta: 'Δ',
  Sigma: 'Σ', Omega: 'Ω', Pi: 'Π',
})
const OPERATORS = Object.freeze({
  times: '×', div: '÷', cdot: '·', pm: '±', leq: '≤', geq: '≥', neq: '≠',
  approx: '≈', infty: '∞', degree: '°', circ: '°',
})
const SUPERSCRIPTS = Object.freeze({
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻',
})

/**
 * The last resort: mathematically correct, readable, unformatted text.
 *
 * Used when detection, repair and the single corrective call have all failed.
 * The rule it implements is that a teacher may be shown UNFORMATTED
 * mathematics, but never raw markup — `\frac{3}{5}` on the page is a defect a
 * teacher has to repair by hand, whereas "3/5" is merely plain.
 *
 * This is deliberately NOT the converter. The converter's job is to make
 * markup beautiful; this one's job is to make sure a failure is still legible.
 */
export function toPlainMathsText(text) {
  let s = String(text ?? '')
  if (!s) return ''

  // [[vmath …]] → the linear sum it represents, so a broken token still reads.
  s = s.replace(VMATH_TOKEN_RE, (whole, body) => {
    const lines = /\blines\s*=\s*("[^"]*"|'[^']*'|[^\s\]]+)/.exec(body || '')
    const op = /\b(?:op|operator)\s*=\s*("[^"]*"|'[^']*'|[^\s\]]+)/.exec(body || '')
    const answer = /\banswer\s*=\s*("[^"]*"|'[^']*'|[^\s\]]+)/.exec(body || '')
    const unquote = (v) => String(v || '').replace(/^["']|["']$/g, '')
    const operands = unquote(lines && lines[1]).split(',').map((x) => x.trim()).filter(Boolean)
    if (!operands.length) return ''
    const glyph = ({ '-': '−', '*': '×', x: '×', X: '×', '/': '÷' })[unquote(op && op[1])]
      || unquote(op && op[1]) || '+'
    const sum = operands.join(` ${glyph} `)
    const ans = unquote(answer && answer[1])
    return ans ? `${sum} = ${ans}` : sum
  })

  // 2\frac{3}{7} → 2 3/7, then a bare \frac{3}{5} → 3/5.
  //
  // Two passes rather than one optional group: `(\d+)?\s*\\frac` also consumes
  // the SPACE before a fraction that has no whole number, so "Calculate
  // \frac{3}{5}" came out as "Calculate3/5" — a word joined to a number, which
  // is worse than the markup it replaced.
  s = s.replace(/(\d+)[ \t]*\\frac\{([^{}]*)\}\{([^{}]*)\}/g,
    (whole, w, num, den) => `${w} ${num}/${den}`)
  s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')

  // \sqrt{49} → √49 ; \sqrt[3]{8} → ∛8
  s = s.replace(/\\sqrt\[3\]\{([^{}]*)\}/g, '∛$1')
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, '√$1')

  // x^{2} / x^2 → x²
  s = s.replace(/\^\{?(-?\d+)\}?/g, (whole, exp) =>
    String(exp).split('').map((c) => SUPERSCRIPTS[c] ?? c).join(''))

  // Named symbols → their character.
  s = s.replace(/\\([a-zA-Z]+)/g, (whole, name) =>
    GREEK[name] ?? OPERATORS[name] ?? name)

  // The delimiters themselves are machinery, not content.
  s = s.replace(/\$/g, '')
  s = s.replace(/[{}]/g, '')

  return s.replace(/[ \t]{2,}/g, ' ').trim()
}

/* ------------------------------------------------------------------ *
 * 6. Whole-question compliance
 * ------------------------------------------------------------------ */

/** Read a field path like `parts[].answer` off a question object. */
function readFieldValues(question, path) {
  const out = []
  const walk = (node, segments) => {
    if (node == null) return
    if (segments.length === 0) {
      if (typeof node === 'string') out.push(node)
      return
    }
    const [head, ...rest] = segments
    if (head === '[]') {
      if (Array.isArray(node)) node.forEach((item) => walk(item, rest))
      return
    }
    if (typeof node !== 'object') return
    walk(node[head], rest)
  }
  walk(question, path.split(/\.|(\[\])/).filter(Boolean))
  return out
}

/**
 * Check every contract-bearing field of one generated question.
 *
 * Returns `{ ok, fields: [{ path, violations }] }`. Only fields that are
 * actually present are reported, so a question with no sub-parts is not
 * "missing" anything.
 */
export function checkQuestionNotation(question) {
  const fields = []
  for (const field of NOTATION_FIELDS) {
    for (const value of readFieldValues(question, field.path)) {
      const { violations } = detectNotationViolations(value)
      if (violations.length) fields.push({ path: field.path, violations })
    }
  }
  return { ok: fields.length === 0, fields }
}

/* ------------------------------------------------------------------ *
 * 7. The way back — editor nodes to contract markup
 * ------------------------------------------------------------------ */

const ATTR = (html, name) => {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(html)
  return m ? m[1] : ''
}

/**
 * Turn the editor's node HTML back into the markup the contract declares.
 *
 * Needed because mathematics travels BOTH ways. A teacher saves a question to
 * the Master Bank as structured nodes; sourcing it back into a new paper hands
 * it to code that expects the generator's markup. The bank mapper stripped tags
 * to get plain text — and a stacked fraction keeps its digits in ATTRIBUTES, so
 * stripping tags did not flatten `3/5`, it deleted it. "Calculate 3/5 + 1/4"
 * came back as "Calculate  + ", and a question whose ANSWER was a fraction was
 * dropped from sourcing entirely, because the mapper reads an empty answer as
 * an unusable question.
 *
 * Emitting markup rather than plain text is what closes the loop: the studio's
 * converter turns it straight back into the same nodes, so a bank question
 * round-trips instead of degrading a little on each pass.
 */
export function nodeHtmlToNotationMarkup(html) {
  let s = String(html ?? '')
  if (!s || !/<|&lt;/.test(s)) return s

  // Stacked fraction / mixed number.
  s = s.replace(/<span\b[^>]*(?:class="[^"]*math-frac[^"]*"|data-math-fraction)[^>]*>\s*<\/span>/gi,
      (tag) => {
        const whole = ATTR(tag, 'data-whole')
        const num = ATTR(tag, 'data-num') || ATTR(tag, 'data-numerator')
        const den = ATTR(tag, 'data-den') || ATTR(tag, 'data-denominator')
        if (!num || !den) return ''
        return `${whole ? whole : ''}\\frac{${num}}{${den}}`
      })

  // Inline KaTeX node.
  s = s.replace(/<span\b[^>]*(?:class="[^"]*mnode[^"]*"|data-latex)[^>]*>\s*<\/span>/gi,
      (tag) => {
        const latex = ATTR(tag, 'data-latex') || ATTR(tag, 'data-math-latex')
        return latex ? `$${latex}$` : ''
      })

  // Number base — no contract markup of its own, so it degrades to the
  // subscript form the inline-maths rule already covers.
  s = s.replace(/<span\b[^>]*(?:class="[^"]*num-base[^"]*"|data-number-base)[^>]*>\s*<\/span>/gi,
      (tag) => {
        const num = ATTR(tag, 'data-number')
        const base = ATTR(tag, 'data-base')
        if (!num) return ''
        return base ? `$${num}_{${base}}$` : num
      })

  // Column calculation.
  s = s.replace(/<div\b[^>]*(?:class="[^"]*vert-arith[^"]*"|data-vertical-arithmetic)[^>]*>\s*<\/div>/gi,
      (tag) => {
        const lines = ATTR(tag, 'data-lines').split('|').filter(Boolean)
        if (lines.length < 2) return ''
        const op = ATTR(tag, 'data-operator') || '+'
        const answer = ATTR(tag, 'data-answer')
        return `[[vmath op=${op} lines=${lines.join(',')}` +
          `${answer ? ` answer=${answer}` : ''}]]`
      })

  return s
}
