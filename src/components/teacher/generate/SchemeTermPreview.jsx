/**
 * SchemeTermPreview — the "review before you generate" planning step for the
 * Scheme of Work studio.
 *
 * The studio no longer jumps straight from the form to a generated scheme.
 * First it divides the grade+subject syllabus intelligently across Term 1,
 * Term 2 and Term 3 (so Term 2 continues where Term 1 ended — the syllabus is
 * never restarted), then shows the teacher THIS term's suggested topics as
 * editable cards. The teacher can:
 *   • remove a topic (and restore it from the removed bin)
 *   • move a topic up / down (reorder)
 *   • increase / decrease the weeks a topic gets
 *   • add a topic manually
 *   • add a revision topic
 * …and only then approve. "Plan all three terms" shows all three slices so the
 * whole-year division is visible, and each term is generated from its own card.
 *
 * Pure-ish presentation over src/utils/schemeTermDivision.js. It owns the
 * editable plan state and calls onApprove({ term, items }) when the teacher
 * confirms. Mobile-first: cards stack, controls are tap-sized, no wide tables.
 */

import { useMemo, useState } from 'react'
import {
  divideTopicsByTerm,
  toDivisionItems,
  validateTermSelection,
  crossTermDuplicates,
  weeksNeeded,
} from '../../../utils/schemeTermDivision'

const TERMS = [1, 2, 3]

let _idSeq = 0
function nextId() {
  _idSeq += 1
  return `t${_idSeq}`
}

/** Give every division item a stable id so React keys survive reordering. */
function withIds(items) {
  return (items || []).map((it) => ({ ...it, id: it.id || nextId() }))
}

function SourceBadge({ source }) {
  // Semantic status tokens (light wash + dark ink in the light themes,
  // translucent wash + light ink on Night) rather than hard-coded pastels,
  // which stayed light-on-light under the Night theme.
  const map = {
    syllabi_studio: { label: 'Syllabus', bg: 'var(--success-bg)', fg: 'var(--success-fg)' },
    uploaded_module: { label: 'Module', bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
    ai_inferred: { label: 'General CBC', bg: 'var(--warning-bg)', fg: 'var(--warning-fg)' },
    teacher: { label: 'You added', bg: null, fg: null, chip: 'zx-chip--purple' },
  }
  const m = map[source] || map.syllabi_studio
  return (
    <span
      className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md ${m.chip || ''}`.trim()}
      style={m.bg ? { background: m.bg, color: m.fg } : undefined}
    >
      {m.label}
    </span>
  )
}

function Advisories({ list }) {
  if (!list || list.length === 0) return null
  return (
    <div className="space-y-2 mb-3">
      {list.map((a, i) => {
        const err = a.level === 'error'
        const warn = a.level === 'warning'
        const style = err
          ? { background: 'var(--danger-bg)', borderColor: 'var(--danger)', color: 'var(--danger-fg)' }
          : warn
            ? { background: 'var(--warning-bg)', borderColor: 'var(--warning)', color: 'var(--warning-fg)' }
            : { background: 'var(--info-bg)', borderColor: 'var(--info)', color: 'var(--info-fg)' }
        return (
          <div key={`${a.code}-${i}`} className="rounded-xl border px-3 py-2 text-sm flex items-start gap-2" style={style}>
            <span>{err ? '⛔' : warn ? '⚠️' : 'ℹ️'}</span>
            <span>{a.message}</span>
          </div>
        )
      })}
    </div>
  )
}

/** One editable topic card. */
function TopicCard({ item, index, count, onRemove, onMove, onWeeks }) {
  const subs = Array.isArray(item.subtopics) ? item.subtopics : []
  return (
    <div className="rounded-xl border theme-border p-3.5" style={{ background: 'var(--zt-card)' }}>
      <div className="flex items-start gap-3">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg font-black text-white shrink-0 mt-0.5" style={{ background: item.isRevision ? '#6b21a8' : 'var(--zt-sidebar-bg)' }}>
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-black break-words" style={{ color: 'var(--zt-text)' }}>
              {item.topic}
            </span>
            <SourceBadge source={item.isRevision ? 'teacher' : item.source} />
          </div>
          {subs.length > 0 && (
            <p className="text-xs mt-1 break-words" style={{ color: 'var(--zt-text-muted)' }}>
              {subs.slice(0, 6).join(' · ')}{subs.length > 6 ? ` +${subs.length - 6} more` : ''}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {/* Weeks stepper */}
            <div className="inline-flex items-center gap-1 rounded-lg border theme-border px-1" style={{ background: 'var(--zt-surface)' }}>
              <button type="button" aria-label="Fewer weeks" onClick={() => onWeeks(Math.max(1, (item.weeks || 1) - 1))} className="px-2 py-0.5 text-sm font-black" style={{ color: 'var(--zt-text-muted)' }}>−</button>
              <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--zt-text)' }}>
                {item.weeks || 1} wk{(item.weeks || 1) === 1 ? '' : 's'}
              </span>
              <button type="button" aria-label="More weeks" onClick={() => onWeeks(Math.min(6, (item.weeks || 1) + 1))} className="px-2 py-0.5 text-sm font-black" style={{ color: 'var(--zt-text-muted)' }}>+</button>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 shrink-0">
          <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="px-2 py-0.5 rounded-md text-xs disabled:opacity-30" style={{ color: 'var(--zt-text)', border: '1px solid var(--zt-line)' }}>▲</button>
          <button type="button" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)} className="px-2 py-0.5 rounded-md text-xs disabled:opacity-30" style={{ color: 'var(--zt-text)', border: '1px solid var(--zt-line)' }}>▼</button>
          <button type="button" aria-label="Remove topic" onClick={onRemove} className="px-2 py-0.5 rounded-md text-xs font-bold" style={{ color: 'var(--danger-fg)', border: '1px solid var(--danger)' }}>✕</button>
        </div>
      </div>
    </div>
  )
}

/** One term's editable panel. */
function TermPanel({
  term, items, removed, deliveryWeeks, totalWeeks, hasRevision, hasExam,
  crossDup, allTopics = [], onChange, onApprove, busy, focused,
}) {
  const [manual, setManual] = useState('')

  // Every mutation emits ONE onChange carrying the full {items, removed} next
  // state, so no two updates in the same handler can clobber each other.
  function setItems(next) {
    onChange({ items: next, removed })
  }

  function removeAt(i) {
    const it = items[i]
    onChange({ items: items.filter((_, idx) => idx !== i), removed: [...removed, it] })
  }
  function restore(id) {
    const it = removed.find((r) => r.id === id)
    if (!it) return
    onChange({ items: [...items, it], removed: removed.filter((r) => r.id !== id) })
  }
  function move(i, dir) {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = items.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setItems(next)
  }
  function setWeeks(i, weeks) {
    setItems(items.map((it, idx) => (idx === i ? { ...it, weeks } : it)))
  }
  function addManual() {
    const name = manual.trim()
    if (!name) return
    setItems([...items, { id: nextId(), topic: name, subtopics: [], weeks: 1, source: 'teacher' }])
    setManual('')
  }
  /** Add a topic chosen from the subject's syllabus dropdown, keeping its real
   * sub-topics, estimated weeks and source so it looks/paces like a syllabus
   * topic (not a bare "You added" one). */
  function addFromSyllabus(indexStr) {
    const idx = Number(indexStr)
    if (!Number.isFinite(idx)) return
    const t = allTopics.find((x) => x.index === idx)
    if (!t) return
    setItems([...items, {
      id: nextId(),
      topic: t.topic,
      subtopics: Array.isArray(t.subtopics) ? t.subtopics : [],
      weeks: t.weeks || 1,
      source: t.source || 'syllabi_studio',
    }])
  }
  function addRevision() {
    setItems([...items, { id: nextId(), topic: 'Revision', subtopics: [], weeks: 1, source: 'teacher', isRevision: true }])
  }

  const advisories = useMemo(
    () => validateTermSelection({ items, deliveryWeeks, hasRevision: hasRevision || items.some((i) => i.isRevision), hasExam }),
    [items, deliveryWeeks, hasRevision, hasExam],
  )
  const used = weeksNeeded(items)

  // Topic names already in THIS term, so the dropdown can mark them as added
  // (a topic is normally taught in one term only).
  const usedKeys = useMemo(
    () => new Set(items.map((it) => String(it.topic || '').toLowerCase())),
    [items],
  )

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${focused ? '' : 'opacity-95'}`} style={{ background: 'var(--zt-card)', borderColor: 'var(--zt-line)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h3 className="studio-display" style={{ fontSize: 18, margin: 0 }}>Term {term}</h3>
        <span className="text-xs font-bold" style={{ color: 'var(--zt-text-muted)' }}>
          {totalWeeks ? `${totalWeeks} calendar week${totalWeeks === 1 ? '' : 's'}` : ''}
          {deliveryWeeks ? ` · ${deliveryWeeks} for teaching` : ''}
        </span>
      </div>
      <p className="text-sm mb-3" style={{ color: 'var(--zt-text-muted)' }}>
        We are planning for <b>Term {term}</b>. Based on the syllabus, the periods per week and the school calendar,
        these are the topics we suggest — <b>{used}</b> of about <b>{deliveryWeeks || totalWeeks || '—'}</b> teaching weeks used.
        Remove, reorder, add, or change the weeks for any topic, then approve.
      </p>

      {crossDup.length > 0 && (
        <Advisories list={[{ code: 'cross', level: 'warning', message: `${crossDup.join(', ')} also appear${crossDup.length === 1 ? 's' : ''} in another term — a topic should normally be taught in one term only (unless it is deliberate revision).` }]} />
      )}
      <Advisories list={advisories} />

      <div className="space-y-2.5">
        {items.map((it, i) => (
          <TopicCard
            key={it.id}
            item={it}
            index={i}
            count={items.length}
            onRemove={() => removeAt(i)}
            onMove={(dir) => move(i, dir)}
            onWeeks={(w) => setWeeks(i, w)}
          />
        ))}
        {items.length === 0 && (
          <div className="rounded-xl border theme-border p-5 text-center text-sm" style={{ color: 'var(--zt-text-muted)' }}>
            No topics for this term yet — add one below or restore a removed topic.
          </div>
        )}
      </div>

      {/* Add / revision controls */}
      <div className="mt-3 space-y-2">
        {/* Pick from the subject's syllabus — the full topic list for this
            grade+subject, so the teacher can choose an exact topic instead of
            typing it. */}
        {allTopics.length > 0 && (
          <div>
            <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--zt-text-muted)' }}>
              Add a topic from the syllabus
            </label>
            <select
              value=""
              onChange={(e) => { addFromSyllabus(e.target.value); e.target.value = '' }}
              aria-label="Add a topic from the syllabus"
              className="studio-input w-full text-sm mt-1"
            >
              <option value="">Choose a topic…</option>
              {allTopics.map((t) => (
                <option key={t.index} value={String(t.index)}>
                  {t.topic}{usedKeys.has(String(t.topic).toLowerCase()) ? ' — already added' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Or type your own topic that isn't in the syllabus. */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual() } }}
            placeholder="Add a topic manually…"
            maxLength={140}
            className="studio-input flex-1 text-sm"
          />
          <div className="flex gap-2">
            <button type="button" onClick={addManual} className="studio-btn-ghost text-sm whitespace-nowrap">➕ Add topic</button>
            <button type="button" onClick={addRevision} className="studio-btn-ghost text-sm whitespace-nowrap">📖 Add revision</button>
          </div>
        </div>
      </div>

      {/* Removed bin */}
      {removed.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--zt-text-muted)' }}>Removed — tap to restore</p>
          <div className="flex flex-wrap gap-1.5">
            {removed.map((r) => (
              <button key={r.id} type="button" onClick={() => restore(r.id)} className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'color-mix(in srgb, var(--zt-text) 7%, var(--zt-card))', color: 'var(--zt-text-muted)', border: '1px dashed var(--zt-line)' }}>
                ↩ {r.topic}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => onApprove(term, items)}
        disabled={busy || items.length === 0 || advisories.some((a) => a.level === 'error')}
        className="studio-btn-primary w-full py-3 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Generating…' : `✓ Approve & Generate Term ${term}`}
      </button>
    </div>
  )
}

export default function SchemeTermPreview({
  topics,
  focusTerm = 1,
  scope = 'single',
  onScopeChange,
  weeksByTerm = {},
  termMeta = {},
  gradeLabel = '',
  subjectLabel = '',
  curriculumLabel = '',
  onApprove,
  onBack,
  busy = false,
  loading = false,
}) {
  // Compute the division once from the incoming syllabus topics, then hand the
  // editable copy to per-term state. Recomputed only when the inputs change.
  const initial = useMemo(
    () => divideTopicsByTerm(topics, { weeksByTerm }),
    [topics, weeksByTerm],
  )

  // The full grade+subject syllabus, normalised once, so each term's "Add a
  // topic from the syllabus" dropdown can offer every topic of the subject.
  const allTopics = useMemo(() => toDivisionItems(topics), [topics])

  // Editable per-term plan: { term: { items, removed } }. Seeded from the
  // division; re-seeded whenever the underlying division changes (new subject).
  const [plan, setPlan] = useState(null)
  const [seedKey, setSeedKey] = useState('')
  const key = `${subjectLabel}|${gradeLabel}|${JSON.stringify(weeksByTerm)}|${(topics || []).length}`
  if (key !== seedKey) {
    // Reseed synchronously on a genuinely new selection (cheap, deterministic).
    const seeded = {}
    for (const t of TERMS) seeded[t] = { items: withIds(initial.byTerm[t]), removed: [] }
    setPlan(seeded)
    setSeedKey(key)
  }

  const byTerm = useMemo(
    () => plan || { 1: { items: [], removed: [] }, 2: { items: [], removed: [] }, 3: { items: [], removed: [] } },
    [plan],
  )

  const crossDup = useMemo(() => {
    const forCheck = {}
    for (const t of TERMS) forCheck[t] = byTerm[t].items
    return crossTermDuplicates(forCheck)
  }, [byTerm])

  function updateTerm(term, next) {
    setPlan((p) => ({ ...(p || byTerm), [term]: next }))
  }

  const shownTerms = scope === 'all' ? TERMS : [focusTerm]

  if (loading) {
    return (
      <div className="studio-card p-8 text-center">
        <div className="text-3xl mb-2">🦁</div>
        <p className="text-sm" style={{ color: 'var(--zt-text-muted)' }}>Reading the syllabus and school calendar…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="studio-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="studio-display" style={{ fontSize: 22, margin: '0 0 2px' }}>Review your term plan</h2>
            <p className="text-sm" style={{ color: 'var(--zt-text-muted)' }}>
              {curriculumLabel ? `${curriculumLabel} · ` : ''}{gradeLabel}{subjectLabel ? ` · ${subjectLabel}` : ''}
            </p>
          </div>
          <button type="button" onClick={onBack} className="studio-btn-ghost text-sm">← Back to settings</button>
        </div>

        {/* Scope toggle */}
        <div className="mt-4 inline-flex rounded-xl border theme-border overflow-hidden" role="group" aria-label="Planning scope">
          {[
            { v: 'single', label: `Plan Term ${focusTerm} only` },
            { v: 'all', label: 'Plan all three terms' },
          ].map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => onScopeChange?.(opt.v)}
              className="px-4 py-2 text-sm font-bold"
              style={scope === opt.v
                ? { background: 'var(--zt-sidebar-bg)', color: 'var(--zt-on-dark, #ffffff)' }
                : { background: 'var(--zt-card)', color: 'var(--zt-text-muted)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {scope === 'all' && (
          <p className="text-xs mt-2" style={{ color: 'var(--zt-text-muted)' }}>
            The full syllabus is divided across all three terms below. Review and edit each term, then generate them one at a time.
          </p>
        )}
      </div>

      {shownTerms.map((t) => (
        <TermPanel
          key={t}
          term={t}
          focused={t === focusTerm}
          items={byTerm[t].items}
          removed={byTerm[t].removed}
          deliveryWeeks={termMeta[t]?.deliveryWeeks || weeksByTerm[t] || 0}
          totalWeeks={termMeta[t]?.totalWeeks || 0}
          hasRevision={termMeta[t]?.hasRevision || false}
          hasExam={termMeta[t]?.hasExam || false}
          crossDup={crossDup.length ? crossDup : []}
          allTopics={allTopics}
          onChange={(next) => updateTerm(t, next)}
          onApprove={onApprove}
          busy={busy}
        />
      ))}
    </div>
  )
}
