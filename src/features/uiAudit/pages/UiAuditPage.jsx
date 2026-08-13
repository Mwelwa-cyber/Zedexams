import { useState } from 'react'
import { useTheme } from '../../../contexts/ThemeContext'
import { TEACHER_THEMES } from '../../../contexts/teacherThemeCore'
import { AUDIT_SECTIONS } from '../lib/auditSections.js'
import { AllThemesGrid, ThemeScope } from '../components/auditKit.jsx'
import '../styles/uiAudit.css'

/**
 * /dev/ui — the internal UI audit page ("kitchen sink").
 *
 * WHAT IT IS FOR
 * Visual regression QA by eyeball. One scrollable page that renders every
 * shared primitive, every design token and every theme, so a component that
 * breaks in one palette — a white panel in Night, invisible muted text, a
 * dropdown arrow tiling across a select — is one scroll away instead of
 * needing the surface it lives on to be found and reproduced.
 *
 * WHAT IT IS NOT
 * Not Storybook, and deliberately not: no new dependency, no second render
 * environment. It is an ordinary lazy route inside the real app, so every
 * specimen renders through the real providers, the real theme context and the
 * real Tailwind build. A component that works in an isolated harness and
 * breaks in the app is exactly the failure this page has to be able to see.
 *
 * TWO THINGS TO KNOW BEFORE TRUSTING WHAT YOU SEE
 *
 * 1. The theme switcher below is the REAL one — `setTeacherTheme` from
 *    ThemeContext, the same call the teacher settings picker makes. It writes
 *    localStorage, persists to the signed-in profile, and sets `data-theme`
 *    on <html>. Switching a theme here changes the theme everywhere, for you,
 *    permanently — which is the point (a page-local reimplementation would
 *    exercise a code path no user ever runs) but is worth knowing before you
 *    leave the page in Night.
 *
 * 2. The whole page renders inside `.studio-theme`, the same scope
 *    TeacherLayout puts on the studio shell. That scope is what remaps the
 *    `--zt-*` workspace tokens onto the reading tokens every shared primitive
 *    is written in — without it, three of the four themes would change the
 *    chrome and leave every specimen identical, and the page would report
 *    "nothing breaks" for the most boring possible reason.
 */
export default function UiAuditPage() {
  const { teacherTheme, setTeacherTheme } = useTheme()
  const [allThemes, setAllThemes] = useState(false)

  return (
    <ThemeScope theme={teacherTheme} className="min-h-screen">
      <a href="#ui-audit-body" className="skip-link">
        Skip to specimens
      </a>

      <header className="sticky top-0 z-30 theme-bg border-b theme-border">
        <div className="px-3 py-2 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-eyebrow">Internal · not linked from anywhere</p>
              <h1 className="text-display-md theme-text">UI audit</h1>
            </div>

            <div
              className="flex flex-wrap items-center gap-1"
              role="group"
              aria-label="Workspace theme"
            >
              {TEACHER_THEMES.map((t) => {
                const active = t.id === teacherTheme
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTeacherTheme(t.id)}
                    aria-pressed={active}
                    title={t.hint}
                    className={`filter-chip inline-flex items-center gap-1.5 ${
                      active ? 'filter-chip-active' : ''
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 rounded-full border theme-border"
                      // The swatch IS the theme's accent, read from the theme
                      // data. A class cannot express it: Tailwind emits only
                      // classes it finds as literals, and there is no literal
                      // for "the accent of a theme that is not active".
                      style={{ background: t.tokens.accent }}
                    />
                    {t.label}
                  </button>
                )
              })}
            </div>

            <label className="filter-chip inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={allThemes}
                onChange={(e) => setAllThemes(e.target.checked)}
                className="h-4 w-4 accent-[color:var(--accent)]"
              />
              All themes side by side
            </label>
          </div>

          <nav aria-label="Sections" className="mt-2 flex flex-wrap gap-1">
            {AUDIT_SECTIONS.map((s, i) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="theme-text-muted hover:theme-text text-[11px] font-bold uppercase tracking-wide underline-offset-2 hover:underline"
              >
                {i + 1}. {s.title}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main id="ui-audit-body" className="px-3 py-5 sm:px-5">
        {allThemes ? (
          <p className="theme-text-muted mb-4 max-w-3xl text-body-sm">
            Each section below is rendered once per theme. Sections with no
            theme-dependent surface (the icon inventory, this page&rsquo;s own
            notes) stay single — four copies of 300 icons hides the sections
            that matter rather than adding coverage. One honest limit of the
            columns: the Night <em>bridge</em> in index.css is declared on{' '}
            <code>body</code> and cannot be scoped to a nested element, so a
            Night column shows the studio&rsquo;s dark palette while the
            toolbar&rsquo;s whole-page Night additionally exercises the bridge.
            Check anything suspicious in both.
          </p>
        ) : null}

        {AUDIT_SECTIONS.map(({ id, Component, allThemes: themed }) =>
          allThemes && themed ? (
            // The anchor lives on the wrapper, not on the four copies inside
            // it — see useInThemeColumn.
            <div key={id} id={id} className="ui-audit-section scroll-mt-24">
              <AllThemesGrid>
                <Component />
              </AllThemesGrid>
            </div>
          ) : (
            <Component key={id} />
          ),
        )}
      </main>
    </ThemeScope>
  )
}
