import { useEffect, useRef } from 'react'
import DiagramSvg from '../../../diagrams/DiagramSvg'
import { hydrateMathContent } from '../../../../editor/utils/safeRender'
import { Block, Section, useResolved, useScopeTheme } from '../auditKit.jsx'

/**
 * Section 8 — content rendering.
 *
 * The renderers that theme passes miss, because none of them is a component
 * with a className anyone greps for: rich text from the studios, a KaTeX
 * formula, and a library diagram.
 *
 * WHY EACH ONE IS HERE
 *
 * • Rich text is stored as HTML and injected with `dangerouslySetInnerHTML`,
 *   so its colours come from whatever the surrounding CSS says. Bold, links
 *   and blockquotes each pick up a different rule, and a table inside stored
 *   content has borders nobody chose.
 *
 * • KaTeX renders into a DOM subtree of its own with its own class names. It
 *   inherits `color`, which is why it usually survives a theme change — and
 *   why a fraction BAR, which KaTeX draws as a bordered element rather than
 *   as text, sometimes does not. That is the specimen to look at: a stacked
 *   fraction in Night whose numerator and denominator are visible and whose
 *   bar is not.
 *
 * • A catalog diagram is an SVG STRING with the accent baked into its stroke
 *   at render time. `renderDiagramSvg` takes a colour argument and defaults to
 *   the brand terracotta, which means a diagram on a dark theme is drawn in a
 *   colour picked against cream. Both are rendered below — the default, and
 *   one passed the live accent token — so the difference is visible rather
 *   than argued about.
 */

const RICH_HTML = `
<h3>Fractions and decimals</h3>
<p>A fraction shows a part of a whole. The number above the line is the
<strong>numerator</strong> and the number below it is the
<em>denominator</em>.</p>
<p>Express <span data-latex="\\frac{3}{4}"></span> as a decimal, then write
<span data-latex="\\frac{18}{24}"></span> in its lowest terms.</p>
<blockquote>Show your working.</blockquote>
<ul><li>Divide the numerator by the denominator.</li>
<li>Round to two decimal places.</li></ul>
<ol><li>First step</li><li>Second step</li></ol>
<p>The chemical formula for water is
<span data-latex="\\ce{H2O}"></span>, and the area of a circle is
<span data-latex="A = \\pi r^2"></span>.</p>
<table><thead><tr><th>Fraction</th><th>Decimal</th></tr></thead>
<tbody><tr><td>1/2</td><td>0.5</td></tr><tr><td>3/4</td><td>0.75</td></tr></tbody></table>
<p>See the <a href="#content">worked example</a> for the full method.</p>
`

/** The three diagrams worth looking at: a line figure, a filled chart and a
 *  labelled one. A single shape would not show whether fills, ticks and text
 *  each follow the colour. */
const DIAGRAMS = [
  ['cylinder', 'line figure'],
  ['barchart', 'filled chart'],
  ['numberline', 'ticks + numerals'],
]

export default function ContentSection() {
  const richRef = useRef(null)
  const theme = useScopeTheme()

  // Hydration is the app's own — the same call the note reader and the paper
  // preview make. Re-running it on a container that is already hydrated is a
  // no-op (hydrateKatex skips a span that already has a .katex child), so the
  // effect is safe to run on every render.
  useEffect(() => {
    if (richRef.current) hydrateMathContent(richRef.current)
  })

  // The scope's accent, READ rather than named — that is the whole point of
  // the second diagram row. Keyed to the theme so a switch re-measures; a
  // stale accent here would draw the comparison row in the previous theme's
  // colour and make the top row look like the correct one.
  const [accentRef, accent] = useResolved(
    (el) => window.getComputedStyle(el).getPropertyValue('--accent').trim(),
    [theme],
  )

  return (
    <Section
      id="content"
      title="8 · Content rendering"
      note={
        'Rich text as the studios produce it, hydrated by the app\'s own safeRender; KaTeX including a stacked fraction and an mhchem formula; and library diagrams from the shared catalog. All three render into DOM the theme system does not otherwise reach.'
      }
    >
      <div ref={accentRef}>
        <Block
          title="Rich text (stored HTML, hydrated by safeRender)"
          note="Headings, paragraphs, bold, italic, a blockquote, both list types, a table and a link — each picks up a different rule, and stored content carries no classes of its own."
        >
          <div
            ref={richRef}
            className="rich-content theme-text max-w-3xl rounded-xl border theme-border theme-card p-4"
            // The content is a constant in this file, not user input.
            dangerouslySetInnerHTML={{ __html: RICH_HTML }}
          />
        </Block>

        <Block
          title="Library diagrams"
          note="Top row: the catalog default colour, which is the brand terracotta chosen against a cream page. Bottom row: the same diagrams passed the live --accent. On a light theme the two rows look similar; on Night the top row is the bug."
        >
          <p className="text-eyebrow mb-1.5">Catalog default colour</p>
          <div className="flex flex-wrap items-start gap-4">
            {DIAGRAMS.map(([key, label]) => (
              <figure key={key} className="m-0 max-w-[14rem]">
                <div className="rounded-xl border theme-border theme-card p-2">
                  <DiagramSvg libraryKey={key} alt={`${key} diagram`} />
                </div>
                <figcaption className="theme-text-muted mt-1 text-body-sm">
                  {key} · {label}
                </figcaption>
              </figure>
            ))}
          </div>

          <p className="text-eyebrow mb-1.5 mt-4">Passed the live --accent</p>
          <div className="flex flex-wrap items-start gap-4">
            {DIAGRAMS.map(([key, label]) => (
              <figure key={key} className="m-0 max-w-[14rem]">
                <div className="rounded-xl border theme-border theme-card p-2">
                  <DiagramSvg
                    libraryKey={key}
                    color={accent || undefined}
                    alt={`${key} diagram in the theme accent`}
                  />
                </div>
                <figcaption className="theme-text-muted mt-1 text-body-sm">
                  {key} · {label}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="theme-text-muted mt-2 text-body-sm">
            Resolved accent: <code>{accent || 'reading…'}</code>
          </p>
        </Block>

        <Block
          title="Code and preformatted text"
          note="Used in the admin generation logs and the developer panels."
        >
          <pre className="ui-audit-scroll-x rounded-xl border theme-border theme-bg-subtle p-3 text-body-sm">
            <code className="theme-text">{`{
  "assessmentType": "mid_term",
  "grade": "7",
  "subject": "Mathematics",
  "totalMarks": 50
}`}</code>
          </pre>
          <p className="theme-text mt-2 text-body-sm">
            Inline <code>code</code> inside a paragraph, for comparison.
          </p>
        </Block>
      </div>
    </Section>
  )
}
