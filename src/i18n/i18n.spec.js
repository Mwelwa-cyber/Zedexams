/**
 * i18n fallback contract (audit A7).
 *
 * Locks in the behaviour the per-file `_TODO` notes promise translators:
 * a Nyanja key that is present and non-empty is used; a key left empty (""),
 * or omitted entirely, falls back to the English baseline rather than
 * rendering blank. This guards the `returnEmptyString: false` init option in
 * ./index.js — without it, i18next would treat "" as a valid translation and
 * the UI would show gaps for every not-yet-translated string.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import i18n from './index.js'

describe('i18n Nyanja fallback', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ny')
  })

  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('uses the real Nyanja string when one is provided', () => {
    expect(i18n.t('welcome')).toBe('Mwakhala bwanji')
    expect(i18n.t('language.label')).toBe('Chiyankhulo')
  })

  it('falls back to English for an empty Nyanja value', () => {
    // common.json ships "" for these — must degrade to English, not "".
    expect(i18n.t('actions.save')).toBe('Save')
    expect(i18n.t('nav.dashboard')).toBe('Home')
  })

  it('falls back to English across namespaces and through interpolation', () => {
    expect(i18n.t('hero.greetingFallback', { ns: 'dashboard' })).toBe('Welcome back!')
    expect(i18n.t('hero.greeting', { ns: 'dashboard', name: 'Mwila' })).toBe(
      'Welcome back, Mwila!',
    )
  })
})
