import { describe, it, expect } from 'vitest'
import { normalizeQuery, scoreItem, rankResults, groupByType, buildResultItems } from './learnerSearch'

describe('normalizeQuery', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeQuery('  Photo   Synthesis ')).toBe('photo synthesis')
    expect(normalizeQuery(null)).toBe('')
    expect(normalizeQuery(undefined)).toBe('')
    expect(normalizeQuery('   ')).toBe('')
  })
})

describe('scoreItem', () => {
  const item = { title: 'Fractions', subject: 'Mathematics', topic: 'Numbers' }
  it('ranks exact > startsWith > contains(title) > metadata', () => {
    expect(scoreItem({ title: 'fractions' }, 'fractions')).toBe(100)
    expect(scoreItem({ title: 'Fractions Basics' }, 'fractions')).toBe(80)
    expect(scoreItem({ title: 'Adding Fractions' }, 'fractions')).toBeGreaterThan(20)
    expect(scoreItem({ title: 'Adding Fractions' }, 'fractions')).toBeLessThan(60)
    expect(scoreItem(item, 'mathematics')).toBe(20) // metadata-only hit
  })

  it('scores an earlier title position higher than a later one', () => {
    const early = scoreItem({ title: 'x fractions here' }, 'fractions')
    const late = scoreItem({ title: 'a very long lead in before fractions' }, 'fractions')
    expect(early).toBeGreaterThan(late)
  })

  it('returns 0 for no match or empty needle', () => {
    expect(scoreItem(item, 'geography')).toBe(0)
    expect(scoreItem(item, '')).toBe(0)
    expect(scoreItem(null, 'x')).toBe(0)
  })
})

describe('rankResults', () => {
  const items = [
    { id: 'a', type: 'quiz', title: 'Adding Fractions', subject: 'Mathematics' },
    { id: 'b', type: 'note', title: 'Fractions', subject: 'Mathematics' },
    { id: 'c', type: 'game', title: 'Geography Quest', subject: 'Social Studies' },
    { id: 'd', type: 'paper', title: 'Maths', subject: 'Mathematics', topic: 'fractions and decimals' },
  ]

  it('returns only matches, ranked by relevance', () => {
    const out = rankResults('fractions', items)
    expect(out.map((r) => r.id)).toEqual(['b', 'a', 'd']) // exact, title-contains, metadata
    expect(out.find((r) => r.id === 'c')).toBeUndefined()
  })

  it('returns [] for an empty query or non-array input', () => {
    expect(rankResults('', items)).toEqual([])
    expect(rankResults('fractions', null)).toEqual([])
  })

  it('tie-breaks alphabetically by title', () => {
    const same = [
      { id: '1', title: 'Zebra science', subject: 's' },
      { id: '2', title: 'Alpha science', subject: 's' },
    ]
    // both are title-contains at the same offset → equal score → alpha order
    expect(rankResults('science', same).map((r) => r.title))
      .toEqual(['Alpha science', 'Zebra science'])
  })
})

describe('buildResultItems', () => {
  it('normalises each source with the correct type + opening route', () => {
    const items = buildResultItems({
      quizzes: [{ id: 'q1', title: 'Fractions', subject: 'Mathematics', topic: 'Numbers' }],
      notes: [{ id: 'n1', title: 'Cells', subject: 'Science' }],
      papers: [{ id: 'p1', title: 'ECZ 2024', subject: 'Maths', year: 2024 }],
      games: [{ id: 'g1', title: 'Word Builder', subject: 'English', description: 'Spell words' }],
    })
    expect(items.find((i) => i.id === 'q1')).toMatchObject({ type: 'quiz', route: '/quiz/q1' })
    expect(items.find((i) => i.id === 'n1')).toMatchObject({ type: 'note', route: '/notes/n1' })
    expect(items.find((i) => i.id === 'p1')).toMatchObject({ type: 'paper', route: '/papers/p1', subtitle: 'Maths · 2024' })
    expect(items.find((i) => i.id === 'g1')).toMatchObject({ type: 'game', route: '/games/play/g1' })
  })

  it('tolerates missing lists and drops items without an id', () => {
    expect(buildResultItems()).toEqual([])
    expect(buildResultItems({ quizzes: [{ title: 'no id' }] })).toEqual([])
  })
})

describe('groupByType', () => {
  it('buckets results by type, preserving order', () => {
    const g = groupByType([
      { type: 'quiz', id: '1' }, { type: 'note', id: '2' },
      { type: 'quiz', id: '3' }, { type: 'game', id: '4' },
    ])
    expect(g.quiz.map((r) => r.id)).toEqual(['1', '3'])
    expect(g.note.map((r) => r.id)).toEqual(['2'])
    expect(g.game.map((r) => r.id)).toEqual(['4'])
    expect(g.paper).toEqual([])
  })

  it('ignores unknown types and handles empty input', () => {
    expect(groupByType([{ type: 'mystery' }]).quiz).toEqual([])
    expect(groupByType(null)).toEqual({ quiz: [], note: [], paper: [], game: [] })
  })
})
