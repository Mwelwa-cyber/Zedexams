import { describe, expect, it } from 'vitest'
import { STUDIOS } from '../../../lib/library/studios.js'
import { FOLDER_TINTS, NEUTRAL_TINT, STUDIO_ICONS, studioIcon, studioTint } from './studioPresentation'

/**
 * The registry stores `icon` and `tint` as name tokens so it stays pure and
 * node-testable. That is only safe if a token that does not resolve fails the
 * build — otherwise the first symptom is a blank card in production.
 */
describe('studio presentation tokens', () => {
  it('every registry icon token resolves to a real component', () => {
    for (const studio of STUDIOS) {
      expect(STUDIO_ICONS[studio.icon], `${studio.id}: unknown icon "${studio.icon}"`).toBeDefined()
      expect(studioIcon(studio.icon)).toBe(STUDIO_ICONS[studio.icon])
    }
  })

  it('every registry tint token resolves to a palette', () => {
    for (const studio of STUDIOS) {
      const tint = FOLDER_TINTS[studio.tint]
      expect(tint, `${studio.id}: unknown tint "${studio.tint}"`).toBeDefined()
      for (const key of ['from', 'to', 'border', 'tab']) {
        expect(tint[key]).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('each studio keeps its own tint — no two folders look identical', () => {
    const tints = STUDIOS.map((s) => s.tint)
    expect(new Set(tints).size).toBe(tints.length)
  })

  it('an unknown token falls back rather than rendering nothing', () => {
    expect(studioTint('not-a-tint')).toBe(NEUTRAL_TINT)
    expect(studioIcon('NotAnIcon')).toBeDefined()
  })
})
