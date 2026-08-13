/**
 * PaperTemplatePicker — a modal grid of ready-made paper structures.
 *
 * Templates (functions/utils paperTemplates.js) give a teacher the standard
 * Zambian paper shapes (end-of-term, mid-term, MCQ quiz, comprehension …) so
 * they don't have to hand-build "SECTION A: 15 multiple choice, SECTION B: 5
 * structured" every time. Picking one seeds the studio with empty-but-typed
 * blocks the teacher then fills in.
 *
 * Presentation only — the studio owns instantiateTemplate() + applying the
 * result, so this stays a pure picker.
 */

import { useEffect } from 'react'
import Icon from './studioIcons'
import { PAPER_TEMPLATES, templateStats } from '../lib/paperTemplates'

export default function PaperTemplatePicker({ open, onClose, onPick }) {
  useEffect(() => {
    if (!open) return undefined
    function handleKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose?.() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="sv-scrim open sv-health-scrim"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div className="sv-template-modal" role="dialog" aria-modal="true" aria-label="Paper templates">
        <header className="sv-health-head">
          <div className="sv-health-head-text">
            <span className="sv-health-badge ready">
              <Icon name="sections" size={13} /> Templates
            </span>
            <h3 className="serif">Start from a template</h3>
            <p>Pick a common paper shape — we build the sections and marks; you fill in the questions.</p>
          </div>
          <button type="button" className="sv-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="remove" size={18} />
          </button>
        </header>

        <div className="sv-template-grid">
          {PAPER_TEMPLATES.map((template) => {
            const stats = templateStats(template)
            return (
              <button
                key={template.id}
                type="button"
                className="sv-template-card"
                onClick={() => onPick?.(template)}
              >
                {template.badge && <span className="sv-template-badge">{template.badge}</span>}
                <strong className="sv-template-name">{template.name}</strong>
                <p className="sv-template-desc">{template.description}</p>
                <div className="sv-template-meta">
                  <span><Icon name="questions" size={13} /> {stats.questionCount} questions</span>
                  <span><Icon name="marks" size={13} /> {stats.totalMarks} marks</span>
                  {template.duration ? <span><Icon name="time" size={13} /> {template.duration} min</span> : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
