import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  DARK_TEACHER_THEME_IDS,
  TEACHER_THEMES,
} from '../../../contexts/teacherThemeCore'

/**
 * Layout scaffolding for the UI audit page.
 *
 * Nothing in here is a UI primitive and nothing in here is reusable outside
 * this page — it is the graph paper the specimens are pinned to. The rule that
 * matters: every colour below comes from a theme utility (`theme-card`,
 * `theme-text`, `theme-border`, …) or a token, never a literal. A page built
 * to catch hardcoded colours cannot itself contain one, or the chrome stops
 * changing with the theme and you start doubting the specimens.
 */

/* ── Theme scoping ──────────────────────────────────────────────────── */

/**
 * A container that renders its children in ONE named workspace theme,
 * regardless of the theme the rest of the page is in. This is what the
 * "All themes" toggle builds its columns out of.
 *
 * It is a scope, not a reimplementation: `data-theme` re-declares the
 * `--zt-*` set (index.css declares them on the bare attribute selector, so a
 * nested element picks them up exactly as <html> does), and `.studio-theme`
 * is the same class TeacherLayout puts on the studio shell — the rule that
 * remaps `--zt-*` onto the reading tokens every shared primitive is written
 * in. A column is therefore styled by the real cascade, through the real
 * classes.
 *
 * ONE HONEST LIMIT, and it is worth knowing before trusting a column:
 * the Night bridge in index.css is `html[data-theme='night'] body`, which
 * repoints the READING palette at Midnight for a teacher on Night. It is
 * declared on <body> for proximity reasons and cannot be scoped to a nested
 * div. So a Night COLUMN shows the studio's own dark palette (what a studio
 * surface uses), while the toolbar's whole-page Night additionally exercises
 * the body bridge (what a shared learner-facing surface uses). Both are real;
 * they are different surfaces. Check a suspect component in both.
 */
const ScopeThemeContext = createContext(null)

export function ThemeScope({ theme, className = '', children, ...rest }) {
  return (
    <ScopeThemeContext.Provider value={theme}>
      <div
        data-theme={theme}
        className={`studio-theme theme-bg theme-text ${className}`}
        {...rest}
      >
        {children}
      </div>
    </ScopeThemeContext.Provider>
  )
}

/**
 * The theme of the nearest enclosing scope — the column's theme in
 * side-by-side mode, the live one otherwise.
 *
 * A section that needs to know which theme it is in must ask THIS, never
 * `useTheme().teacherTheme`. The live theme is the right answer exactly once
 * per page and the wrong answer in three of the four columns, and a component
 * given the wrong answer does not fail — it renders the other theme's
 * treatment and looks correct. That is the failure mode: `.tdv2` carries an
 * `is-dark` modifier the real dashboard derives from the active theme, so a
 * Night column driven from the live theme would get light-mode overrides on a
 * dark surface and quietly pass.
 */
export function useScopeTheme() {
  return useContext(ScopeThemeContext)
}

/**
 * Whether a workspace theme's surfaces are dark. Read from the theme data
 * rather than string-matching 'night'.
 */
export function isDarkTheme(theme) {
  return DARK_TEACHER_THEME_IDS.includes(theme)
}

/**
 * Render `children` once per theme, side by side. The fastest way to catch a
 * component that is fine in Terracotta and unreadable in Night — the two sit
 * on the same screen row instead of a theme switch and a memory of what the
 * last one looked like.
 *
 * Horizontal scroll rather than wrapping: four columns that reflow to two are
 * two comparisons, and the comparison is the entire point.
 */
/**
 * True while rendering inside one of the four side-by-side theme columns.
 *
 * Sections need to know, for one reason that is invisible until it bites: in
 * column mode every section is rendered FOUR times, so its `id` — the jump
 * link's target — would exist four times in the document. Duplicate ids make
 * `#cards` resolve to whichever copy the browser reaches first, which is the
 * Terracotta column, so every jump link would silently scroll to the left
 * edge of the row instead of to the section. Sections therefore drop their id
 * inside a column and the wrapper carries it once.
 */
const ColumnContext = createContext(false)

export function useInThemeColumn() {
  return useContext(ColumnContext)
}

export function AllThemesGrid({ children }) {
  return (
    <ColumnContext.Provider value>
      <div className="ui-audit-scroll-x -mx-1 px-1 pb-2">
        <div className="ui-audit-themes-grid">
          {TEACHER_THEMES.map((t) => (
            <ThemeScope
              key={t.id}
              theme={t.id}
              className="rounded-xl border theme-border p-3"
            >
              <p className="text-eyebrow mb-2">{t.label}</p>
              {children}
            </ThemeScope>
          ))}
        </div>
      </div>
    </ColumnContext.Provider>
  )
}

/* ── Page furniture ─────────────────────────────────────────────────── */

/** One audit section: an anchor target, a title, and a note about it. */
export function Section({ id, title, note, children }) {
  const inColumn = useInThemeColumn()
  return (
    <section id={inColumn ? undefined : id} className="ui-audit-section scroll-mt-24">
      <header className="mb-3 border-b theme-border pb-2">
        <h2 className="text-display-md theme-text">{title}</h2>
        {/* The note is dropped inside a column: four identical paragraphs of
            explanation between four narrow columns of specimens buries the
            thing the column mode exists to show. */}
        {note && !inColumn ? (
          <p className="theme-text-muted text-body-sm mt-1 max-w-3xl">{note}</p>
        ) : null}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

/** A labelled sub-block inside a section. */
export function Block({ title, note, children, className = '' }) {
  return (
    <div className={className}>
      {title ? <p className="text-eyebrow mb-2">{title}</p> : null}
      {note ? (
        <p className="theme-text-muted text-body-sm mb-2 max-w-3xl">{note}</p>
      ) : null}
      {children}
    </div>
  )
}

/**
 * A specimen: one component, labelled with the exact prop combination that
 * produced it. The label is the deliverable as much as the specimen is — a
 * broken square with no caption tells you nothing you can act on.
 */
export function Specimen({ label, children, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-1.5 flex min-h-[2.25rem] items-center">{children}</div>
      <code className="theme-text-muted block break-words font-mono text-[10.5px] leading-tight">
        {label}
      </code>
    </div>
  )
}

/** The dense auto-fill grid most sections lay their specimens out on. */
export function SpecimenGrid({ children, min = '11rem', className = '' }) {
  return (
    <div
      className={`grid gap-3 ${className}`}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))` }}
    >
      {children}
    </div>
  )
}

/**
 * A labelled matrix — variants down, states across — with the row/column
 * headers the button section needs. Scrolls horizontally on a phone rather
 * than reflowing, for the same reason AllThemesGrid does.
 */
export function Matrix({ columns, rows }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="ui-audit-matrix w-full border-collapse">
        <thead>
          <tr>
            <th className="text-eyebrow sticky left-0 z-10 theme-bg py-1 pr-3 text-left align-bottom" />
            {columns.map((c) => (
              <th
                key={c}
                className="text-eyebrow whitespace-nowrap px-2 py-1 text-left align-bottom"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t theme-border">
              <th
                scope="row"
                className="sticky left-0 z-10 theme-bg py-2 pr-3 text-left align-middle text-body-sm font-bold theme-text"
              >
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td key={columns[i]} className="px-2 py-2 align-middle">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A colour swatch with its name and the hex the browser actually resolved.
 * Sample text sits ON the swatch in both directions, because a contrast
 * problem is invisible in a bare square — that is the whole reason the brief
 * asks for text on top.
 *
 * The two "Aa" probes are the page's ONE deliberate fixed-colour exception,
 * and they have to be: a probe that themed along with the swatch would move
 * whenever the swatch moved and could never show you a collision. Black and
 * white are the two extremes of the printer and the screen, so a swatch on
 * which neither is legible is a swatch nothing can be written on. They are
 * Tailwind's `text-black`/`text-white`, not literals in a style attribute.
 */
export function Swatch({ name, value, hex, note }) {
  return (
    <div className="min-w-0 rounded-lg border theme-border overflow-hidden">
      <div
        className="flex h-14 items-center justify-between gap-1 px-2"
        style={{ background: value }}
      >
        <span className="text-[11px] font-black text-black">Aa</span>
        <span className="text-[11px] font-black text-white">Aa</span>
      </div>
      <div className="theme-card px-2 py-1.5">
        <code className="block break-all font-mono text-[10.5px] leading-tight theme-text">
          {name}
        </code>
        <code className="theme-text-muted block font-mono text-[10.5px] leading-tight">
          {hex || value || '—'}
        </code>
        {note ? (
          <code className="theme-text-muted block break-all font-mono text-[10px] leading-tight opacity-70">
            {note}
          </code>
        ) : null}
      </div>
    </div>
  )
}

/* ── Hooks ──────────────────────────────────────────────────────────── */

/**
 * Run `read(element)` once the element is in the DOM and again whenever
 * `deps` change, returning whatever it produced.
 *
 * A layout effect is deliberately NOT used: `getComputedStyle` on a freshly
 * inserted subtree can resolve against not-yet-applied styles in some
 * browsers, and a raF gives the cascade a frame to settle. The cost is one
 * frame of empty swatches; the alternative is a page confidently reporting
 * the wrong values.
 */
export function useResolved(read, deps = []) {
  const ref = useRef(null)
  const [value, setValue] = useState(null)

  useEffect(() => {
    let cancelled = false
    const id = requestAnimationFrame(() => {
      if (cancelled || !ref.current) return
      setValue(read(ref.current))
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
    // `read` is redeclared every render at every call site; depending on it
    // would re-measure forever. The caller's deps are the real signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return [ref, value]
}
