import { describe, it, expect } from 'vitest'
import {
  ZM_GREEN,
  ZM_GOLD,
  ZM_RED,
  SOURCE_2013,
  STRUCTURE_2013,
  CAREER_PATHWAYS_2013,
  FOCUS_AREAS_2013,
  GUIDING_PRINCIPLES_2013,
  NATIONAL_CONCERNS_2013,
  KEY_INSTRUMENTS_2013,
  OTHER_LEVELS_2013,
} from './frameworkData2013.js'

// Guards the 2013 curriculum reference data (drawn from the Zambia Education
// Curriculum Framework 2013). These pages are presentational, so the data
// module is where a regression — an emptied list or a malformed entry — would
// silently break a page. The generator/UI wiring is covered elsewhere.

describe('frameworkData2013', () => {
  it('exposes the Zambia flag accents and a source attribution', () => {
    for (const c of [ZM_GREEN, ZM_GOLD, ZM_RED]) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    }
    expect(SOURCE_2013).toMatch(/2013/)
    expect(SOURCE_2013.toLowerCase()).toContain('curriculum development centre')
  })

  it('describes the Grade 1–12 education structure', () => {
    expect(STRUCTURE_2013.length).toBeGreaterThanOrEqual(5)
    for (const row of STRUCTURE_2013) {
      expect(row).toHaveLength(2)
      expect(row[0]).toBeTruthy()
      expect(row[1]).toBeTruthy()
    }
    // The two-tier secondary reform is the whole point of the 2013 framework.
    const flat = STRUCTURE_2013.flat().join(' ')
    expect(flat).toMatch(/Junior Secondary/)
    expect(flat).toMatch(/Senior Secondary/)
  })

  it('names both career pathways', () => {
    expect(CAREER_PATHWAYS_2013).toHaveLength(2)
    const titles = CAREER_PATHWAYS_2013.map((p) => p.title).join(' ')
    expect(titles).toMatch(/Academic/)
    expect(titles).toMatch(/Vocational/)
    for (const p of CAREER_PATHWAYS_2013) {
      expect(p.emoji).toBeTruthy()
      expect(p.body.length).toBeGreaterThan(20)
    }
  })

  it('lists focus areas and guiding principles as [name, definition] pairs', () => {
    for (const list of [FOCUS_AREAS_2013, GUIDING_PRINCIPLES_2013]) {
      expect(list.length).toBeGreaterThan(0)
      for (const [name, def] of list) {
        expect(name).toBeTruthy()
        expect(def).toBeTruthy()
      }
    }
  })

  it('captures the 12 national concerns (cross-cutting themes)', () => {
    expect(NATIONAL_CONCERNS_2013).toHaveLength(12)
    const names = NATIONAL_CONCERNS_2013.map(([n]) => n)
    expect(new Set(names).size).toBe(names.length) // no duplicates
    expect(names.join(' ')).toMatch(/Special Educational Needs/)
    for (const [, def] of NATIONAL_CONCERNS_2013) {
      expect(def.length).toBeGreaterThan(20)
    }
  })

  it('groups key instruments into non-empty lists', () => {
    const groups = Object.entries(KEY_INSTRUMENTS_2013)
    expect(groups.length).toBeGreaterThan(0)
    for (const [, items] of groups) {
      expect(Array.isArray(items)).toBe(true)
      expect(items.length).toBeGreaterThan(0)
    }
  })

  it('describes the other levels (Teacher Ed, TEVET, Adult Literacy) fully', () => {
    expect(OTHER_LEVELS_2013).toHaveLength(3)
    for (const level of OTHER_LEVELS_2013) {
      expect(level.title).toBeTruthy()
      expect(level.range).toBeTruthy()
      expect(level.emoji).toBeTruthy()
      expect(level.notes).toBeTruthy()
      expect(level.facts.length).toBeGreaterThan(0)
      for (const [label, value] of level.facts) {
        expect(label).toBeTruthy()
        expect(value).toBeTruthy()
      }
    }
  })
})
