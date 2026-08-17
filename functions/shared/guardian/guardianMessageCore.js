/**
 * guardianMessageCore — the message a guardian receives, in a fixed order.
 *
 * ⚠️ SHARED WITH THE FRONTEND, same contract as functions/shared/assessment
 * and functions/shared/consent: plain ESM, no React/DOM/Firebase imports. The
 * app previews this message and the Cloud Function sends it, and a preview
 * that differs from what was sent is worse than no preview.
 *
 * ── The order is the product ───────────────────────────────────────────
 *
 *   evidence → what the child asked for → exam countdown → price
 *
 * and it is not a style preference. The payer has, in most cases, never opened
 * the app. A message that opens with a price is an invoice from a stranger; a
 * message that opens with "she scored 14 out of 20 today, her weakest area is
 * sentence completion" is a progress report, and the price at the end of a
 * progress report is a decision rather than a solicitation. `buildGuardianMessage`
 * assembles the blocks in this order and offers no way to reorder them, which
 * is what stops a later "make the CTA more prominent" ticket from moving the
 * price to the top.
 *
 * ── What it refuses to say ─────────────────────────────────────────────
 *
 * Every number in the message comes from the caller's payload and nothing is
 * invented. A missing score omits the score line rather than substituting a
 * plausible one, an absent exam date omits the countdown rather than printing
 * "0 days", and an unknown weak topic omits that sentence. A guardian who
 * checks one of these against the app and finds it wrong will not check the
 * next one.
 */

/** The block order. Exported so a test can assert it rather than read it. */
export const MESSAGE_BLOCK_ORDER = Object.freeze([
  'evidence',
  'request',
  'countdown',
  'price',
])

/** Gate id → the sentence describing what the learner asked to unlock. */
const REQUEST_SENTENCES = Object.freeze({
  PAPER_CONTINUE:
    'wants to finish the remaining {remaining} questions of the paper and get it marked like the real exam',
  PAPER_OPEN: 'wants to open more past papers for revision',
  PAPER_OFFLINE: 'is asking to unlock offline past papers so they can revise without using data',
  AUTO_MARKING: 'wants their full paper marked, with the topics to work on',
  NOTES_OTHER_TERMS: 'wants to open the notes for the other terms',
  LIVE_CHALLENGE: 'wants to practise against a classmate',
})

const DEFAULT_REQUEST_SENTENCE = 'is asking to unlock more practice on ZedExams'

function interpolate(template, context) {
  if (typeof template !== 'string') return ''
  return template
    .replace(/\{(\w+)\}/g, (_, key) => {
      const value = context?.[key]
      return value == null || value === '' ? '' : String(value)
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function firstName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return 'Your child'
  return trimmed.split(/\s+/)[0]
}

/**
 * What the child asked for, as a clause that follows their name: "wants to
 * open more past papers for revision".
 *
 * Exported because the guardian is now told this in two places — the message
 * that reaches their email, and the notification that lands in a linked
 * parent account's inbox — and the two must not describe the same request
 * differently. This is the one copy of that wording.
 *
 * @param {{feature?: string, remaining?: number}} payload
 * @returns {string} the clause, unpunctuated
 */
export function requestClause(payload = {}) {
  const sentence = REQUEST_SENTENCES[payload.feature] || DEFAULT_REQUEST_SENTENCE
  return interpolate(sentence, payload)
}

/**
 * Assemble the guardian message.
 *
 * @param {object} payload
 * @param {string} payload.learnerName
 * @param {string} payload.feature            a gate id, e.g. 'PAPER_CONTINUE'
 * @param {number} [payload.score]            marks earned in the latest attempt
 * @param {number} [payload.outOf]            marks available in that attempt
 * @param {string} [payload.subject]
 * @param {string} [payload.paperTitle]
 * @param {string} [payload.weakTopic]
 * @param {string} [payload.weakTopicDetail]  e.g. 'joining words like but, so, because'
 * @param {number} [payload.streakDays]
 * @param {number} [payload.daysPractisedThisWeek]
 * @param {number} [payload.weekOverWeekDelta] percentage points, may be negative
 * @param {number} [payload.remaining]        questions left in the paper
 * @param {number} [payload.daysToExam]
 * @param {string} [payload.grade]
 * @param {object} [payload.plan]             { label, price } — the offer
 * @param {string} [payload.payUrl]
 * @returns {{ blocks: object[], text: string, stats: string[], cta: object|null }}
 */
export function buildGuardianMessage(payload = {}) {
  const name = firstName(payload.learnerName)
  const blocks = []
  const stats = []

  // ── 1. Evidence ───────────────────────────────────────────────────────
  const hasScore = Number.isFinite(Number(payload.score)) && Number.isFinite(Number(payload.outOf))
  const evidence = []
  if (hasScore) {
    const subject = payload.subject ? ` in ${payload.subject}` : ''
    const paper = payload.paperTitle ? ` on ${payload.paperTitle}` : ''
    evidence.push(`${name} scored ${payload.score} out of ${payload.outOf} today${subject}${paper}.`)
    stats.push(`${payload.score}/${payload.outOf}${payload.subject ? ` · ${payload.subject}` : ''}`)
  } else if (Number.isFinite(Number(payload.daysPractisedThisWeek)) && payload.daysPractisedThisWeek > 0) {
    const d = Number(payload.daysPractisedThisWeek)
    evidence.push(`${name} has practised ${d} day${d === 1 ? '' : 's'} this week.`)
  }

  if (Number.isFinite(Number(payload.streakDays)) && payload.streakDays > 0) {
    stats.push(`${payload.streakDays}-day streak`)
  }
  if (Number.isFinite(Number(payload.weekOverWeekDelta)) && payload.weekOverWeekDelta !== 0) {
    const delta = Number(payload.weekOverWeekDelta)
    stats.push(`${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)}% on last week`)
  }
  if (payload.weakTopic) {
    const detail = payload.weakTopicDetail ? ` — ${payload.weakTopicDetail}` : ''
    evidence.push(`Weakest area right now: ${payload.weakTopic}${detail}.`)
  }
  if (evidence.length) blocks.push({ id: 'evidence', text: evidence.join(' ') })

  // ── 2. What the child asked for ───────────────────────────────────────
  blocks.push({
    id: 'request',
    text: `${name} ${requestClause(payload)}.`,
  })

  // ── 3. Exam countdown ─────────────────────────────────────────────────
  const days = Number(payload.daysToExam)
  if (Number.isFinite(days) && days > 0) {
    const gradeLabel = payload.grade ? `Grade ${String(payload.grade).replace(/^grade\s*/i, '')} ` : ''
    blocks.push({
      id: 'countdown',
      text: `${gradeLabel}exams in ${days} day${days === 1 ? '' : 's'}.`,
    })
  }

  // ── 4. Price, last ────────────────────────────────────────────────────
  let cta = null
  if (payload.plan && Number.isFinite(Number(payload.plan.price))) {
    const label = payload.plan.label || 'Unlock'
    cta = {
      label: `Unlock — K${Math.round(Number(payload.plan.price))} for the ${label.toLowerCase().replace(/\s*pass$/, '')}`.trim(),
      url: payload.payUrl || '',
    }
    blocks.push({ id: 'price', text: cta.label })
  }

  return {
    blocks,
    stats,
    cta,
    text: blocks.map((b) => b.text).join('\n\n'),
  }
}

/**
 * The invariant, as a predicate a test can call: no price block may appear
 * before the evidence or request blocks.
 */
export function priceComesLast(message) {
  const ids = (message?.blocks || []).map((b) => b.id)
  const priceAt = ids.indexOf('price')
  if (priceAt === -1) return true
  return priceAt === ids.length - 1
}
