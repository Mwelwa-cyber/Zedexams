/**
 * src/editor/extensions/buildExtensions.js
 *
 * Factory that creates a fresh Tiptap extension array for each editor instance.
 *
 * WHY a factory and not a shared constant?
 * Placeholder extension must be configured per editor (different placeholder text).
 * StarterKit.configure() returns a NEW extension instance each time.
 * Extensions are pure configuration — re-creating them is cheap and correct.
 *
 * Usage:
 *   const extensions = buildExtensions({ placeholder: 'Write the question…' })
 *   const editor = useEditor({ extensions, content, … })
 */

// NOTE on imports:
//   Tiptap v3 (the version installed here) changed several extensions from
//   default to named exports (TextStyle, Color, Table family, Placeholder).
//   Using default imports for those produces a "default is not exported"
//   build error. Do NOT swap these to default imports.
import StarterKit      from '@tiptap/starter-kit'
// Underline is bundled in StarterKit as of Tiptap v3 — do NOT import it
// separately. The old explicit Underline import produced "Duplicate extension
// names found: ['underline']" warnings on every editor mount (one per quiz
// question × several editor instances = 500+ console entries).
import { TextStyle }   from '@tiptap/extension-text-style'
import { Color }       from '@tiptap/extension-color'
import TextAlign       from '@tiptap/extension-text-align'
import Highlight       from '@tiptap/extension-highlight'
import { Table }       from '@tiptap/extension-table'
import { TableRow }    from '@tiptap/extension-table-row'
import { TableCell }   from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import Superscript     from '@tiptap/extension-superscript'
import Subscript       from '@tiptap/extension-subscript'
import { Placeholder } from '@tiptap/extension-placeholder'
import { MathInline }  from './MathInline.js'
// KaTeX stylesheet is loaded here (instead of the app root) so it only ships
// in the editor/viewer chunks that actually render math. Every path that
// renders a MathInline node goes through this module.
import 'katex/dist/katex.min.css'

/**
 * @param {object} options
 * @param {string} [options.placeholder='']  Placeholder text for this editor
 * @param {boolean} [options.readOnly=false] When true, omit interactive extensions
 * @returns {import('@tiptap/core').AnyExtension[]}
 */
export function buildExtensions({ placeholder = '', readOnly = false } = {}) {
  const base = [
    StarterKit.configure({
      heading:   { levels: [1, 2, 3] },
      codeBlock: false,  // not needed in a quiz editor
      // History + Underline are included in StarterKit — keep them.
    }),
    TextStyle,   // required by Color
    Color,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Superscript,
    Subscript,
    MathInline,
  ]

  if (!readOnly) {
    base.push(
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: true,
        showOnlyCurrent: false,
      })
    )
  }

  return base
}

/**
 * Convenience: build extensions for pure rendering (generateHTML, generateJSON).
 * No Placeholder, no interactive extensions.
 */
export const renderExtensions = buildExtensions({ readOnly: true })
