import { Section } from '../auditKit.jsx'

/**
 * Section 10 — gaps found.
 *
 * Building this page meant rendering every shared primitive next to every
 * surface that hand-rolls the same thing, which surfaces two categories the
 * brief asked to be recorded rather than fixed here:
 *
 *   • MISSING PRIMITIVES — a pattern the app draws repeatedly with no shared
 *     component, so each copy drifts on its own schedule.
 *   • UNTOKENISED SURFACES — a shared component that paints with fixed
 *     literals, so it does not follow the theme.
 *
 * The rule the brief sets, and the reason nothing below was quietly patched
 * on this page: an override applied HERE makes the audit page look correct
 * while the app stays broken, which is worse than the bug. Anything that
 * needed a one-off to render was left rendering as it really does.
 *
 * The counts are from a scan at the time of writing (2026-07-31) and are
 * there to indicate scale, not to be maintained — treat them as "many",
 * "a dozen", "nearly fifty".
 */

const MISSING = [
  {
    what: 'Tabs',
    where: '~15 surfaces hand-roll a role="tablist"',
    detail:
      'CbcKbAdmin, CurriculumReplaceStudio, zedexams-settings, NotesStudio, SyllabiLibrary, the teacher launcher, both marketing pages and more. Each picks its own active treatment — underline, pill, or filled — so the same interaction looks like three different controls depending on which page you are on. `.filter-chip` / `.filter-chip-active` is the one shared tab-like class and covers only the chip shape.',
  },
  {
    what: 'Table',
    where: '~47 components write their own <table>',
    detail:
      'No shared header, zebra, hover or dividing rule. Most stripe with a fixed Tailwind grey (odd:bg-slate-50 and friends), which is a faint wash on a light theme and a near-white band across the row on Night. The specimen in section 7 shows the same table striped with theme-bg-subtle for comparison.',
  },
  {
    what: 'Alert / banner',
    where: '~18 files compose one out of the semantic utilities by hand',
    detail:
      'bg-danger-subtle + text-danger + a border + an icon, re-typed each time. The tokens are right; the composition is not shared, so padding, radius, icon size and whether there is a title vary per surface.',
  },
  {
    what: 'Checkbox / radio / switch',
    where: '~37 files for checkbox, ~8 hand-built switches',
    detail:
      'studioFields.jsx covers text, textarea, select, date and number, and stops there. Every tick box and toggle in the app is bespoke — including whether it uses accent-[color:var(--accent)] (so it follows the theme) or the browser default (so it does not).',
  },
  {
    what: 'Field error state',
    where: 'no primitive accepts one',
    detail:
      'None of the Field* components take an `error` prop, so every studio renders its own message element and its own invalid border. The consequences are inconsistent aria wiring, not just inconsistent colour: some call sites set aria-invalid and aria-describedby, most set neither.',
  },
  {
    what: 'Standalone spinner',
    where: "Button's <Spinner> is private to Button.jsx",
    detail:
      'Anything that needs a loading indicator outside a button either renders a Button it does not want or writes another SVG. FullScreenLoader and PageLoader cover the page-level cases only.',
  },
  {
    what: 'One card, not four',
    where: 'Card + .card + .section-card + .content-card + .tdv2-card',
    detail:
      'Five surfaces for the same idea. The three raw classes in index.css predate the Card primitive and are still used across admin; .tdv2-card is the dashboard\'s own. They differ in radius, shadow and border, which is visible in section 4 with all four rendered side by side.',
  },
]

const UNTOKENISED = [
  {
    what: 'StatusBadge',
    file: 'src/shared/components/StatusBadge.jsx',
    detail:
      'Every one of the four states is a fixed Tailwind pair — bg-gray-100/text-gray-600, bg-yellow-100/text-yellow-700, bg-green-100/text-green-700, bg-red-100/text-red-600. On Night these are light chips on a dark card: legible, but they are the only light objects on the surface, and they do not match the semantic tokens (bg-danger-subtle etc.) that the chips beside them in section 6 use. The right fix is the semantic tokens, which already exist and already have a dark treatment.',
  },
  {
    what: 'HeaderIconButton — active and important tones',
    file: 'src/shared/components/HeaderIconButton.jsx',
    detail:
      'The default tone is fully tokenised (theme-card / theme-border / hover:theme-accent-bg). `active` is border-blue-200 bg-blue-50 text-blue-700 and `important` is the amber equivalent — both fixed. The badge is bg-red-500 with ring-2 ring-white, so on a dark card the ring is a white halo. Section 2 renders all three tones together.',
  },
  {
    what: 'PaginationFooter error message',
    file: 'src/shared/components/PaginationFooter.jsx',
    detail:
      "style={{ color: '#b91c1c' }} — a literal, where the file's own end-of-list message two branches below correctly uses var(--zt-text-muted). On Night that red sits at roughly 3:1 against the surface where the --danger-fg token is tuned to clear AA. Section 5 renders the error state.",
  },
  {
    what: '.studio-input paints itself light and is repainted for Night',
    file: 'src/index.css',
    detail:
      'background #ffffff, border #d9cfb8, color #0e2a32, with a separate [data-theme=\'night\'] block to undo all three. That is the arrangement that produced the tiling select chevron (see selectArrow.test.js) — a shorthand in the override silently reset background-repeat and background-position. It works today and the test pins the specific failure, but the shape invites the next one; deriving the light values from tokens would remove the override block entirely.',
  },
  {
    what: 'Toast escapes the theme scope',
    file: 'src/shared/components/Toast.jsx',
    detail:
      'createPortal(…, document.body) puts the toast outside .studio-theme, so it resolves the reading tokens off <body> rather than the workspace ones. A teacher on Miombo or Copperbelt gets a toast in whatever LEARNER palette their profile holds. Night is the exception, because index.css carries a body-level bridge for it — which is why this is easy to miss: the theme people check dark mode in is the one theme where it looks right. Fire the toast buttons in section 6 in each theme.',
  },
  {
    what: 'The :root alias tokens are frozen to the default palette',
    file: 'src/index.css — the "Lines" / "Surfaces & shadows" alias block',
    detail:
      '--line-medium: var(--border), --line-faint and --surface are declared on :root. A custom property is substituted where it is DECLARED, so these resolve against :root\'s --border (#BAE6FD, the Sky default) and every descendant inherits that resolved value — they do not follow the reading palettes on <body> or the .studio-theme remap. Section 1 shows it directly: in Night, --border reads #3B4757 while --line-medium two swatches away still reads #BAE6FD. Most consumers are inside .tdv2 or the learner shell, both of which redefine all three, so the visible damage is limited — LessonLibrary.jsx is the one surface using them unscoped, and its filter selects keep a pale-blue border and a white fill in every theme. The fix is to redeclare the aliases wherever --border is redeclared, or to drop the aliases.',
  },
  {
    what: 'Diagram catalog colour is fixed to the brand terracotta',
    file: 'functions/shared/assessment/diagramCatalogCore.js',
    detail:
      'renderDiagramSvg takes a colour but defaults to DEFAULT_COLOR, chosen against a cream page. Every studio preview calls it without one, so a figure on Night is drawn in a colour picked for a light background. Section 8 renders both — the default and the live --accent — so the difference is visible rather than argued about. Note this is a SHARED module: the export path uses it too, and a paper is printed on white regardless of theme, so the fix belongs at the call site rather than in the default.',
  },
  {
    what: 'Diagram LABELS are baked near-black and disappear on Night',
    file: 'functions/shared/assessment/diagramCatalogCore.js',
    detail:
      'Separate from the stroke colour above, and worse: every <text> in the catalog carries fill="#1c1612" or "#3a2f25" as a literal, and unlike the stroke there is no parameter to override it. On Night the figure draws but its labels — the side lengths, the axis numerals, the angle names — are near-black on a dark card. Section 8 shows it: the cylinder\'s r and h and the number line\'s numerals are effectively gone. Same shared-module caveat as above, so this needs a decision rather than a patch: either a second colour argument for ink, or the on-screen renderer wrapping the SVG in a scope that can restyle it.',
  },
]

export default function GapsSection() {
  return (
    <Section
      id="gaps"
      title="10 · Gaps found"
      note={
        'Recorded rather than patched. An override applied on this page would make the audit look correct while the app stayed broken — so everything below renders here exactly as it renders in the product. Counts are from a scan on 2026-07-31 and indicate scale, not a maintained figure.'
      }
    >
      <GapList
        title="Missing primitives — patterns the app draws with no shared component"
        items={MISSING.map((g) => ({ ...g, meta: g.where }))}
      />
      <GapList
        title="Untokenised surfaces — shared components that do not follow the theme"
        items={UNTOKENISED.map((g) => ({ ...g, meta: g.file }))}
      />
    </Section>
  )
}

function GapList({ title, items }) {
  return (
    <div>
      <p className="text-eyebrow mb-2">{title}</p>
      <ol className="space-y-2">
        {items.map((item, i) => (
          <li
            key={item.what}
            className="rounded-xl border theme-border theme-card p-3"
          >
            <p className="theme-text text-body-sm font-bold">
              {i + 1}. {item.what}
            </p>
            <code className="theme-text-muted block break-all font-mono text-[10.5px]">
              {item.meta}
            </code>
            <p className="theme-text-muted mt-1.5 max-w-4xl text-body-sm">
              {item.detail}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}
