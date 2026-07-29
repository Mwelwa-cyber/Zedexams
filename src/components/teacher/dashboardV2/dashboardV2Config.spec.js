/**
 * Regression guard for the dashboard sidebar's nav taxonomy.
 *
 * Bug: after the 2026-07 Assessment Paper Studio merge (Test Paper Studio +
 * Exam Studio → one studio), NAV_GROUPS (the /teacher dashboard sidebar) kept
 * the two pre-merge entries while STUDIO_NAV_GROUPS (the studio shell) was
 * updated — so the sidebar visibly "changed studios" between the dashboard
 * and any studio page, resurfacing Test/Exam Studio entries that both pointed
 * at the same merged route.
 */
import { describe, it, expect } from 'vitest'
import { NAV_GROUPS, STUDIO_NAV_GROUPS } from './dashboardV2Config'

const allItems = (groups) => groups.flatMap((g) => g.items)

describe('dashboardV2 nav config', () => {
  it('carries no pre-merge Test Paper / Exam Studio entries in either sidebar', () => {
    for (const groups of [NAV_GROUPS, STUDIO_NAV_GROUPS]) {
      const labels = allItems(groups).map((i) => i.label)
      expect(labels).not.toContain('Test Paper Studio')
      expect(labels).not.toContain('Exam Studio')
    }
  })

  it('dashboard sidebar Create group links the merged Assessment Studio', () => {
    const create = NAV_GROUPS.find((g) => g.id === 'create')
    const assessment = create.items.find((i) => i.label === 'Assessment Studio')
    expect(assessment).toBeTruthy()
    expect(assessment.to).toBe('/teacher/assessment-papers/new')
  })

  it('no two items within a sidebar share a destination (the duplicate-entry smell)', () => {
    for (const groups of [NAV_GROUPS, STUDIO_NAV_GROUPS]) {
      const tos = allItems(groups).map((i) => i.to)
      expect(new Set(tos).size).toBe(tos.length)
    }
  })
})
