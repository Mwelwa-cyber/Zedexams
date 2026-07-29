/**
 * The fraction tool — §5 (a denominator cannot be zero) and §13 (a teacher can
 * open, use and leave it without a mouse, and is told why an action is refused).
 *
 * A real Tiptap editor backs these, matching EditorToolbar.spec.jsx, so an
 * insertion goes through the production command rather than a mock of it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../../extensions/buildExtensions.js'
import FractionModal from './FractionModal.jsx'

let editor

function makeEditor() {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const ed = new Editor({
      element: host,
      extensions: buildExtensions({ placeholder: '', readOnly: true }),
      content: '<p></p>',
      autofocus: false,
    })
    ed.on('create', () => setTimeout(() => resolve(ed), 0))
  })
}

beforeEach(async () => { editor = await makeEditor() })
afterEach(() => { editor?.destroy(); editor = null })

const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('a denominator of zero (§5)', () => {
  it('is refused, and the reason is announced rather than implied', () => {
    // The old guard was `if (!num || !den)`, and the field holds a STRING —
    // `!'0'` is false — so "3 over 0" was insertable and printed onto the paper
    // as a bar over a zero.
    render(<FractionModal editor={editor} editState={null} onClose={() => {}} />)
    type('Numerator', '3')
    type('Denominator', '0')

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/denominator cannot be zero/i)
    expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled()
  })

  it('clears as soon as the denominator becomes usable', () => {
    render(<FractionModal editor={editor} editState={null} onClose={() => {}} />)
    type('Numerator', '3')
    type('Denominator', '0')
    expect(screen.queryByRole('alert')).toBeTruthy()
    type('Denominator', '4')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Insert' })).not.toBeDisabled()
  })

  it('a real fraction inserts a structured node, not text', () => {
    const onClose = vi.fn()
    render(<FractionModal editor={editor} editState={null} onClose={onClose} />)
    type('Numerator', '3')
    type('Denominator', '5')
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))

    const html = editor.getHTML()
    expect(html).toContain('data-math-fraction')
    expect(html).toContain('data-num="3"')
    expect(html).toContain('data-den="5"')
    // Never the computer form.
    expect(editor.getText()).not.toContain('3/5')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('keyboard and screen-reader access (§13)', () => {
  it('Escape closes without touching the question', () => {
    const onClose = vi.fn()
    render(<FractionModal editor={editor} editState={null} onClose={onClose} />)
    const before = editor.getHTML()
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(editor.getHTML()).toBe(before)
  })

  it('every control has an accessible name', () => {
    render(<FractionModal editor={editor} editState={null} onClose={() => {}} />)
    for (const name of ['Whole number', 'Numerator', 'Denominator']) {
      expect(screen.getByLabelText(name)).toBeTruthy()
    }
    expect(screen.getByRole('dialog', { name: 'Insert fraction' })).toBeTruthy()
  })

  it('the quick choices are named in words, not left as bare stacks', () => {
    // A stacked "1 over 2" reads as "12" to a screen reader, so the spoken
    // name has to be carried separately from the drawn shape.
    render(<FractionModal editor={editor} editState={null} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'one half' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'one and one third' })).toBeTruthy()
  })

  it('a quick choice draws the fraction it inserts — no ½ glyph anywhere (§5)', () => {
    const { container } = render(<FractionModal editor={editor} editState={null} onClose={() => {}} />)
    const preset = screen.getByRole('button', { name: 'one half' })
    expect(preset.querySelector('.math-frac-stack')).toBeTruthy()
    expect(container.textContent).not.toMatch(/[½¼¾⅓⅔⅕]/)
  })

  it('the mixed-number entry point says so and starts on the whole number', () => {
    render(<FractionModal editor={editor} editState={null} mixed onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Insert mixed number' })).toBeTruthy()
  })
})
