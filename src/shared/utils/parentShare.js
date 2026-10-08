/**
 * parentShare — the WhatsApp message a learner sends their own parent.
 *
 * Pure: no DOM, no React, no Firebase. The learner taps a button, WhatsApp
 * opens with this text already written, and the learner chooses the contact
 * and presses Send. Nothing is stored and nothing is sent by the server, so
 * the only data in the message is what the learner is already looking at.
 *
 * Written in the FIRST person, because the learner is the sender. It names a
 * topic, never a question or an answer the child typed — a guardian sees
 * topics, not a child's own words.
 */

const SITE = 'zedexams.com'
const MAX_TOPIC_CHARS = 60

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function cleanTopic(value) {
  const t = cleanText(value)
  return t.length > MAX_TOPIC_CHARS ? `${t.slice(0, MAX_TOPIC_CHARS - 1).trimEnd()}…` : t
}

function cleanPercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** "https://wa.me/?text=…" — no number, so the learner picks the contact. */
export function whatsappShareUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(String(text ?? ''))}`
}

/**
 * After a quiz, Daily Quiz or paper.
 *
 * Give `correct` + `total` when the screen shows a count ("8 out of 10"),
 * otherwise `percentage`. With neither, the message still reads sensibly
 * rather than printing a made-up number.
 */
export function buildResultMessage({ subject, correct, total, percentage, weakTopic } = {}) {
  const sub = cleanText(subject)
  const where = sub ? ` in ${sub}` : ''
  const c = Number(correct)
  const t = Number(total)
  const pct = cleanPercent(percentage)

  let score = null
  let strong = false
  if (Number.isFinite(c) && Number.isFinite(t) && t > 0) {
    score = `${c} out of ${t}`
    strong = c / t >= 0.7
  } else if (pct != null) {
    score = `${pct}%`
    strong = pct >= 70
  }

  const lines = []
  if (score) {
    lines.push(`Hello 👋 I scored ${score}${where} on ZedExams today.${strong ? ' 🎉' : ''}`)
  } else {
    lines.push(`Hello 👋 I finished a${sub ? ` ${sub}` : ''} quiz on ZedExams today.`)
  }
  const topic = cleanTopic(weakTopic)
  if (topic) lines.push(`I want to practise more: ${topic}.`)
  lines.push(SITE)
  return lines.join('\n')
}

/** The week so far: days played out of seven, and what to practise. */
export function buildWeekMessage({ daysPlayed, weakTopics } = {}) {
  const days = Math.max(0, Math.min(7, Math.round(Number(daysPlayed) || 0)))
  const lines = [
    days > 0
      ? `Hello 👋 This week I studied on ZedExams on ${days} out of 7 days.${days >= 4 ? ' 🎉' : ''}`
      : 'Hello 👋 I am getting ready to study on ZedExams this week.',
  ]
  const topics = (Array.isArray(weakTopics) ? weakTopics : [])
    .map((t) => cleanTopic(typeof t === 'string' ? t : t?.topic))
    .filter(Boolean)
    .slice(0, 2)
  if (topics.length) lines.push(`I want to practise more: ${topics.join(', ')}.`)
  lines.push(SITE)
  return lines.join('\n')
}
