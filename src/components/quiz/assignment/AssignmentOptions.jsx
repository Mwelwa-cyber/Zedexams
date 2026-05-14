/**
 * Shared options panel — timer, retakes, shuffle, lock, schedule,
 * notifications. Used by both Automatic and Manual modes so a
 * teacher gets the same controls in either flow.
 *
 * Controlled component. Parent owns the `values` object; we only
 * call `onChange(field, value)` per toggle.
 */

export default function AssignmentOptions({
  values,
  onChange,
  showSchedule = true,
  showDailyChallenge = false,
  className = '',
}) {
  const v = values || {}

  function field(name, value) {
    onChange?.(name, value)
  }

  return (
    <div className={`grid gap-4 ${className}`}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle
          id="timed"
          label="Timed exam"
          description="Locks the quiz to its built-in duration."
          checked={Boolean(v.timed)}
          onChange={(checked) => field('timed', checked)}
        />
        <Toggle
          id="allowRetakes"
          label="Allow retakes"
          description="Let learners attempt the quiz more than once."
          checked={Boolean(v.allowRetakes)}
          onChange={(checked) => field('allowRetakes', checked)}
        />
        <Toggle
          id="shuffleQuestions"
          label="Shuffle questions"
          description="Random order per learner — discourages copying."
          checked={Boolean(v.shuffleQuestions)}
          onChange={(checked) => field('shuffleQuestions', checked)}
        />
        <Toggle
          id="lockAfterSubmission"
          label="Lock after submission"
          description="Learner can't change answers once submitted."
          checked={Boolean(v.lockAfterSubmission)}
          onChange={(checked) => field('lockAfterSubmission', checked)}
        />
        <Toggle
          id="notifyLearners"
          label="Notify learners"
          description="Send an in-app ping when the assignment goes live."
          checked={v.notifyLearners !== false}
          onChange={(checked) => field('notifyLearners', checked)}
        />
        {showDailyChallenge && (
          <Toggle
            id="addToDailyChallenge"
            label="Add to daily challenge"
            description="Featured in the learner's daily challenge feed."
            checked={Boolean(v.addToDailyChallenge)}
            onChange={(checked) => field('addToDailyChallenge', checked)}
          />
        )}
      </div>

      {showSchedule && (
        <div className="grid gap-3 sm:grid-cols-2">
          <DatetimeField
            id="openAt"
            label="Open date"
            help="When learners can start (optional)."
            value={v.openAtInput || ''}
            onChange={(value) => field('openAtInput', value)}
          />
          <DatetimeField
            id="dueAt"
            label="Close date"
            help="Must be in the future. Optional."
            value={v.dueAtInput || ''}
            onChange={(value) => field('dueAtInput', value)}
          />
        </div>
      )}
    </div>
  )
}

function Toggle({ id, label, description, checked, onChange }) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 rounded-2xl border theme-border theme-card p-3 cursor-pointer hover:theme-bg-subtle min-h-[60px]"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
        className="mt-0.5 h-5 w-5 flex-shrink-0 rounded border-2 theme-border accent-current"
      />
      <div className="flex-1 min-w-0">
        <p className="theme-text text-sm font-black">{label}</p>
        <p className="theme-text-muted text-xs mt-0.5 leading-snug">{description}</p>
      </div>
    </label>
  )
}

function DatetimeField({ id, label, help, value, onChange }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-xs font-black uppercase tracking-widest theme-text-muted">
        {label}
      </span>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className="rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm"
      />
      {help && <span className="text-[11px] theme-text-muted">{help}</span>}
    </label>
  )
}
