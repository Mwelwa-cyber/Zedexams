/**
 * Unit tests for the central friendly-error translator
 * (src/utils/friendlyErrors.js).
 *
 * Locks the contract the whole app relies on: a learner must NEVER see a raw
 * Firebase code / stack trace / "Internal Server Error (500)", and each
 * friendly error must carry a title, a calm message, and at least one
 * actionable button. Pure module → runs under plain `node`.
 *
 * Run: node src/utils/friendlyErrors.test.js   (npm run test:friendly-errors)
 */
import assert from 'node:assert'
import {
  ACTIONS,
  SEVERITY,
  TEMPLATES,
  toFriendlyError,
  friendlyTemplate,
  friendlyMessage,
  friendlyAuthMessage,
  normalizeError,
  looksOffline,
  technicalDetails,
} from './friendlyErrors.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}
const eq = (name, a, b) => ok(`${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, a === b)

// A friendly error is only useful if it never leaks raw tech and always
// gives the learner something to do. Assert that invariant on every result.
const TECH_LEAKS = [/firebase/i, /firestore/i, /stack/i, /undefined/, /\bnull\b/, /\[object/i]
function assertSafe(name, friendly) {
  ok(`${name}: has title`, typeof friendly.title === 'string' && friendly.title.length > 0)
  ok(`${name}: has message`, typeof friendly.message === 'string' && friendly.message.length > 0)
  ok(`${name}: has >=1 action`, Array.isArray(friendly.actions) && friendly.actions.length >= 1)
  ok(
    `${name}: message leaks no tech`,
    !TECH_LEAKS.some((re) => re.test(friendly.title + ' ' + friendly.message)),
  )
}

console.log('friendlyErrors — normalizeError')
eq('string → message', normalizeError('boom').message, 'boom')
eq('null → empty', normalizeError(null).message, '')
eq('Error.message', normalizeError(new Error('nope')).message, 'nope')
eq('firebase code surfaces', normalizeError({ code: 'auth/wrong-password' }).code, 'auth/wrong-password')
eq('status field', normalizeError({ status: 503 }).status, 503)
eq('statusCode field', normalizeError({ statusCode: 500 }).status, 500)
eq('status parsed from message', normalizeError({ message: 'Internal Server Error (500)' }).status, 500)
eq('status parsed "status code 503"', normalizeError({ message: 'Request failed with status code 503' }).status, 503)

console.log('\nfriendlyErrors — looksOffline')
ok('explicit online=false', looksOffline(new Error('anything'), { online: false }))
ok('auth/network-request-failed', looksOffline({ code: 'auth/network-request-failed' }))
ok('unavailable code', looksOffline({ code: 'unavailable' }))
ok('functions/unavailable code', looksOffline({ code: 'functions/unavailable' }))
ok('failed to fetch message', looksOffline(new Error('Failed to fetch')))
ok('not offline for plain error', !looksOffline(new Error('boom')))
ok('online=true does not force offline', !looksOffline(new Error('boom'), { online: true }))

console.log('\nfriendlyErrors — network always wins over generic')
{
  const f = toFriendlyError(new Error('boom'), { online: false })
  eq('offline → network title', f.title, TEMPLATES.network.title)
  ok('offline → has Continue Offline', f.actions.includes(ACTIONS.CONTINUE_OFFLINE))
  assertSafe('network', f)
}

console.log('\nfriendlyErrors — auth codes')
{
  const wp = toFriendlyError({ code: 'auth/wrong-password' })
  eq('wrong-password title', wp.title, 'Incorrect Password')
  ok('wrong-password → Forgot Password', wp.actions.includes(ACTIONS.FORGOT_PASSWORD))
  assertSafe('wrong-password', wp)

  const nf = toFriendlyError({ code: 'auth/user-not-found' })
  eq('user-not-found title', nf.title, 'Account Not Found')
  ok('user-not-found → Create Account', nf.actions.includes(ACTIONS.CREATE_ACCOUNT))

  eq('invalid-credential maps to wrong password', toFriendlyError({ code: 'auth/invalid-credential' }).title, 'Incorrect Password')
  eq('too-many-requests → Too Many Attempts', toFriendlyError({ code: 'auth/too-many-requests' }).title, 'Too Many Attempts')
  eq('requires-recent-login → Session Expired', toFriendlyError({ code: 'auth/requires-recent-login' }).title, 'Session Expired')
}

console.log('\nfriendlyErrors — permission / session / functions codes')
eq('permission-denied → Access Restricted', toFriendlyError({ code: 'permission-denied' }).title, 'Access Restricted')
eq('functions/permission-denied → Access Restricted', toFriendlyError({ code: 'functions/permission-denied' }).title, 'Access Restricted')
eq('unauthenticated → Session Expired', toFriendlyError({ code: 'unauthenticated' }).title, 'Session Expired')
eq('resource-exhausted → Daily Limit Reached', toFriendlyError({ code: 'functions/resource-exhausted' }).title, 'Daily Limit Reached')
eq('internal → server', toFriendlyError({ code: 'internal' }).title, 'Something Went Wrong')

console.log('\nfriendlyErrors — storage codes')
eq('quota-exceeded → Storage Limit Reached', toFriendlyError({ code: 'storage/quota-exceeded' }).title, 'Storage Limit Reached')
eq('storage/unauthorized → Access Restricted', toFriendlyError({ code: 'storage/unauthorized' }).title, 'Access Restricted')

console.log('\nfriendlyErrors — HTTP status families')
eq('401 → Session Expired', toFriendlyError({ status: 401 }).title, 'Session Expired')
eq('403 → Access Restricted', toFriendlyError({ status: 403 }).title, 'Access Restricted')
eq('500 → server', toFriendlyError({ status: 500 }).title, 'Something Went Wrong')
eq('503 → server', toFriendlyError({ status: 503 }).title, 'Something Went Wrong')
eq('504 → timeout', toFriendlyError({ status: 504 }).title, 'This Is Taking Too Long')
eq('429 default → Daily Limit', toFriendlyError({ status: 429 }).title, 'Daily Limit Reached')
eq('429 in auth → Too Many Attempts', toFriendlyError({ status: 429 }, { category: 'auth' }).title, 'Too Many Attempts')

console.log('\nfriendlyErrors — domain category fallback')
eq('payment category fallback', toFriendlyError(new Error('weird'), { category: 'payment' }).title, 'Payment Unsuccessful')
eq('ai category fallback', toFriendlyError(new Error('weird'), { category: 'ai' }).title, "AI Couldn't Complete Your Request")
eq('quiz category fallback', toFriendlyError(new Error('weird'), { category: 'quiz' }).title, 'Quiz Not Available')
eq('download category fallback', toFriendlyError(new Error('weird'), { category: 'download' }).title, 'Download Failed')
// payment resource-exhausted should NOT be mis-read as the AI cap
eq('payment resource-exhausted stays payment', toFriendlyError({ code: 'resource-exhausted' }, { category: 'payment' }).title, 'Payment Unsuccessful')

console.log('\nfriendlyErrors — generic catch-all stays safe')
{
  const g = toFriendlyError(new Error('TypeError: x is undefined'))
  eq('unknown → generic title', g.title, 'Something Went Wrong')
  ok('generic → Report Problem offered', g.actions.includes(ACTIONS.REPORT_PROBLEM))
  assertSafe('generic', g)
}

console.log('\nfriendlyErrors — every template is well-formed')
for (const key of Object.keys(TEMPLATES)) {
  assertSafe(`template:${key}`, friendlyTemplate(key))
  ok(`template:${key} severity valid`, Object.values(SEVERITY).includes(TEMPLATES[key].severity))
  ok(`template:${key} has icon`, typeof TEMPLATES[key].icon === 'string' && TEMPLATES[key].icon.length > 0)
}

console.log('\nfriendlyErrors — friendlyTemplate returns fresh, overridable copies')
{
  const a = friendlyTemplate('network')
  const b = friendlyTemplate('network')
  ok('distinct objects', a !== b)
  ok('distinct action arrays', a.actions !== b.actions)
  eq('override title applied', friendlyTemplate('network', { title: 'Custom' }).title, 'Custom')
  eq('unknown key → generic', friendlyTemplate('does-not-exist').category, 'unknown')
}

console.log('\nfriendlyErrors — friendlyMessage')
eq('maps code to message', friendlyMessage({ code: 'auth/wrong-password' }), 'The password you entered is incorrect. Please try again.')
eq('uses fallback only for unknown', friendlyMessage(new Error('weird'), 'Custom fallback.'), 'Custom fallback.')
eq('known error ignores fallback', friendlyMessage({ status: 500 }, 'Custom fallback.'), TEMPLATES.server.message)

console.log('\nfriendlyErrors — friendlyAuthMessage')
{
  // Known codes map to calm inline copy.
  eq('wrong-password inline', friendlyAuthMessage('auth/wrong-password'), 'Wrong password. Please try again.')
  eq('unmapped falls back (signin)', friendlyAuthMessage('auth/whatever'), 'Login failed. Please try again.')
  eq('unmapped falls back (signup)', friendlyAuthMessage('auth/whatever', { flow: 'signup' }), 'Registration failed. Please try again.')
  eq('custom fallback honoured', friendlyAuthMessage('auth/whatever', { fallback: 'Nope.' }), 'Nope.')

  // The core fix: a network failure while the device is ONLINE must NOT tell
  // the user to check a connection that plainly works — it points at the real
  // culprit (a VPN / ad-blocker / extension / network blocking Google's
  // sign-in server) instead. Both auth methods surface this same code.
  const offlineCopy = friendlyAuthMessage('auth/network-request-failed')
  const onlineCopy = friendlyAuthMessage('auth/network-request-failed', { online: true })
  ok('online network copy differs from offline copy', onlineCopy !== offlineCopy)
  ok('online copy does NOT blame the user connection', !/check your connection/i.test(onlineCopy))
  ok('online copy names a real culprit', /(vpn|ad-?block|extension|browser|network)/i.test(onlineCopy))
  ok('online copy keeps the sign-in verb', /sign in/i.test(onlineCopy))
  ok('offline (online omitted) keeps connection guidance', /connection/i.test(offlineCopy))
  ok('offline (online=false) keeps connection guidance', /connection/i.test(friendlyAuthMessage('auth/network-request-failed', { online: false })))
  ok('online copy uses sign-up verb under signup flow', /sign up/i.test(friendlyAuthMessage('auth/network-request-failed', { online: true, flow: 'signup' })))
  // A non-network code must ignore the online hint entirely.
  eq('online hint ignored for non-network code', friendlyAuthMessage('auth/wrong-password', { online: true }), 'Wrong password. Please try again.')
}

console.log('\nfriendlyErrors — technicalDetails keeps the raw signal for admins')
{
  const t = technicalDetails({ code: 'permission-denied', message: 'Missing or insufficient permissions.' })
  eq('keeps code', t.code, 'permission-denied')
  eq('keeps category', t.category, 'permission')
  ok('keeps raw message for devs', t.rawMessage.includes('insufficient permissions'))
  const t2 = technicalDetails({ status: 500 })
  eq('http status encoded as code', t2.code, 'http/500')
  eq('status kept', t2.status, 500)
}

console.log(`\n✓ friendlyErrors: ${passed} assertions passed`)
