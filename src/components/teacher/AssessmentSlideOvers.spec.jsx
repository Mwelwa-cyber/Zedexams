import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockPickerSlide } from './AssessmentSlideOvers.jsx'

// The block picker is a static tile grid — mount it directly with an onPick
// spy and assert every tile fires the key handleBlockPick expects. Guards the
// "Diagram-based" mis-wire (it used to fire 'structured', identical to the
// Structured tile, so picking it silently produced a figure-less block).

// Keep the live Firebase app (pulled transitively via the syllabus-topic
// hook → KB services) out of this jsdom run — same stubs as
// AssessmentStudio.spec.jsx.
vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {}, storage: {}, app: {} }))
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => vi.fn() }))
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(),
  addDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  serverTimestamp: vi.fn(), writeBatch: vi.fn(), onSnapshot: vi.fn(),
}))

function pickFromTile(title) {
  const onPick = vi.fn()
  render(<BlockPickerSlide open onClose={() => {}} onPick={onPick} />)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }))
  expect(onPick).toHaveBeenCalledTimes(1)
  return onPick.mock.calls[0][0]
}

describe('BlockPickerSlide — tile → block key mapping', () => {
  it('"Diagram-based" inserts a diagram question, NOT a structured one', () => {
    expect(pickFromTile('Label or describe an image')).toBe('diagram_image')
  })

  it('"Structured" keeps its own key', () => {
    expect(pickFromTile('Multi-part with marks')).toBe('structured')
  })

  it('"Diagram-Based Question" (stimulus) keeps its own key', () => {
    expect(pickFromTile('Instruction → diagram → follow-up sub-questions')).toBe('diagram_stimulus')
  })

  it('no two tiles fire the same key', () => {
    const onPick = vi.fn()
    render(<BlockPickerSlide open onClose={() => {}} onPick={onPick} />)
    const tiles = screen.getAllByRole('button').filter(b => b.className.includes('sv-bp-item'))
    tiles.forEach(tile => fireEvent.click(tile))
    const keys = onPick.mock.calls.map(c => c[0])
    expect(keys.length).toBe(tiles.length)
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes).toEqual([])
  })
})
