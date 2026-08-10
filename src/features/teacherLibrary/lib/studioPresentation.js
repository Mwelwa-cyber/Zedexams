/**
 * The presentation half of the studio registry: token → icon component, token →
 * folder palette.
 *
 * `src/lib/library/studios.js` carries `icon` and `tint` as NAME TOKENS rather
 * than an imported component and a hex triple, for two reasons — the registry is
 * imported by the plain-node suite, which cannot load React icon components, and
 * the folder pastels are deliberately theme-independent (see the palette note in
 * TeacherLibrary.jsx: a coloured folder on a dark page still reads as a folder,
 * so these stay light in all four themes and carry their own ink).
 *
 * This module is where the two halves meet. `studioPresentation.spec.js` fails
 * if a registry token does not resolve here, so a typo is a red build rather
 * than a blank card nobody notices.
 */

import {
  BarChart3,
  BookOpen,
  Calculator,
  CalendarDays,
  ClipboardCheckList,
  ClipboardList,
  DocumentTextIcon,
  Files,
  FolderOpen,
  Layers,
  ListChecks,
  PencilLine,
} from '../../../components/ui/icons'

/** Icon components addressable by the registry's `icon` token. */
export const STUDIO_ICONS = {
  BarChart3,
  BookOpen,
  Calculator,
  CalendarDays,
  ClipboardCheckList,
  ClipboardList,
  DocumentTextIcon,
  Files,
  Layers,
  ListChecks,
  PencilLine,
}

/** A folder with no palette of its own — also the fallback for an unknown tint. */
export const NEUTRAL_TINT = {
  from: '#fbfbf9', to: '#edebe4', border: '#dedacd', tab: '#eceadf',
}

/**
 * Soft pastel gradients, one per tint token. The folder body fades from `from`
 * to `to`, the tab and icon chip sit on `tab`, and `border` keeps the outline a
 * shade darker than the fill. These are the same twelve palettes the library has
 * always drawn — named here instead of being keyed by studio id, so a new studio
 * can reuse a tint rather than inventing a thirteenth pastel.
 */
export const FOLDER_TINTS = {
  'warm-cream':      { from: '#fffdf4', to: '#fdeec0', border: '#efdfa9', tab: '#f9ecc2' },
  'soft-mint':       { from: '#f4fbf5', to: '#d9f0de', border: '#c2e2ca', tab: '#ddf1e1' },
  'soft-peach':      { from: '#fff7f0', to: '#f4e2d9', border: '#e7cfc1', tab: '#f4e4dc' },
  'soft-blue':       { from: '#f4f9fe', to: '#d9e9f8', border: '#c3d9ee', tab: '#dcebf8' },
  lavender:          { from: '#f9f6fe', to: '#e7dcf7', border: '#d7c8ec', tab: '#e9def7' },
  'soft-teal':       { from: '#f2fbfa', to: '#d4f0ec', border: '#bce2dc', tab: '#d8f1ed' },
  'soft-coral':      { from: '#fff6f3', to: '#f5dfdc', border: '#e8ccc8', tab: '#fbded5' },
  'soft-sky':        { from: '#eff9fe', to: '#d2ebf7', border: '#bbdcec', tab: '#d8eef9' },
  'soft-sage':       { from: '#f6faf1', to: '#e0eecd', border: '#cbe0b2', tab: '#e5f0d3' },
  'soft-periwinkle': { from: '#f5f6fe', to: '#dee2f8', border: '#c8cdf0', tab: '#e1e5f9' },
  'soft-rose':       { from: '#fdf6f9', to: '#f8dfeb', border: '#ecc9da', tab: '#f7e1ec' },
  'soft-butter':     { from: '#fffdf0', to: '#f8edbe', border: '#ebdb9b', tab: '#f6ebbe' },
}

/** The icon component for a registry token; a generic folder if it is unknown. */
export function studioIcon(token) {
  return STUDIO_ICONS[token] || FolderOpen
}

/** The palette for a registry tint token; the neutral one if it is unknown. */
export function studioTint(token) {
  return FOLDER_TINTS[token] || NEUTRAL_TINT
}
