import * as AppIcons from '../../../../components/ui/icons'
import Icon from '../../../../components/ui/Icon'
import { LUCIDE_ICONS, LUCIDE_ICON_NAMES } from '../../lib/iconInventory.js'
import { Block, Section } from '../auditKit.jsx'

/**
 * Section 9 — icons.
 *
 * TWO SETS, because the app has two and they are drawn differently.
 *
 * • `src/components/ui/icons.js` — a Heroicons barrel, rendered through the
 *   `<Icon>` primitive, which pins size and stroke weight for the whole app.
 *   Enumerated with `import * as` because it is one fixed module the app
 *   already loads whole: nothing to drift, nothing extra to ship.
 *
 * • lucide-react — used directly by the dashboard, the launcher and the
 *   auth screens, with no size/weight primitive in front of it. That is the
 *   comparison worth having on one page: a Lucide glyph at 20px sits at a
 *   different optical weight from a Heroicon at 20px with stroke 2.25, and
 *   the two are used side by side in the teacher shell.
 *
 * Rendered at the sizes the app uses (the `<Icon>` size tokens), each labelled
 * with the name you would import. Colour is inherited, so an icon that does
 * not follow the theme here is one that hardcoded a fill.
 */

const SIZES = ['xs', 'sm', 'md', 'lg', 'xl']

/* The barrel exports the icon components plus a couple of helpers; a
 * capitalised name whose value is renderable is an icon, anything else is
 * not. Filtering by shape rather than by a name list is what keeps this from
 * needing maintenance. */
const APP_ICON_NAMES = Object.keys(AppIcons)
  .filter((name) => {
    if (!/^[A-Z]/.test(name)) return false
    const value = AppIcons[name]
    return typeof value === 'function' || (value && typeof value === 'object')
  })
  .sort()

export default function IconsSection() {
  return (
    <Section
      id="icons"
      title="9 · Icons"
      note={
        `The app's own Heroicons barrel (${APP_ICON_NAMES.length}, enumerated from the module) and the Lucide icons it imports directly (${LUCIDE_ICON_NAMES.length}, listed in iconInventory.js and pinned to the codebase by test:ui-audit-icons). Colour is inherited throughout — an icon that does not follow the theme has a hardcoded fill.`
      }
    >
      <Block
        title="Size scale"
        note="The <Icon> primitive's five size tokens at one stroke weight, so a size that reads too light is visible against its neighbours."
      >
        <div className="flex flex-wrap items-end gap-5">
          {SIZES.map((size) => (
            <div key={size} className="text-center">
              <Icon as={AppIcons.BookOpen} size={size} className="theme-text" />
              <code className="theme-text-muted mt-1 block font-mono text-[10.5px]">
                {size}
              </code>
            </div>
          ))}
        </div>
      </Block>

      <Block
        title="Weight comparison"
        note="The same idea drawn from each set, at the same nominal size. If the teacher shell looks inconsistent, this row is why."
      >
        <div className="flex flex-wrap items-center gap-6">
          <span className="flex items-center gap-2 theme-text">
            <Icon as={AppIcons.BookOpen} size="md" />
            <code className="text-[10.5px]">icons.js · BookOpen · stroke 2.25</code>
          </span>
          <span className="flex items-center gap-2 theme-text">
            <LUCIDE_ICONS.BookOpen size={20} />
            <code className="text-[10.5px]">lucide · BookOpen · stroke 2 (default)</code>
          </span>
        </div>
      </Block>

      <Block title={`App barrel — src/components/ui/icons.js (${APP_ICON_NAMES.length})`}>
        <IconGrid
          names={APP_ICON_NAMES}
          render={(name) => <Icon as={AppIcons[name]} size="md" />}
        />
      </Block>

      <Block title={`Lucide, as imported by the app (${LUCIDE_ICON_NAMES.length})`}>
        <IconGrid
          names={LUCIDE_ICON_NAMES}
          render={(name) => {
            const Glyph = LUCIDE_ICONS[name]
            return <Glyph size={20} aria-hidden="true" />
          }}
        />
      </Block>
    </Section>
  )
}

function IconGrid({ names, render }) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))' }}
    >
      {names.map((name) => (
        <div
          key={name}
          className="flex min-w-0 flex-col items-center gap-1 rounded-lg border theme-border theme-card px-1 py-2 theme-text"
          title={name}
        >
          {render(name)}
          <code className="theme-text-muted block w-full truncate text-center font-mono text-[9.5px] leading-tight">
            {name}
          </code>
        </div>
      ))}
    </div>
  )
}
