/**
 * src/editor/components/modals/MathModal.jsx
 *
 * Math insert / edit modal.
 *
 * Design goals (2026-04-22 rewrite):
 *   - Symbols organised by CATEGORY, not a flat list (teachers can find π
 *     under "Greek" instead of scanning a 26-item grid)
 *   - Search input that filters templates + symbols by name or latex
 *   - Single-column LaTeX + live KaTeX preview, identical safety model
 *   - Mobile-friendly: larger tap targets, tab-row is scrollable on narrow
 *     viewports (see editor.css)
 *
 * Data model unchanged: stores `{ latex: string }` in the Tiptap doc via
 * `editor.chain().insertMathNode(latex).run()`. No change to save/load,
 * no migration needed, no tests broken.
 *
 * Props:
 *   editor      {object|null}    Tiptap editor instance
 *   editState   {object|null}    { latex, pos } when editing; null when inserting
 *   onClose     {function}
 */

import { useState, useEffect, useMemo } from 'react'
import katex from 'katex'

// ── Templates: ready-to-insert structures with argument placeholders ──
const TEMPLATES = [
  { label: 'Fraction',    latex: '\\frac{a}{b}',              preview: 'a⁄b'   },
  { label: 'Mixed frac',  latex: 'a\\tfrac{b}{c}',             preview: '1½'    },
  { label: 'xⁿ Power',    latex: 'x^{n}',                     preview: 'xⁿ'    },
  { label: 'x²',          latex: 'x^{2}',                     preview: 'x²'    },
  { label: 'x³',          latex: 'x^{3}',                     preview: 'x³'    },
  { label: '√x',          latex: '\\sqrt{x}',                  preview: '√x'   },
  { label: 'ⁿ√x',         latex: '\\sqrt[n]{x}',               preview: 'ⁿ√x'  },
  { label: 'Subscript',   latex: 'x_{n}',                     preview: 'xₙ'    },
  { label: '½',           latex: '\\frac{1}{2}',               preview: '½'    },
  { label: '¾',           latex: '\\frac{3}{4}',               preview: '¾'    },
  { label: 'Log',         latex: '\\log_{b}(x)',               preview: 'log'  },
  { label: 'Percent',     latex: '\\frac{x}{100}',             preview: '%'    },
  { label: 'Quadratic',   latex: 'ax^{2}+bx+c=0',              preview: 'ax²…' },
  { label: 'Quadratic f.',latex: 'x = \\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}', preview: '−b±…' },
  { label: 'Pythagoras',  latex: 'a^{2}+b^{2}=c^{2}',          preview: 'a²+b²' },
  { label: 'Sine rule',   latex: '\\frac{a}{\\sin A}=\\frac{b}{\\sin B}', preview: 'sin rule' },
  { label: 'Limit',       latex: '\\lim_{x \\to 0} f(x)',      preview: 'lim'  },
  { label: 'Derivative',  latex: '\\frac{dy}{dx}',             preview: 'dy/dx' },
  { label: 'Integral',    latex: '\\int f(x)\\,dx',            preview: '∫'    },
  { label: 'Definite',    latex: '\\int_{a}^{b} f(x)\\,dx',    preview: 'ₐ∫ᵇ'  },
  { label: 'Sum',         latex: '\\sum_{i=1}^{n} a_{i}',      preview: 'Σ'    },
]

// ── Symbols, organised by category ──
// Each symbol: `g` is the glyph shown on the button, `l` is the LaTeX
// appended on click, `n` is the searchable name.
const SYMBOL_CATEGORIES = [
  {
    id: 'common',
    label: 'Common',
    items: [
      { g: '+',   l: '+',         n: 'plus' },
      { g: '−',   l: '-',         n: 'minus' },
      { g: '×',   l: '\\times',   n: 'times multiply' },
      { g: '÷',   l: '\\div',     n: 'divide' },
      { g: '·',   l: '\\cdot',    n: 'dot multiply' },
      { g: '±',   l: '\\pm',      n: 'plus minus' },
      { g: '∓',   l: '\\mp',      n: 'minus plus' },
      { g: '=',   l: '=',         n: 'equals' },
      { g: '≠',   l: '\\neq',     n: 'not equal' },
      { g: '≈',   l: '\\approx',  n: 'approximately' },
      { g: '∞',   l: '\\infty',   n: 'infinity' },
      { g: '°',   l: '^{\\circ}', n: 'degree degrees' },
    ],
  },
  {
    id: 'compare',
    label: 'Compare',
    items: [
      { g: '<',   l: '<',         n: 'less than' },
      { g: '>',   l: '>',         n: 'greater than' },
      { g: '≤',   l: '\\leq',     n: 'less equal leq' },
      { g: '≥',   l: '\\geq',     n: 'greater equal geq' },
      { g: '≪',   l: '\\ll',      n: 'much less' },
      { g: '≫',   l: '\\gg',      n: 'much greater' },
      { g: '≡',   l: '\\equiv',   n: 'equivalent' },
      { g: '∝',   l: '\\propto',  n: 'proportional' },
    ],
  },
  {
    id: 'greek',
    label: 'Greek',
    items: [
      { g: 'α',   l: '\\alpha',   n: 'alpha' },
      { g: 'β',   l: '\\beta',    n: 'beta' },
      { g: 'γ',   l: '\\gamma',   n: 'gamma' },
      { g: 'δ',   l: '\\delta',   n: 'delta' },
      { g: 'ε',   l: '\\epsilon', n: 'epsilon' },
      { g: 'θ',   l: '\\theta',   n: 'theta' },
      { g: 'λ',   l: '\\lambda',  n: 'lambda' },
      { g: 'μ',   l: '\\mu',      n: 'mu' },
      { g: 'π',   l: '\\pi',      n: 'pi' },
      { g: 'ρ',   l: '\\rho',     n: 'rho' },
      { g: 'σ',   l: '\\sigma',   n: 'sigma' },
      { g: 'τ',   l: '\\tau',     n: 'tau' },
      { g: 'φ',   l: '\\phi',     n: 'phi' },
      { g: 'ω',   l: '\\omega',   n: 'omega' },
      { g: 'Δ',   l: '\\Delta',   n: 'capital delta' },
      { g: 'Θ',   l: '\\Theta',   n: 'capital theta' },
      { g: 'Λ',   l: '\\Lambda',  n: 'capital lambda' },
      { g: 'Π',   l: '\\Pi',      n: 'capital pi' },
      { g: 'Σ',   l: '\\Sigma',   n: 'capital sigma sum' },
      { g: 'Ω',   l: '\\Omega',   n: 'capital omega' },
    ],
  },
  {
    id: 'functions',
    label: 'Functions',
    items: [
      { g: '√',     l: '\\sqrt{}',       n: 'square root' },
      { g: '∛',     l: '\\sqrt[3]{}',    n: 'cube root' },
      { g: '∑',     l: '\\sum',          n: 'sum summation' },
      { g: '∏',     l: '\\prod',         n: 'product' },
      { g: '∫',     l: '\\int',          n: 'integral' },
      { g: 'lim',   l: '\\lim',          n: 'limit' },
      { g: 'log',   l: '\\log',          n: 'logarithm' },
      { g: 'ln',    l: '\\ln',           n: 'natural log' },
      { g: 'sin',   l: '\\sin',          n: 'sine' },
      { g: 'cos',   l: '\\cos',          n: 'cosine' },
      { g: 'tan',   l: '\\tan',          n: 'tangent' },
      { g: '|x|',   l: '|x|',            n: 'absolute value' },
    ],
  },
  {
    id: 'sets',
    label: 'Sets',
    items: [
      { g: '∈',   l: '\\in',         n: 'element of belongs' },
      { g: '∉',   l: '\\notin',      n: 'not element' },
      { g: '⊂',   l: '\\subset',     n: 'subset' },
      { g: '⊆',   l: '\\subseteq',   n: 'subset equal' },
      { g: '⊃',   l: '\\supset',     n: 'superset' },
      { g: '⊇',   l: '\\supseteq',   n: 'superset equal' },
      { g: '∪',   l: '\\cup',        n: 'union' },
      { g: '∩',   l: '\\cap',        n: 'intersection' },
      { g: '∅',   l: '\\emptyset',   n: 'empty set' },
      { g: '∀',   l: '\\forall',     n: 'for all every' },
      { g: '∃',   l: '\\exists',     n: 'there exists' },
      { g: '⇒',   l: '\\Rightarrow', n: 'implies' },
      { g: '⇔',   l: '\\iff',        n: 'if and only if' },
    ],
  },
  {
    id: 'arrows',
    label: 'Arrows',
    items: [
      { g: '→', l: '\\to',          n: 'right arrow to' },
      { g: '←', l: '\\leftarrow',   n: 'left arrow' },
      { g: '↔', l: '\\leftrightarrow', n: 'two way arrow' },
      { g: '⇒', l: '\\Rightarrow',  n: 'implies double arrow' },
      { g: '⇐', l: '\\Leftarrow',   n: 'double left arrow' },
      { g: '⇔', l: '\\Leftrightarrow', n: 'equivalent double' },
      { g: '↑', l: '\\uparrow',     n: 'up arrow' },
      { g: '↓', l: '\\downarrow',   n: 'down arrow' },
      { g: '⇌', l: '\\rightleftharpoons', n: 'reversible chemistry' },
    ],
  },
]

export default function MathModal({ editor, editState, onClose }) {
  const isEditing = editState !== null && editState !== undefined

  const [latex,    setLatex]    = useState(isEditing ? editState.latex : TEMPLATES[0].latex)
  const [selTpl,   setSelTpl]   = useState(isEditing ? -1 : 0)
  const [prevHTML, setPrevHTML] = useState('')
  const [prevErr,  setPrevErr]  = useState(false)
  const [activeCat, setActiveCat] = useState(SYMBOL_CATEGORIES[0].id)
  const [search,   setSearch]   = useState('')

  // Re-render KaTeX preview whenever LaTeX changes.
  useEffect(() => {
    try {
      const html = katex.renderToString(latex, { throwOnError: true, displayMode: true })
      setPrevHTML(html)
      setPrevErr(false)
    } catch {
      setPrevErr(true)
      setPrevHTML('')
    }
  }, [latex])

  // Derive the visible items from the active category AND the search filter.
  // When search is non-empty, we search across ALL categories — teachers
  // typing "sigma" shouldn't have to know which tab it lives in.
  const visibleSymbols = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q) {
      const all = SYMBOL_CATEGORIES.flatMap(c => c.items)
      return all.filter(item =>
        item.n.toLowerCase().includes(q) ||
        item.l.toLowerCase().includes(q) ||
        item.g === q
      )
    }
    const cat = SYMBOL_CATEGORIES.find(c => c.id === activeCat)
    return cat ? cat.items : []
  }, [activeCat, search])

  const visibleTemplates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return TEMPLATES
    return TEMPLATES.filter(t =>
      t.label.toLowerCase().includes(q) ||
      t.latex.toLowerCase().includes(q)
    )
  }, [search])

  const handleSave = () => {
    if (prevErr || !latex.trim() || !editor) return
    if (isEditing && editState.pos !== null) {
      const { state, view } = editor
      const tr = state.tr
      tr.setNodeMarkup(editState.pos, undefined, { latex })
      view.dispatch(tr)
    } else {
      editor.chain().focus().insertMathNode(latex).run()
    }
    onClose()
  }

  const handleDelete = () => {
    if (!editor || !isEditing || editState.pos === null) return
    const { state, view } = editor
    const node = state.doc.nodeAt(editState.pos)
    if (node) {
      const tr = state.tr
      tr.delete(editState.pos, editState.pos + node.nodeSize)
      view.dispatch(tr)
    }
    onClose()
  }

  const appendSym = (l) => {
    setLatex((prev) => prev + l)
    setSelTpl(-1)
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="modal math-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? 'Edit math expression' : 'Insert math expression'}
      >
        <div className="mhd">
          <span className="mtitle">{isEditing ? '✏️ Edit Math' : '∑ Insert Math'}</span>
          <button className="mx" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="mbd">
          {/* ── Search: filters both templates and symbols across all tabs ── */}
          <input
            type="search"
            className="qe-inp math-search"
            placeholder="Search symbols or templates (e.g. sigma, sqrt, sine, >=)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search math symbols and templates"
          />

          {/* ── Quick templates ── */}
          {visibleTemplates.length > 0 && (
            <>
              <div className="mlbl">Quick Templates</div>
              <div className="tgrid">
                {visibleTemplates.map((t, i) => (
                  <div
                    key={t.label}
                    className={`tc${selTpl === i ? ' sel' : ''}`}
                    // Touch-safe: mousedown only prevents focus loss; click fires on tap.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setSelTpl(i); setLatex(t.latex) }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { setSelTpl(i); setLatex(t.latex) }
                    }}
                    title={t.latex}
                  >
                    <div className="tp">{t.preview}</div>
                    <div className="tl">{t.label}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Category tabs (hidden while searching, since results span all) ── */}
          {!search && (
            <>
              <div className="mlbl">Symbols</div>
              <div className="sym-tabs" role="tablist" aria-label="Symbol categories">
                {SYMBOL_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={activeCat === cat.id}
                    className={`sym-tab${activeCat === cat.id ? ' on' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setActiveCat(cat.id)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {search && visibleSymbols.length > 0 && (
            <div className="mlbl">
              Matching symbols
              <span style={{ marginLeft: 8, fontWeight: 400, opacity: 0.7 }}>
                ({visibleSymbols.length})
              </span>
            </div>
          )}

          {visibleSymbols.length > 0 ? (
            <div className="sgrid">
              {visibleSymbols.map((s) => (
                <button
                  key={s.l + s.n}
                  type="button"
                  className="sbtn"
                  title={`${s.n} — ${s.l}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => appendSym(s.l)}
                >
                  {s.g}
                </button>
              ))}
            </div>
          ) : search ? (
            <div className="math-empty">
              No symbols match “{search}”. Try another term, or type LaTeX directly below.
            </div>
          ) : null}

          {/* ── LaTeX input ── */}
          <div className="mlbl">LaTeX Expression</div>
          <input
            type="text"
            className="qe-inp math-latex"
            value={latex}
            spellCheck={false}
            placeholder="\frac{a}{b} · x^{2} · \sqrt{x}"
            onChange={(e) => { setLatex(e.target.value); setSelTpl(-1) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave()
            }}
            autoFocus={isEditing}
          />

          {/* ── Live preview ── */}
          <div className="mlbl">Live Preview</div>
          <div className="kprev">
            {prevHTML
              ? <span dangerouslySetInnerHTML={{ __html: prevHTML }} />
              : <span style={{ color: 'var(--ro)', fontSize: '13px' }}>
                  {prevErr ? 'Invalid LaTeX — check syntax' : '…'}
                </span>
            }
          </div>
        </div>

        <div className="mft">
          {isEditing && (
            <button type="button" className="btn btn-d" onClick={handleDelete}>
              Delete
            </button>
          )}
          <button type="button" className="btn btn-s" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-p"
            onClick={handleSave}
            disabled={prevErr || !latex.trim()}
          >
            {isEditing ? 'Update Math' : 'Insert Math'}
          </button>
        </div>
      </div>
    </div>
  )
}
