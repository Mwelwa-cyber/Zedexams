/**
 * src/shared/utils/importFormatTokens.js
 *
 * Inline FORMATTING tokens for the quiz import pipeline. The DOCX extractor
 * reads Word run properties (w:rPr — bold / underline / italic / highlight /
 * superscript / subscript) and wraps the affected words in these bracket
 * tokens; downstream they convert into the exact editor HTML the sanitiser
 * allows (<strong>/<u>/<em>/<mark>/<sup>/<sub>):
 *
 *   [[b]]bold[[/b]]  [[u]]underlined[[/u]]  [[i]]italic[[/i]]
 *   [[hl]]highlighted[[/hl]]  x[[sup]]2[[/sup]]  H[[sub]]2[[/sub]]O
 *
 * Why tokens instead of emitting HTML directly from the extractor?
 *   - The deterministic parser (documentQuizParserCore) matches question
 *     numbers / option labels with line-anchored regexes on PLAIN text. Angle
 *     brackets would also collide with cleanText and the passage heuristics.
 *     Bracket tokens follow the [[vmath …]] precedent, survive cleanText
 *     untouched, and are trivially strippable for plain-text consumers.
 *   - The exam papers this matters for say things like "what does the
 *     underlined word mean?" — losing the underline makes the question
 *     unanswerable, which is exactly the bug this fixes.
 *
 * Two intentional safety rules:
 *   1. Paragraph-level formatting is DROPPED: when every non-whitespace run in
 *      a paragraph shares a format (a fully-bold title, heading, or teacher
 *      habit of bolding whole questions), that format is styling, not
 *      emphasis — keeping it would recreate the "everything is bold" problem.
 *   2. Structural prefixes are unwrapped: "**1.**" / a bold "A." option label
 *      must still match the parser's QUESTION_RE / OPTION_RE, so leading
 *      number/letter prefixes are freed of tokens (formatting moves past the
 *      prefix, or is dropped when it covered only the prefix).
 *
 * Pure string in / string out — no DOM — so it runs in the browser importer
 * and under the plain `node` test runner alike.
 */

export const FORMAT_TOKEN_TYPES = ['b', 'u', 'i', 'hl', 'sup', 'sub']

// Emission (nesting) order — outermost first. Closing emits in reverse.
const EMIT_ORDER = ['hl', 'b', 'u', 'i', 'sup', 'sub']

export const FORMAT_TOKEN_TAG = {
  b: 'strong',
  u: 'u',
  i: 'em',
  hl: 'mark',
  sup: 'sup',
  sub: 'sub',
}

const TOKEN_PATTERN = /\[\[(\/?)(b|u|i|hl|sup|sub)\]\]/
const TOKEN_PATTERN_G = /\[\[(\/?)(b|u|i|hl|sup|sub)\]\]/g

export function hasFormatTokens(text) {
  return TOKEN_PATTERN.test(String(text ?? ''))
}

/** Remove every format token, keeping the text content. */
export function stripFormatTokens(text) {
  return String(text ?? '').replace(TOKEN_PATTERN_G, '')
}

/**
 * Try to read a format token at position `i` of `src`.
 * Returns { type, closing, end } or null.
 */
export function matchFormatToken(src, i) {
  if (src[i] !== '[' || src[i + 1] !== '[') return null
  const slice = src.slice(i, i + 10) // longest token: [[/sup]] = 8 chars
  const m = slice.match(/^\[\[(\/?)(b|u|i|hl|sup|sub)\]\]/)
  if (!m) return null
  return { type: m[2], closing: m[1] === '/', end: i + m[0].length }
}

/* ── Emission from extracted runs ───────────────────────────────────────── */

function normalizeFormats(formats) {
  if (!formats) return null
  const active = FORMAT_TOKEN_TYPES.filter((t) => formats[t])
  return active.length ? active : null
}

/**
 * Turn extracted runs [{ text, formats }] into a single string with format
 * tokens. `formats` is an object of booleans ({ b, u, i, hl, sup, sub }) or
 * null for structural pieces (tabs, newlines).
 *
 * Applies the paragraph-coverage rule: a format present on EVERY
 * non-whitespace piece is paragraph styling and is dropped entirely.
 */
export function wrapFormattedPieces(pieces) {
  const list = Array.isArray(pieces) ? pieces : []
  const textPieces = list.filter((p) => p && typeof p.text === 'string' && p.text.trim())

  // Coverage rule: formats carried by every non-whitespace piece are dropped.
  const dropped = new Set()
  if (textPieces.length) {
    FORMAT_TOKEN_TYPES.forEach((type) => {
      const covered = textPieces.every((p) => p.formats && p.formats[type])
      if (covered) dropped.add(type)
    })
  }

  let out = ''
  list.forEach((piece) => {
    if (!piece || typeof piece.text !== 'string' || !piece.text) return
    const active = (normalizeFormats(piece.formats) || []).filter((t) => !dropped.has(t))
    // Whitespace-only pieces don't need wrapping — formatting whitespace is
    // invisible and only fragments the token stream.
    if (!active.length || !piece.text.trim()) {
      out += piece.text
      return
    }
    const ordered = EMIT_ORDER.filter((t) => active.includes(t))
    const open = ordered.map((t) => `[[${t}]]`).join('')
    const close = ordered
      .slice()
      .reverse()
      .map((t) => `[[/${t}]]`)
      .join('')
    out += `${open}${piece.text}${close}`
  })

  // Merge directly-adjacent close/open pairs of the same type (Word splits
  // runs arbitrarily — spellcheck boundaries, rsids — so "under|lined" arrives
  // as two identically-formatted runs). Loop until stable to handle nesting.
  let prev = null
  while (prev !== out) {
    prev = out
    out = out.replace(/\[\[\/(b|u|i|hl|sup|sub)\]\]\[\[\1\]\]/g, '')
  }
  return out
}

/* ── Structural-prefix fix ──────────────────────────────────────────────── */

const LEADING_OPENS_RE = /^((?:\[\[(?:b|u|i|hl|sup|sub)\]\])+)/
const LEADING_CLOSES_RE = /^((?:\[\[\/(?:b|u|i|hl|sup|sub)\]\])+)/
// The number/letter core of a question ("1." / "12)") or option ("A." / "b)")
// prefix. The punctuation may sit inside or outside the formatted run. A tab
// can appear either OUTSIDE the tokens (a w:tab is its own element — the
// PRISCA "1\t…" form) or INSIDE them (some generators put a literal tab
// character inside the same bold <w:t> as the number — "[[b]]1\t[[/b]]…"),
// so PREFIX_PUNCT_RE accepts a bare tab as a separator too.
const PREFIX_CORE_RE = /^(\d{1,3}|[A-Da-d])/
const PREFIX_PUNCT_RE = /^([.)\]:][\t ]?|\t)/
const PREFIX_SEPARATOR_RE = /^([.)\]:][\t ]?|\t| )/

// A structural marker line the parser matches with line-anchored regexes on
// PLAIN text: "Answer: C — …", "Ans: B", "Key: D", "Explanation: …",
// "Reason: …". When the source document formats the marker itself (a bold
// "Answer:" run), the leading [[b]] token stops the parser's ANSWER_RE /
// EXPLANATION_RE from ever matching, so the answer leaks into passage or
// question text. Formatting carries no learner-facing value on these
// metadata lines, so they are returned token-free. Mirrors ANSWER_RE /
// EXPLANATION_RE in documentQuizParserCore.js.
const MARKER_LINE_RE = /^\s*(?:answer|correct answer|ans|key|explanation|reason|because)\s*[:-]/i

function countTokens(s) {
  return (String(s).match(TOKEN_PATTERN_G) || []).length
}

/**
 * Free a line's leading question-number / option-letter prefix from format
 * tokens so the parser's line-anchored matchers still fire:
 *   "[[b]]1.[[/b]] What…"   → "1. What…"        (formatting covered prefix only)
 *   "[[b]]1[[/b]]\tWhat…"   → "1\tWhat…"         (PRISCA tab form)
 *   "[[b]]A. dog[[/b]]"     → "A. [[b]]dog[[/b]]" (formatting moved past prefix)
 * Lines without leading tokens or a structural prefix pass through — e.g.
 * "[[b]]Apple[[/b]]" starts with a letter but has no separator, so it is a
 * word, not a label, and stays wrapped.
 */
export function fixLeadingStructuralTokens(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => {
      // Answer/explanation marker lines are parser metadata, not content —
      // strip every token so ANSWER_RE / EXPLANATION_RE match at line start.
      if (hasFormatTokens(line) && MARKER_LINE_RE.test(stripFormatTokens(line))) {
        return stripFormatTokens(line)
      }
      const opens = line.match(LEADING_OPENS_RE)
      if (!opens) return line
      const afterOpens = line.slice(opens[1].length)
      const core = afterOpens.match(PREFIX_CORE_RE)
      if (!core) return line
      const afterCore = afterOpens.slice(core[1].length)
      const punctInside = afterCore.match(PREFIX_PUNCT_RE)
      const afterPunct = punctInside ? afterCore.slice(punctInside[1].length) : afterCore
      const closes = afterPunct.match(LEADING_CLOSES_RE)

      if (closes && countTokens(closes[1]) === countTokens(opens[1])) {
        const rest = afterPunct.slice(closes[1].length)
        if (punctInside) {
          // "[[b]]1.[[/b]] What…" — tokens wrapped exactly the prefix.
          return core[1] + punctInside[1] + rest
        }
        // "[[b]]1[[/b]]\tWhat…" — separator sits outside the tokens. Require
        // one so "[[b]]A[[/b]]pple" (a formatted word) stays wrapped.
        if (PREFIX_SEPARATOR_RE.test(rest)) return core[1] + rest
        return line
      }

      // Tokens span past the prefix — move the opens after it. Only when the
      // punctuation confirms this really is a label ("[[b]]A. dog[[/b]]").
      if (punctInside) return core[1] + punctInside[1] + opens[1] + afterPunct
      return line
    })
    .join('\n')
}

/* ── Token → HTML conversion ────────────────────────────────────────────── */

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Consume the format token at src[i] (if any), updating `stack` (an array of
 * open token types the caller owns) and returning `{ html, next }` — the tag
 * HTML to emit and the index after the token — or null when src[i] is not a
 * token. Shared with importRichText.convertInline so the smart-import path
 * converts tokens with the exact same nesting/mis-nesting semantics.
 */
export function consumeFormatToken(src, i, stack) {
  const token = matchFormatToken(src, i)
  if (!token) return null
  let html = ''
  if (!token.closing) {
    stack.push(token.type)
    html = `<${FORMAT_TOKEN_TAG[token.type]}>`
  } else {
    const idx = stack.lastIndexOf(token.type)
    if (idx !== -1) {
      // Close everything above it (mis-nesting guard), then this one, then
      // reopen the others so the output HTML stays properly nested.
      for (let d = stack.length - 1; d >= idx; d -= 1) {
        html += `</${FORMAT_TOKEN_TAG[stack[d]]}>`
      }
      const reopen = stack.splice(idx).slice(1)
      reopen.forEach((t) => {
        stack.push(t)
        html += `<${FORMAT_TOKEN_TAG[t]}>`
      })
    }
    // Stray close with no open: drop silently (html stays '').
  }
  return { html, next: token.end }
}

/** Close every still-open token type in `stack`, emptying it. */
export function closeFormatTokens(stack) {
  let html = ''
  for (let d = stack.length - 1; d >= 0; d -= 1) {
    html += `</${FORMAT_TOKEN_TAG[stack[d]]}>`
  }
  stack.length = 0
  return html
}

// Convert one line: escape everything, tokens become tags. A stray close
// (no matching open) is dropped; unclosed opens are closed at end of line —
// tokens never legitimately span a line break (Word runs cannot contain one).
function convertTokensInLine(line) {
  let out = ''
  const stack = []
  let i = 0
  while (i < line.length) {
    const consumed = consumeFormatToken(line, i, stack)
    if (consumed) {
      out += consumed.html
      i = consumed.next
      continue
    }
    out += escapeHtml(line[i])
    i += 1
  }
  out += closeFormatTokens(stack)
  return out
}

/**
 * Convert a block field (question stem, passage, explanation, instruction)
 * containing format tokens into editor HTML: blank lines split paragraphs,
 * single newlines become <br>, all other text is HTML-escaped. Text without
 * any token is returned UNCHANGED so plain imports behave exactly as before.
 */
export function formatTokensToHtml(text) {
  const src = String(text ?? '')
  if (!src.trim() || !hasFormatTokens(src)) return src

  const lines = src.split(/\r?\n/)
  const parts = []
  let paragraph = []
  const flush = () => {
    if (!paragraph.length) return
    const inner = paragraph.map(convertTokensInLine).join('<br>')
    if (inner.trim()) parts.push(`<p>${inner}</p>`)
    paragraph = []
  }
  lines.forEach((line) => {
    if (!line.trim()) flush()
    else paragraph.push(line)
  })
  flush()
  return parts.join('')
}

/**
 * Convert a single answer option (inline field — no paragraphs). Plain
 * options pass straight through unchanged.
 */
export function formatTokensToInlineHtml(text) {
  const src = String(text ?? '')
  if (!src.trim() || !hasFormatTokens(src)) return src
  return convertTokensInLine(src.replace(/\n+/g, ' '))
}
