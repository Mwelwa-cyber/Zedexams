/**
 * Behaviour tests for EditorToolbar.jsx — the shared Tiptap toolbar used by
 * every rich-text editor (quiz stems, options, passages, notes, lessons).
 *
 * A REAL Tiptap editor (the production buildExtensions set) backs each test,
 * so the assertions exercise genuine commands — toggling bold on a selected
 * word, clearing formatting — not mocks. jsdom hosts the ProseMirror view.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../extensions/buildExtensions.js'
import EditorToolbar from './EditorToolbar.jsx'

let editor

// Tiptap flips isInitialized inside a setTimeout(0) after emitting `create`
// — the toolbar renders an empty shell until then, so await the event.
function makeEditor(content) {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const ed = new Editor({
      element: host,
      // readOnly:true only omits the Placeholder extension, whose viewport
      // tracking needs document.elementFromPoint (missing in jsdom). The
      // editor itself stays editable, so every formatting command is real.
      extensions: buildExtensions({ placeholder: '', readOnly: true }),
      content,
      autofocus: false,
    })
    ed.on('create', () => setTimeout(() => resolve(ed), 0))
  })
}

// Select the given text inside the first paragraph (word-level selection).
function selectWord(ed, word) {
  const text = ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n')
  const at = text.indexOf(word)
  if (at === -1) throw new Error(`"${word}" not in doc`)
  // +1 for the opening paragraph token.
  ed.commands.setTextSelection({ from: at + 1, to: at + 1 + word.length })
}

function renderToolbar(props = {}) {
  return render(
    <EditorToolbar editor={editor} onMath={() => {}} onTable={() => {}} {...props} />,
  )
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('EditorToolbar — full variant', () => {
  beforeEach(async () => {
    editor = await makeEditor('<p>The quick fox</p>')
  })

  it('exposes the spec-required controls', () => {
    renderToolbar()
    for (const title of [
      'Bold (Ctrl+B)', 'Italic (Ctrl+I)', 'Underline (Ctrl+U)', 'Strikethrough',
      'Superscript', 'Subscript', 'Clear formatting', 'Highlight',
      'Undo (Ctrl+Z)', 'Redo (Ctrl+Y)', 'Insert Table',
    ]) {
      expect(screen.getByTitle(title), title).toBeInTheDocument()
    }
  })

  it('names every mathematics tool in words a teacher reads (§6)', () => {
    // These titles were machine vocabulary ("Insert Math (LaTeX)") or a bare
    // glyph. A teacher choosing a tool should not have to know what LaTeX is,
    // so the assertion is on the WORDS, and it doubles as the check that every
    // tool is present at once.
    renderToolbar()
    for (const [tool, name] of [
      ['formula', 'Insert a formula'],
      ['fraction', 'Insert a fraction'],
      ['mixed number', 'Insert a mixed number'],
      ['vertical calculation', 'Insert a vertical calculation'],
      ['power', 'Power (superscript)'],
      ['square root', 'Insert a square root'],
      ['number base', 'Insert a number in another base'],
      ['brackets', 'Insert brackets'],
      ['more maths', 'More maths tools'],
    ]) {
      expect(screen.getByLabelText(name), tool).toBeInTheDocument()
    }
    expect(screen.queryByTitle(/latex/i)).toBeNull()
  })

  it('orders the tools for the grade band, and hides none of them', () => {
    // Ordering is a convenience, never a restriction: a Grade 2 teacher meets
    // vertical calculation first but can still reach a number base.
    const { unmount } = renderToolbar({ grade: '2' })
    const early = screen.getAllByRole('button')
      .map(b => b.getAttribute('aria-label'))
      .filter(Boolean)
    expect(early.indexOf('Insert a vertical calculation'))
      .toBeLessThan(early.indexOf('Insert a formula'))
    expect(early).toContain('Insert a number in another base')
    unmount()

    renderToolbar({ grade: 'G10' })
    const secondary = screen.getAllByRole('button')
      .map(b => b.getAttribute('aria-label'))
      .filter(Boolean)
    expect(secondary.indexOf('Insert a formula'))
      .toBeLessThan(secondary.indexOf('Insert a vertical calculation'))
  })

  it('applies bold to ONLY the selected word (word-level formatting)', () => {
    renderToolbar()
    selectWord(editor, 'quick')
    fireEvent.click(screen.getByTitle('Bold (Ctrl+B)'))
    expect(editor.getHTML()).toContain('The <strong>quick</strong> fox')
  })

  it('highlight swatch marks the selected word with <mark>', () => {
    renderToolbar()
    selectWord(editor, 'quick')
    fireEvent.click(screen.getByTitle('Highlight'))
    fireEvent.click(screen.getByLabelText('Highlight #fef08a'))
    const html = editor.getHTML()
    expect(html).toContain('<mark')
    expect(html).toMatch(/<mark[^>]*>quick<\/mark>/)
  })

  it('the highlight picker offers a "Remove highlight" action', () => {
    editor.commands.setContent('<p><mark data-color="#fef08a">word</mark></p>')
    renderToolbar()
    selectWord(editor, 'word')
    fireEvent.click(screen.getByTitle('Highlight'))
    fireEvent.click(screen.getByLabelText('Remove highlight'))
    expect(editor.getHTML()).not.toContain('<mark')
  })

  it('Clear formatting strips every mark from the selection', () => {
    editor.commands.setContent('<p><strong><u>styled</u></strong> plain</p>')
    renderToolbar()
    selectWord(editor, 'styled')
    fireEvent.click(screen.getByTitle('Clear formatting'))
    const html = editor.getHTML()
    expect(html).not.toContain('<strong>')
    expect(html).not.toContain('<u>')
    expect(html).toContain('styled plain')
  })

  it('Clear formatting lifts a heading back to a paragraph', () => {
    editor.commands.setContent('<h1>Title text</h1>')
    renderToolbar()
    editor.commands.selectAll()
    fireEvent.click(screen.getByTitle('Clear formatting'))
    const html = editor.getHTML()
    expect(html).not.toContain('<h1>')
    expect(html).toContain('<p>Title text</p>')
  })
})

describe('EditorToolbar — compact (answer-option) variant', () => {
  beforeEach(async () => {
    editor = await makeEditor('<p>largest planet</p>')
  })

  it('keeps the essentials, adds highlight, hides block tools', () => {
    renderToolbar({ variant: 'compact' })
    expect(screen.getByTitle('Bold (Ctrl+B)')).toBeInTheDocument()
    expect(screen.getByTitle('Underline (Ctrl+U)')).toBeInTheDocument()
    expect(screen.getByTitle('Clear formatting')).toBeInTheDocument()
    expect(screen.getByTitle('Highlight')).toBeInTheDocument()
    // Block-level tools stay hidden in the narrow option row.
    expect(screen.queryByTitle('Insert Table')).toBeNull()
    expect(screen.queryByTitle('Heading 1')).toBeNull()
    expect(screen.queryByTitle('Bullet list')).toBeNull()
  })

  it('compact highlight toggles a default-colour <mark> on the selection', () => {
    renderToolbar({ variant: 'compact' })
    selectWord(editor, 'largest')
    fireEvent.click(screen.getByTitle('Highlight'))
    expect(editor.getHTML()).toMatch(/<mark[^>]*>largest<\/mark>/)
    // Toggling again removes it.
    fireEvent.click(screen.getByTitle('Highlight'))
    expect(editor.getHTML()).not.toContain('<mark')
  })
})
