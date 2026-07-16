/**
 * TeachingProfileMigrationCard — the detected-assignments onboarding card shown
 * to an EXISTING teacher (no profile yet) whose past work suggests which
 * classes they teach. It only SUGGESTS: the teacher ticks the assignments they
 * currently teach and confirms; nothing is saved until they click
 * "Add N & continue", and no existing document is touched. "Start from
 * scratch" skips straight to the blank wizard.
 *
 * Suggestions arrive already NORMALISED + DEDUPED (see
 * src/utils/detectedAssignments.js via buildMigrationPlan): canonical grade +
 * subject labels, one entry per grade + subject + curriculum + class, source
 * documents merged. This component only renders and filters them.
 */

import { useMemo, useState } from 'react'
import DetectedAssignmentsBanner from './detected/DetectedAssignmentsBanner'
import AssignmentToolbar from './detected/AssignmentToolbar'
import AssignmentList from './detected/AssignmentList'
import TeachingProfileActions from './detected/TeachingProfileActions'
import {
  filterDetectedAssignments,
  gradeFilterOptions,
  curriculumFilterOptions,
} from '../../../../utils/detectedAssignments'

// Search + filter controls only appear once the list is long enough to need
// them (section 7 of the redesign spec).
const FILTERS_THRESHOLD = 8

export default function TeachingProfileMigrationCard({
  suggestions = [],
  selectedKeys,
  onToggle,
  onSelectKeys,
  onClearAll,
  onApply,
  onSkip,
  applying = false,
  error = '',
}) {
  const [expandedKey, setExpandedKey] = useState(null)
  const [query, setQuery] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [curriculumFilter, setCurriculumFilter] = useState('')

  const visible = useMemo(
    () => filterDetectedAssignments(suggestions, { query, gradeId: gradeFilter, curriculumId: curriculumFilter }),
    [suggestions, query, gradeFilter, curriculumFilter],
  )
  const gradeOptions = useMemo(() => gradeFilterOptions(suggestions), [suggestions])
  const curriculumOptions = useMemo(() => curriculumFilterOptions(suggestions), [suggestions])

  if (!suggestions.length) return null
  const selectedCount = suggestions.filter((sug) => selectedKeys.has(sug.key)).length

  const clearFilters = () => {
    setQuery('')
    setGradeFilter('')
    setCurriculumFilter('')
  }

  return (
    <section className="tset-card tset-dta" aria-labelledby="tset-dta-found">
      <DetectedAssignmentsBanner />
      <AssignmentToolbar
        totalCount={suggestions.length}
        visibleCount={visible.length}
        selectedCount={selectedCount}
        onSelectAll={() => onSelectKeys(visible.map((sug) => sug.key))}
        onClearAll={onClearAll}
        showFilters={suggestions.length > FILTERS_THRESHOLD}
        query={query}
        onQueryChange={setQuery}
        gradeFilter={gradeFilter}
        onGradeFilterChange={setGradeFilter}
        gradeOptions={gradeOptions}
        curriculumFilter={curriculumFilter}
        onCurriculumFilterChange={setCurriculumFilter}
        curriculumOptions={curriculumOptions}
        onClearFilters={clearFilters}
      />
      <AssignmentList
        items={visible}
        selectedKeys={selectedKeys}
        expandedKey={expandedKey}
        onToggle={onToggle}
        onToggleExpand={(key) => setExpandedKey((cur) => (cur === key ? null : key))}
      />
      <TeachingProfileActions
        selectedCount={selectedCount}
        applying={applying}
        error={error}
        onApply={onApply}
        onSkip={onSkip}
      />
    </section>
  )
}
