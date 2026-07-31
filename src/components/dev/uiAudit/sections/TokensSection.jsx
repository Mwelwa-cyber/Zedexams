import { useMemo } from 'react'
import tailwindConfig from '../../../../../tailwind.config.js'
import {
  Block,
  Section,
  SpecimenGrid,
  Swatch,
  useResolved,
  useScopeTheme,
} from '../auditKit.jsx'
import {
  classifyToken,
  collectDeclaredTokenNames,
  readSwatches,
  readTokens,
  sortTokenNames,
  TOKEN_GROUPS,
} from '../tokenReader.js'

/**
 * Section 1 — design tokens.
 *
 * The foundation section, and the one that has to be drift-proof or none of
 * the others can be trusted. Two sources, both read rather than transcribed:
 *
 *   • CSS custom properties — scraped from the stylesheets the page loaded,
 *     filtered to the rules that declare a palette. Add a token to index.css
 *     and it appears here on the next reload with no edit to this file.
 *   • The Tailwind ramps — imported from tailwind.config.js itself, which is
 *     the definition. A ramp added there shows up here.
 *
 * Values are never taken from either source directly: the config gives the
 * NAME and the declaration text, the browser gives the colour. That gap is
 * where the interesting bugs live — `--accent-tint` is a `color-mix()` that
 * reads as unrenderable text and resolves to a different colour in each of
 * the four themes.
 */

/* Flatten the Tailwind colour config into `{ label, value }` swatches.
 *
 * The values are handed to the browser to resolve, NOT rendered as a Tailwind
 * class: JIT only emits classes it can find as literal strings in the source,
 * so a `bg-orange-${step}` built at runtime produces no CSS at all and every
 * swatch would come out transparent. Passing the config's own value through
 * `style` sidesteps that and, for the `var(--zt-*)` entries, resolves live
 * per theme — which is the behaviour worth auditing anyway. */
function flattenColours(colours, prefix = '') {
  const out = []
  for (const [key, value] of Object.entries(colours || {})) {
    const label = prefix ? `${prefix}-${key}` : key
    if (typeof value === 'string') out.push({ label, value })
    else if (value && typeof value === 'object') out.push(...flattenColours(value, label))
  }
  return out
}

/* A ramp (orange-50…950, zambia-green…) reads as a ramp; a one-off token
 * reads as a token. Splitting them keeps 40 swatches scannable.
 *
 * A bare name that is ALSO a stem leads its own family rather than being
 * exiled to the singles bucket: `sidebar` belongs at the head of
 * `sidebar-text` / `sidebar-muted`, not four groups away from them, because
 * the question you are asking of a swatch is almost always "how does this sit
 * against its neighbours". */
function groupRamps(entries) {
  const ramps = new Map()
  const bare = new Map()
  for (const entry of entries) {
    if (!entry.label.includes('-')) {
      bare.set(entry.label, entry)
      continue
    }
    const stem = entry.label.split('-')[0]
    if (!ramps.has(stem)) ramps.set(stem, [])
    ramps.get(stem).push(entry)
  }

  const out = []
  const singles = []
  for (const [stem, items] of ramps) {
    const lead = bare.get(stem)
    if (lead) {
      items.unshift(lead)
      bare.delete(stem)
    }
    if (items.length > 1) out.push({ stem, items })
    else singles.push(...items)
  }
  singles.push(...bare.values())
  if (singles.length) out.push({ stem: 'single tokens', items: singles })
  return out
}

const TAILWIND_COLOURS = flattenColours(tailwindConfig.theme?.extend?.colors)
const TAILWIND_RAMPS = groupRamps(TAILWIND_COLOURS)

const TYPOGRAPHY = [
  { cls: 'text-display-2xl', sample: 'Every learner, every grade' },
  { cls: 'text-display-xl', sample: 'Assessment Paper Studio' },
  { cls: 'text-display-lg', sample: 'Grade 7 · Mathematics' },
  { cls: 'text-display-md', sample: 'Section B — Structured questions' },
  { cls: 'text-eyebrow', sample: 'Mid-term test' },
  { cls: 'text-body-lg', sample: 'Work out the answer and show your working.' },
  { cls: 'text-body', sample: 'Work out the answer and show your working.' },
  { cls: 'text-body-sm', sample: 'Work out the answer and show your working.' },
  { cls: 'font-display', sample: 'Outfit — display face' },
  { cls: 'font-body', sample: 'Plus Jakarta Sans — reading face' },
]

const RADII = [
  'rounded-radius-xs',
  'rounded-radius-sm',
  'rounded-radius-md',
  'rounded-radius-lg',
  'rounded-radius-xl',
  'rounded-radius-pill',
]

const SHADOWS = [
  'shadow-elev-sm',
  'shadow-elev-md',
  'shadow-elev-lg',
  'shadow-elev-xl',
  'shadow-elev-inner-hl',
]

export default function TokensSection() {
  // The scope's theme, and the reason it is a dependency below rather than
  // decoration: the swatch BACKGROUNDS are `var(--token)`, so they recolour on
  // a theme switch whether or not anything re-measures. The printed hexes do
  // not. Without this the page shows Night's colours under Terracotta's
  // numbers — a swatch and a label that disagree, which is worse than either
  // being absent because both look authoritative.
  const theme = useScopeTheme()

  // The declared token names are a property of the STYLESHEETS, not of the
  // active theme, so they are scraped once. Their values are re-read per
  // scope, which is the part that changes.
  const declared = useMemo(() => {
    const names = sortTokenNames([...collectDeclaredTokenNames()])
    const byGroup = new Map()
    for (const name of names) {
      const group = classifyToken(name)
      if (!group) continue
      if (!byGroup.has(group)) byGroup.set(group, [])
      byGroup.get(group).push(name)
    }
    return byGroup
  }, [])

  const [ref, resolved] = useResolved((el) => {
    const tokens = new Map()
    for (const [group, names] of declared) {
      tokens.set(group, readTokens(el, names))
    }
    return {
      tokens,
      ramps: TAILWIND_RAMPS.map((r) => ({
        ...r,
        items: readSwatches(el, r.items),
      })),
    }
  }, [declared, theme])

  return (
    <Section
      id="tokens"
      title="1 · Design tokens"
      note={
        'Names are scraped from the loaded stylesheets and the Tailwind config; every value below was read back with getComputedStyle against this container. Nothing here is transcribed, so editing a token in index.css changes this page with no code change. Where a token is a color-mix() expression, the declaration and the resolved colour differ — the second line is what actually painted.'
      }
    >
      <div ref={ref}>
        {TOKEN_GROUPS.filter((g) => (declared.get(g.id) || []).length).map((group) => {
          const rows = resolved?.tokens.get(group.id) || []
          return (
            <Block key={group.id} title={group.title} note={group.hint} className="mb-5">
              {group.kind === 'colour' ? (
                <SpecimenGrid min="9.5rem">
                  {rows.map((t) => (
                    <Swatch
                      key={t.name}
                      name={t.name}
                      value={`var(${t.name})`}
                      hex={t.hex}
                      note={t.hex && t.raw !== t.hex ? t.raw : null}
                    />
                  ))}
                </SpecimenGrid>
              ) : null}

              {group.kind === 'length' ? (
                <div className="flex flex-wrap items-end gap-3">
                  {rows.map((t) => (
                    <div key={t.name} className="text-center">
                      <div
                        className="h-14 w-14 theme-accent-fill"
                        style={{ borderRadius: `var(${t.name})` }}
                      />
                      <code className="theme-text-muted mt-1 block font-mono text-[10.5px]">
                        {t.name}
                      </code>
                      <code className="theme-text-muted block font-mono text-[10.5px] opacity-70">
                        {t.raw}
                      </code>
                    </div>
                  ))}
                </div>
              ) : null}

              {group.kind === 'shadow' ? (
                <div className="flex flex-wrap gap-4 py-2">
                  {rows.map((t) => (
                    <div key={t.name} className="text-center">
                      <div
                        className="h-14 w-20 rounded-xl theme-card border theme-border"
                        style={{ boxShadow: `var(${t.name})` }}
                      />
                      <code className="theme-text-muted mt-1.5 block font-mono text-[10.5px]">
                        {t.name}
                      </code>
                    </div>
                  ))}
                </div>
              ) : null}

              {group.kind === 'raw' ? (
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {rows.map((t) => (
                    <code
                      key={t.name}
                      className="theme-text-muted block break-all font-mono text-[10.5px] leading-relaxed"
                    >
                      <span className="theme-text">{t.name}</span>: {t.raw}
                    </code>
                  ))}
                </div>
              ) : null}
            </Block>
          )
        })}

        <Block
          title="Tailwind colour ramps"
          note="Read straight out of tailwind.config.js. The var()-backed entries are the teacher token set exposed as utility classes — they re-resolve per theme; the literal ramps (orange, zambia) do not."
          className="mb-5"
        >
          {(resolved?.ramps || TAILWIND_RAMPS).map((ramp) => (
            <div key={ramp.stem} className="mb-3">
              <code className="theme-text-muted mb-1.5 block font-mono text-[11px]">
                {ramp.stem}
              </code>
              <SpecimenGrid min="8rem">
                {ramp.items.map((c) => (
                  <Swatch
                    key={c.label}
                    name={c.label}
                    value={c.value}
                    hex={c.hex}
                    note={c.hex && c.value !== c.hex ? c.value : null}
                  />
                ))}
              </SpecimenGrid>
            </div>
          ))}
        </Block>

        <Block
          title="Typography scale"
          note="One line per style the app actually uses, rendered in that style."
        >
          <div className="space-y-2">
            {TYPOGRAPHY.map((t) => (
              <div
                key={t.cls}
                className="flex flex-col gap-0.5 border-b theme-border pb-2 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <code className="theme-text-muted shrink-0 font-mono text-[10.5px] sm:w-40">
                  .{t.cls}
                </code>
                <span className={`${t.cls} theme-text min-w-0`}>{t.sample}</span>
              </div>
            ))}
          </div>
        </Block>

        <Block
          title="Radius + elevation utilities"
          note="The utility classes, as opposed to the raw tokens above — this is what a component writes."
        >
          <div className="flex flex-wrap items-end gap-3">
            {RADII.map((cls) => (
              <div key={cls} className="text-center">
                <div className={`h-14 w-14 theme-accent-fill ${cls}`} />
                <code className="theme-text-muted mt-1 block font-mono text-[10.5px]">
                  .{cls}
                </code>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 py-2">
            {SHADOWS.map((cls) => (
              <div key={cls} className="text-center">
                <div
                  className={`h-14 w-20 rounded-xl theme-card border theme-border ${cls}`}
                />
                <code className="theme-text-muted mt-1.5 block font-mono text-[10.5px]">
                  .{cls}
                </code>
              </div>
            ))}
          </div>
        </Block>
      </div>
    </Section>
  )
}
