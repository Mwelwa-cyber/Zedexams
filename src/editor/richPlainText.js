/**
 * Re-export only. Plain-text extraction lives in the shared text package.
 *
 * @see functions/shared/text/richPlainText.js
 *
 * See the note in src/utils/textJunk.js for why it moved: the past-paper
 * quiz's exam mode is marked on the SERVER, and a key stored as a stringified
 * Tiptap doc has to project to the same string in both runtimes or the two
 * disagree about which option was correct.
 *
 * The import path here is unchanged, so RichContent.jsx and the ~6 other call
 * sites are untouched, and scripts/test-rich-plain-text.mjs still tests the
 * behaviour through this path.
 *
 * DO NOT ADD A RULE HERE.
 */
export {
  unwrapNestedTiptapDoc,
  extractPlainText,
  getRichPlainText,
} from '../../functions/shared/text/richPlainText.js'
