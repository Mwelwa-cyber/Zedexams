/**
 * Pure logic for the `punctuation` engine — the prototype-v3
 * "Punctuation Pro" tap-the-correct-sentence game (learner redesign
 * step 4, the fourth and last rebuilt mechanic).
 *
 * The mechanic is the prototype's: one 60-second round through a
 * recycling shuffled queue of items, each showing two or three versions
 * of the same sentence with only one punctuated correctly. Tapping the
 * right one locks it green, pays 20 × combo and deals the next after a
 * beat; tapping a wrong one shakes it red and resets the combo, with
 * the item staying live for another try.
 *
 * Content is the repo's standard MCQ shape ({ question: optional
 * prompt, options: the sentence versions, answer: the correct one —
 * verbatim text, or an index into options }), so games author like any
 * quiz; the prototype's ten items are the fallback. No React, no DOM;
 * draws take an injectable `rng` so scripts/test-punctuation.mjs can
 * drive it deterministically.
 */

export const ROUND_SECONDS = 60

/** The prototype's items — the fallback when a game doc has none. */
export const FALLBACK_ITEMS = [
  { options: ['She has a beautiful voice.', 'She has a beautiful voice,', 'she has a beautiful voice.'], answer: 'She has a beautiful voice.' },
  { options: ['The children are playing outside.', 'The children are playing outside?', 'The children are playing outside;'], answer: 'The children are playing outside.' },
  { options: ['How many countries are there in Africa?', 'how many countries are there in Africa?', 'How many countries are there in Africa.'], answer: 'How many countries are there in Africa?' },
  { options: ['Plums, pears, apples and bananas are good sources of vitamin C.', 'Plums pears apples and bananas are good sources of vitamin C.', 'Plums, pears, apples and bananas are good sources of Vitamin C,'], answer: 'Plums, pears, apples and bananas are good sources of vitamin C.' },
  { options: ['“Are you a student here?” Tony asked.', '“Are you a student here? Tony asked.', 'Are you a student here, Tony asked?'], answer: '“Are you a student here?” Tony asked.' },
  { options: ['Where are you going, Mary?', 'Where are you going Mary.', 'where are you going, Mary?'], answer: 'Where are you going, Mary?' },
  { options: ['I bought sugar, salt and rice.', 'I bought sugar salt and rice.', 'I bought sugar, salt and rice'], answer: 'I bought sugar, salt and rice.' },
  { options: ['It is raining, so we stayed inside.', 'It is raining so we stayed inside', 'it is raining, so we stayed inside.'], answer: 'It is raining, so we stayed inside.' },
  { options: ['My uncle lives in Ndola, but he works in Kitwe.', 'My uncle lives in Ndola but he works in Kitwe', 'my uncle lives in Ndola, but he works in Kitwe.'], answer: 'My uncle lives in Ndola, but he works in Kitwe.' },
  { options: ['What a wonderful surprise!', 'What a wonderful surprise.', 'what a wonderful surprise!'], answer: 'What a wonderful surprise!' },
]

function shuffled(list, rng = Math.random) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * The playable items of a game doc: at least two distinct options, and
 * an answer resolving to one of them — verbatim text (the repo's MCQ
 * convention), or an index into `options`. The prompt rides along.
 */
export function playableItems(questions) {
  const out = []
  for (const q of questions || []) {
    const options = (q?.options || []).map((o) => String(o ?? '').trim()).filter(Boolean)
    if (new Set(options).size < 2) continue
    const raw = q?.answer
    let answer = null
    const asText = String(raw ?? '').trim()
    if (options.includes(asText)) answer = asText
    else if (/^\d+$/.test(asText) && Number(asText) < options.length) answer = options[Number(asText)]
    if (!answer) continue
    out.push({ prompt: String(q?.question || '').trim(), options, answer })
  }
  return out
}

/** A fresh shuffled queue — the game's own items, or the fallback list. */
export function itemQueue(questions, rng = Math.random) {
  const items = playableItems(questions)
  return shuffled(items.length ? items : FALLBACK_ITEMS.map((it) => ({ prompt: '', ...it })), rng)
}

/** The item's options in play order — shuffled per deal (prototype). */
export function dealOptions(item, rng = Math.random) {
  return shuffled(item.options, rng)
}

/** Points for a correct pick — 20 × the current combo multiplier. */
export function pickGain(combo) {
  return 20 * Math.max(1, Math.floor(Number(combo) || 1))
}

/** Stars for a finished round — the prototype's word-game thresholds. */
export function starsForScore(score) {
  const s = Number(score) || 0
  return s >= 140 ? 3 : s >= 60 ? 2 : 1
}

/**
 * Map a finished round onto the shared `useGameFinish` result shape —
 * correct picks count as correct answers, wrong taps as wrong ones,
 * and the peak combo is the round's best streak.
 */
export function roundResult({ game, score, solved, misses, peakCombo }) {
  const correct = Math.max(0, Math.floor(Number(solved) || 0))
  const wrong = Math.max(0, Math.floor(Number(misses) || 0))
  const attempts = correct + wrong
  return {
    game,
    score: Math.max(0, Math.floor(Number(score) || 0)),
    correct,
    wrong,
    accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
    bestStreak: Math.max(0, Math.floor(Number(peakCombo) || 0)),
    timeSpent: ROUND_SECONDS,
  }
}
