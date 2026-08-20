/**
 * ONE COPY OF THE SPELLING CONTENT RULES.
 *
 * Everything that decides whether a spelling word may reach a learner lives
 * here: the shape of a word record, the checks that can be automated, and the
 * approval states. Three callers read it and none of them may hold a second
 * copy —
 *
 *   • the admin authoring tool (`/admin/spelling`), which must refuse a bad
 *     record BEFORE it is saved;
 *   • `scripts/test-spelling-bank.mjs`, which runs the same checks over the
 *     bundled bank so the shipped content cannot drift below the bar the
 *     admin tool enforces;
 *   • `spellingPack.js`, which will not serve an unapproved record.
 *
 * The rules used to live inline in the bank test alone. That was fine while
 * the only way to add a word was to edit a file and run the test — it stops
 * being fine the moment an admin can type one into a form, because then the
 * test's rules and the form's rules are two implementations of one decision
 * and the form is the one nobody runs in CI.
 *
 * WHAT IS CHECKABLE AND WHAT IS NOT. A machine can check that chunks rebuild
 * the word, that a sentence has exactly one gap and does not print its own
 * answer, and that a spelling is not the American form. It cannot check that
 * `sep | a | rate` is the right place to cut, that a hook is memorable, or
 * that a sentence is age-appropriate — so those stay a HUMAN approval, and
 * `approved` is a field a person sets, never a verdict this file computes.
 *
 * Pure: no React, no DOM, no Firebase. Node runs it directly.
 */

/* ── the vocabulary ────────────────────────────────────────────────── */

/** Chunking strategies. A cut declares which one it uses. */
export const STRATEGIES = Object.freeze([
  'syllables',
  'root+affix',
  'trap',
  'sound-out',
  'family',
])

/**
 * Review states. `draft` → `pending` → `approved` | `rejected`.
 *
 * A learner is served `approved` and nothing else. `pending` is what an AI
 * generation lands in — never `approved` — so the generator can fill the bank
 * without ever putting an unreviewed sentence in front of a child.
 */
export const STATUSES = Object.freeze(['draft', 'pending', 'approved', 'rejected'])

/** The only status a learner may be served. */
export const LEARNER_STATUS = 'approved'

/** Difficulty tiers, low to high. Purely editorial — the band is the ladder. */
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard'])

/**
 * The gap marker in a context sentence.
 * "Our ___ helped us carry the water."
 */
export const GAP = '___'

/**
 * American forms that must never reach an ECZ paper, each with the British
 * form it should have been.
 *
 * DELIBERATELY NOT HERE, and each for the same reason: both spellings are
 * correct British English and only the MEANING separates them, which no word
 * list can see — practice/practise (noun/verb), check/cheque, draft/draught,
 * tire/tyre, curb/kerb. Flagging one of those would fail the bank on correct
 * English, and a check that cries wolf is a check somebody switches off.
 */
export const AMERICAN_FORMS = Object.freeze([
  ['color', 'colour'], ['favorite', 'favourite'], ['neighbor', 'neighbour'],
  ['honor', 'honour'], ['labor', 'labour'], ['behavior', 'behaviour'],
  ['flavor', 'flavour'], ['humor', 'humour'], ['rumor', 'rumour'],
  ['realize', 'realise'], ['organize', 'organise'], ['recognize', 'recognise'],
  ['apologize', 'apologise'], ['criticize', 'criticise'], ['memorize', 'memorise'],
  ['center', 'centre'], ['theater', 'theatre'], ['meter', 'metre'],
  ['liter', 'litre'], ['fiber', 'fibre'], ['somber', 'sombre'],
  ['traveling', 'travelling'], ['traveled', 'travelled'], ['canceled', 'cancelled'],
  ['modeling', 'modelling'], ['labeled', 'labelled'],
  ['defense', 'defence'], ['offense', 'offence'], ['pretense', 'pretence'],
  ['program', 'programme'], ['catalog', 'catalogue'], ['dialog', 'dialogue'],
  ['gray', 'grey'], ['jewelry', 'jewellery'], ['plow', 'plough'],
  ['skillful', 'skilful'], ['fulfill', 'fulfil'], ['enrollment', 'enrolment'],
  ['math', 'maths'], ['aluminum', 'aluminium'], ['sulfur', 'sulphur'],
])

/** Escape a word for use inside a RegExp. */
function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ── individual checks ─────────────────────────────────────────────── */

/**
 * The one check a machine can make about a cut: the chunks rebuild the word.
 *
 * A cut that does not rejoin teaches a child a word that does not exist —
 * which is worse than showing no cut at all, because the learner has just
 * been told they are wrong and would now be told a lie about why.
 */
export function chunksRebuild(word, chunks) {
  if (!Array.isArray(chunks) || !chunks.length) return false
  if (chunks.some((chunk) => typeof chunk !== 'string' || !chunk.length)) return false
  return chunks.join('').toLowerCase() === String(word || '').toLowerCase()
}

/** Every American form found in a piece of text, as `[found, expected]`. */
export function americanisms(text) {
  const hay = String(text || '').toLowerCase()
  return AMERICAN_FORMS.filter(([us]) => new RegExp(`\\b${us}\\b`).test(hay))
}

/**
 * Whether a sentence prints its own answer.
 *
 * Checked as a WHOLE WORD, so "practise" in a sentence does not trip on
 * "practice" and "her" inside "there" is fine. The whole mechanic is "hear
 * it, then produce it" — a sentence containing the word turns that into
 * copying, which is the one thing the game must not become.
 */
export function sentenceLeaksWord(word, sentence) {
  if (!word || !sentence) return false
  const bare = String(sentence).split(GAP).join(' ')
  return new RegExp(`\\b${escapeRe(word)}\\b`, 'i').test(bare)
}

/** How many gaps a sentence has. Exactly one is the contract. */
export function gapCount(sentence) {
  return String(sentence || '').split(GAP).length - 1
}

/* ── the record ────────────────────────────────────────────────────── */

/**
 * A spelling word, with every optional field defaulted.
 *
 * The shape is the same whether the record came from the bundled bank, an
 * admin form, or Firestore, so nothing downstream has to know which.
 */
export function normaliseWord(raw = {}) {
  const word = String(raw.word ?? '').trim().toLowerCase()
  const chunks = Array.isArray(raw.chunks)
    ? raw.chunks.map((chunk) => String(chunk).trim().toLowerCase()).filter(Boolean)
    : []
  const trapRaw = raw.trap
  return {
    word,
    grade: raw.grade == null || raw.grade === '' ? null : Number(raw.grade),
    band: String(raw.band ?? '').trim(),
    // `chapter` is the human label; `band` is the id the ladder is built on.
    // Both travel so a record read straight out of Firestore can be listed
    // without joining it back to the band table.
    chapter: String(raw.chapter ?? '').trim(),
    difficulty: DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : 'medium',
    contextSentence: String(raw.contextSentence ?? raw.sentence ?? '').trim(),
    // Set only when a word has recorded audio. Empty means "speak it with the
    // device voice", which is what every word does today.
    audio: String(raw.audio ?? '').trim(),
    chunks,
    trap: Number.isInteger(trapRaw) && trapRaw >= 0 && trapRaw < chunks.length ? trapRaw : null,
    strategy: STRATEGIES.includes(raw.strategy) ? raw.strategy : null,
    hook: String(raw.hook ?? '').trim(),
    hookNote: String(raw.hookNote ?? '').trim(),
    why: String(raw.why ?? '').trim(),
    relatedWords: Array.isArray(raw.relatedWords ?? raw.transfer)
      ? (raw.relatedWords ?? raw.transfer).map((w) => String(w).trim().toLowerCase()).filter(Boolean)
      : [],
    status: STATUSES.includes(raw.status) ? raw.status : 'draft',
    approved: raw.approved === true,
    active: raw.active !== false,
    source: String(raw.source ?? '').trim(),
  }
}

/**
 * Everything wrong with a record, as reader-facing lines. Empty means
 * publishable — which is NOT the same as approved: a human still decides
 * whether the cut is the right cut and the sentence is a good sentence.
 *
 * `bands` is the set of band ids the record's grade actually has, so a typo
 * in a band id is caught here rather than making a word unreachable in
 * silence. Pass nothing to skip that check (the admin tool always passes it).
 */
export function validateWord(raw, { bands = null } = {}) {
  const record = normaliseWord(raw)
  const problems = []

  if (!record.word) problems.push('The word is required.')
  else if (!/^[a-z][a-z'-]*$/.test(record.word)) {
    problems.push(`"${record.word}" must be letters only (an apostrophe or hyphen is allowed inside).`)
  } else if (record.word.length < 2) problems.push('A word needs at least two letters.')

  // The slot row wraps below ten letters on a 360px screen, which is legible;
  // a longer word wraps twice and pushes the sentence off the screen.
  if (record.word.length > 14) {
    problems.push(`"${record.word}" is ${record.word.length} letters — too long for the tile row on a small phone.`)
  }

  if (!record.band) problems.push('A chapter (band) is required — it is what the ladder is built on.')
  else if (bands && !bands.has(record.band)) {
    problems.push(`"${record.band}" is not a chapter this grade has.`)
  }

  if (record.grade != null && !(Number.isInteger(record.grade) && record.grade >= 1 && record.grade <= 12)) {
    problems.push(`Grade "${raw?.grade}" is not a grade.`)
  }

  /* the context sentence */
  if (!record.contextSentence) {
    problems.push('A context sentence is required — it is how the learner gets the meaning without the spelling.')
  } else {
    const gaps = gapCount(record.contextSentence)
    if (gaps !== 1) problems.push(`The sentence needs exactly one ${GAP} gap (it has ${gaps}).`)
    if (sentenceLeaksWord(record.word, record.contextSentence)) {
      problems.push(`The sentence prints "${record.word}" — the learner would be copying, not spelling.`)
    }
    const tail = record.contextSentence.trim().slice(-1)
    if (!'.?!'.includes(tail)) problems.push('The sentence should end with . ? or !')
  }

  /* British spelling — the word and its sentence both */
  for (const [us, uk] of americanisms(`${record.word} ${record.contextSentence}`)) {
    problems.push(`"${us}" is the American form — ECZ marks "${uk}".`)
  }

  /* the cut, when there is one. A word with NO cut is fine — most have none. */
  if (record.chunks.length) {
    if (!chunksRebuild(record.word, record.chunks)) {
      problems.push(`The chunks rebuild "${record.chunks.join('')}", not "${record.word}".`)
    }
    if (!record.strategy) {
      problems.push(`A cut needs a strategy — one of ${STRATEGIES.join(', ')}.`)
    }
    if (raw?.trap != null && raw.trap !== '' && record.trap === null) {
      problems.push(`Trap ${raw.trap} is not one of the ${record.chunks.length} chunks.`)
    }
    if (!record.why) {
      problems.push('A cut needs a "why people get it wrong" line — the cut alone teaches very little.')
    }
    if (record.hook && !record.hookNote) {
      problems.push('A memory hook needs the one-line note that says what it means.')
    }
    if (record.relatedWords.includes(record.word)) {
      problems.push('The related words list contains the word itself.')
    }
  } else {
    if (record.strategy || record.why || record.hook) {
      problems.push('A strategy, explanation or hook with no chunks has nothing to attach to.')
    }
    if (record.relatedWords.length) {
      problems.push('Related words teach a shared cut — add the chunks first.')
    }
  }

  return problems
}

/** Convenience: is this record fit to be shown to a human reviewer? */
export function isPublishable(raw, options) {
  return validateWord(raw, options).length === 0
}

/**
 * May this record be served to a learner?
 *
 * Approval is a HUMAN act and this only reads it back — but it is read
 * fail-closed: a record that is somehow `approved: true` while still failing
 * a machine check is refused, because the checks are the floor the approval
 * sits on and not a step it replaces.
 */
export function servableToLearner(raw, options) {
  const record = normaliseWord(raw)
  if (!record.active) return false
  if (record.status !== LEARNER_STATUS || !record.approved) return false
  return isPublishable(raw, options)
}

/**
 * The doc id for a word. Stable and derived, so re-importing the same word
 * converges on one document instead of minting a second — the same property
 * that makes the games seed importer idempotent.
 */
export function wordDocId({ grade, word }) {
  const g = grade == null || grade === '' ? 'x' : String(grade)
  return `g${g}_${String(word || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

/**
 * Fill the gap back in — the sentence as the learner sees it AFTER answering.
 * A word that leads its sentence is capitalised, because "___ your arms"
 * becoming "stretch your arms" reads as a typo.
 */
export function fillGap(word, sentence) {
  if (!sentence) return ''
  if (!word) return sentence
  const at = String(sentence).indexOf(GAP)
  const filled = String(sentence).split(GAP).join(String(word))
  if (at !== 0) return filled
  return filled.charAt(0).toUpperCase() + filled.slice(1)
}

/* ── the tiny bit of markup a hook is allowed ──────────────────────── */

/**
 * The only tags a memory hook, its note, or a "why people get it wrong" line
 * may carry: bold, italic, underline and a line break.
 *
 * A hook is emphasis on a fragment of the word — "there's <u>a rat</u> in
 * sepa<u>rat</u>e" — and that emphasis IS the teaching, so the content cannot
 * be flattened to plain text. It is also written by an admin into Firestore
 * and rendered with `dangerouslySetInnerHTML`, which makes it exactly the
 * shape of thing that becomes an XSS hole the day an admin account is taken.
 *
 * A WHITELIST, NOT A STRIPPER. Everything that is not one of the four tags
 * below is ESCAPED rather than removed — so a stray `<script>` renders as
 * visible text an admin can see and fix, instead of vanishing silently and
 * looking like it worked.
 */
export const INLINE_TAGS = Object.freeze(['b', 'i', 'u', 'em', 'strong', 'br'])

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ESCAPES[char])
}

/**
 * A safe HTML string for one line of authored inline markup.
 *
 * Attributes are dropped wholesale rather than filtered — none of the four
 * tags takes one that matters here, and "which attributes are safe" is a
 * question with a long history of wrong answers.
 */
export function renderInlineMarkup(raw) {
  const text = String(raw ?? '')
  if (!text) return ''
  let out = ''
  let cursor = 0
  const tag = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g
  let match = tag.exec(text)
  while (match) {
    out += escapeHtml(text.slice(cursor, match.index))
    const [whole, closing, name] = match
    if (INLINE_TAGS.includes(name.toLowerCase())) {
      out += name.toLowerCase() === 'br' ? '<br>' : `<${closing ? '/' : ''}${name.toLowerCase()}>`
    } else {
      out += escapeHtml(whole)
    }
    cursor = match.index + whole.length
    match = tag.exec(text)
  }
  return out + escapeHtml(text.slice(cursor))
}
