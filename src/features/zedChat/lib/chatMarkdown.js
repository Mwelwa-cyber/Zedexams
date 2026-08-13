/**
 * chatMarkdown — render Zed's chat replies as safe HTML.
 *
 * Zed (like every chat LLM) replies in Markdown: `**Definition:**`, bullet
 * lists, the odd numbered list. The chat bubble used to print that raw, so
 * learners saw literal asterisks around the words that were meant to be bold.
 *
 * This converts the Markdown to HTML with `marked` and then hard-sanitises it
 * with DOMPurify against a tiny allow-list (no images, no scripts, no styles —
 * just the inline + list/heading tags a study answer needs). Anchors are
 * forced to open in a new tab with `rel="noopener"`.
 *
 * Uses its OWN `Marked` instance so it can't clash with the global
 * `marked.setOptions` the blog renderer sets (src/utils/blogPosts.js).
 */

import { Marked } from 'marked'
import DOMPurify from 'dompurify'

// breaks: true — chat answers use single newlines between thoughts and expect
// them to show as line breaks (the old whitespace-pre-wrap behaviour), which
// vanilla GFM would otherwise collapse.
const md = new Marked({ gfm: true, breaks: true })

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del',
  'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4',
  'a', 'hr', 'span',
]
const ALLOWED_ATTR = ['href', 'target', 'rel']

function canUseDom() {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined'
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Force every link to open safely in a new tab. Registered once; DOMPurify
// hooks are global but this one is idempotent and additive.
let hookRegistered = false
function ensureLinkHook() {
  if (hookRegistered || !canUseDom()) return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  hookRegistered = true
}

/**
 * Convert a chat message (Markdown) to sanitised HTML.
 * Returns '' for empty input. Falls back to escaped plain text when no DOM is
 * available (SSR / tests without jsdom) so callers never inject raw HTML.
 */
export function renderChatMarkdown(text) {
  const src = String(text ?? '')
  if (!src.trim()) return ''

  let html
  try {
    html = md.parse(src)
  } catch {
    // Parser blew up on weird input — degrade to escaped, line-broken text.
    return escapeHtml(src).replace(/\n/g, '<br>')
  }

  if (!canUseDom()) {
    return escapeHtml(src).replace(/\n/g, '<br>')
  }

  ensureLinkHook()
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })
}
