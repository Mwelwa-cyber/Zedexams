/**
 * Unit tests for friendly form validation (src/utils/formValidation.js).
 *
 * Locks the spec's exact field-level copy ("Enter your email address.",
 * "Please select a subject.", "Password must contain at least 8
 * characters.") and the scroll-to-first-error behaviour. Pure module +
 * an injected element resolver → runs under plain `node`.
 *
 * Run: node src/utils/formValidation.test.js   (npm run test:form-validation)
 */
import assert from 'node:assert'
import {
  validateRule,
  validateFields,
  hasErrors,
  firstErrorField,
  focusFirstError,
} from './formValidation.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}
const eq = (name, a, b) => ok(`${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, a === b)

console.log('formValidation — required messages match the spec copy')
eq('empty email', validateRule('', 'required', 'email'), 'Enter your email address.')
eq('empty password', validateRule('', 'required', 'password'), 'Please enter your password.')
eq('empty subject → select', validateRule('', 'required', 'subject'), 'Please select a subject.')
eq('empty grade → choose', validateRule('', 'required', 'grade'), 'Please choose a grade.')
eq('generic field', validateRule('', 'required', 'title'), 'Please enter your title.')
eq('whitespace counts as empty', validateRule('   ', 'required', 'name'), 'Please enter your name.')
eq('empty array (multiselect)', validateRule([], 'required', 'topics'), 'Please enter your topics.')
eq('present value passes', validateRule('x', 'required', 'email'), '')

console.log('\nformValidation — email rule')
eq('bad email', validateRule('not-an-email', 'email', 'email'), 'Please enter a valid email address.')
eq('good email', validateRule('a@b.co', 'email', 'email'), '')
eq('email rule skips empty (required owns that)', validateRule('', 'email', 'email'), '')

console.log('\nformValidation — min length')
eq('password too short', validateRule('abc', { min: 8 }, 'password'), 'Password must contain at least 8 characters.')
eq('password long enough', validateRule('abcdefgh', { min: 8 }, 'password'), '')
eq('generic min', validateRule('ab', { min: 5 }, 'name'), 'Your name must be at least 5 characters.')

console.log('\nformValidation — passwordPolicy rule (delegates to passwordPolicy.js)')
eq('trailing space refused', validateRule('Zambia2026 ', 'passwordPolicy', 'password'), 'Your password cannot start or end with a space.')
eq('leading space refused', validateRule(' Zambia2026', 'passwordPolicy', 'password'), 'Your password cannot start or end with a space.')
eq('interior space allowed — a passphrase is not a defect', validateRule('my dog rex', 'passwordPolicy', 'password'), '')
eq('short password still reports the minimum', validateRule('abc', 'passwordPolicy', 'password'), 'Password must contain at least 6 characters.')
eq('a good password passes', validateRule('abcdef', 'passwordPolicy', 'password'), '')

console.log('\nformValidation — match + pattern')
eq('mismatch', validateRule('a', { match: 'confirmPassword', value: 'b' }, 'confirmPassword'), 'Your password confirmation does not match.')
eq('match ok', validateRule('a', { match: 'confirmPassword', value: 'a' }, 'confirmPassword'), '')
eq('pattern custom message', validateRule('12', { pattern: /^\d{4}$/, message: 'Enter a 4-digit PIN.' }, 'pin'), 'Enter a 4-digit PIN.')

{
  // The schema Register.jsx actually uses. A space-padded password must fail
  // the form, not reach createUserWithEmailAndPassword.
  const errors = validateFields(
    { email: 'a@b.co', password: 'Zambia2026 ' },
    { email: ['required', 'email'], password: ['required', 'passwordPolicy'] },
  )
  eq('padded password blocks the form', errors.password, 'Your password cannot start or end with a space.')
  ok('a clean password leaves no error', !validateFields(
    { email: 'a@b.co', password: 'Zambia2026' },
    { email: ['required', 'email'], password: ['required', 'passwordPolicy'] },
  ).password)
}

console.log('\nformValidation — validateFields keeps order + first failure per field')
{
  const errors = validateFields(
    { email: '', password: 'short', subject: '' },
    { email: ['required', 'email'], password: ['required', { min: 8 }], subject: ['required'] },
  )
  eq('email error', errors.email, 'Enter your email address.')
  eq('password min error (required passed)', errors.password, 'Password must contain at least 8 characters.')
  eq('subject error', errors.subject, 'Please select a subject.')
  ok('hasErrors true', hasErrors(errors))
  eq('first error field is top-most', firstErrorField(errors), 'email')
}
{
  const clean = validateFields({ email: 'a@b.co' }, { email: ['required', 'email'] })
  ok('no errors when valid', !hasErrors(clean))
  eq('firstErrorField null when clean', firstErrorField(clean), null)
}

console.log('\nformValidation — focusFirstError scrolls + focuses the first invalid field')
{
  const focused = []
  const scrolled = []
  const fakeEl = {
    focus: () => focused.push('email'),
    scrollIntoView: () => scrolled.push('email'),
  }
  const errors = { email: 'Enter your email address.', password: 'too short' }
  const returned = focusFirstError(errors, { getElement: (name) => (name === 'email' ? fakeEl : null) })
  ok('returned the resolved element', returned === fakeEl)
  eq('focused the first field only', focused.length, 1)
  eq('scrolled to it', scrolled.length, 1)
  eq('focusFirstError null on clean', focusFirstError({}), null)
  ok('missing element resolves to null safely', focusFirstError({ x: 'bad' }, { getElement: () => null }) === null)
}

console.log(`\n✓ formValidation: ${passed} assertions passed`)
