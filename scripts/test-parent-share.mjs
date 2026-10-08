/**
 * The message a learner sends their parent on WhatsApp.
 * Guards: first person, topics only, no raw numbers or names, safe encoding.
 */
import assert from 'node:assert/strict'
import { buildResultMessage, buildWeekMessage, whatsappShareUrl } from '../src/shared/utils/parentShare.js'

// A count beats a percentage when the screen shows one.
const a = buildResultMessage({ subject: 'Maths', correct: 8, total: 10, weakTopic: 'Fractions' })
assert.match(a, /I scored 8 out of 10 in Maths on ZedExams today\. 🎉/)
assert.match(a, /practise more: Fractions\./)
assert.ok(a.endsWith('zedexams.com'))

// Percentage path, below the pass mark: no celebration, no topic line.
const b = buildResultMessage({ subject: 'English', percentage: 45.4 })
assert.match(b, /I scored 45% in English/)
assert.ok(!b.includes('🎉'))
assert.ok(!b.includes('practise more'))

// No score at all: say so honestly rather than inventing one.
const c = buildResultMessage({ subject: 'Science' })
assert.match(c, /finished a Science quiz/)
assert.ok(!/\d+%|out of/.test(c))

// Junk never prints NaN/undefined; out-of-range percentages are clamped.
assert.ok(!/NaN|undefined|null/.test(buildResultMessage({ percentage: 'abc', subject: null })))
assert.match(buildResultMessage({ percentage: 250 }), /100%/)

// A long topic is clipped.
assert.ok(buildResultMessage({ weakTopic: 'x'.repeat(200) }).split('\n')[1].length < 100)

// Week.
const w = buildWeekMessage({ daysPlayed: 5, weakTopics: [{ topic: 'Fractions' }, 'Decimals', 'Ratio'] })
assert.match(w, /on 5 out of 7 days\. 🎉/)
assert.match(w, /Fractions, Decimals\./)
assert.ok(!w.includes('Ratio'))
assert.match(buildWeekMessage({ daysPlayed: 0 }), /getting ready to study/)
assert.match(buildWeekMessage({ daysPlayed: 99 }), /7 out of 7/)

// URL: no phone number (the learner picks the contact), text fully encoded.
const url = whatsappShareUrl('Hi & bye\nzedexams.com')
assert.equal(url, 'https://wa.me/?text=Hi%20%26%20bye%0Azedexams.com')

console.log('parent-share: all checks passed')
