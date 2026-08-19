/**
 * guardianContactCore — how a grown-up is reached, and how often.
 *
 * ⚠️ SHARED WITH THE FRONTEND, same rule as guardianConsentCore: the screen a
 * child types a number into and the callable that refuses it must not hold two
 * different ideas of what a usable contact is. A number the browser accepts and
 * the server rejects is a child staring at a spinner; a number the browser
 * rejects and the server would have accepted is a guardian never asked.
 *
 * Plain ESM, no React/DOM/Firebase (test:shared-consent-neutral).
 *
 * ── Why WhatsApp comes first ─────────────────────────────────────────────
 *
 * The live flow was email-only. Plenty of Zambian guardians have no email
 * address they check, and nearly all have WhatsApp — the same channel the
 * product already reaches them on for MTN and Airtel payments. An email-only
 * step is therefore not a neutral default, it is the funnel's worst drop-off
 * point dressed as one. DEFAULT_CONTACT_CHANNEL is the deliverable channel,
 * not the tidy one.
 *
 * ── Why the learner's own contact is refused ─────────────────────────────
 *
 * A child who enters their own address approves their own account, and the
 * consent record then says a guardian agreed when nobody did. That record is
 * the evidence shown to a regulator or to Play on appeal, so a self-approval
 * is worse than no approval: it is a false statement we made about a child.
 * This cannot be enforced perfectly — a second address is a minute's work —
 * but the accidental and the casual cases are most of them, and refusing
 * them out loud tells the child what the step is actually for.
 *
 * ── Why sends back off instead of being capped once a day ────────────────
 *
 * A flat 24-hour cooldown makes the honest failure — one mistyped digit —
 * unrecoverable for a day, which is the case the waiting screen's Resend
 * exists to catch. A ladder fixes that without handing a child a button that
 * can bury a parent's inbox: the first retry is minutes away, the fifth is a
 * day away, and the total is bounded whatever the child does in between.
 */

/** The channels a guardian can be reached on, plus the hand-the-phone-over route. */
export const CONTACT_CHANNEL = Object.freeze({
  WHATSAPP: 'whatsapp',
  EMAIL: 'email',
  // Not a channel in the messaging sense: the grown-up is in the room and
  // decides on this device. It is here because it is stored in the same field
  // and must be a value everything downstream already knows how to read.
  SAME_DEVICE: 'same_device',
})

/** Channels a message can actually be sent on. */
export const MESSAGING_CHANNELS = Object.freeze([
  CONTACT_CHANNEL.WHATSAPP,
  CONTACT_CHANNEL.EMAIL,
])

/**
 * The channel offered first. See the docblock: this is a delivery decision
 * about Zambian guardians, not a preference.
 */
export const DEFAULT_CONTACT_CHANNEL = CONTACT_CHANNEL.WHATSAPP

/**
 * Why a contact was refused. Codes rather than sentences so the server can
 * refuse and the client can explain in its own voice — and so a test can
 * assert on the reason instead of on copy.
 */
export const CONTACT_REJECTION = Object.freeze({
  EMPTY: 'empty',
  BAD_EMAIL: 'bad_email',
  BAD_PHONE: 'bad_phone',
  OWN_CONTACT: 'own_contact',
  LEARNER_ACCOUNT: 'learner_account',
})

/**
 * What a child reads for each refusal. Grade 4–9 reading level, and each one
 * says what to do next — "invalid" on its own is a dead end for someone who
 * is trying to get it right.
 */
export const CONTACT_REJECTION_MESSAGE = Object.freeze({
  [CONTACT_REJECTION.EMPTY]:
    "Type your grown-up's number or email so we can reach them.",
  [CONTACT_REJECTION.BAD_EMAIL]:
    "That doesn't look like an email address. It should look like name@example.com.",
  [CONTACT_REJECTION.BAD_PHONE]:
    "That doesn't look like a phone number. A Zambian number looks like 0977 123456.",
  [CONTACT_REJECTION.OWN_CONTACT]:
    'This is your own contact. Use a grown-up\'s one — a parent, guardian, or another grown-up who looks after you.',
  [CONTACT_REJECTION.LEARNER_ACCOUNT]:
    'Someone already learns on ZedExams with this contact. Use a grown-up\'s own number or email instead.',
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const ZAMBIA_CC = '260'

/** Every character that is decoration in a typed phone number. */
function digitsOf(value) {
  return String(value == null ? '' : value).replace(/\D/g, '')
}

/**
 * Turn what a child typed into E.164.
 *
 * Zambian numbers arrive in every shape a person writes them — 0977123456,
 * 260 977 123 456, +260-97-7123456, (0977) 123 456 — and a guardian in the
 * diaspora arrives with a country code we have never seen. So: an explicit
 * country code is believed, and a bare national number is read as Zambian,
 * which is the only assumption a Zambian learner app is entitled to make.
 *
 * @return {string} E.164 (`+260977123456`), or '' when it cannot be one.
 */
export function toE164(value) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) return ''
  const explicitCode = raw.startsWith('+') || raw.startsWith('00')
  let digits = digitsOf(raw)
  if (!digits) return ''

  if (raw.startsWith('00')) digits = digits.replace(/^00/, '')

  if (!explicitCode) {
    // A trunk zero (0977…) or a bare national number (977…). Both are ours.
    if (digits.startsWith('0')) digits = digits.replace(/^0+/, '')
    if (!digits.startsWith(ZAMBIA_CC)) digits = ZAMBIA_CC + digits
  }

  if (digits.startsWith(ZAMBIA_CC)) {
    const national = digits.slice(ZAMBIA_CC.length)
    // Zambian mobile: nine digits, starting 9 (MTN/Airtel/Zamtel) or 7.
    if (!/^[79]\d{8}$/.test(national)) return ''
    return `+${ZAMBIA_CC}${national}`
  }

  // Someone else's country. We cannot validate their numbering plan, so we
  // check only that it is a plausible international number.
  if (!/^\d{8,15}$/.test(digits)) return ''
  return `+${digits}`
}

/** How a normalised contact is shown back to the child on the confirm screen. */
export function displayContact({ channel, value }) {
  if (channel !== CONTACT_CHANNEL.WHATSAPP) return String(value || '')
  const e164 = String(value || '')
  const zm = /^\+260(\d{3})(\d{3})(\d{3})$/.exec(e164)
  // Grouped the way a Zambian number is read aloud, so a wrong digit is
  // visible. An unfamiliar country code is left exactly as it was normalised.
  return zm ? `+260 ${zm[1]} ${zm[2]} ${zm[3]}` : e164
}

/**
 * Validate and normalise a guardian contact.
 *
 * @param {object} args
 * @param {string} args.contact  What the child typed.
 * @param {string} args.channel  CONTACT_CHANNEL.WHATSAPP | EMAIL.
 * @return {{ok: boolean, channel?: string, value?: string, display?: string,
 *           key?: string, reason?: string, message?: string}}
 *   `value` is what we send to; `key` is the comparison/rate-limit identity
 *   (lower-cased email, or digits-only phone), which is deliberately NOT the
 *   same string — two people can type one address six ways.
 */
export function normalizeGuardianContact({ contact, channel } = {}) {
  const wanted = MESSAGING_CHANNELS.includes(channel) ? channel : DEFAULT_CONTACT_CHANNEL
  const raw = String(contact == null ? '' : contact).trim()
  if (!raw) return refusal(CONTACT_REJECTION.EMPTY)

  if (wanted === CONTACT_CHANNEL.EMAIL) {
    const value = raw.slice(0, 254)
    if (!EMAIL_RE.test(value)) return refusal(CONTACT_REJECTION.BAD_EMAIL)
    const lower = value.toLowerCase()
    return { ok: true, channel: wanted, value: lower, display: lower, key: lower }
  }

  const e164 = toE164(raw)
  if (!e164) return refusal(CONTACT_REJECTION.BAD_PHONE)
  return {
    ok: true,
    channel: wanted,
    value: e164,
    display: displayContact({ channel: wanted, value: e164 }),
    key: e164.replace('+', ''),
  }
}

function refusal(reason) {
  return { ok: false, reason, message: CONTACT_REJECTION_MESSAGE[reason] }
}

/**
 * Does this contact belong to the learner themselves?
 *
 * Compared on the normalised KEY, so `Parent@Example.COM `, `parent@example.com`
 * and `0977123456` vs `+260 977 123 456` are all caught. Anything the learner
 * record does not carry simply does not match — this is a check we can only
 * run against what we know, and it says so rather than guessing.
 */
export function contactMatchesLearner({ key, channel } = {}, learner = {}) {
  const target = String(key || '')
  if (!target) return false
  const own = []
  if (channel === CONTACT_CHANNEL.EMAIL) {
    for (const field of ['email', 'contactEmail']) {
      const v = String(learner?.[field] || '').trim().toLowerCase()
      if (v) own.push(v)
    }
  } else {
    for (const field of ['phone', 'phoneNumber', 'whatsapp']) {
      const v = toE164(learner?.[field])
      if (v) own.push(v.replace('+', ''))
    }
  }
  return own.includes(target)
}

// ── How often a message may go out ────────────────────────────────────────

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/**
 * The wait before send N+1, indexed by how many have already gone out.
 *
 * The first retry is fifteen minutes, not a day: the case Resend exists for is
 * a wrong number noticed thirty seconds later, and a flow that answers that
 * with "try tomorrow" is a flow that loses the account. The last rung is
 * inside the burst window rather than equal to it, so the per-contact ceiling
 * is a limit that can actually be reached rather than one the ladder hides.
 */
export const RESEND_LADDER_MS = Object.freeze([0, 15 * MINUTE, HOUR, 4 * HOUR, 12 * HOUR])

/**
 * Messages one learner may send about one contact inside a burst before the
 * ladder stops mattering and the answer becomes "try a different number".
 */
export const MAX_SENDS_PER_CONTACT = 5

/**
 * Messages one learner may send inside a burst, across every contact they try.
 *
 * The per-contact count RESETS when the contact changes, because correcting a
 * mistyped number must not be punished with the wait the wrong number earned.
 * This one does not, because otherwise "change the number" is an unlimited
 * send button with an extra tap in front of it.
 */
export const MAX_SENDS_TOTAL = 8

/**
 * How long the counters remember.
 *
 * They bound a BURST, not a lifetime, and the difference is a child six weeks
 * later whose guardian never answered. A lifetime total would leave them with
 * no self-serve route at all — permanently unable to ask again, on a screen
 * whose entire purpose is asking. A quiet day clears the slate; a hammered
 * hour does not.
 */
export const BURST_WINDOW_MS = 24 * HOUR

/** Messages one destination may receive per day, from everyone, together. */
export const MAX_SENDS_PER_DESTINATION_DAY = 5

/** The window MAX_SENDS_PER_DESTINATION_DAY is counted over. */
export const DESTINATION_WINDOW_MS = BURST_WINDOW_MS

export const SEND_REFUSAL = Object.freeze({
  TOO_SOON: 'too_soon',
  CONTACT_EXHAUSTED: 'contact_exhausted',
  TOTAL_EXHAUSTED: 'total_exhausted',
})

/**
 * May this learner send now, and what do the counters become if they do?
 *
 * Pure: the caller passes the clock and the counters it read, so the same
 * function decides on the server and explains on the client. It also returns
 * the NEXT counter values, because every reset — a quiet day, a corrected
 * number — has to be applied by whoever writes them, and a caller that
 * incremented the stale values would re-impose a wait this function just
 * decided had expired.
 *
 * @param {object} args
 * @param {number} args.sendCount   Stored sends to the current contact.
 * @param {number} args.sendTotal   Stored sends across contacts.
 * @param {number|null} args.lastSentAt  Epoch ms of the last send, or null.
 * @param {boolean} args.contactChanged  Is this a different contact?
 * @param {number} args.now
 * @return {{allowed: boolean, reason?: string, waitMs?: number,
 *           nextSendCount: number, nextSendTotal: number}}
 */
export function resolveSendDecision({
  sendCount = 0, sendTotal = 0, lastSentAt = null, contactChanged = false, now = 0,
} = {}) {
  const storedCount = Number.isFinite(sendCount) && sendCount > 0 ? Math.floor(sendCount) : 0
  const storedTotal = Number.isFinite(sendTotal) && sendTotal > 0 ? Math.floor(sendTotal) : storedCount
  const last = Number.isFinite(lastSentAt) ? lastSentAt : null
  const elapsed = last == null ? Infinity : Math.max(0, now - last)

  // A quiet day forgets everything. Nothing about a burst limit should still
  // be true a week later.
  const quiet = elapsed >= BURST_WINDOW_MS
  const total = quiet ? 0 : storedTotal
  const count = quiet || contactChanged ? 0 : storedCount

  const allow = () => ({allowed: true, nextSendCount: count + 1, nextSendTotal: total + 1})
  const refuse = (reason, waitMs) => ({
    allowed: false, reason, waitMs, nextSendCount: count, nextSendTotal: total,
  })

  if (total >= MAX_SENDS_TOTAL) {
    return refuse(SEND_REFUSAL.TOTAL_EXHAUSTED, Math.max(0, BURST_WINDOW_MS - elapsed))
  }
  if (count >= MAX_SENDS_PER_CONTACT) {
    return refuse(SEND_REFUSAL.CONTACT_EXHAUSTED, Math.max(0, BURST_WINDOW_MS - elapsed))
  }

  // A corrected number goes out now: the wait the wrong number earned is not
  // the right one's to serve.
  const wait = contactChanged ? 0 : RESEND_LADDER_MS[Math.min(count, RESEND_LADDER_MS.length - 1)]
  if (elapsed < wait) return refuse(SEND_REFUSAL.TOO_SOON, wait - elapsed)
  return allow()
}

/**
 * "in about 15 minutes" — for a child, not a log line.
 *
 * Rounds UP, so the message never invites a retry that will be refused.
 */
export function describeWait(waitMs) {
  const ms = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 0
  if (ms <= 0) return 'now'
  const minutes = Math.ceil(ms / MINUTE)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
  return 'a day'
}
