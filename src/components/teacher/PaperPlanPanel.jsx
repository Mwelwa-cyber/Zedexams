// The plan a teacher confirms before a paper is written (§3.1).
//
// Between "Plan the paper" and "Write it" the teacher sees exactly what is about
// to be produced: how many questions, worth how many marks, how long it will
// take, which topics carry how much of the paper, how hard it gets, and what will
// need a picture. Then they either write it or change the spread and re-plan.
//
// Everything shown here comes from the SAME blueprint object the generator is
// constrained by, so this is not a summary of intentions; it is the paper's
// specification, in English.
//
// Presentational only: the panel computes nothing itself (blueprintSummary.js
// does that, under test) and owns no server calls.

import { useEffect, useMemo, useState } from 'react'
import { summarizePlan, DIFFICULTY_PRESETS } from '../../utils/blueprintSummary'
import {
  TOS_TAXONOMY_OPTIONS,
  downloadTableOfSpecificationsDocx,
  openTableOfSpecificationsPrintWindow,
} from '../../utils/tableOfSpecifications'

function Bar({ percent }) {
  return (
    <div aria-hidden="true" style={{
      height: 6, borderRadius: 999, background: 'var(--sv-soft)', overflow: 'hidden',
    }}>
      <div style={{
        width: `${Math.max(0, Math.min(100, percent))}%`, height: '100%',
        background: 'var(--sv-primary)', borderRadius: 999,
      }} />
    </div>
  )
}

function Rows({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase',
        color: 'var(--sv-muted)', marginBottom: 6,
      }}>{title}</div>
      {children}
    </div>
  )
}

export default function PaperPlanPanel({
  blueprint,
  problems = [],
  topicsOnFile = 0,
  presetId = 'band',
  onPresetChange,
  onGenerate,
  onBack,
  replanning = false,
  generating = false,
}) {
  const plan = useMemo(() => summarizePlan(blueprint), [blueprint])
  const suggestedTaxonomy = blueprint?.framework === '2013' ? 'traditional' : 'revised'
  const [bloomTaxonomy, setBloomTaxonomy] = useState(suggestedTaxonomy)
  const [exporting, setExporting] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const selectedTaxonomy = useMemo(
    () => TOS_TAXONOMY_OPTIONS.find((option) => option.id === bloomTaxonomy) || TOS_TAXONOMY_OPTIONS[0],
    [bloomTaxonomy],
  )

  useEffect(() => {
    setBloomTaxonomy(suggestedTaxonomy)
  }, [suggestedTaxonomy])

  async function exportSpecifications(kind) {
    if (!blueprint || exporting) return
    setExporting(kind)
    setExportMessage('')
    try {
      const meta = { bloomTaxonomy }
      if (kind === 'word') {
        await downloadTableOfSpecificationsDocx(blueprint, meta)
        setExportMessage(`${selectedTaxonomy.label} editable copy is downloading.`)
      } else {
        openTableOfSpecificationsPrintWindow(blueprint, meta)
        setExportMessage(`${selectedTaxonomy.label} filing copy is open. Choose Print or Save as PDF.`)
      }
    } catch (error) {
      setExportMessage(error?.message || 'Could not prepare the Table of Specifications.')
    } finally {
      setExporting('')
    }
  }

  // A plan we could not build is not hidden behind a spinner or dressed up as a
  // plan. The teacher is told, and can still generate (the generator falls back
  // to writing the paper unconstrained).
  if (!plan.ready) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{
          borderRadius: 10, border: '1px solid #fcd34d', background: '#fffbeb',
          padding: '10px 12px', fontSize: 13, color: '#92400e',
        }}>
          <strong>We could not work out a plan for this one.</strong>
          <div style={{ marginTop: 4 }}>
            You can still write the paper. It just won’t be planned question by
            question first, so check the spread of topics and marks yourself when
            it lands.
          </div>
          {problems.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
              {problems.slice(0, 3).map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="sv-btn sv-btn-primary" style={{ flex: 1 }}
            onClick={onGenerate} disabled={generating}>
            {generating ? '✦ Writing the paper…' : '✦ Write the paper anyway'}
          </button>
          <button type="button" className="sv-btn" onClick={onBack} disabled={generating}>
            ← Change settings
          </button>
        </div>
      </div>
    )
  }

  const overTime = plan.durationMinutes > 0 &&
    plan.estimatedMinutes > plan.durationMinutes * 1.15

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        borderRadius: 12, border: '1px solid var(--sv-border)',
        background: 'var(--sv-soft)', padding: '12px 14px',
      }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--sv-text)' }}>
          Here’s the plan for your paper
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--sv-text)', marginTop: 4, fontWeight: 700 }}>
          {plan.headline}
        </div>
        <div style={{ fontSize: 12, color: 'var(--sv-muted)', marginTop: 4 }}>
          You’ve allowed {plan.durationMinutes} minutes
          {overTime
            ? ' — that looks tight for this many marks.'
            : '.'}{' '}
          {topicsOnFile > 0 && `Planned from ${topicsOnFile} topic${topicsOnFile === 1 ? '' : 's'} in the syllabus on file.`}
        </div>
      </div>

      <div style={{
        borderRadius: 12,
        border: '1px solid #e6c7be',
        background: '#fffaf7',
        padding: '12px 14px',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1 1 300px' }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--sv-text)' }}>
              Table of Specifications
            </div>
            <div style={{ fontSize: 12, color: 'var(--sv-muted)', marginTop: 3, lineHeight: 1.45 }}>
              Download the teacher filing copy that shows the topics, marks and
              cognitive levels used to plan this paper. It is separate from the
              learner question paper.
            </div>

            <div style={{ marginTop: 11 }}>
              <div id="tos-bloom-format-label" style={{
                fontSize: 11, fontWeight: 800, letterSpacing: 0.35,
                textTransform: 'uppercase', color: 'var(--sv-muted)', marginBottom: 6,
              }}>
                Bloom&apos;s taxonomy format
              </div>
              <div
                role="group"
                aria-labelledby="tos-bloom-format-label"
                style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
              >
                {TOS_TAXONOMY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`sv-cpm-pill ${bloomTaxonomy === option.id ? 'active' : ''}`}
                    aria-pressed={bloomTaxonomy === option.id}
                    disabled={Boolean(exporting) || generating || replanning}
                    onClick={() => {
                      setBloomTaxonomy(option.id)
                      setExportMessage('')
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div style={{
                marginTop: 6, fontSize: 11.5, lineHeight: 1.45, color: 'var(--sv-muted)',
              }}>
                {selectedTaxonomy.description}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="sv-btn"
              onClick={() => exportSpecifications('pdf')}
              disabled={Boolean(exporting) || generating || replanning}
            >
              {exporting === 'pdf' ? 'Preparing…' : 'Print / Save PDF'}
            </button>
            <button
              type="button"
              className="sv-btn sv-btn-primary"
              onClick={() => exportSpecifications('word')}
              disabled={Boolean(exporting) || generating || replanning}
            >
              {exporting === 'word' ? 'Preparing Word…' : 'Download Word copy'}
            </button>
          </div>
        </div>
        {exportMessage && (
          <div role="status" style={{
            marginTop: 8, fontSize: 12,
            color: /could not|blocked/i.test(exportMessage) ? '#991b1b' : '#065f46',
          }}>
            {exportMessage}
          </div>
        )}
      </div>

      {plan.sections.length > 0 && (
        <Rows title="Parts of the paper">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {plan.sections.map((s) => (
              <div key={s.key} style={{
                display: 'flex', justifyContent: 'space-between', gap: 10,
                fontSize: 13, color: 'var(--sv-text)',
              }}>
                <span style={{ fontWeight: 700 }}>{s.label}</span>
                <span style={{ color: 'var(--sv-muted)' }}>
                  {s.questions} question{s.questions === 1 ? '' : 's'} · {s.marks} marks
                </span>
              </div>
            ))}
          </div>
        </Rows>
      )}

      <Rows title="Topics covered">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {plan.topics.map((t) => (
            <div key={t.topic}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', gap: 10,
                fontSize: 13, color: 'var(--sv-text)',
              }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.topic}
                </span>
                <span style={{ color: 'var(--sv-muted)', flex: '0 0 auto' }}>
                  {t.questions} · {t.marks} marks
                </span>
              </div>
              <Bar percent={plan.totalMarks > 0 ? (t.marks / plan.totalMarks) * 100 : 0} />
            </div>
          ))}
        </div>
      </Rows>

      <Rows title="How hard it gets">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {plan.difficulty.map((d) => (
            <div key={d.key}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', gap: 10,
                fontSize: 13, color: d.questions === 0 ? 'var(--sv-muted)' : 'var(--sv-text)',
              }}>
                <span>{d.label}</span>
                <span style={{ color: 'var(--sv-muted)' }}>
                  {d.questions} question{d.questions === 1 ? '' : 's'}
                </span>
              </div>
              <Bar percent={d.percent} />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--sv-muted)', marginBottom: 4 }}>
            Change the spread and we’ll re-plan:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {DIFFICULTY_PRESETS.map((p) => (
              <button key={p.id} type="button"
                className={`sv-cpm-pill ${presetId === p.id ? 'active' : ''}`}
                title={p.hint}
                disabled={replanning || generating}
                onClick={() => onPresetChange?.(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          {replanning && (
            <div style={{ fontSize: 12, color: 'var(--sv-muted)', marginTop: 6 }} role="status">
              Re-planning…
            </div>
          )}
        </div>
      </Rows>

      <Rows title="Kinds of question">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {plan.activities.map((a) => (
            <span key={a.key} className="sv-cpm-chip" style={{ fontSize: 12 }}>
              {a.label} × {a.questions}
              {a.limited && <span style={{ color: 'var(--sv-muted)' }}> · basic</span>}
            </span>
          ))}
        </div>
      </Rows>

      {plan.notes.length > 0 && (
        <ul style={{
          margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--sv-muted)',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {plan.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="sv-btn sv-btn-primary" style={{ flex: 1 }}
          onClick={onGenerate} disabled={generating || replanning}>
          {generating ? '✦ Writing the paper… (about a minute)' : '✦ Write this paper'}
        </button>
        <button type="button" className="sv-btn" onClick={onBack} disabled={generating}>
          ← Change settings
        </button>
      </div>
    </div>
  )
}
