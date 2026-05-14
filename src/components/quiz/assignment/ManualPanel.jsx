/**
 * Manual-mode body: pick specific classes and (optionally) narrow to
 * specific learners within them. Reuses <AssignmentOptions> for the
 * shared timer/schedule controls.
 */

import { useMemo, useState } from 'react'
import AssignmentOptions from './AssignmentOptions'
import ClassMultiSelect from './ClassMultiSelect'
import LearnerMultiSelect from './LearnerMultiSelect'

export default function ManualPanel({
  allClasses = [],
  selectedClassIds = [],
  onSelectedClassesChange,
  selectedLearnerUids = [],
  onSelectedLearnersChange,
  options,
  onOptionChange,
  existingClassIds = [],
  learnerLookup = new Map(),
  learnersLoading = false,
}) {
  const [showLearnerScope, setShowLearnerScope] = useState(selectedLearnerUids.length > 0)

  // Build the union of learners across the selected classes, with
  // per-class metadata so the picker can show "Jane · Grade 7 Blue".
  const members = useMemo(() => {
    if (selectedClassIds.length === 0) return []
    const out = []
    const seen = new Set()
    for (const klass of allClasses) {
      if (!selectedClassIds.includes(klass.id)) continue
      const roster = Array.isArray(klass.learners) ? klass.learners : []
      for (const uid of roster) {
        if (seen.has(uid)) continue
        seen.add(uid)
        const summary = learnerLookup.get(uid) || { uid }
        out.push({
          uid,
          displayName: summary.displayName || '',
          email: summary.email || '',
          className: klass.name || '',
        })
      }
    }
    return out.sort((a, b) => (a.displayName || a.email || a.uid).localeCompare(b.displayName || b.email || b.uid))
  }, [allClasses, selectedClassIds, learnerLookup])

  function toggleClass(classId) {
    if (selectedClassIds.includes(classId)) {
      const next = selectedClassIds.filter((id) => id !== classId)
      onSelectedClassesChange?.(next)
      // Drop learner uids that no longer belong to a selected class.
      const stillEligible = new Set()
      for (const klass of allClasses) {
        if (!next.includes(klass.id)) continue
        for (const uid of (klass.learners || [])) stillEligible.add(uid)
      }
      onSelectedLearnersChange?.(selectedLearnerUids.filter((uid) => stillEligible.has(uid)))
    } else {
      onSelectedClassesChange?.([...selectedClassIds, classId])
    }
  }

  function toggleLearner(uid) {
    if (selectedLearnerUids.includes(uid)) {
      onSelectedLearnersChange?.(selectedLearnerUids.filter((u) => u !== uid))
    } else {
      onSelectedLearnersChange?.([...selectedLearnerUids, uid])
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="surface space-y-4 p-4 sm:p-5">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-lg">🏫</span>
            <h3 className="theme-text text-base font-black">Choose classes</h3>
          </div>
          <span className="rounded-full theme-accent-bg theme-accent-text px-2.5 py-1 text-xs font-black">
            {selectedClassIds.length} selected
          </span>
        </header>
        <ClassMultiSelect
          classes={allClasses}
          selectedIds={selectedClassIds}
          disabledIds={existingClassIds}
          onToggle={toggleClass}
          onSelectAll={(ids) => onSelectedClassesChange?.(ids)}
          onClear={() => {
            onSelectedClassesChange?.([])
            onSelectedLearnersChange?.([])
          }}
          emptyMessage="You don't own any classes yet. Create a class first under Classes → New class."
        />
      </section>

      <section className="surface space-y-3 p-4 sm:p-5">
        <button
          type="button"
          onClick={() => setShowLearnerScope((v) => !v)}
          aria-expanded={showLearnerScope}
          className="flex w-full items-center justify-between gap-3 rounded-xl theme-bg-subtle px-3 py-2.5 text-left text-sm font-black hover:opacity-90 min-h-[44px]"
        >
          <span className="flex items-center gap-2">
            <span aria-hidden="true">👥</span>
            Pick specific learners <span className="theme-text-muted text-xs font-bold">(optional)</span>
          </span>
          <span aria-hidden="true">{showLearnerScope ? '▾' : '▸'}</span>
        </button>
        {showLearnerScope && (
          <LearnerMultiSelect
            members={members}
            selectedUids={selectedLearnerUids}
            onToggle={toggleLearner}
            onSelectAll={(uids) => onSelectedLearnersChange?.(uids)}
            onClear={() => onSelectedLearnersChange?.([])}
            loading={learnersLoading}
          />
        )}
      </section>

      <section className="surface space-y-3 p-4 sm:p-5">
        <header className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg">⚙️</span>
          <h3 className="theme-text text-base font-black">Quiz settings</h3>
        </header>
        <AssignmentOptions
          values={options}
          onChange={onOptionChange}
          showSchedule
          showDailyChallenge={false}
        />
      </section>
    </div>
  )
}
