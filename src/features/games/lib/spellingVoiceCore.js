/**
 * Which device voice a spelling word is spoken with — the pure half.
 *
 * Split out of `spellingSpeech.js` for the reason `metaWhatsAppCore.js` is
 * split out of `metaWhatsApp.js`: the speech module now imports
 * `src/utils/tts`, which reaches Firebase, so it cannot be loaded under plain
 * `node`. This part CAN be, and it is the part most worth testing — an accent
 * order is a list, and a list silently in the wrong order is invisible on
 * screen and audible only to a learner.
 *
 * A BRITISH-FORMS ENGLISH, ALWAYS. ECZ marks British spelling, and a US voice
 * says "zee" for the letter Z and reads "practise" as "practice". Within that
 * rule the accent is ordered: en-ZA first, then en-GB, then the other African
 * and Commonwealth Englishes, and only then en-US. A Zambian learner has heard
 * a South African accent all their life and a Midwestern one on television;
 * the first is easier to spell along with.
 *
 * No imports, no DOM, no Firebase. Keep it that way — the whole point is that
 * `node scripts/test-spelling-ride.mjs` can read it.
 */

/**
 * Accent order. British forms first, then the Englishes a Zambian learner is
 * most likely to have heard, then anything.
 */
export const VOICE_PREFERENCE = Object.freeze([
  'en-za', 'en-gb', 'en-ke', 'en-ng', 'en-in', 'en-au', 'en-us', 'en',
])

/**
 * Pick a voice out of a device list, by the preference order above.
 *
 * A device that offers no English at all returns null rather than a French
 * voice reading English words — the caller then speaks with no explicit voice
 * and lets the platform decide, which is the least-worst of two bad options.
 */
export function resolveVoice(voices = []) {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : []
  if (!list.length) return null
  const langOf = (v) => String(v.lang || '').replace('_', '-').toLowerCase()
  for (const wanted of VOICE_PREFERENCE) {
    const hit = list.find((v) => langOf(v).indexOf(wanted) === 0)
    if (hit) return hit
  }
  return list.find((v) => langOf(v).indexOf('en') === 0) || null
}
