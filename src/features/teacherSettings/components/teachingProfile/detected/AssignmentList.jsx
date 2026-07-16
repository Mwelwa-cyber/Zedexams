import AssignmentRow from './AssignmentRow'

/**
 * The list of detected assignments. Rows manage selection through real
 * checkboxes; expansion state is lifted so only one source panel is open at a
 * time (keeps the list scannable).
 */
export default function AssignmentList({
  items = [],
  selectedKeys,
  expandedKey,
  onToggle,
  onToggleExpand,
  emptyLabel = 'No assignments match your search.',
}) {
  if (!items.length) {
    return <p className="tset-dta-list__none">{emptyLabel}</p>
  }
  return (
    <ul className="tset-dta-list">
      {items.map((item, index) => (
        <AssignmentRow
          key={item.key}
          item={item}
          index={index}
          checked={selectedKeys.has(item.key)}
          expanded={expandedKey === item.key}
          onToggle={onToggle}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </ul>
  )
}
