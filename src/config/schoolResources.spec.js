import { describe, it, expect } from 'vitest'
import {
  SCHOOL_RESOURCE_LEVELS,
  DEFAULT_SCHOOL_RESOURCES,
  schoolResourcePromptLines,
  schoolResourceLabel,
} from './schoolResources.js'
// Server mirror — the two files must stay in lock-step (same pattern as
// learningEnvironments). Importing the CommonJS module directly makes the
// sync a test failure instead of a comment nobody reads.
import serverMirror from '../../functions/teacherTools/schoolResources.js'

describe('schoolResources — definitions', () => {
  it('offers exactly the low / basic / full levels', () => {
    expect(SCHOOL_RESOURCE_LEVELS.map((l) => l.value)).toEqual(['low', 'basic', 'full'])
  })

  it('defaults to basic (most Zambian classrooms), not well-resourced', () => {
    expect(DEFAULT_SCHOOL_RESOURCES).toBe('basic')
  })

  it('every level has a label and at least one prompt line starting "- School resources:"', () => {
    for (const level of SCHOOL_RESOURCE_LEVELS) {
      expect(level.label.length).toBeGreaterThan(0)
      expect(level.promptLines.length).toBeGreaterThan(0)
      expect(level.promptLines[0]).toMatch(/^- School resources:/)
    }
  })

  it('the low-resource level forbids equipment a village school lacks', () => {
    const lines = schoolResourcePromptLines('low').join(' ')
    expect(lines).toContain('LOW-RESOURCE RURAL SCHOOL')
    expect(lines).toMatch(/HARD CONSTRAINT/)
    expect(lines).toMatch(/printing|photocop/i)
    expect(lines).toMatch(/electricity/i)
  })
})

describe('schoolResources — helpers', () => {
  it('schoolResourcePromptLines returns [] for unknown or empty values', () => {
    expect(schoolResourcePromptLines('')).toEqual([])
    expect(schoolResourcePromptLines(null)).toEqual([])
    expect(schoolResourcePromptLines('mega')).toEqual([])
  })

  it('schoolResourcePromptLines is case-insensitive', () => {
    expect(schoolResourcePromptLines('LOW')).toEqual(schoolResourcePromptLines('low'))
  })

  it('schoolResourceLabel resolves labels and falls back to ""', () => {
    expect(schoolResourceLabel('basic')).toMatch(/chalkboard/i)
    expect(schoolResourceLabel('bogus')).toBe('')
  })
})

describe('schoolResources — server mirror stays in sync', () => {
  it('functions/teacherTools/schoolResources.js has identical values and prompt lines', () => {
    expect(serverMirror.SCHOOL_RESOURCE_LEVELS.map((l) => l.value))
      .toEqual(SCHOOL_RESOURCE_LEVELS.map((l) => l.value))
    for (const clientLevel of SCHOOL_RESOURCE_LEVELS) {
      const serverLevel = serverMirror.SCHOOL_RESOURCE_LEVELS
        .find((l) => l.value === clientLevel.value)
      expect(serverLevel.promptLines).toEqual(clientLevel.promptLines)
      expect(serverLevel.label).toEqual(clientLevel.label)
    }
  })
})
