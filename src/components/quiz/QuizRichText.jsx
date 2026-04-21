import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import {
  Undo2, Redo2,
  Bold, Italic, Underline, Strikethrough,
  Superscript, Subscript,
  List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight,
  Palette, Highlighter,
  Sigma, Table as TableIcon,
  X,
} from '../ui/icons'
import {
  createMathNodeHtml,
  createTableHtml,
  ensureRichTextHtml,
  loadKaTeXAssets,
  renderMathInElement,
  richTextHasContent,
  serializeEditorElement,
} from '../../utils/quizRichText.js'

const TEXT_COLORS = ['#0f172a', '#1d4ed8', '#0f766e', '#15803d', '#b45309', '#c2410c', '#be123c', '#7c3aed', '#475569', '#dc2626']
const HIGHLIGHT_COLORS = ['#fef08a', '#fde68a', '#bfdbfe', '#bae6fd', '#bbf7d0', '#fecaca', '#f5d0fe', '#e5e7eb']

// ── Quick Templates ───────────────────────────────────────────────────
// Categorised templates the teacher or learner can tap to insert a
// ready-made equation skeleton. Each category is a tab in MathModal.
const TEMPLATE_GROUPS = [
  {
    id: 'algebra',
    label: 'Algebra',
    items: [
      { label: 'Fraction',          value: '\\frac{a}{b}' },
      { label: 'Mixed number',      value: '3\\tfrac{1}{2}' },
      { label: 'Square',            value: 'x^{2}' },
      { label: 'Cube',              value: 'x^{3}' },
      { label: 'Power',             value: 'x^{n}' },
      { label: 'Square root',       value: '\\sqrt{x}' },
      { label: 'Nth root',          value: '\\sqrt[n]{x}' },
      { label: 'Subscript',         value: 'x_{1}' },
      { label: 'Quadratic',         value: 'ax^{2} + bx + c = 0' },
      { label: 'Quadratic formula', value: 'x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}' },
      { label: 'Absolute value',    value: '|x|' },
      { label: 'Scientific form',   value: '1.23 \\times 10^{4}' },
      { label: 'Logarithm',         value: '\\log_{10}(x)' },
      { label: 'Natural log',       value: '\\ln(x)' },
    ],
  },
  {
    id: 'geometry',
    label: 'Geometry',
    items: [
      { label: 'Area of circle',     value: 'A = \\pi r^{2}' },
      { label: 'Circumference',      value: 'C = 2\\pi r' },
      { label: 'Pythagoras',         value: 'a^{2} + b^{2} = c^{2}' },
      { label: 'Area of triangle',   value: 'A = \\tfrac{1}{2} b h' },
      { label: 'Volume of cuboid',   value: 'V = l \\times w \\times h' },
      { label: 'Volume of cylinder', value: 'V = \\pi r^{2} h' },
      { label: 'Angle',              value: '\\angle ABC = 90^{\\circ}' },
      { label: 'Parallel',           value: 'AB \\parallel CD' },
      { label: 'Perpendicular',      value: 'AB \\perp CD' },
    ],
  },
  {
    id: 'trig',
    label: 'Trig',
    items: [
      { label: 'sin',         value: '\\sin(\\theta)' },
      { label: 'cos',         value: '\\cos(\\theta)' },
      { label: 'tan',         value: '\\tan(\\theta)' },
      { label: 'Identity',    value: '\\sin^{2}(\\theta) + \\cos^{2}(\\theta) = 1' },
      { label: 'Sine rule',   value: '\\frac{a}{\\sin A} = \\frac{b}{\\sin B}' },
      { label: 'Cosine rule', value: 'c^{2} = a^{2} + b^{2} - 2ab\\cos C' },
    ],
  },
  {
    id: 'calculus',
    label: 'Calculus',
    items: [
      { label: 'Limit',             value: '\\lim_{x \\to 0} f(x)' },
      { label: 'Derivative',        value: '\\frac{dy}{dx}' },
      { label: 'Partial derivative', value: '\\frac{\\partial f}{\\partial x}' },
      { label: 'Integral',          value: '\\int f(x) \\, dx' },
      { label: 'Definite integral', value: '\\int_{a}^{b} f(x) \\, dx' },
      { label: 'Summation',         value: '\\sum_{i=1}^{n} a_{i}' },
      { label: 'Product',           value: '\\prod_{i=1}^{n} a_{i}' },
    ],
  },
  {
    id: 'sets',
    label: 'Sets & Logic',
    items: [
      { label: 'Union',        value: 'A \\cup B' },
      { label: 'Intersection', value: 'A \\cap B' },
      { label: 'Subset',       value: 'A \\subset B' },
      { label: 'Subset equal', value: 'A \\subseteq B' },
      { label: 'Element of',   value: 'x \\in A' },
      { label: 'Not in',       value: 'x \\notin A' },
      { label: 'Empty set',    value: '\\emptyset' },
      { label: 'For all',      value: '\\forall x' },
      { label: 'There exists', value: '\\exists x' },
      { label: 'Implies',      value: 'p \\Rightarrow q' },
      { label: 'If and only if', value: 'p \\iff q' },
    ],
  },
  {
    id: 'chemistry',
    label: 'Chemistry',
    items: [
      { label: 'Water',           value: 'H_{2}O' },
      { label: 'Carbon dioxide',  value: 'CO_{2}' },
      { label: 'Methane',         value: 'CH_{4}' },
      { label: 'Glucose',         value: 'C_{6}H_{12}O_{6}' },
      { label: 'Sulfuric acid',   value: 'H_{2}SO_{4}' },
      { label: 'Reaction arrow',  value: 'A + B \\rightarrow C' },
      { label: 'Reversible',      value: 'A + B \\rightleftharpoons C' },
      { label: 'Gas release',     value: 'CO_{2} \\uparrow' },
      { label: 'Precipitate',     value: 'AgCl \\downarrow' },
      { label: 'Photosynthesis',  value: '6CO_{2} + 6H_{2}O \\xrightarrow{\\text{light}} C_{6}H_{12}O_{6} + 6O_{2}' },
      { label: 'Ion charge',      value: 'Na^{+}' },
      { label: 'Double charge',   value: 'Ca^{2+}' },
    ],
  },
]

// Flat list retained for backwards-compat (some callers import it).

// ── Symbol palette ────────────────────────────────────────────────────
// Each entry: { latex, glyph, label? }
//   latex  — what gets appended to the LaTeX input
//   glyph  — what we render on the button (bigger, clearer)
//   label  — optional fallback name (used by aria-label)
const SYMBOL_GROUPS = [
  {
    id: 'operators',
    label: 'Operators',
    items: [
      { latex: '\\times',     glyph: '×'  },
      { latex: '\\div',       glyph: '÷'  },
      { latex: '\\cdot',      glyph: '·'  },
      { latex: '\\pm',        glyph: '±'  },
      { latex: '\\mp',        glyph: '∓'  },
      { latex: '\\neq',       glyph: '≠'  },
      { latex: '\\approx',    glyph: '≈'  },
      { latex: '\\leq',       glyph: '≤'  },
      { latex: '\\geq',       glyph: '≥'  },
      { latex: '\\ll',        glyph: '≪'  },
      { latex: '\\gg',        glyph: '≫'  },
      { latex: '\\equiv',     glyph: '≡'  },
      { latex: '\\propto',    glyph: '∝'  },
      { latex: '\\infty',     glyph: '∞'  },
      { latex: '^{\\circ}',   glyph: '°', label: 'degree' },
      { latex: "\\prime",     glyph: '′'  },
    ],
  },
  {
    id: 'greek',
    label: 'Greek',
    items: [
      { latex: '\\alpha',  glyph: 'α' },
      { latex: '\\beta',   glyph: 'β' },
      { latex: '\\gamma',  glyph: 'γ' },
      { latex: '\\delta',  glyph: 'δ' },
      { latex: '\\epsilon',glyph: 'ε' },
      { latex: '\\zeta',   glyph: 'ζ' },
      { latex: '\\eta',    glyph: 'η' },
      { latex: '\\theta',  glyph: 'θ' },
      { latex: '\\lambda', glyph: 'λ' },
      { latex: '\\mu',     glyph: 'μ' },
      { latex: '\\pi',     glyph: 'π' },
      { latex: '\\rho',    glyph: 'ρ' },
      { latex: '\\sigma',  glyph: 'σ' },
      { latex: '\\tau',    glyph: 'τ' },
      { latex: '\\phi',    glyph: 'φ' },
      { latex: '\\psi',    glyph: 'ψ' },
      { latex: '\\omega',  glyph: 'ω' },
      { latex: '\\Gamma',  glyph: 'Γ' },
      { latex: '\\Delta',  glyph: 'Δ' },
      { latex: '\\Theta',  glyph: 'Θ' },
      { latex: '\\Lambda', glyph: 'Λ' },
      { latex: '\\Pi',     glyph: 'Π' },
      { latex: '\\Sigma',  glyph: 'Σ' },
      { latex: '\\Phi',    glyph: 'Φ' },
      { latex: '\\Omega',  glyph: 'Ω' },
    ],
  },
  {
    id: 'relations',
    label: 'Sets',
    items: [
      { latex: '\\cup',      glyph: '∪' },
      { latex: '\\cap',      glyph: '∩' },
      { latex: '\\subset',   glyph: '⊂' },
      { latex: '\\subseteq', glyph: '⊆' },
      { latex: '\\supset',   glyph: '⊃' },
      { latex: '\\supseteq', glyph: '⊇' },
      { latex: '\\in',       glyph: '∈' },
      { latex: '\\notin',    glyph: '∉' },
      { latex: '\\emptyset', glyph: '∅' },
      { latex: '\\forall',   glyph: '∀' },
      { latex: '\\exists',   glyph: '∃' },
      { latex: '\\neg',      glyph: '¬' },
    ],
  },
  {
    id: 'arrows',
    label: 'Arrows',
    items: [
      { latex: '\\rightarrow',        glyph: '→' },
      { latex: '\\leftarrow',         glyph: '←' },
      { latex: '\\leftrightarrow',    glyph: '↔' },
      { latex: '\\Rightarrow',        glyph: '⇒' },
      { latex: '\\Leftarrow',         glyph: '⇐' },
      { latex: '\\Leftrightarrow',    glyph: '⇔' },
      { latex: '\\uparrow',           glyph: '↑' },
      { latex: '\\downarrow',         glyph: '↓' },
      { latex: '\\rightleftharpoons', glyph: '⇌' },
      { latex: '\\mapsto',            glyph: '↦' },
    ],
  },
  {
    id: 'calculus',
    label: 'Calculus',
    items: [
      { latex: '\\sum',     glyph: '∑' },
      { latex: '\\prod',    glyph: '∏' },
      { latex: '\\int',     glyph: '∫' },
      { latex: '\\oint',    glyph: '∮' },
      { latex: '\\partial', glyph: '∂' },
      { latex: '\\nabla',   glyph: '∇' },
      { latex: '\\sqrt{}',  glyph: '√' },
    ],
  },
]

// Flat list retained for backwards-compat.

function joinClasses(...parts) {
  return parts.filter(Boolean).join(' ')
}

function getSelectionRange(editorElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  const anchorNode = range.commonAncestorContainer
  return editorElement.contains(anchorNode) ? range.cloneRange() : null
}

function focusEditorAtEnd(editorElement) {
  editorElement.focus()
  const range = document.createRange()
  range.selectNodeContents(editorElement)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return range
}

function restoreSelection(editorElement, savedRange) {
  const range = savedRange && editorElement.contains(savedRange.commonAncestorContainer)
    ? savedRange
    : focusEditorAtEnd(editorElement)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return range
}

function insertHtmlAtSelection(editorElement, savedRange, html) {
  restoreSelection(editorElement, savedRange)
  document.execCommand('insertHTML', false, html)
}

function ToolbarButton({ active = false, title, onClick, children, ariaLabel, compact = false }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel || title}
      aria-pressed={active}
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
      className={joinClasses(
        'inline-flex items-center justify-center gap-1.5 min-h-0 rounded-lg border font-black transition-all duration-fast ease-out',
        compact ? 'h-8 w-8 text-sm' : 'h-8 px-2.5 text-xs',
        active
          ? 'border-[var(--accent)] theme-accent-fill theme-on-accent shadow-elev-inner-hl shadow-elev-sm'
          : 'theme-border theme-card theme-text hover:border-[var(--accent)] hover:theme-accent-bg hover:-translate-y-px hover:shadow-elev-sm',
      )}
    >
      {children}
    </button>
  )
}

// Visual group divider between tool clusters.
function ToolbarDivider() {
  return <span className="theme-border h-5 border-l mx-0.5" aria-hidden="true" />
}

function ColorPalette({ colors, onPick }) {
  return (
    <div className="theme-card theme-border absolute left-0 top-[calc(100%+0.5rem)] z-20 grid w-44 grid-cols-5 gap-2 rounded-2xl border p-3 shadow-xl">
      {colors.map(color => (
        <button
          key={color}
          type="button"
          onMouseDown={event => event.preventDefault()}
          onClick={() => onPick(color)}
          className="h-7 w-7 min-h-0 rounded-full border border-white/80 shadow-sm transition-transform hover:scale-105"
          style={{ backgroundColor: color }}
          aria-label={`Choose ${color}`}
        />
      ))}
    </div>
  )
}

const RECENT_SYMBOL_KEY = 'examprep:mathRecentSymbols'
const MAX_RECENT_SYMBOLS = 12

function loadRecentSymbols() {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_SYMBOL_KEY)
    return raw ? JSON.parse(raw).slice(0, MAX_RECENT_SYMBOLS) : []
  } catch { return [] }
}

function saveRecentSymbols(list) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(RECENT_SYMBOL_KEY, JSON.stringify(list.slice(0, MAX_RECENT_SYMBOLS))) } catch { /* storage disabled */ }
}

// Flat lookup {latex → {glyph,label}} so we can resolve a recent entry
// back to its display form without a search every render.
const SYMBOL_LOOKUP = (() => {
  const map = new Map()
  SYMBOL_GROUPS.forEach(g => g.items.forEach(item => { map.set(item.latex, item) }))
  return map
})()

function MathModal({ open, onClose, onInsert, initialLatex = '', mode = 'insert' }) {
  const [latex, setLatex] = useState('')
  const [templateTab, setTemplateTab] = useState(TEMPLATE_GROUPS[0].id)
  const [symbolTab, setSymbolTab] = useState('recent') // default to Recent if any saved
  const [recentSymbols, setRecentSymbols] = useState(loadRecentSymbols)
  const previewRef = useRef(null)

  useEffect(() => {
    if (!open) return
    loadKaTeXAssets()
    // Seed from initialLatex whenever the modal opens. If we're editing an
    // existing node, this populates the textarea so the user can tweak.
    setLatex(initialLatex || '')
  }, [open, initialLatex])

  useEffect(() => {
    if (!open || !previewRef.current) return
    const container = previewRef.current
    const previewNode = container.querySelector('.mnode')
    if (!previewNode) return

    loadKaTeXAssets().then(() => {
      renderMathInElement(container)
    })
  }, [latex, open])

  useEffect(() => {
    if (!open) {
      setLatex('')
      setTemplateTab(TEMPLATE_GROUPS[0].id)
    } else {
      // Each time the modal opens, reload recents + default to the sensible
      // tab (Recent if we have any, otherwise Operators).
      const fresh = loadRecentSymbols()
      setRecentSymbols(fresh)
      setSymbolTab(fresh.length ? 'recent' : SYMBOL_GROUPS[0].id)
    }
  }, [open])

  // Escape closes.
  useEffect(() => {
    if (!open) return
    function onKey(event) { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const activeTemplateGroup = TEMPLATE_GROUPS.find(g => g.id === templateTab) || TEMPLATE_GROUPS[0]
  // Resolve the symbol grid for the active tab. "recent" isn't in the
  // canonical groups — we synthesize it from localStorage.
  const activeSymbolItems = symbolTab === 'recent'
    ? recentSymbols.map(latex => SYMBOL_LOOKUP.get(latex)).filter(Boolean)
    : (SYMBOL_GROUPS.find(g => g.id === symbolTab) || SYMBOL_GROUPS[0]).items

  const previewHtml = latex
    ? createMathNodeHtml(latex)
    : '<p class="quiz-rich-muted">Pick a template or tap symbols — your formula previews here.</p>'

  function appendSymbol(latexFragment) {
    setLatex(current => {
      if (!current) return latexFragment
      // Insert with a trailing space for readability unless already whitespace.
      const sep = /\s$/.test(current) ? '' : ' '
      return `${current}${sep}${latexFragment}`
    })
    // Promote to the top of Recent — dedupe, cap at MAX_RECENT_SYMBOLS.
    setRecentSymbols(prev => {
      const next = [latexFragment, ...prev.filter(x => x !== latexFragment)].slice(0, MAX_RECENT_SYMBOLS)
      saveRecentSymbols(next)
      return next
    })
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="theme-card theme-border w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-[28px] border shadow-elev-xl animate-scale-in">
        {/* Header */}
        <div className="sticky top-0 z-10 theme-card theme-border border-b px-5 pt-5 pb-4 flex items-start justify-between gap-3 rounded-t-[28px]">
          <div>
            <p className="text-eyebrow" style={{ color: 'var(--accent-fg)' }}>Math editor</p>
            <h2 className="text-display-md theme-text mt-1" style={{ fontSize: 19 }}>
              {mode === 'edit' ? 'Edit math' : 'Insert math'}
            </h2>
            <p className="theme-text-muted text-body-sm mt-1">
              {mode === 'edit'
                ? 'Adjust the LaTeX, swap the template, or add more symbols.'
                : 'Pick a template, tap symbols, or type raw LaTeX.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="theme-text-muted min-h-0 bg-transparent p-1 shadow-none hover:theme-text transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5 pb-5 pt-4 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* LEFT — templates + symbols */}
          <div className="space-y-5 min-w-0">
            {/* Templates */}
            <div>
              <p className="text-eyebrow mb-2.5">Quick templates</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {TEMPLATE_GROUPS.map(group => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setTemplateTab(group.id)}
                    className={joinClasses(
                      'min-h-0 rounded-full border px-3 py-1 text-xs font-black transition-all duration-fast ease-out',
                      templateTab === group.id
                        ? 'theme-accent-fill theme-on-accent border-transparent shadow-elev-sm shadow-elev-inner-hl'
                        : 'theme-card theme-border theme-text-muted hover:border-[var(--accent)] hover:theme-accent-text',
                    )}
                  >
                    {group.label}
                  </button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {activeTemplateGroup.items.map(template => (
                  <button
                    key={template.label}
                    type="button"
                    onClick={() => setLatex(template.value)}
                    className="theme-bg-subtle theme-border theme-text min-h-0 rounded-xl border px-3 py-2 text-left text-sm font-bold transition-all duration-fast ease-out hover:-translate-y-px hover:border-[var(--accent)] hover:shadow-elev-sm"
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Symbols — MS Word-style grid */}
            <div>
              <p className="text-eyebrow mb-2.5">Symbols</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {recentSymbols.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSymbolTab('recent')}
                    className={joinClasses(
                      'min-h-0 rounded-full border px-3 py-1 text-xs font-black transition-all duration-fast ease-out',
                      symbolTab === 'recent'
                        ? 'theme-accent-fill theme-on-accent border-transparent shadow-elev-sm shadow-elev-inner-hl'
                        : 'theme-card theme-border theme-text-muted hover:border-[var(--accent)] hover:theme-accent-text',
                    )}
                  >
                    Recent
                  </button>
                )}
                {SYMBOL_GROUPS.map(group => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setSymbolTab(group.id)}
                    className={joinClasses(
                      'min-h-0 rounded-full border px-3 py-1 text-xs font-black transition-all duration-fast ease-out',
                      symbolTab === group.id
                        ? 'theme-accent-fill theme-on-accent border-transparent shadow-elev-sm shadow-elev-inner-hl'
                        : 'theme-card theme-border theme-text-muted hover:border-[var(--accent)] hover:theme-accent-text',
                    )}
                  >
                    {group.label}
                  </button>
                ))}
              </div>

              {/* Uniform square-cell grid mimicking MS Word's Symbol dialog:
                  thin borders between cells, generous glyph size in a serif
                  (Cambria Math) font, subtle accent fill on hover, tooltip
                  shows LaTeX + descriptive label. */}
              {activeSymbolItems.length > 0 ? (
                <div
                  role="grid"
                  className="theme-card theme-border rounded-xl border overflow-hidden"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(46px, 1fr))',
                  }}
                >
                  {activeSymbolItems.map((sym, i) => (
                    <button
                      key={`${sym.latex}-${i}`}
                      type="button"
                      role="gridcell"
                      onClick={() => appendSymbol(sym.latex)}
                      aria-label={sym.label || sym.latex}
                      title={`${sym.latex}${sym.label ? ` — ${sym.label}` : ''}`}
                      className="theme-text hover:theme-accent-bg hover:theme-accent-text flex items-center justify-center border-r border-b theme-border transition-colors duration-fast"
                      style={{
                        height: 46,
                        fontFamily: '"Cambria Math","Cambria","Latin Modern Math","STIX Two Math","Times New Roman",serif',
                        fontSize: 22,
                        lineHeight: 1,
                      }}
                    >
                      {sym.glyph}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="theme-text-muted text-body-sm italic px-1 py-2">
                  No recent symbols yet — tap any symbol from another tab and it will appear here.
                </p>
              )}
            </div>
          </div>

          {/* RIGHT — LaTeX input, preview, insert */}
          <div className="space-y-3 min-w-0">
            <label className="block">
              <span className="text-eyebrow mb-2 block">LaTeX</span>
              <textarea
                value={latex}
                onChange={event => setLatex(event.target.value)}
                placeholder="e.g. \frac{1}{2}x^2"
                rows={5}
                className="theme-input w-full rounded-2xl border-2 px-3 py-3 text-sm outline-none transition-colors focus:border-[var(--accent)] font-mono"
              />
            </label>

            <div className="theme-bg-subtle theme-border min-h-[9rem] rounded-2xl border p-4 shadow-elev-sm">
              <p className="text-eyebrow mb-2">Preview</p>
              <div
                ref={previewRef}
                className="quiz-rich-content min-h-[5rem] text-base"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLatex('')}
                disabled={!latex}
                className="theme-card theme-border theme-text min-h-0 rounded-2xl border-2 px-4 py-3 text-sm font-black transition-all duration-fast ease-out hover:border-[var(--accent)] disabled:opacity-40 disabled:pointer-events-none"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!latex.trim()) return
                  onInsert(latex)
                  onClose()
                }}
                disabled={!latex.trim()}
                className="theme-accent-fill theme-on-accent flex-1 rounded-2xl py-3 font-black transition-all duration-fast ease-out shadow-elev-sm shadow-elev-inner-hl hover:-translate-y-px hover:shadow-elev-md disabled:opacity-50 disabled:pointer-events-none"
              >
                {mode === 'edit' ? 'Save changes' : 'Insert math'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Perform a structural edit on an existing <table> inside the editor.
 * The cell the caret is in acts as the anchor — we find its row/column
 * index and mutate the DOM directly. Works on any table but tuned for
 * the `.etable` class that ensureRichTextHtml emits.
 */
function runTableAction(action, table) {
  if (!table) return
  const sel = window.getSelection()
  const anchor = sel?.anchorNode
  const host = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement
  const cell = host?.closest?.('td, th')
  const row  = host?.closest?.('tr')
  const colIndex = cell && row ? Array.from(row.children).indexOf(cell) : 0
  const columnCount = row ? row.children.length : 0

  switch (action) {
    case 'row-above':
    case 'row-below': {
      if (!row) return
      const ref = action === 'row-above' ? row : row.nextSibling
      const newRow = document.createElement('tr')
      for (let i = 0; i < columnCount; i++) {
        const td = document.createElement('td')
        td.innerHTML = '<br>'
        newRow.appendChild(td)
      }
      row.parentNode?.insertBefore(newRow, ref)
      break
    }
    case 'col-left':
    case 'col-right': {
      if (!row) return
      const allRows = Array.from(table.querySelectorAll('tr'))
      allRows.forEach(r => {
        const ref = r.children[colIndex + (action === 'col-right' ? 1 : 0)] || null
        const td = document.createElement('td')
        td.innerHTML = '<br>'
        r.insertBefore(td, ref)
      })
      break
    }
    case 'row-delete': {
      if (!row) return
      // If it's the last row, delete the whole table instead.
      const rowCount = table.querySelectorAll('tr').length
      if (rowCount <= 1) table.remove()
      else row.remove()
      break
    }
    case 'col-delete': {
      if (!row) return
      const allRows = Array.from(table.querySelectorAll('tr'))
      // If deleting the last remaining column, remove the whole table.
      if (columnCount <= 1) { table.remove(); break }
      allRows.forEach(r => {
        const target = r.children[colIndex]
        target?.remove()
      })
      break
    }
    case 'table-delete': {
      table.remove()
      break
    }
    default:
      return
  }
}

/**
 * TableToolbar — small floating strip that appears above the active table
 * while the cursor is inside it. Acts like Notion's slash-menu for tables:
 * add/remove rows and columns, delete the whole table.
 */
function TableToolbar({ table, onAction }) {
  const [pos, setPos] = useState(() => computeTablePosition(table))

  // Reposition when the table scrolls into a new spot (editor resize, caret
  // move, viewport scroll).
  useEffect(() => {
    if (!table) return undefined
    const update = () => setPos(computeTablePosition(table))
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [table])

  if (!table) return null

  const btnBase = 'inline-flex items-center gap-1 rounded-md border theme-border bg-[var(--card)] hover:border-[var(--accent)] hover:theme-accent-bg theme-text h-7 px-2 text-[11px] font-black transition-all duration-fast ease-out hover:-translate-y-px'

  return (
    <div
      role="toolbar"
      aria-label="Table actions"
      className="absolute z-30 flex flex-wrap gap-1 p-1 theme-card rounded-xl border theme-border shadow-elev-md"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()} // don't steal focus from editor
    >
      <button type="button" className={btnBase} onClick={() => onAction('row-above')} title="Insert row above">↑ Row</button>
      <button type="button" className={btnBase} onClick={() => onAction('row-below')} title="Insert row below">↓ Row</button>
      <button type="button" className={btnBase} onClick={() => onAction('col-left')} title="Insert column left">← Col</button>
      <button type="button" className={btnBase} onClick={() => onAction('col-right')} title="Insert column right">→ Col</button>
      <span className="theme-border mx-0.5 h-5 border-l" />
      <button type="button" className={btnBase} onClick={() => onAction('row-delete')} title="Delete row">− Row</button>
      <button type="button" className={btnBase} onClick={() => onAction('col-delete')} title="Delete column">− Col</button>
      <button
        type="button"
        onClick={() => onAction('table-delete')}
        title="Delete table"
        className="inline-flex items-center gap-1 rounded-md border border-[color:var(--danger-fg)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)] h-7 px-2 text-[11px] font-black transition-all duration-fast ease-out hover:-translate-y-px"
      >
        ✕ Table
      </button>
    </div>
  )
}

function computeTablePosition(table) {
  if (!table) return { top: -9999, left: 0 }
  // Offset relative to the nearest positioned ancestor, which is the
  // <div className="relative"> wrapping the contentEditable.
  const parent = table.offsetParent
  const tRect = table.getBoundingClientRect()
  const pRect = parent?.getBoundingClientRect() ?? { top: 0, left: 0 }
  return {
    top: tRect.top - pRect.top - 40, // 40 px above the table
    left: tRect.left - pRect.left,
  }
}

function TablePopover({ open, onClose, onPick }) {
  const [hovered, setHovered] = useState({ rows: 2, columns: 2 })

  useEffect(() => {
    if (!open) setHovered({ rows: 2, columns: 2 })
  }, [open])

  if (!open) return null

  return (
    <div className="theme-card theme-border absolute right-0 top-[calc(100%+0.5rem)] z-20 rounded-2xl border p-3 shadow-xl">
      <p className="theme-text text-sm font-black">Insert Table</p>
      <p className="theme-text-muted mt-1 text-xs font-bold">{hovered.columns} × {hovered.rows}</p>
      <div className="mt-3 grid grid-cols-6 gap-1">
        {Array.from({ length: 8 }).map((_, rowIndex) =>
          Array.from({ length: 6 }).map((_, columnIndex) => {
            const active = rowIndex < hovered.rows && columnIndex < hovered.columns
            return (
              <button
                key={`${rowIndex}-${columnIndex}`}
                type="button"
                onMouseEnter={() => setHovered({ rows: rowIndex + 1, columns: columnIndex + 1 })}
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  onPick(rowIndex + 1, columnIndex + 1)
                  onClose()
                }}
                className={joinClasses(
                  'h-6 w-6 min-h-0 rounded-md border transition-colors',
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-bg)]'
                    : 'theme-border theme-bg-subtle',
                )}
                aria-label={`Insert ${columnIndex + 1} columns and ${rowIndex + 1} rows`}
              />
            )
          }),
        )}
      </div>
    </div>
  )
}

export function RichTextContent({ value, className = '' }) {
  const rootRef = useRef(null)
  const safeHtml = useMemo(() => ensureRichTextHtml(value), [value])

  useEffect(() => {
    if (!rootRef.current || !safeHtml) return
    loadKaTeXAssets().then(() => renderMathInElement(rootRef.current))
  }, [safeHtml])

  if (!safeHtml) return null

  return (
    <div
      ref={rootRef}
      className={joinClasses('quiz-rich-content', className)}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  )
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeightClass = 'min-h-[7rem]',
  compact = false,
}) {
  const editorRef = useRef(null)
  const savedRangeRef = useRef(null)
  const [commandState, setCommandState] = useState({})
  const [paletteOpen, setPaletteOpen] = useState(null)
  const [mathOpen, setMathOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [isEmpty, setIsEmpty] = useState(!richTextHasContent(value))
  // Math edit-in-place: when non-null, MathModal opens in "edit" mode and
  // insert replaces this specific node instead of inserting a new one.
  const [editingMathNode, setEditingMathNode] = useState(null)
  // Active table — drives the floating table toolbar when the cursor sits
  // inside an <table class="etable">.
  const [activeTable, setActiveTable] = useState(null)

  function syncFromEditor() {
    if (!editorRef.current) return
    const nextHtml = serializeEditorElement(editorRef.current)
    setIsEmpty(!richTextHasContent(nextHtml))
    startTransition(() => onChange(nextHtml))
  }

  function refreshCommandState() {
    if (!editorRef.current) return
    const selection = window.getSelection()
    const anchorNode = selection?.anchorNode
    if (!anchorNode || !editorRef.current.contains(anchorNode)) {
      setCommandState({})
      return
    }

    setCommandState({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikeThrough: document.queryCommandState('strikeThrough'),
      subscript: document.queryCommandState('subscript'),
      superscript: document.queryCommandState('superscript'),
      insertUnorderedList: document.queryCommandState('insertUnorderedList'),
      insertOrderedList: document.queryCommandState('insertOrderedList'),
      justifyLeft: document.queryCommandState('justifyLeft'),
      justifyCenter: document.queryCommandState('justifyCenter'),
      justifyRight: document.queryCommandState('justifyRight'),
    })
  }

  function rememberSelection() {
    if (!editorRef.current) return
    const range = getSelectionRange(editorRef.current)
    if (range) savedRangeRef.current = range
  }

  function runCommand(command, valueArg = null) {
    if (!editorRef.current) return
    restoreSelection(editorRef.current, savedRangeRef.current)
    document.execCommand('styleWithCSS', false, true)
    document.execCommand(command, false, valueArg)
    editorRef.current.focus()
    syncFromEditor()
    refreshCommandState()
  }

  useEffect(() => {
    if (!editorRef.current) return
    const nextHtml = ensureRichTextHtml(value)
    const currentHtml = serializeEditorElement(editorRef.current)

    if (currentHtml !== nextHtml) {
      editorRef.current.innerHTML = nextHtml
      loadKaTeXAssets().then(() => renderMathInElement(editorRef.current))
    }

    setIsEmpty(!richTextHasContent(nextHtml))
  }, [value])

  useEffect(() => {
    loadKaTeXAssets()
  }, [])

  useEffect(() => {
    function handleSelectionChange() {
      refreshCommandState()
      rememberSelection()
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  return (
    <>
      <div className={joinClasses('theme-card theme-border overflow-hidden rounded-2xl border', compact ? '' : 'shadow-elev-sm')}>
        <div className="theme-bg-subtle theme-border relative flex flex-wrap items-center gap-1 border-b px-3 py-2">
          {/* History */}
          <ToolbarButton compact title="Undo (Ctrl+Z)" onClick={() => runCommand('undo')}>
            <Undo2 size={15} strokeWidth={2.25} />
          </ToolbarButton>
          <ToolbarButton compact title="Redo (Ctrl+Shift+Z)" onClick={() => runCommand('redo')}>
            <Redo2 size={15} strokeWidth={2.25} />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Text formatting */}
          <ToolbarButton compact title="Bold (Ctrl+B)" active={commandState.bold} onClick={() => runCommand('bold')}>
            <Bold size={15} strokeWidth={2.5} />
          </ToolbarButton>
          <ToolbarButton compact title="Italic (Ctrl+I)" active={commandState.italic} onClick={() => runCommand('italic')}>
            <Italic size={15} strokeWidth={2.5} />
          </ToolbarButton>
          <ToolbarButton compact title="Underline (Ctrl+U)" active={commandState.underline} onClick={() => runCommand('underline')}>
            <Underline size={15} strokeWidth={2.5} />
          </ToolbarButton>
          <ToolbarButton compact title="Strikethrough" active={commandState.strikeThrough} onClick={() => runCommand('strikeThrough')}>
            <Strikethrough size={15} strokeWidth={2.5} />
          </ToolbarButton>
          <ToolbarButton compact title="Superscript — e.g. x²" active={commandState.superscript} onClick={() => runCommand('superscript')}>
            <Superscript size={15} strokeWidth={2.5} />
          </ToolbarButton>
          <ToolbarButton compact title="Subscript — e.g. H₂O" active={commandState.subscript} onClick={() => runCommand('subscript')}>
            <Subscript size={15} strokeWidth={2.5} />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Lists */}
          <ToolbarButton compact title="Bullet list" active={commandState.insertUnorderedList} onClick={() => runCommand('insertUnorderedList')}>
            <List size={15} strokeWidth={2.25} />
          </ToolbarButton>
          <ToolbarButton compact title="Numbered list" active={commandState.insertOrderedList} onClick={() => runCommand('insertOrderedList')}>
            <ListOrdered size={15} strokeWidth={2.25} />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Alignment */}
          <ToolbarButton compact title="Align left" active={commandState.justifyLeft} onClick={() => runCommand('justifyLeft')}>
            <AlignLeft size={15} strokeWidth={2.25} />
          </ToolbarButton>
          <ToolbarButton compact title="Align centre" active={commandState.justifyCenter} onClick={() => runCommand('justifyCenter')}>
            <AlignCenter size={15} strokeWidth={2.25} />
          </ToolbarButton>
          <ToolbarButton compact title="Align right" active={commandState.justifyRight} onClick={() => runCommand('justifyRight')}>
            <AlignRight size={15} strokeWidth={2.25} />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Colour & highlight */}
          <div className="relative">
            <ToolbarButton
              compact
              title="Text colour"
              onClick={() => {
                rememberSelection()
                setTableOpen(false)
                setPaletteOpen(current => current === 'text' ? null : 'text')
              }}
            >
              <Palette size={15} strokeWidth={2.25} />
            </ToolbarButton>
            {paletteOpen === 'text' && (
              <ColorPalette
                colors={TEXT_COLORS}
                onPick={color => {
                  runCommand('foreColor', color)
                  setPaletteOpen(null)
                }}
              />
            )}
          </div>

          <div className="relative">
            <ToolbarButton
              compact
              title="Highlight"
              onClick={() => {
                rememberSelection()
                setTableOpen(false)
                setPaletteOpen(current => current === 'highlight' ? null : 'highlight')
              }}
            >
              <Highlighter size={15} strokeWidth={2.25} />
            </ToolbarButton>
            {paletteOpen === 'highlight' && (
              <ColorPalette
                colors={HIGHLIGHT_COLORS}
                onPick={color => {
                  runCommand('hiliteColor', color)
                  setPaletteOpen(null)
                }}
              />
            )}
          </div>

          <ToolbarDivider />

          {/* Insert */}
          <ToolbarButton
            title="Insert math"
            onClick={() => {
              rememberSelection()
              setPaletteOpen(null)
              setMathOpen(true)
            }}
          >
            <Sigma size={14} strokeWidth={2.5} />
            Math
          </ToolbarButton>

          <div className="relative ml-auto">
            <ToolbarButton
              title="Insert table"
              onClick={() => {
                rememberSelection()
                setPaletteOpen(null)
                setTableOpen(current => !current)
              }}
            >
              <TableIcon size={14} strokeWidth={2.25} />
              Table
            </ToolbarButton>
            <TablePopover
              open={tableOpen}
              onClose={() => setTableOpen(false)}
              onPick={(rows, columns) => {
                if (!editorRef.current) return
                insertHtmlAtSelection(editorRef.current, savedRangeRef.current, createTableHtml(rows, columns))
                syncFromEditor()
              }}
            />
          </div>
        </div>

        <div className="relative">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            data-placeholder={placeholder}
            data-empty={isEmpty ? 'true' : 'false'}
            className={joinClasses(
              'quiz-rich-editor theme-text w-full px-4 py-3 text-sm leading-relaxed outline-none',
              minHeightClass,
            )}
            onFocus={rememberSelection}
            onClick={(event) => {
              rememberSelection()
              // Click-to-edit a math node. Inserting a fraction/formula
              // creates a <span class="mnode" data-latex="…"> — tapping it
              // reopens the math modal pre-loaded with the node's LaTeX.
              const mnode = event.target.closest?.('.mnode')
              if (mnode && editorRef.current?.contains(mnode)) {
                event.preventDefault()
                setEditingMathNode(mnode)
                setMathOpen(true)
                return
              }
              // Table focus — update the floating toolbar target.
              const tbl = event.target.closest?.('table.etable, table')
              setActiveTable(tbl && editorRef.current?.contains(tbl) ? tbl : null)
            }}
            onKeyDown={(event) => {
              // Backspace/Delete on an .mnode removes the whole node cleanly.
              if (event.key === 'Backspace' || event.key === 'Delete') {
                const sel = window.getSelection()
                if (sel?.rangeCount) {
                  const range = sel.getRangeAt(0)
                  if (range.collapsed) {
                    const target = event.key === 'Backspace'
                      ? range.startContainer.previousSibling || range.startContainer.parentElement?.previousSibling
                      : range.startContainer.nextSibling || range.startContainer.parentElement?.nextSibling
                    if (target && target.nodeType === Node.ELEMENT_NODE && target.classList?.contains('mnode')) {
                      event.preventDefault()
                      target.remove()
                      syncFromEditor()
                    }
                  }
                }
              }
            }}
            onKeyUp={() => {
              rememberSelection()
              // Refresh the table toolbar target when the caret moves with arrows.
              const sel = window.getSelection()
              const anchor = sel?.anchorNode
              if (anchor instanceof Node) {
                const host = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement
                const tbl = host?.closest?.('table.etable, table')
                setActiveTable(tbl && editorRef.current?.contains(tbl) ? tbl : null)
              }
            }}
            onInput={() => {
              setPaletteOpen(null)
              setTableOpen(false)
              syncFromEditor()
            }}
            onPaste={event => {
              const html = event.clipboardData.getData('text/html')
              if (html && editorRef.current) {
                event.preventDefault()
                insertHtmlAtSelection(editorRef.current, savedRangeRef.current, ensureRichTextHtml(html))
                loadKaTeXAssets().then(() => renderMathInElement(editorRef.current))
                syncFromEditor()
              }
            }}
            onBlur={(event) => {
              // Keep the table toolbar anchor only while focus remains in
              // the editor. If the user tabs out entirely, clear it.
              const next = event.relatedTarget
              if (!next || !editorRef.current?.contains(next)) {
                // Small delay lets the toolbar button receive the click first.
                setTimeout(() => setActiveTable(null), 120)
              }
            }}
          />

          {/* Floating table toolbar */}
          {activeTable && (
            <TableToolbar
              table={activeTable}
              onAction={(action) => {
                runTableAction(action, activeTable)
                syncFromEditor()
                // Re-check: action may have removed the table.
                if (!editorRef.current?.contains(activeTable)) {
                  setActiveTable(null)
                }
              }}
            />
          )}
        </div>
      </div>

      <MathModal
        open={mathOpen}
        onClose={() => {
          setMathOpen(false)
          setEditingMathNode(null)
        }}
        initialLatex={editingMathNode?.getAttribute('data-latex') || ''}
        mode={editingMathNode ? 'edit' : 'insert'}
        onInsert={latex => {
          if (!editorRef.current) return
          if (editingMathNode && editorRef.current.contains(editingMathNode)) {
            // Replace the existing node in place rather than inserting new.
            const wrapper = document.createElement('span')
            wrapper.innerHTML = createMathNodeHtml(latex)
            const replacement = wrapper.firstElementChild
            if (replacement) {
              editingMathNode.replaceWith(replacement)
            }
          } else {
            insertHtmlAtSelection(editorRef.current, savedRangeRef.current, createMathNodeHtml(latex))
          }
          setEditingMathNode(null)
          loadKaTeXAssets().then(() => renderMathInElement(editorRef.current))
          syncFromEditor()
        }}
      />
    </>
  )
}
