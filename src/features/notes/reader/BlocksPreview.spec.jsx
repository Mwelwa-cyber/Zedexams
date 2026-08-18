/**
 * BlocksPreview — the studio's authoring preview.
 *
 * What is pinned here is the property the studio lost: an author sees the
 * pictures. The Digestive System note's eight organ cards and its
 * label-the-diagram figure were present in the note and absent from the
 * editor, because the preview ran through a renderer that has no case for
 * those block types and renders `null` instead of throwing.
 *
 * Also pinned: the preview does NOT apply Learn/Revise placement. Learn
 * hides the key points and Revise hides the quiz and the label game —
 * right for a learner, wrong for the person writing the note.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BlocksPreview from './BlocksPreview'

const NOTE = [
  { id: 'h', type: 'heading', level: 2, text: 'The food tube' },
  { id: 'body', type: 'image', url: '/notes/g7-sci-1-1-body.jpg', caption: 'The food’s journey' },
  {
    id: 'organs',
    type: 'tapexplore',
    items: [
      { key: 'mouth', name: 'Mouth', url: '/notes/g7-sci-1-1-mouth.jpg', role: 'Digestion starts here.' },
      { key: 'liver', name: 'Liver', url: '/notes/g7-sci-1-1-liver.jpg', role: 'Makes bile juice.' },
    ],
  },
  {
    id: 'label',
    type: 'labeldiagram',
    url: '/notes/g7-sci-1-1-label.jpg',
    alt: 'The digestive system, unlabelled',
    items: [
      { key: 'mouth', label: 'Mouth', x: 0.187, y: 0.188 },
      { key: 'liver', label: 'Liver', x: 0.143, y: 0.489 },
    ],
  },
  { id: 'se', type: 'startend', start: 'Mouth', end: 'Small intestine' },
  { id: 'kp', type: 'keypoints', items: ['Digestion begins in the mouth.'] },
]

const draw = (blocks = NOTE) =>
  render(<MemoryRouter><BlocksPreview blocks={blocks} /></MemoryRouter>)

const srcs = () => Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src'))

describe('BlocksPreview', () => {
  it('shows every picture the note carries', () => {
    draw()
    const seen = srcs()
    for (const src of [
      '/notes/g7-sci-1-1-body.jpg',
      '/notes/g7-sci-1-1-mouth.jpg',
      '/notes/g7-sci-1-1-liver.jpg',
      '/notes/g7-sci-1-1-label.jpg',
    ]) {
      expect(seen, `missing ${src}`).toContain(src)
    }
  })

  it('renders the reader-only blocks rather than dropping them', () => {
    draw()
    // Queried per block, not by bare text: "Mouth" is legitimately on the
    // page three times (an organ card, a label word, the start box), and a
    // getByText that happens to be ambiguous proves nothing about which
    // block rendered it.
    const organs = Array.from(document.querySelectorAll('.lhx-organ-name')).map((n) => n.textContent)
    expect(organs).toEqual(['Mouth', 'Liver'])

    const words = Array.from(document.querySelectorAll('.lhx-lbl-chip')).map((n) => n.textContent)
    expect(words).toHaveLength(2)

    const ends = Array.from(document.querySelectorAll('.lhx-se-org')).map((n) => n.textContent)
    expect(ends).toEqual(['Mouth', 'Small intestine'])
  })

  it('shows blocks a learner mode would hide', () => {
    // Learn hides keypoints; the author still wrote them.
    draw()
    expect(screen.getByText('Digestion begins in the mouth.')).toBeInTheDocument()
  })

  it('numbers level-2 headings in authored order', () => {
    draw([
      { id: 'a', type: 'heading', level: 2, text: 'One' },
      { id: 'b', type: 'paragraph', text: 'text' },
      { id: 'c', type: 'heading', level: 2, text: 'Two' },
    ])
    expect(screen.getByText('One').textContent).toBe('One')
    const nums = Array.from(document.querySelectorAll('.lhx-h2-num')).map((n) => n.textContent)
    expect(nums).toEqual(['1', '2'])
  })

  it('renders nothing for an empty or malformed note without throwing', () => {
    expect(() => draw([])).not.toThrow()
    expect(() => draw([null, undefined, { type: 'not_a_real_block' }])).not.toThrow()
  })
})
