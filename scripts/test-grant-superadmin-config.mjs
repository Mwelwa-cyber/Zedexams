/**
 * scripts/test-grant-superadmin-config.mjs
 *
 * grant-superadmin.mjs used to hard-require GOOGLE_APPLICATION_CREDENTIALS,
 * which meant the only way to run it was to download a production
 * service-account private key onto a laptop. It now accepts Application
 * Default Credentials too — but ADC user credentials carry no project id, so
 * the script has to resolve one itself or firebase-admin throws "Unable to
 * detect a Project Id".
 *
 * That resolution order is a decision, not an implementation detail: it picks
 * which PRODUCTION project a role write lands in. These checks pin it.
 *
 * Plain-node test (throws on failure). Run: npm run test:grant-superadmin-config
 */

import assert from 'node:assert/strict'
import { resolveProjectId, resolveCredentialSource } from './grant-superadmin.mjs'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const RC = { projects: { default: 'examsprepzambia' } }

console.log('resolveProjectId — most explicit wins')

check('--project beats every environment variable', () => {
  const r = resolveProjectId({
    flag: 'from-flag',
    env: { GOOGLE_CLOUD_PROJECT: 'from-gcp', GCLOUD_PROJECT: 'from-gcloud' },
    firebaserc: RC,
  })
  assert.equal(r.projectId, 'from-flag')
  assert.equal(r.from, '--project')
})

check('GOOGLE_CLOUD_PROJECT beats GCLOUD_PROJECT', () => {
  const r = resolveProjectId({
    env: { GOOGLE_CLOUD_PROJECT: 'from-gcp', GCLOUD_PROJECT: 'from-gcloud' },
    firebaserc: RC,
  })
  assert.equal(r.projectId, 'from-gcp')
  assert.equal(r.from, 'GOOGLE_CLOUD_PROJECT')
})

check('GCLOUD_PROJECT beats .firebaserc', () => {
  const r = resolveProjectId({ env: { GCLOUD_PROJECT: 'from-gcloud' }, firebaserc: RC })
  assert.equal(r.projectId, 'from-gcloud')
  assert.equal(r.from, 'GCLOUD_PROJECT')
})

check('.firebaserc default is the fallback, so a bare ADC run still works', () => {
  const r = resolveProjectId({ env: {}, firebaserc: RC })
  assert.equal(r.projectId, 'examsprepzambia')
  assert.equal(r.from, '.firebaserc')
})

check('nothing resolvable reports null rather than guessing a project', () => {
  const r = resolveProjectId({ env: {}, firebaserc: { projects: {} } })
  assert.equal(r.projectId, null)
  assert.equal(r.from, null)
})

check('the repo .firebaserc really does declare a default (the fallback is live)', () => {
  const r = resolveProjectId({ env: {} })
  assert.equal(r.projectId, 'examsprepzambia')
  assert.equal(r.from, '.firebaserc')
})

console.log('resolveCredentialSource — the credential is named before it is used')

check('an explicit key file is reported as such', () => {
  const r = resolveCredentialSource({ GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' }, false)
  assert.equal(r.kind, 'service-account-key')
  assert.equal(r.detail, '/tmp/key.json')
})

check('a key file wins over a present ADC file', () => {
  const r = resolveCredentialSource(
    { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json', HOME: '/home/someone' },
    true,
  )
  assert.equal(r.kind, 'service-account-key')
})

check('a present ADC file is recognised without any env var', () => {
  const r = resolveCredentialSource({ HOME: '/home/someone' }, true)
  assert.equal(r.kind, 'adc-user')
  assert.ok(r.detail.endsWith('application_default_credentials.json'))
})

check('CLOUDSDK_CONFIG relocates the ADC path', () => {
  const r = resolveCredentialSource({ CLOUDSDK_CONFIG: '/custom/gcloud', HOME: '/home/someone' }, true)
  assert.equal(r.kind, 'adc-user')
  assert.ok(r.detail.startsWith('/custom/gcloud'))
})

check('no key and no ADC file reports none — the script must refuse, not guess', () => {
  const r = resolveCredentialSource({ HOME: '/home/someone' }, false)
  assert.equal(r.kind, 'none')
  assert.equal(r.detail, null)
})

check('no HOME and no CLOUDSDK_CONFIG is none, not a crash', () => {
  const r = resolveCredentialSource({}, null)
  assert.equal(r.kind, 'none')
})

console.log(`\n${passed} checks passed.`)
