import Icon from '../../../../../shared/components/Icon'
import { ChevronDown } from '../../../../../shared/components/icons'
import AssignmentSourceDetails from './AssignmentSourceDetails'

/**
 * One selectable detected-assignment row.
 *
 * Desktop: CSS-Grid row — [checkbox] [grade · subject] [curriculum] [sources]
 * [chevron]. Mobile: collapses into a compact card (see teacherSettings.css).
 *
 * Clicking anywhere on the row toggles the (real, semantic) checkbox via its
 * <label>; the chevron is a separate button that expands the source details
 * without touching the selection, with aria-expanded/aria-controls wiring.
 */
export default function AssignmentRow({
  item,
  index,
  checked,
  expanded,
  onToggle,
  onToggleExpand,
}) {
  const checkboxId = `tset-dta-check-${index}`
  const detailsId = `tset-dta-sources-${index}`
  const title = [item.gradeLabel, item.subjectLabel].filter(Boolean).join(' · ')
  const sourceCount = item.sourceCount || item.count || 1

  return (
    <li className={`tset-dta-row${checked ? ' is-selected' : ''}`}>
      <div className="tset-dta-row__main">
        <span className="tset-dta-row__checkcell">
          <input
            id={checkboxId}
            type="checkbox"
            className="tset-dta-row__check"
            checked={checked}
            onChange={() => onToggle(item.key)}
          />
        </span>
        <label className="tset-dta-row__body" htmlFor={checkboxId}>
          <span className="tset-dta-row__title">
            {title}
            {item.className ? <span className="tset-dta-row__class"> · {item.className}</span> : null}
          </span>
          <span
            className={`tset-dta-row__curriculum${item.curriculumConfirmed === false ? ' is-unconfirmed' : ''}`}
          >
            {item.curriculumLabel}
          </span>
          <span className="tset-dta-row__count">
            From {sourceCount} document{sourceCount === 1 ? '' : 's'}
          </span>
        </label>
        <button
          type="button"
          className={`tset-dta-row__expand${expanded ? ' is-open' : ''}`}
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? 'Hide' : 'Show'} source documents for ${title}`}
          onClick={() => onToggleExpand(item.key)}
        >
          <Icon as={ChevronDown} size="sm" aria-hidden="true" />
        </button>
      </div>
      {expanded && <AssignmentSourceDetails id={detailsId} sources={item.sources} />}
    </li>
  )
}
