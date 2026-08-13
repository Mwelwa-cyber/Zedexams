import Icon from '../../../../components/ui/Icon'
import StatusBadge from '../../../../components/ui/StatusBadge'
import { HeaderIconButton } from '../../../../components/ui/HeaderIconButton'
import { Download, FileText, Trash2 } from '../../../../components/ui/icons'
import { Block, Section } from '../auditKit.jsx'

/**
 * Section 7 — data display.
 *
 * There is no shared Table primitive and no shared List primitive; every
 * surface that shows tabular data writes its own `<table>` with its own
 * classes. What follows is the shape they converge on, written entirely in
 * tokens — so it doubles as a reference for what a shared one should look
 * like. Both absences are recorded in Gaps found.
 *
 * ZEBRA STRIPING IS THE THING TO WATCH IN NIGHT. A stripe is a small tint on
 * the row background, and every hand-rolled table in this codebase draws it
 * with a Tailwind grey (`odd:bg-slate-50`, `even:bg-gray-50`). On a light
 * theme that is a barely-there wash; on a dark one it is a near-white band
 * across the row. The stripe below uses `theme-bg-subtle`, which is derived
 * from the theme's own text colour and therefore darkens rather than
 * brightens — compare the two in the same theme and the difference is the
 * whole argument for the token.
 */

const ROWS = [
  ['Grade 7 Mathematics — Mid-term test', 'Mathematics', 20, 'published'],
  ['Fractions and decimals worksheet', 'Mathematics', 12, 'draft'],
  ['Integrated Science — End of term', 'Integrated Science', 30, 'pending'],
  ['English comprehension — Week 4', 'English', 8, 'rejected'],
]

export default function DataDisplaySection() {
  return (
    <Section
      id="data"
      title="7 · Data display"
      note={
        'No shared Table or List primitive exists — this is the shape the hand-rolled ones converge on, written in tokens. Watch the zebra stripe in Night: the real tables stripe with a fixed Tailwind grey, which inverts into a near-white band on a dark row.'
      }
    >
      <Block
        title="Table — header, zebra rows, hover, badge + icon button in a cell"
        note="Hover a row. The stripe is theme-bg-subtle, which darkens on a dark theme rather than brightening."
      >
        <div className="ui-audit-scroll-x rounded-xl border theme-border">
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">Recent documents</caption>
            <thead>
              <tr className="theme-bg-subtle">
                {['Document', 'Subject', 'Questions', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="text-eyebrow whitespace-nowrap px-3 py-2 text-left"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr
                  key={row[0]}
                  className={`border-t theme-border transition-colors hover:theme-card-hover ${
                    i % 2 ? 'theme-bg-subtle' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon as={FileText} size="sm" className="theme-accent-text" />
                      <span className="theme-text truncate font-bold">{row[0]}</span>
                    </span>
                  </td>
                  <td className="theme-text-muted whitespace-nowrap px-3 py-2">{row[1]}</td>
                  <td className="theme-text whitespace-nowrap px-3 py-2 tabular-nums">{row[2]}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row[3]} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1">
                      <HeaderIconButton
                        label="Export"
                        icon={Download}
                        size="sm"
                        onClick={() => {}}
                      />
                      <HeaderIconButton
                        label="Delete"
                        icon={Trash2}
                        size="sm"
                        onClick={() => {}}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <Block
        title="List with dividers"
        note="The same data as a list, which is what every one of these tables becomes below 640px."
      >
        <ul className="rounded-xl border theme-border theme-card">
          {ROWS.map((row, i) => (
            <li
              key={row[0]}
              className={`flex items-center gap-3 p-3 transition-colors hover:theme-card-hover ${
                i ? 'border-t theme-border' : ''
              }`}
            >
              <Icon as={FileText} size="sm" className="theme-accent-text shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="theme-text block truncate font-bold">{row[0]}</span>
                <span className="theme-text-muted block text-body-sm">
                  {row[1]} · {row[2]} questions
                </span>
              </span>
              <StatusBadge status={row[3]} />
            </li>
          ))}
        </ul>
      </Block>

      <Block
        title="Definition list"
        note="Label / value pairs — the paper header, the plan summary, every settings panel."
      >
        <dl className="grid max-w-lg grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-body-sm">
          {[
            ['Grade', 'Grade 7'],
            ['Subject', 'Mathematics'],
            ['Curriculum', 'CBC (2023)'],
            ['Assessment type', 'Mid-term test'],
            ['Total marks', '50'],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="theme-text-muted whitespace-nowrap font-bold">{k}</dt>
              <dd className="theme-text min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      </Block>
    </Section>
  )
}
