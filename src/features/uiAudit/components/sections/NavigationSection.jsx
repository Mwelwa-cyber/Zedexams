import Breadcrumbs from '../../../../shared/components/Breadcrumbs'
import PageHeader from '../../../../shared/components/PageHeader'
import PaginationFooter from '../../../../shared/components/PaginationFooter'
import Button from '../../../../shared/components/Button'
import Icon from '../../../../shared/components/Icon'
import {
  BookOpen,
  ChevronDown,
  FileText,
  LayoutDashboard,
  Search,
  Settings,
} from '../../../../shared/components/icons'
import {
  Block,
  isDarkTheme,
  Section,
  Specimen,
  useScopeTheme,
} from '../auditKit.jsx'

/**
 * Section 5 — navigation and chrome.
 *
 * The real Sidebar / TopHeader are not rendered here, and that is a deliberate
 * limit rather than laziness: both read auth, the router and live Firestore
 * counts, so mounting them would put a signed-in teacher's real data on a QA
 * page and make the section fail for reasons that have nothing to do with
 * colour. What IS real is the styling — every sample below uses the shipped
 * `.tdv2-*` classes, so it recolours through exactly the variables the
 * shipped nav recolours through.
 *
 * The `is-dark` modifier is resolved per SCOPE, not from the active theme.
 * The dashboard derives it from whichever theme is live, which is the wrong
 * answer for a side-by-side column showing a different one — a Night column
 * would get light-mode overrides and quietly look fine.
 */

const NAV_SAMPLE = [
  { icon: LayoutDashboard, label: 'Dashboard', state: 'active' },
  { icon: FileText, label: 'Assessment Papers', state: 'default' },
  { icon: BookOpen, label: 'Lesson Plans', state: 'hover' },
  { icon: Settings, label: 'Settings', state: 'default' },
]

export default function NavigationSection() {
  // The SCOPE's theme — the column's in side-by-side mode, the live one
  // otherwise. Reading the live theme in both places is the bug this avoids.
  const dark = isDarkTheme(useScopeTheme())

  return (
    <Section
      id="navigation"
      title="5 · Navigation + chrome"
      note={
        'Faithful static renderings using the shipped .tdv2-* classes — the real Sidebar and TopHeader read auth, the router and live Firestore counts, so mounting them would put real data on a QA page. Breadcrumbs, PageHeader and PaginationFooter below ARE the real primitives.'
      }
    >
      <Block
        title="Sidebar nav items"
        note="Default, active and hover. The sidebar is dark in all four themes — that is a property of the themes (every one defines a dark --zt-sidebar-bg), asserted by the contrast test, not an accident of this sample."
      >
        <ThemedTdv2 dark={dark}>
          <div
            className="tdv2-sidebar rounded-xl p-3"
            style={{ maxWidth: '18rem' }}
          >
            <p className="tdv2-nav-label">Teaching</p>
            <nav className="tdv2-nav">
              {NAV_SAMPLE.map((item) => (
                <span
                  key={item.label}
                  className={`tdv2-nav-item ${
                    item.state === 'active' ? 'is-active' : ''
                  } ${item.state === 'hover' ? 'ui-audit-nav-hover' : ''}`}
                >
                  <Icon as={item.icon} size="sm" />
                  {item.label}
                  <span className="ml-auto text-[10px] opacity-60">{item.state}</span>
                </span>
              ))}
            </nav>
          </div>
        </ThemedTdv2>
        <p className="theme-text-muted mt-1 text-body-sm">
          The row marked <code>hover</code> is pinned open by{' '}
          <code>.ui-audit-nav-hover</code>, which repeats{' '}
          <code>.tdv2-nav-item:hover</code> — a pseudo-class cannot be applied
          programmatically. <code>test:ui-audit-forced-states</code> fails if
          the two ever differ.
        </p>
      </Block>

      <Block title="Top bar">
        <ThemedTdv2 dark={dark}>
          <div className="tdv2-header rounded-xl">
            <div className="tdv2-search">
              <Icon as={Search} size="sm" />
              <span className="theme-text-muted text-body-sm">
                Search papers, lessons, classes…
              </span>
              <span className="tdv2-kbd">⌘K</span>
            </div>
            <div className="tdv2-header-right">
              <span className="tdv2-iconbtn" aria-hidden="true">
                <Icon as={Settings} size="sm" />
              </span>
              <span className="tdv2-profile">
                <span className="tdv2-avatar" aria-hidden="true">
                  MM
                </span>
                <span className="tdv2-profile-text">
                  <span className="tdv2-profile-name">Mwelwa Mahenga</span>
                  <span className="tdv2-profile-role">Teacher</span>
                </span>
                <Icon as={ChevronDown} size="sm" className="tdv2-profile-chevron" />
              </span>
            </div>
          </div>
        </ThemedTdv2>
      </Block>

      <Block
        title="Tabs"
        note="There is no shared Tabs primitive — eleven surfaces hand-roll a tablist. This is the shape they converge on, tokenised. See Gaps found."
      >
        <div role="tablist" className="flex flex-wrap gap-1 border-b theme-border">
          {['Questions', 'Answer key', 'Layout', 'Export'].map((tab, i) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={i === 0}
              className={`min-h-0 px-3 py-2 text-body-sm font-bold transition-colors ${
                i === 0
                  ? 'theme-accent-text border-b-2 border-[color:var(--accent)]'
                  : 'theme-text-muted border-b-2 border-transparent hover:theme-text'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {['All', 'Grade 7', 'Grade 8', 'Grade 9'].map((chip, i) => (
            <button
              key={chip}
              type="button"
              className={`filter-chip ${i === 1 ? 'filter-chip-active' : ''}`}
            >
              {chip}
            </button>
          ))}
        </div>
        <p className="theme-text-muted mt-1 text-body-sm">
          <code>.filter-chip</code> / <code>.filter-chip-active</code> — the one
          tab-like pattern that IS a shared class.
        </p>
      </Block>

      <Block title="Breadcrumbs (real primitive)">
        <Breadcrumbs
          items={[
            { label: 'Teacher', to: '/teacher' },
            { label: 'Assessment Papers', to: '/teacher/assessment-papers' },
            { label: 'Grade 7 Mathematics — Mid-term test' },
          ]}
        />
      </Block>

      <Block title="PageHeader (real primitive)">
        <PageHeader
          eyebrow="Mid-term test"
          title="Grade 7 Mathematics"
          description="Twenty questions across fractions, decimals and place value. Marks reconcile with the header by construction."
          actions={
            <>
              <Button variant="secondary" size="sm">
                Preview
              </Button>
              <Button size="sm">Export</Button>
            </>
          }
        />
      </Block>

      <Block
        title="PaginationFooter (real primitive)"
        note="All three states it can be in. The error state is the one worth checking — it paints its message with a literal #b91c1c rather than the danger token."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Specimen label="hasNextPage">
            <div className="w-full">
              <PaginationFooter hasNextPage loadedCount={20} noun="paper" onLoadMore={() => {}} />
            </div>
          </Specimen>
          <Specimen label="end of list">
            <div className="w-full">
              <PaginationFooter hasNextPage={false} loadedCount={20} noun="paper" />
            </div>
          </Specimen>
          <Specimen label="error">
            <div className="w-full">
              <PaginationFooter error={new Error('offline')} noun="paper" onLoadMore={() => {}} />
            </div>
          </Specimen>
        </div>
      </Block>
    </Section>
  )
}

/** The `.tdv2` token scope, with `is-dark` resolved for THIS scope. */
function ThemedTdv2({ dark, children }) {
  return <div className={`tdv2 ${dark ? 'is-dark' : ''}`}>{children}</div>
}
