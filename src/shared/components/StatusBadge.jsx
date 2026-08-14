/**
 * StatusBadge — shows the content workflow status as a coloured pill.
 * Statuses: draft | pending | published | rejected
 *
 * Painted in the SEMANTIC tokens (--success-bg/--warning-bg/--danger-bg and
 * their -fg pairs), which carry a per-theme dark treatment, rather than in
 * fixed Tailwind pairs. The pairs this replaces — bg-green-100/text-green-700
 * and friends — are a light-theme palette with no dark variant, so on Night
 * these pills were the only light objects on a dark card, and they did not
 * match the semantic chips rendered beside them elsewhere in the app.
 *
 * Draft is deliberately NOT a semantic colour: it is the absence of a state,
 * so it takes the theme's own subtle surface and muted ink.
 */
const NEUTRAL = 'theme-bg-subtle theme-text-muted'

export default function StatusBadge({ status }) {
  const map = {
    draft:     { cls: NEUTRAL,                            label: '📝 Draft'          },
    pending:   { cls: 'bg-warning-subtle text-warning',   label: '⏳ Pending Review' },
    published: { cls: 'bg-success-subtle text-success',   label: '✅ Published'      },
    rejected:  { cls: 'bg-danger-subtle text-danger',     label: '❌ Rejected'       },
  }
  const { cls, label } = map[status] ?? { cls: NEUTRAL, label: status ?? '—' }
  return (
    <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${cls}`}>
      {label}
    </span>
  )
}
