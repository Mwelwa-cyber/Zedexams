// src/features/notes/hooks/useReaderPrefs.js
//
// Learner-chosen reading comfort for the note reader: text size, typeface, and
// page background. Persisted per-device in localStorage (same pattern as the
// `notes:hl` highlights toggle) so a learner's choice follows them note to note.
//
// The three values map to CSS classes defined in ../styles/notes.css:
//   size → note-size-*   (scales body copy via the --note-scale variable)
//   font → note-font-*   (swaps the body typeface)
//   page → note-page-*   (paints the reading surface: cream / white / lined / sepia)
//
// Options live here so the menu (ReaderPrefsMenu) stays declarative and the
// reader page (LearnerNoteRead) can compose the class names.

import { useCallback, useState } from 'react'

export const SIZE_OPTIONS = [
  { value: 'sm',   label: 'S',   title: 'Small' },
  { value: 'base', label: 'M',   title: 'Medium' },
  { value: 'lg',   label: 'L',   title: 'Large' },
  { value: 'xl',   label: 'XL',  title: 'Extra large' },
  { value: 'xxl',  label: '2XL', title: 'Huge' },
]

export const FONT_OPTIONS = [
  { value: 'sans',  label: 'Default', className: 'note-font-sans' },
  { value: 'serif', label: 'Serif',   className: 'note-font-serif' },
  { value: 'book',  label: 'Book',    className: 'note-font-book' },
  { value: 'mono',  label: 'Mono',    className: 'note-font-mono' },
]

export const PAGE_OPTIONS = [
  { value: 'cream', label: 'Cream', swatch: '#F5EFE1' },
  { value: 'white', label: 'White', swatch: '#FFFFFF' },
  { value: 'lined', label: 'Lined', swatch: 'lined' },
  { value: 'sepia', label: 'Sepia', swatch: '#F4ECD8' },
]

const KEYS = { size: 'notes:size', font: 'notes:font', page: 'notes:page' }

// Default to Large text — the studio's body copy was reported as too small, so
// new readers land on a comfortable size out of the box and can tune from there.
const DEFAULTS = { size: 'lg', font: 'sans', page: 'cream' }

const VALUES = {
  size: SIZE_OPTIONS.map(o => o.value),
  font: FONT_OPTIONS.map(o => o.value),
  page: PAGE_OPTIONS.map(o => o.value),
}

function readPref(kind) {
  try {
    const v = localStorage.getItem(KEYS[kind])
    return VALUES[kind].includes(v) ? v : DEFAULTS[kind]
  } catch {
    return DEFAULTS[kind]
  }
}

function writePref(kind, value) {
  try { localStorage.setItem(KEYS[kind], value) } catch { /* private mode / quota — ignore */ }
}

export function useReaderPrefs() {
  const [size, setSizeState] = useState(() => readPref('size'))
  const [font, setFontState] = useState(() => readPref('font'))
  const [page, setPageState] = useState(() => readPref('page'))

  const setSize = useCallback((v) => { setSizeState(v); writePref('size', v) }, [])
  const setFont = useCallback((v) => { setFontState(v); writePref('font', v) }, [])
  const setPage = useCallback((v) => { setPageState(v); writePref('page', v) }, [])

  // Class names the reader page composes onto its containers.
  const bodyClass = `note-body note-size-${size} note-font-${font}`
  const pageClass = `note-page-${page}`

  return { size, font, page, setSize, setFont, setPage, bodyClass, pageClass }
}

export default useReaderPrefs
