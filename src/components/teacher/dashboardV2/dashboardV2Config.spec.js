/**
 * Regression guard for the teacher navigation taxonomy.
 *
 * History this protects. There used to be TWO nav configs — a curated
 * NAV_GROUPS for the dashboard and a full-map STUDIO_NAV_GROUPS for the
 * studio shell — and being two hand-maintained arrays, they said different
 * things about the same tools. After the 2026-07 Assessment Paper Studio
 * merge one of them still listed the pre-merge Test Paper and Exam Studio
 * entries, so the sidebar visibly "changed studios" between the dashboard and
 * any studio page. They are now ONE array; these tests hold the properties
 * that made the fork visible, so a future split fails here rather than on a
 * teacher's screen.
 */
import { describe, it, expect } from 'vitest'
import {
  TEACHER_NAV_GROUPS,
  QUICK_CREATE_TILES,
  WORKSPACE_TILES,
  WORKSPACE_EXPANDABLE,
  ALL_TOOLS,
  CANONICAL_TOOL_LABELS,
  canonicalToolLabel,
} from './dashboardV2Config'

const allItems = (groups) => groups.flatMap((g) => g.items)

/* The menu, exactly as specified. Written out in full rather than derived
   from the config, because a test that computes its expectation from the
   thing under test cannot fail. */
const CANONICAL_MENU = [
  ['root', null, ['Dashboard']],
  ['create', 'Create', ['Lesson Plans', 'Schemes of Work', 'Weekly Focus', 'Record of Work']],
  ['manage', 'Manage', [
    'My Library', 'Assessments', 'My Classes', 'Class List', 'Class Register',
    'Syllabi Studio', 'Curriculum', 'School Calendar',
  ]],
  ['settings', 'Settings', ['Subscription', 'Profile', 'Settings', 'Help & Support']],
]

describe('teacher nav config', () => {
  it('is the canonical menu, in order, with nothing added or dropped', () => {
    expect(TEACHER_NAV_GROUPS.map((g) => [g.id, g.label, g.items.map((i) => i.label)]))
      .toEqual(CANONICAL_MENU)
  })

  it('carries no pre-merge Test Paper / Exam Studio entries', () => {
    const labels = allItems(TEACHER_NAV_GROUPS).map((i) => i.label)
    expect(labels).not.toContain('Test Paper Studio')
    expect(labels).not.toContain('Exam Studio')
  })

  it('no two items share a destination (the duplicate-entry smell)', () => {
    const tos = allItems(TEACHER_NAV_GROUPS).map((i) => i.to)
    expect(new Set(tos).size).toBe(tos.length)
  })

  it('Subscription points inside the teacher area, not at the standalone page', () => {
    const item = allItems(TEACHER_NAV_GROUPS).find((i) => i.label === 'Subscription')
    expect(item.to).toBe('/teacher/subscription')
  })

  it('every item has a real destination and an icon', () => {
    for (const item of allItems(TEACHER_NAV_GROUPS)) {
      expect(item.to, `${item.label} has no destination`).toMatch(/^\//)
      expect(item.icon, `${item.label} has no icon`).toBeTruthy()
    }
  })
})

describe('canonical tool naming', () => {
  it('the sidebar label is the canonical name for every tool it lists', () => {
    for (const item of allItems(TEACHER_NAV_GROUPS)) {
      const canonical = canonicalToolLabel(item.to)
      // Dashboard/Profile/Settings/Help are destinations, not "tools", so
      // they need no entry — but where one exists it must agree.
      if (canonical) expect(canonical).toBe(item.label)
    }
  })

  /* One tool, one name. Every navigation surface that offers a tool has to
     call it what the sidebar calls it — "Lesson Plans", never "Lesson Plan"
     or "Lesson Plan Studio". ("Studio" survives in PAGE headers, which is
     product identity, not navigation.) */
  const SURFACES = [
    ['Quick Create tiles', QUICK_CREATE_TILES.map((t) => [t.title, t.to])],
    ['Workspace tiles', WORKSPACE_TILES.map((t) => [t.title, t.to])],
    ['Workspace sub-lists', WORKSPACE_EXPANDABLE.flatMap((g) => g.items.map((i) => [i.label, i.to]))],
    ['All-tools grid', ALL_TOOLS.map((t) => [t.label, t.to])],
  ]

  it.each(SURFACES)('%s use the canonical name for every tool', (_name, entries) => {
    for (const [label, to] of entries) {
      const canonical = canonicalToolLabel(to)
      if (canonical) expect(`${to} → ${label}`).toBe(`${to} → ${canonical}`)
    }
  })

  it('one destination never carries two names across surfaces', () => {
    const byRoute = new Map()
    for (const [, entries] of SURFACES) {
      for (const [label, to] of entries) {
        const route = to.split('?')[0]
        if (!byRoute.has(route)) byRoute.set(route, new Set())
        byRoute.get(route).add(label)
      }
    }
    const conflicts = [...byRoute]
      .filter(([, names]) => names.size > 1)
      .map(([route, names]) => `${route}: ${[...names].join(' / ')}`)
    expect(conflicts).toEqual([])
  })

  it('every canonical label maps a route, not a tool id', () => {
    for (const route of Object.keys(CANONICAL_TOOL_LABELS)) {
      expect(route).toMatch(/^\/teacher\//)
    }
  })
})

describe('tools kept out of the sidebar stay reachable', () => {
  /* Worksheet and Homework are deliberately NOT in the permanent menu. That
     is only acceptable while another surface still offers them — otherwise
     "kept short" quietly becomes "unreachable". */
  const OFF_MENU_TOOLS = ['/teacher/generate/worksheet', '/teacher/generate/homework']

  it.each(OFF_MENU_TOOLS)('%s is absent from the sidebar', (route) => {
    expect(allItems(TEACHER_NAV_GROUPS).map((i) => i.to)).not.toContain(route)
  })

  it.each(OFF_MENU_TOOLS)('%s is still offered by another surface', (route) => {
    const offered = SURFACE_ROUTES().includes(route)
    expect(offered).toBe(true)
  })

  function SURFACE_ROUTES() {
    return [
      ...QUICK_CREATE_TILES.map((t) => t.to),
      ...WORKSPACE_TILES.map((t) => t.to),
      ...WORKSPACE_EXPANDABLE.flatMap((g) => g.items.map((i) => i.to)),
      ...ALL_TOOLS.map((t) => t.to),
    ]
  }
})
