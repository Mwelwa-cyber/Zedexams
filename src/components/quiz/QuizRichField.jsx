/**
 * QuizRichField — the Tiptap-based editor used inside the quiz flow.
 *
 * Why this wrapper instead of using RichEditor directly?
 *   The quiz code currently stores rich text as HTML strings and emits HTML
 *   strings from its editor. We're migrating to Tiptap JSON. The wrapper
 *   does three jobs during that migration:
 *
 *     1. Accepts either an HTML string (legacy, pre-migration) OR Tiptap
 *        JSON (post-migration) as `value`. RichEditor's migrateContent()
 *        handles both — we just pass straight through.
 *
 *     2. Normalises the onChange contract. RichEditor emits Tiptap JSON.
 *        The caller stores it directly into section state as-is. On save
 *        the serializer passes it through without forcing HTML.
 *
 *     3. Remounts the underlying editor when the value IDENTITY changes
 *        (e.g. switching between questions in a list). RichEditor reads
 *        `initialContent` only once on mount — if we don't key it, moving
 *        between questions keeps showing the previous one's text.
 *
 * Props
 *   value        — HTML string | Tiptap JSON | null
 *   onChange     — function(tiptapJSON)
 *   placeholder  — placeholder text
 *   minHeight    — pixel min-height (default matches the old RichTextEditor)
 *   compact      — match the old RichTextEditor compact chrome (no shadow)
 *   resetKey     — optional external key; when the parent needs to force
 *                  a clean remount (e.g. "Clear" button) bump this value.
 */

import { useMemo } from 'react'
import RichEditor from '../../editor/components/RichEditor.jsx'

export default function QuizRichField({
  value,
  onChange,
  placeholder = 'Start typing…',
  minHeight = 120,
  compact = false,
  // Toolbar variant passes through to RichEditor. 'compact' is the
  // answer-option layout (no headings / alignment / table / colour); 'full'
  // is everything. Defaults track the visual `compact` chrome prop so
  // legacy callers keep their existing toolbar.
  toolbarVariant,
  resetKey,
}) {
  // When the value object identity changes (parent switched to a different
  // question), remount RichEditor so it re-reads initialContent. We don't
  // key on shallow value changes — that would wipe cursor on every keystroke.
  const mountKey = useMemo(() => {
    // Stable key per "document" identity: object reference for JSON, string
    // hash for HTML. Teachers editing in place keep their cursor; switching
    // to another question hands RichEditor a new document to mount.
    const base = (value && typeof value === 'object')
      ? identityKey(value)
      : (typeof value === 'string' ? `s:${stringHash(value)}` : 'empty')
    // resetKey lets a parent force a clean remount that re-reads the CURRENT
    // value — used after an AI edit replaces the field's content in place.
    // When resetKey is undefined the dep is stable, so typing still keeps the
    // cursor (we recompute base only when resetKey actually changes).
    return resetKey != null ? `${base}#${resetKey}` : base
    // We INTENTIONALLY recompute only when resetKey changes, not on every
    // onChange — that would remount every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  return (
    <div className={compact ? 'qrf-compact' : ''} style={{ width: '100%' }}>
      <RichEditor
        key={mountKey}
        initialContent={value}
        onChange={onChange}
        placeholder={placeholder}
        minHeight={minHeight}
        toolbarVariant={toolbarVariant || 'full'}
      />
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────────────────────────── */

// Stable identity for a Tiptap JSON value. Uses a reference → id WeakMap so
// the same object always gets the same key — without serialising the whole
// doc on every render.
const _identityMap = new WeakMap()
let _identityCounter = 0
function identityKey(obj) {
  const existing = _identityMap.get(obj)
  if (existing) return existing
  const id = `o:${++_identityCounter}`
  _identityMap.set(obj, id)
  return id
}

function stringHash(s) {
  // Tiny FNV-1a variant — not cryptographic, only used to key React mounts.
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
