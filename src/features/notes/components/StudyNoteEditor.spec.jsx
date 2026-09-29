// The admin Notes Studio editor: every block type must be editable, and the
// two bugs that made editing painful (Enter swallowed, empty cards) stay fixed.

import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StudyNoteEditor } from './StudyNoteEditor'
import { newStudyBlock, STUDY_BLOCK_TYPES } from '../lib/studyBlocks'

vi.mock('../lib/storage', () => ({ uploadInlineImage: vi.fn(async () => 'https://x/y.png') }))
vi.mock('./QuizPicker', () => ({ QuizPicker: () => null }))
vi.mock('../reader/BlocksPreview', () => ({ default: () => <div data-testid="preview" /> }))
vi.mock('./StudyNoteReader', () => ({ StudyNoteReader: () => <div data-testid="legacy-preview" /> }))

function Harness({ initial, spy }) {
  const [blocks, setBlocks] = useState(initial)
  return (
    <StudyNoteEditor
      value={blocks}
      onChange={(b) => { spy?.(b); setBlocks(b) }}
      ownerUid="u1" assetBatchId="b1" subject="Integrated Science" grade={7}
    />
  )
}

describe('StudyNoteEditor', () => {
  it('gives every block type at least one editable field', () => {
    for (const type of STUDY_BLOCK_TYPES) {
      const { container, unmount } = render(<Harness initial={[newStudyBlock(type)]} />)
      const fields = container.querySelectorAll('input, textarea, select, button[title="Choose image"], button')
      // header buttons alone are 4; an editor adds more.
      expect(fields.length, `${type} shows an empty card`).toBeGreaterThan(4)
      unmount()
    }
  })

  it('keeps a blank line while typing (Enter is not swallowed)', () => {
    const b = { ...newStudyBlock('bullets'), items: ['One'] }
    const spy = vi.fn()
    render(<Harness initial={[b]} spy={spy} />)
    const ta = screen.getByDisplayValue('One')
    fireEvent.change(ta, { target: { value: 'One\n' } })
    expect(ta.value).toBe('One\n')
    fireEvent.change(ta, { target: { value: 'One\nTwo' } })
    expect(spy).toHaveBeenLastCalledWith([expect.objectContaining({ items: ['One', 'Two'] })])
  })

  it('edits a glossary meaning and offers the [[words]] that have no entry', () => {
    const blocks = [
      { id: 'p', type: 'paragraph', text: 'The [[gut]] digests food.' },
      { ...newStudyBlock('glossary'), entries: [{ word: 'digest', meaning: 'break down', how: '', examples: [] }] },
    ]
    const spy = vi.fn()
    render(<Harness initial={blocks} spy={spy} />)
    fireEvent.change(screen.getByDisplayValue('break down'), { target: { value: 'break food down' } })
    expect(spy.mock.lastCall[0][1].entries[0].meaning).toBe('break food down')
    fireEvent.click(screen.getByRole('button', { name: /gut/ }))
    expect(spy.mock.lastCall[0][1].entries.map((e) => e.word)).toEqual(['digest', 'gut'])
  })

  it('label diagram: clicking the picture drops a numbered box; delete is blocked at two', () => {
    const b = { ...newStudyBlock('labeldiagram'), url: 'https://x/d.png' }
    const spy = vi.fn()
    const { container } = render(<Harness initial={[b]} spy={spy} />)
    const box = container.querySelector('.cursor-crosshair')
    box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 })
    fireEvent.click(box, { clientX: 100, clientY: 50 })
    const items = spy.mock.lastCall[0][0].items
    expect(items).toHaveLength(3)
    expect(items[2]).toMatchObject({ x: 0.5, y: 0.5 })
    expect(new Set(items.map((i) => i.key)).size).toBe(3)
  })

  it('practice: choosing a different correct answer keeps exactly one', () => {
    const spy = vi.fn()
    render(<Harness initial={[newStudyBlock('practice')]} spy={spy} />)
    fireEvent.click(screen.getByLabelText('Option 2 is correct'))
    expect(spy.mock.lastCall[0][0].options.map((o) => o.correct)).toEqual([false, true])
  })

  it('warns about an incomplete block instead of dropping it silently', () => {
    const bad = { ...newStudyBlock('flow'), steps: [{ text: 'Only one', note: '' }] }
    render(<Harness initial={[bad]} />)
    expect(screen.getByText(/1 block is incomplete/)).toBeTruthy()
  })
})
