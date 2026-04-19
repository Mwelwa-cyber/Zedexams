import { sanitizeQuizRichHTML } from '../editor/utils/sanitize.js'

const STRIP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'META', 'LINK'])
const ALLOWED_TAGS = new Set([
  'P',
  'DIV',
  'BR',
  'STRONG',
  'EM',
  'U',
  'S',
  'SUB',
  'SUP',
  'UL',
  'OL',
  'LI',
  'SPAN',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TH',
  'TD',
])
const TAG_ALIASES = {
  B: 'strong',
  I: 'em',
  STRIKE: 's',
  FONT: 'span',
}
const BLOCK_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR'])
const SAFE_TEXT_ALIGN = new Set(['left', 'center', 'right'])
const SAFE_CLASS_NAMES = new Set(['mnode', 'etable'])
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgb(a)?\([\d\s,.%]+\)|hsl(a)?\([\d\s,.%]+\)|transparent|currentcolor|inherit)$/i
const HTML_RE = /<\/?[a-z][\s\S]*>/i
const KATEX_VERSION = '0.16.11'

let katexLoaderPromise = null

function canUseDom() {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && typeof DOMParser !== 'undefined'
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

function normalizeLineBreaks(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n')
}

function cleanColorValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return COLOR_RE.test(normalized) ? normalized : ''
}

function cleanStyleAttribute(styleValue) {
  const next = []

  String(styleValue ?? '')
    .split(';')
    .map(rule => rule.trim())
    .filter(Boolean)
    .forEach(rule => {
      const separator = rule.indexOf(':')
      if (separator === -1) return

      const property = rule.slice(0, separator).trim().toLowerCase()
      const rawValue = rule.slice(separator + 1).trim()

      if (property === 'text-align') {
        const normalized = rawValue.toLowerCase()
        if (SAFE_TEXT_ALIGN.has(normalized)) next.push(`text-align:${normalized}`)
        return
      }

      if (property === 'color' || property === 'background-color') {
        const clean = cleanColorValue(rawValue)
        if (clean) next.push(`${property}:${clean}`)
      }
    })

  return next.join(';')
}

function plainTextToHtml(value) {
  const text = normalizeLineBreaks(value).trim()
  if (!text) return ''

  return text
    .split(/\n{2,}/)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function unwrapElement(element) {
  const parent = element.parentNode
  if (!parent) return

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

function replaceElement(element, tagName, doc) {
  const replacement = doc.createElement(tagName)

  for (const { name, value } of Array.from(element.attributes)) {
    if (name.toLowerCase() === 'color' && tagName === 'span') {
      replacement.setAttribute('style', `color:${value}`)
      continue
    }
    replacement.setAttribute(name, value)
  }

  while (element.firstChild) {
    replacement.appendChild(element.firstChild)
  }

  element.parentNode?.replaceChild(replacement, element)
  return replacement
}

function cleanCellSpan(value) {
  const numeric = Number.parseInt(String(value ?? '').trim(), 10)
  if (!Number.isFinite(numeric)) return ''
  return String(Math.min(Math.max(numeric, 1), 12))
}

function sanitizeElementAttributes(element) {
  const tagName = element.tagName.toUpperCase()
  const originalAttributes = Array.from(element.attributes)

  originalAttributes.forEach(attribute => element.removeAttribute(attribute.name))

  let hasMathClass = false

  originalAttributes.forEach(attribute => {
    const name = attribute.name.toLowerCase()
    const value = String(attribute.value ?? '')

    if (name.startsWith('on')) return

    if (name === 'class') {
      const classes = value
        .split(/\s+/)
        .map(item => item.trim())
        .filter(item => SAFE_CLASS_NAMES.has(item))
      if (classes.length) {
        element.setAttribute('class', classes.join(' '))
        hasMathClass = classes.includes('mnode')
      }
      return
    }

    if (name === 'style') {
      const cleanStyle = cleanStyleAttribute(value)
      if (cleanStyle) element.setAttribute('style', cleanStyle)
      return
    }

    if (name === 'align') {
      const normalized = value.trim().toLowerCase()
      if (SAFE_TEXT_ALIGN.has(normalized)) {
        const previousStyle = element.getAttribute('style')
        const nextStyle = [previousStyle, `text-align:${normalized}`].filter(Boolean).join(';')
        element.setAttribute('style', cleanStyleAttribute(nextStyle))
      }
      return
    }

    if (tagName === 'SPAN' && (hasMathClass || value) && name === 'data-latex') {
      element.setAttribute('data-latex', value)
      return
    }

    if (tagName === 'SPAN' && name === 'data-display') {
      element.setAttribute('data-display', value === 'true' ? 'true' : 'false')
      return
    }

    if ((tagName === 'TD' || tagName === 'TH') && (name === 'colspan' || name === 'rowspan')) {
      const cleanSpan = cleanCellSpan(value)
      if (cleanSpan) element.setAttribute(name, cleanSpan)
    }
  })

  if (tagName === 'SPAN' && element.getAttribute('data-latex') && !element.classList.contains('mnode')) {
    element.setAttribute('class', 'mnode')
  }

  if (tagName === 'SPAN' && element.classList.contains('mnode') && !element.getAttribute('data-latex')) {
    element.removeAttribute('class')
  }

  if (tagName === 'TABLE' && !element.classList.contains('etable')) {
    element.setAttribute('class', 'etable')
  }
}

function sanitizeDomNode(node, doc) {
  if (node.nodeType === Node.TEXT_NODE) return
  if (node.nodeType !== Node.ELEMENT_NODE) {
    node.parentNode?.removeChild(node)
    return
  }

  let element = node
  const alias = TAG_ALIASES[element.tagName.toUpperCase()]
  if (alias) {
    element = replaceElement(element, alias, doc)
  }

  const tagName = element.tagName.toUpperCase()
  if (STRIP_TAGS.has(tagName)) {
    element.parentNode?.removeChild(element)
    return
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    const children = Array.from(element.childNodes)
    children.forEach(child => {
      element.parentNode?.insertBefore(child, element)
      sanitizeDomNode(child, doc)
    })
    element.parentNode?.removeChild(element)
    return
  }

  Array.from(element.childNodes).forEach(child => sanitizeDomNode(child, doc))
  sanitizeElementAttributes(element)
}

function normalizeSanitizedHtml(html) {
  if (!canUseDom()) return String(html ?? '').trim()

  const doc = new DOMParser().parseFromString(`<body>${String(html ?? '')}</body>`, 'text/html')
  Array.from(doc.body.childNodes).forEach(node => sanitizeDomNode(node, doc))
  const output = doc.body.innerHTML.trim()
  if (output === '<br>' || !output) return ''
  // Final defensive pass: DOMPurify enforces the tag/attr allow-list on top of
  // our own normalisation. If anything upstream ever leaks a tag or attribute
  // we didn't expect (e.g. from pasted rich text or future refactors), the
  // battle-tested library catches it — two layers instead of one.
  return sanitizeQuizRichHTML(output)
}

export function isRichTextHtml(value) {
  return HTML_RE.test(String(value ?? ''))
}

export function ensureRichTextHtml(value) {
  const input = String(value ?? '')
  if (!input.trim()) return ''
  const normalized = normalizeSanitizedHtml(isRichTextHtml(input) ? input : plainTextToHtml(input))
  if (!normalized) return ''
  if (!/\bdata-latex=/.test(normalized) && !/<table\b/i.test(normalized) && !richTextToPlainText(normalized).replace(/\s+/g, '').trim()) {
    return ''
  }
  return normalized
}

export function richTextToPlainText(value) {
  const input = String(value ?? '')
  if (!input.trim()) return ''
  if (!canUseDom()) {
    return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  const doc = new DOMParser().parseFromString(`<body>${isRichTextHtml(input) ? input : plainTextToHtml(input)}</body>`, 'text/html')
  const pieces = []

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      pieces.push(node.textContent ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const element = node
    const tagName = element.tagName.toUpperCase()

    if (tagName === 'BR') {
      pieces.push('\n')
      return
    }

    if (element.classList.contains('mnode')) {
      pieces.push(element.getAttribute('data-latex') || element.textContent || '')
      pieces.push(' ')
      return
    }

    const isCell = tagName === 'TD' || tagName === 'TH'
    const isRow = tagName === 'TR'

    if (BLOCK_TAGS.has(tagName)) pieces.push('\n')
    Array.from(element.childNodes).forEach(walk)
    if (isCell) pieces.push('\t')
    if (isRow) pieces.push('\n')
    if (BLOCK_TAGS.has(tagName)) pieces.push('\n')
  }

  Array.from(doc.body.childNodes).forEach(walk)

  return pieces
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function richTextHasContent(value) {
  const html = ensureRichTextHtml(value)
  if (!html) return false
  if (/\bdata-latex=/.test(html) || /<table\b/i.test(html)) return true
  return Boolean(richTextToPlainText(html).replace(/\s+/g, '').trim())
}

export function createMathNodeHtml(latex, displayMode = false) {
  const normalized = String(latex ?? '').trim()
  if (!normalized) return ''

  return `<span class="mnode" data-latex="${escapeAttribute(normalized)}" data-display="${displayMode ? 'true' : 'false'}">${escapeHtml(normalized)}</span>`
}

export function createTableHtml(rows = 2, columns = 2) {
  const safeRows = Math.min(Math.max(Number(rows) || 2, 1), 8)
  const safeColumns = Math.min(Math.max(Number(columns) || 2, 1), 6)
  const body = Array.from({ length: safeRows }, () => (
    `<tr>${Array.from({ length: safeColumns }, () => '<td><br></td>').join('')}</tr>`
  )).join('')

  return `<table class="etable"><tbody>${body}</tbody></table><p><br></p>`
}

export function serializeEditorElement(editorElement) {
  if (!editorElement) return ''
  const clone = editorElement.cloneNode(true)

  clone.querySelectorAll('.mnode').forEach(node => {
    const latex = node.getAttribute('data-latex') || node.textContent || ''
    node.textContent = latex
    node.removeAttribute('contenteditable')
    node.removeAttribute('spellcheck')
  })

  clone.querySelectorAll('[contenteditable]').forEach(node => node.removeAttribute('contenteditable'))
  clone.querySelectorAll('[spellcheck]').forEach(node => node.removeAttribute('spellcheck'))

  return ensureRichTextHtml(clone.innerHTML)
}

export function loadKaTeXAssets() {
  if (!canUseDom()) return Promise.resolve(null)
  if (window.katex?.render) return Promise.resolve(window.katex)
  if (katexLoaderPromise) return katexLoaderPromise

  katexLoaderPromise = new Promise(resolve => {
    const existingLink = document.querySelector('link[data-katex-styles="true"]')
    if (!existingLink) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`
      link.setAttribute('data-katex-styles', 'true')
      document.head.appendChild(link)
    }

    const existingScript = document.querySelector('script[data-katex-script="true"]')
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.katex || null), { once: true })
      existingScript.addEventListener('error', () => resolve(null), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js`
    script.async = true
    script.setAttribute('data-katex-script', 'true')
    script.onload = () => resolve(window.katex || null)
    script.onerror = () => resolve(null)
    document.head.appendChild(script)
  })

  return katexLoaderPromise
}

export function renderMathInElement(container) {
  if (!container) return

  const katex = window.katex
  container.querySelectorAll('.mnode').forEach(node => {
    const latex = node.getAttribute('data-latex') || node.textContent || ''
    const displayMode = node.getAttribute('data-display') === 'true'

    node.setAttribute('contenteditable', 'false')
    node.setAttribute('spellcheck', 'false')

    if (katex?.render) {
      try {
        katex.render(latex, node, {
          throwOnError: false,
          displayMode,
          strict: 'ignore',
        })
        return
      } catch (error) {
        console.error('KaTeX render failed:', error)
      }
    }

    node.textContent = latex
  })
}

export function normalizeRichTextPayload(value) {
  return ensureRichTextHtml(value)
}
