const MAP = {
  active:    { cls: 'bg-green-100 text-green-700',  label: 'Active' },
  suspended: { cls: 'bg-amber-100 text-amber-700',  label: 'Suspended' },
  deleted:   { cls: 'bg-red-100 text-red-600',      label: 'Deleted' },
}

export default function UserStatusBadge({ status }) {
  const { cls, label } = MAP[status] ?? MAP.active
  return (
    <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>
      {label}
    </span>
  )
}
