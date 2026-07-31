import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { clampInt } from '../../../utils/inputs.js'
import { toEditableText } from '../AssessmentQuestionEditors'
import {
  CardQuestionText,
  McqOptions,
  ShortAnswerInputs,
  AnswerSpaceControl,
} from '../AssessmentQuestionEditors'
import { STUDIO_QUESTION_TYPE_OPTIONS, typeSelectValue } from '../assessmentQuestionTypes'
import { QuestionBlock } from '../AssessmentQuestionBlock'
import { QUIZ_DOCUMENT_ACCEPT } from '../../quiz/documentQuizImporter'
import {
  ASSESSMENT_TYPE_LABELS,
  TERMS,
  INSTRUCTION_PRESETS,
  buildTitleFromForm,
  buildHeaderTitleFromForm,
} from '../AssessmentStudio'
import {
  useStudioSubjectChoices, useSyllabusLevelOptions, useSyllabusSubjectOptions,
  normalizeStudioFramework, CURRICULUM_FRAMEWORKS,
} from '../syllabusTopicOptions'
import { LEVEL_STAGE_LABELS, assessmentCategory } from '../paperTaxonomy'
import { CHOICE_COUNT_OPTIONS, recommendedChoiceCount, resolveChoiceCount } from '../../../utils/mcqChoices'
import { PAGE_SIZES, MARGIN_PRESETS } from '../../../config/paperLayoutTokens'
import { GRADE_NUMBER_STYLES, LEARNER_NAME_LABELS } from '../../../utils/paperMetadata'

/**
 * Render an ordered level list as <optgroup>s by education stage (Early
 * Childhood → Primary → Secondary → Legacy), preserving the fixed educational
 * order the options already carry.
 */
function GroupedLevelOptions({ levels }) {
  const order = [...Object.values(LEVEL_STAGE_LABELS), 'Other', 'Legacy']
  const groups = new Map()
  for (const lvl of levels) {
    const g = lvl.group || 'Other'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(lvl)
  }
  const groupNames = [...groups.keys()].sort(
    (a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
  )
  return (
    <>
      {groupNames.map((name) => (
        <optgroup key={name} label={name}>
          {groups.get(name).map((lvl) => (
            <option key={lvl.value} value={lvl.value}>{lvl.label}</option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

/**
 * The ASSESSMENT TYPE picker, grouped into "Tests" and "Examinations" —
 * one field, two labelled sections, so a teacher never has to guess which
 * route to open to create a given paper type.
 */
function GroupedAssessmentTypeOptions({ types }) {
  const tests = types.filter((t) => assessmentCategory(t) === 'test')
  const examinations = types.filter((t) => assessmentCategory(t) === 'examination')
  return (
    <>
      {tests.length > 0 && (
        <optgroup label="Tests">
          {tests.map((t) => <option key={t} value={t}>{ASSESSMENT_TYPE_LABELS[t]}</option>)}
        </optgroup>
      )}
      {examinations.length > 0 && (
        <optgroup label="Examinations">
          {examinations.map((t) => <option key={t} value={t}>{ASSESSMENT_TYPE_LABELS[t]}</option>)}
        </optgroup>
      )}
    </>
  )
}
import Icon from './studioIcons'

/* ==================================================================
 * IMPORT SUMMARY BANNER
 * Shown at the top of HeaderBlock after a document/scan import so the
 * teacher immediately sees what was extracted. Dismisses by clearing
 * importSummary in AssessmentStudio via onDismissImportSummary.
 * ================================================================== */
function ImportSummaryBanner({ summary, onDismiss }) {
  const warnings = Array.isArray(summary.warnings) ? summary.warnings : []
  const manyWarnings = warnings.length > 3
  return (
    <div className="sv-import-banner" role="status" aria-live="polite">
      <div className="sv-import-banner-head">
        <span className="sv-import-banner-title">
          {summary.smartApplied && (
            <span className="sv-import-tag smart">Smart import</span>
          )}
          <strong>{summary.fileName || 'Imported document'}</strong>
          {' — '}
          {summary.totalQuestions != null ? `${summary.totalQuestions} question${summary.totalQuestions === 1 ? '' : 's'} extracted` : 'questions extracted'}
          {summary.reviewCount > 0 && (
            <span className="sv-import-tag review"> · {summary.reviewCount} need review</span>
          )}
        </span>
        {onDismiss && (
          <button
            type="button"
            className="sv-import-banner-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss import summary"
          >
            ×
          </button>
        )}
      </div>
      {warnings.length > 0 && (
        manyWarnings ? (
          <details className="sv-import-warnings">
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--sv-muted)' }}>
              {warnings.length} import warnings
            </summary>
            <ul className="sv-import-warning-list">
              {warnings.map((w, i) => <li key={i}>{String(w)}</li>)}
            </ul>
          </details>
        ) : (
          <ul className="sv-import-warning-list">
            {warnings.map((w, i) => <li key={i}>{String(w)}</li>)}
          </ul>
        )
      )}
      {/* Parser version stamp — same stale-bundle diagnostic as the quiz
          editor's ImportQuizPanel; documents parse locally in the browser. */}
      {summary.importerVersion ? (
        <p style={{ margin: '4px 0 0', fontSize: 11, fontFamily: 'monospace', color: 'var(--sv-muted)' }}>
          importer {summary.importerVersion}
          {summary.scanned && summary.engineVersion ? ` · engine ${summary.engineVersion}` : ''}
        </p>
      ) : null}
    </div>
  )
}

/* ==================================================================
 * HEADER BLOCK
 * ================================================================== */
export function HeaderBlock({ form, setF, importing, onImportDocument, onScan, assessmentTypes = ['topic_test', 'weekly_test', 'mid_term', 'end_of_term', 'mock_exam', 'examination', 'final_exam'], assessmentTypeLabel = 'Assessment type', importSummary, onDismissImportSummary }) {
  const docInputRef = useRef(null)
  // Import options — both default ON; threaded into the parser via onImportDocument.
  const [preserveNumbering, setPreserveNumbering] = useState(true)
  const [groupComprehension, setGroupComprehension] = useState(true)
  // How scanned diagrams are handled. Default 'keep' — never drop figures by
  // default; many Zambian questions depend on them. 'text' is NOT the default.
  const [diagramHandling, setDiagramHandling] = useState('keep')
  // Subjects come from the live syllabus for the chosen grade + curriculum —
  // each level offers what it is actually taught (Grade 10 → Physics/Biology,
  // Grade 1 → Literacy/Numeracy) rather than a fixed upper-primary list. The
  // paper's saved subject always stays selectable.
  const framework = normalizeStudioFramework(form.framework)
  const { options: subjectChoices, loading: subjectsLoading } =
    useStudioSubjectChoices(form.grade, framework, form.subject)
  const noSubjects = !subjectsLoading && subjectChoices.length === 0
  // The subjects genuinely on the syllabus for this grade + curriculum (NO
  // saved-subject prepend) — the authority for whether the current subject is
  // still valid after a grade/curriculum change.
  const { subjects: validSubjectPairs, loading: validSubjectsLoading } =
    useSyllabusSubjectOptions(form.grade, framework)
  const validSubjectLabels = validSubjectPairs.map((s) => s.label)
  // Levels come STRICTLY from the Syllabi Studio for this curriculum — no
  // universal Grade 1–12 list. CBC and the previous syllabus each show only
  // their own levels, Forms stay Forms, in fixed educational order.
  const { levels: levelOptions, loading: levelsLoading } =
    useSyllabusLevelOptions(framework, form.grade)
  const noLevels = !levelsLoading && levelOptions.length === 0
  // Only snap the subject on a change the TEACHER triggered — never silently
  // rewrite a freshly-opened saved paper on mount (its saved subject stays
  // selectable via useStudioSubjectChoices' prepend).
  const selectionTouched = useRef(false)
  // Changing the level invalidates the free-text topic (it belongs to a
  // different syllabus page); the subject list re-scopes via the hooks above.
  const changeGrade = (value) => { selectionTouched.current = true; setF('grade', value); if (form.topic) setF('topic', '') }
  const changeFramework = (value) => { selectionTouched.current = true; setF('framework', value) }
  // After a teacher-triggered grade/curriculum change, drop a subject that is no
  // longer valid for the new grade's syllabus and snap to the first valid one.
  // Without this, a leftover subject (e.g. "Integrated Science" kept when the
  // grade is switched to Nursery) stays selected, so the topic lookup runs
  // against a subject the grade doesn't teach and shows "no syllabus topics on
  // file" — the subject picker and topic picker disagreeing on the catalogue.
  useEffect(() => {
    if (!selectionTouched.current) return
    if (validSubjectsLoading) return
    if (validSubjectLabels.length === 0) return // fail-closed empty state → noSubjects UI
    if (!validSubjectLabels.includes(form.subject)) {
      setF('subject', validSubjectLabels[0])
      if (form.topic) setF('topic', '')
    }
    selectionTouched.current = false
    // validSubjectLabels is a fresh array each render; the selectionTouched flag
    // (reset above) keeps this to a single snap per user change.
  }, [validSubjectsLoading, validSubjectLabels, form.subject, form.topic, setF])

  return (
    <div className="sv-block b-header">
      <div className="sv-block-head">
        <span className="sv-ic"><Icon name="header" size={15} /></span> Paper Header
      </div>

      {importSummary && (
        <ImportSummaryBanner summary={importSummary} onDismiss={onDismissImportSummary} />
      )}

      <div className="sv-identity-row">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--sv-s3)' }}>
          <div className="sv-field">
            <label>School name <span className="sv-req">*</span></label>
            <input
              type="text"
              value={form.schoolName}
              onChange={e => setF('schoolName', e.target.value)}
              placeholder="e.g. Jemareen Academy"
            />
            <div style={{ fontSize: 11, color: 'var(--sv-muted)', marginTop: 4 }}>
              New papers fill this in from your{' '}
              <Link to="/settings?tab=school" style={{ color: 'var(--sv-primary)', fontWeight: 600 }}>
                School details
              </Link>
              .
            </div>
          </div>
          <div className="sv-field">
            <label>Class (optional)</label>
            <input
              type="text"
              value={form.className}
              onChange={e => setF('className', e.target.value)}
              placeholder="e.g. 4A"
            />
          </div>
        </div>
      </div>

      <div className="sv-field-grid four" style={{ marginBottom: 'var(--sv-s3)' }}>
        <div className="sv-field">
          <label>Grade / level</label>
          <select value={form.grade} onChange={e => changeGrade(e.target.value)}
            disabled={levelsLoading || noLevels}>
            {levelsLoading && <option value={form.grade}>Loading education levels…</option>}
            {noLevels && <option value="">No syllabus levels for this curriculum</option>}
            {!levelsLoading && !noLevels && <GroupedLevelOptions levels={levelOptions} />}
          </select>
          {noLevels && (
            <div style={{ fontSize: 11, color: 'var(--sv-muted)', marginTop: 4 }}>
              No syllabus levels are available for this curriculum.
            </div>
          )}
        </div>
        <div className="sv-field">
          <label htmlFor="studio-assessment-type">{assessmentTypeLabel}</label>
          <select id="studio-assessment-type" value={form.assessmentType} onChange={e => setF('assessmentType', e.target.value)}>
            <GroupedAssessmentTypeOptions types={assessmentTypes} />
          </select>
        </div>
        <div className="sv-field">
          <label>Term</label>
          <select value={form.term} onChange={e => setF('term', e.target.value)}>
            {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
          </select>
        </div>
        <div className="sv-field">
          <label>Year</label>
          <input
            type="number"
            value={form.year}
            onChange={e => setF('year', e.target.value)}
            onBlur={e => setF('year', clampInt(e.target.value, 2020, 2099, new Date().getFullYear()))}
          />
        </div>
      </div>

      <div className="sv-field" style={{ marginBottom: 'var(--sv-s3)' }}>
        <label>Curriculum / syllabus</label>
        <select value={framework} onChange={e => changeFramework(e.target.value)}>
          {CURRICULUM_FRAMEWORKS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: 'var(--sv-muted)', marginTop: 4 }}>
          The subject list and syllabus topics follow the chosen curriculum for this grade.
        </div>
      </div>

      <div className="sv-field-grid two">
        <div className="sv-field">
          <label>Subject <span className="sv-req">*</span></label>
          <select value={form.subject} onChange={e => setF('subject', e.target.value)}
            disabled={subjectsLoading || noSubjects}>
            {subjectsLoading && <option value={form.subject}>Loading subjects…</option>}
            {noSubjects && <option value="">No subjects in this syllabus</option>}
            {subjectChoices.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {noSubjects && (
            <div style={{ fontSize: 11, color: 'var(--sv-muted)', marginTop: 4 }}>
              This grade has no subjects in the chosen syllabus yet.
            </div>
          )}
        </div>
        <div className="sv-field">
          <label>Paper name <small style={{ color: 'var(--sv-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</small></label>
          <select value={form.paperName} onChange={e => setF('paperName', e.target.value)}>
            <option value="">— None —</option>
            <option>Paper 1</option>
            <option>Paper 2</option>
            <option>Special Paper 1</option>
            <option>Special Paper 2</option>
            <option>Practical Paper</option>
            <option>Revision Paper</option>
          </select>
        </div>
      </div>

      <div className="sv-field-grid two" style={{ marginTop: 'var(--sv-s3)' }}>
        <div className="sv-field">
          <label>Duration (minutes)</label>
          <input
            type="number"
            value={form.duration}
            onChange={e => setF('duration', e.target.value)}
            onBlur={e => setF('duration', clampInt(e.target.value, 5, 600, 60))}
          />
        </div>
        <div className="sv-field">
          <label>Date (optional)</label>
          <input
            type="date"
            value={form.assessmentDate}
            onChange={e => setF('assessmentDate', e.target.value)}
          />
        </div>
      </div>

      <div style={{ marginTop: 'var(--sv-s4)' }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 'var(--sv-s2)' }}>
          Learner info fields (printed on paper)
        </label>
        <div className="sv-toggle-list">
          <Toggle icon="name" label="NAME field"        on={form.showNameField}  onChange={v => setF('showNameField', v)} />
          <Toggle icon="date" label="DATE field"        on={form.showDateField}  onChange={v => setF('showDateField', v)} />
          <Toggle icon="marks" label="TOTAL MARKS field" on={form.showMarksField} onChange={v => setF('showMarksField', v)} />
          <Toggle icon="classField" label="CLASS field"       on={form.showClassField} onChange={v => setF('showClassField', v)} />
        </div>
      </div>

      <div style={{ marginTop: 'var(--sv-s4)' }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 'var(--sv-s2)' }}>
          Multiple-choice options (all MCQs)
        </label>
        <SegControl
          label="Layout"
          value={form.mcqOptionLayout}
          onChange={v => setF('mcqOptionLayout', v)}
          options={[
            { value: 'vertical', label: <><Icon name="layoutRows" size={13} /> Vertical</> },
            { value: 'horizontal', label: <><Icon name="layoutColumns" size={13} /> Horizontal</> },
          ]}
        />
        {/* §3. The three counts a Zambian paper actually uses. Two is absent —
            a two-choice "multiple choice" question is a true/false question,
            which the studio has as its own type with its own marking. Papers
            saved with two still render; they just cannot be chosen here. */}
        <SegControl
          label="Number of answer choices"
          value={resolveChoiceCount({ paper: form })}
          onChange={v => setF('mcqAnswerChoiceCount', v)}
          options={CHOICE_COUNT_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
        />
        <p style={{ fontSize: 11, color: 'var(--sv-muted)', margin: '4px 0 0' }}>
          {recommendedChoiceCount(form.grade) === 4
            ? 'A–D is recommended from Grade 4 up. A section can override this, and your choice is never changed for you.'
            : 'A–C is recommended below Grade 4 — five options is a reading test. A section can override this.'}
        </p>
        <label className="sv-inline-check" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={Boolean(form.allowPerQuestionChoiceCount)}
            onChange={e => setF('allowPerQuestionChoiceCount', e.target.checked)}
          />
          <span>
            Let individual questions override this
            <small style={{ display: 'block', color: 'var(--sv-muted)' }}>
              Off by default: a stray setting on one imported question should not
              quietly give it a different shape from the rest of its section.
            </small>
          </span>
        </label>
      </div>

      {/* §2/§9. The sheet itself, and how the paper words the things that
          identify it. Everything here resolves through the shared layout
          tokens, so the preview, the print window, the PDF and Word all draw
          the same page — there is no second place a renderer decides this. */}
      <div style={{ marginTop: 'var(--sv-s4)' }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 'var(--sv-s2)' }}>
          Page setup
        </label>
        <div className="sv-row-2">
          <div className="sv-field">
            <label>Paper size</label>
            <select value={form.pageSize || 'a4'} onChange={e => setF('pageSize', e.target.value)}>
              {Object.values(PAGE_SIZES).map(size => (
                <option key={size.id} value={size.id}>{size.label} · {size.width} × {size.height} mm</option>
              ))}
            </select>
          </div>
          <div className="sv-field">
            <label>Orientation</label>
            <select value={form.orientation || 'portrait'} onChange={e => setF('orientation', e.target.value)}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>
        </div>
        <div className="sv-row-2">
          <div className="sv-field">
            <label>Margins</label>
            <select value={form.margins || 'normal'} onChange={e => setF('margins', e.target.value)}>
              {Object.values(MARGIN_PRESETS).map(preset => (
                <option key={preset.id} value={preset.id}>{preset.label} · {preset.top} mm</option>
              ))}
            </select>
          </div>
          <div className="sv-field">
            <label>Grade in the title</label>
            <select value={form.gradeNumberStyle || 'numeral'} onChange={e => setF('gradeNumberStyle', e.target.value)}>
              {GRADE_NUMBER_STYLES.map(style => (
                <option key={style.id} value={style.id}>{style.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="sv-row-2">
          <div className="sv-field">
            <label>Name field label</label>
            <select value={form.nameFieldStyle || 'name'} onChange={e => setF('nameFieldStyle', e.target.value)}>
              {LEARNER_NAME_LABELS.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          {form.nameFieldStyle === 'custom' && (
            <div className="sv-field">
              <label>Your label</label>
              <input
                value={form.nameFieldLabel || ''}
                onChange={e => setF('nameFieldLabel', e.target.value)}
                maxLength={40}
                placeholder="e.g. Examinee"
              />
            </div>
          )}
        </div>
        <label className="sv-inline-check" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={form.showQuestionMarks !== false}
            onChange={e => setF('showQuestionMarks', e.target.checked)}
          />
          <span>Show marks beside every question</span>
        </label>
      </div>

      <div className="sv-title-preview-card">
        <div className="sv-auto-label"><Icon name="more" size={13} /> Auto-generated header</div>
        <div className="sv-school">{(form.schoolName || 'YOUR SCHOOL NAME').toUpperCase()}</div>
        {/* The header title, which omits the subject — the printed paper puts the
            subject on its own line, right below, exactly as previewed here. The
            paper's LIBRARY name is a different (subject-bearing) string, shown
            under the card so the teacher knows what to look for in their library. */}
        <div className="sv-title-auto">{buildHeaderTitleFromForm(form)}</div>
        {form.subject && <div className="sv-subject-auto">{form.subject.toUpperCase()}</div>}
        {form.paperName && <div className="sv-paper-auto">{form.paperName.toUpperCase()}</div>}
      </div>
      <div className="sv-import-row-hint" style={{ display: 'block', marginTop: 6 }}>
        Saved in your library as <strong>{(form.title || '').trim() || buildTitleFromForm(form)}</strong>
      </div>

      <div className="sv-import-row">
        <span className="sv-import-row-hint">
          Have an existing paper? Scan it page by page, or import a Word, PDF, or pictures.
        </span>
        <button
          className="sv-btn sv-btn-primary sv-btn-sm sv-import-row-scan"
          onClick={onScan}
          disabled={importing}
        >
          <Icon name="camera" size={14} /> Scan full test paper
        </button>
        <button
          className="sv-btn sv-btn-outline sv-btn-sm"
          onClick={() => docInputRef.current?.click()}
          disabled={importing}
        >
          <Icon name={importing ? 'spinner' : 'import'} size={14} spin={importing} /> {importing ? 'Importing…' : 'Import .doc / .pdf / pictures'}
        </button>
        <input
          ref={docInputRef}
          type="file"
          accept={QUIZ_DOCUMENT_ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            const files = Array.from(e.target.files || []).filter(Boolean)
            if (files.length) onImportDocument(files.length === 1 ? files[0] : files, { preserveNumbering, groupComprehension, diagramHandling })
            e.target.value = ''
          }}
        />
        <div style={{ flexBasis: '100%', display: 'flex', gap: 'var(--sv-s3)', flexWrap: 'wrap', marginTop: 'var(--sv-s2)' }}>
          <label style={{ fontSize: 12, color: 'var(--sv-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={preserveNumbering} disabled={importing} onChange={e => setPreserveNumbering(e.target.checked)} />
            Preserve original numbering
          </label>
          <label style={{ fontSize: 12, color: 'var(--sv-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={groupComprehension} disabled={importing} onChange={e => setGroupComprehension(e.target.checked)} />
            Group comprehension under passage
          </label>
        </div>
        <div style={{ flexBasis: '100%', marginTop: 'var(--sv-s2)' }}>
          <label htmlFor="sv-diagram-handling" style={{ fontSize: 12, fontWeight: 700, color: 'var(--sv-muted)', display: 'block', marginBottom: 4 }}>
            How should diagrams be handled?
          </label>
          <select
            id="sv-diagram-handling"
            value={diagramHandling}
            disabled={importing}
            onChange={e => setDiagramHandling(e.target.value)}
            style={{ width: '100%', maxWidth: 460, fontSize: 13, padding: '6px 8px', borderRadius: 'var(--sv-r)', border: '1px solid var(--sv-border)' }}
          >
            <option value="keep">Keep diagrams and place them in the correct questions</option>
            <option value="clean">Clean diagrams before adding them</option>
            <option value="text">Leave out diagrams and use text only</option>
            <option value="ask">Ask me for each diagram</option>
          </select>
          <div style={{ fontSize: 11, color: 'var(--sv-muted)', marginTop: 4 }}>
            {diagramHandling === 'text'
              ? '⚠️ Diagrams will be left out — only use this for text-only papers.'
              : diagramHandling === 'clean'
                ? 'Each figure is cropped and cleaned to sharp black-and-white before it is placed under its question.'
                : diagramHandling === 'ask'
                  ? 'Each figure is attached and flagged so you can decide after import.'
                  : 'Recommended. Each figure is cropped from the page and kept under its question.'}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Toggle({ label, icon, on, onChange }) {
  return (
    <div className="sv-tg-row">
      <div className="sv-lbl">{icon ? <Icon name={icon} size={14} /> : null} {label}</div>
      <button
        className={`sv-tg ${on ? 'on' : ''}`}
        onClick={() => onChange(!on)}
        aria-pressed={on}
        aria-label={label}
      />
    </div>
  )
}

// Small segmented button group used for the paper-level MCQ layout / choice
// count pickers. Compares with == so it works for both string and number
// option values.
export function SegControl({ label, value, onChange, options }) {
  return (
    <div className="sv-seg-row">
      <div className="sv-lbl">{label}</div>
      <div className="sv-seg" role="group" aria-label={label}>
        {options.map(opt => (
          <button
            key={String(opt.value)}
            type="button"
            className={`sv-seg-btn ${value === opt.value ? 'on' : ''}`}
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ==================================================================
 * INSTRUCTIONS BLOCK
 * ================================================================== */
export function InstructionsBlock({ form, setF }) {
  const appendPreset = (text) => {
    const current = (form.coverInstructions || '').trim()
    setF('coverInstructions', current ? `${current}\n${text}` : text)
  }
  // A preset already sitting in the box shouldn't be appended again — clicking
  // it twice used to silently duplicate the line. We mark it "added" instead,
  // so the quick-add pills stay a one-tap, no-surprise affordance.
  const presentLines = new Set(
    (form.coverInstructions || '').split('\n').map(l => l.trim()).filter(Boolean),
  )
  return (
    <div className="sv-block b-instr">
      <div className="sv-block-head">
        <span className="sv-ic"><Icon name="instructions" size={15} /></span> General Instructions
      </div>
      <div className="sv-field">
        <textarea
          value={form.coverInstructions}
          onChange={e => setF('coverInstructions', e.target.value)}
          placeholder="Answer all the questions.
Choose and circle the correct answer from the given options A, B, C, and D."
          rows={4}
        />
      </div>
      <div className="sv-preset-row">
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-muted)', alignSelf: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Quick add
        </span>
        {INSTRUCTION_PRESETS.map(preset => {
          const added = presentLines.has(preset)
          return (
            <button
              key={preset}
              className="sv-preset-pill"
              onClick={() => { if (!added) appendPreset(preset) }}
              disabled={added}
              aria-pressed={added}
              title={added ? 'Already in the instructions' : 'Add this line to the instructions'}
              type="button"
              style={added ? { opacity: 0.55, cursor: 'default' } : undefined}
            >
              <Icon name={added ? 'check' : 'add'} size={13} /> {preset}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ==================================================================
 * SECTION BLOCK (renders either passage or standalone)
 * ================================================================== */
export function SectionBlock(props) {
  const {
    section, sectionIndex, parts, questionNumbers, questionIssues, paperMeta,
    onEditQuestion, onMoveSection, onRemoveSection, onDuplicateSection, onSaveToBank,
    onToggleLock, onRewriteQuestion, rewritingKey,
    onUpdateStandaloneQuestion, onUploadStandaloneImage, onRemoveStandaloneImage,
    onUploadStandaloneOptionImage, onRemoveStandaloneOptionImage,
    onUpdateSection, onUploadPassageImage, onRemovePassageImage,
    onUpdatePassageQuestion, onAddPassageQuestion, onRemovePassageQuestion,
    onAssignSectionToPart,
  } = props

  if (section.kind === 'pagebreak') {
    return (
      <PagebreakBlock
        sectionIndex={sectionIndex}
        onMoveSection={onMoveSection}
        onRemoveSection={onRemoveSection}
      />
    )
  }
  if (section.kind === 'passage') {
    return (
      <PassageBlock
        section={section}
        sectionIndex={sectionIndex}
        parts={parts}
        questionNumbers={questionNumbers}
        questionIssues={questionIssues}
        paperMeta={paperMeta}
        onEditQuestion={onEditQuestion}
        onMoveSection={onMoveSection}
        onRemoveSection={onRemoveSection}
        onUpdateSection={onUpdateSection}
        onUploadPassageImage={onUploadPassageImage}
        onRemovePassageImage={onRemovePassageImage}
        onUpdatePassageQuestion={onUpdatePassageQuestion}
        onAddPassageQuestion={onAddPassageQuestion}
        onRemovePassageQuestion={onRemovePassageQuestion}
        onAssignSectionToPart={onAssignSectionToPart}
      />
    )
  }
  return (
    <QuestionBlock
      section={section}
      sectionIndex={sectionIndex}
      parts={parts}
      questionNumbers={questionNumbers}
      questionIssues={questionIssues}
      paperMeta={paperMeta}
      onEditQuestion={onEditQuestion}
      onMoveSection={onMoveSection}
      onRemoveSection={onRemoveSection}
      onDuplicateSection={onDuplicateSection}
      onSaveToBank={onSaveToBank}
      onToggleLock={onToggleLock}
      onRewriteQuestion={onRewriteQuestion}
      rewriting={rewritingKey === section.question?.localId}
      onUpdateQuestion={(field, value) => onUpdateStandaloneQuestion(sectionIndex, field, value)}
      onUploadImage={file => onUploadStandaloneImage(sectionIndex, file)}
      onRemoveImage={() => onRemoveStandaloneImage(sectionIndex)}
      onUploadOptionImage={(optIndex, file) => onUploadStandaloneOptionImage(sectionIndex, optIndex, file)}
      onRemoveOptionImage={optIndex => onRemoveStandaloneOptionImage(sectionIndex, optIndex)}
      onAssignSectionToPart={onAssignSectionToPart}
    />
  )
}

export function PassageBlock({ section, sectionIndex, parts, questionNumbers, questionIssues, paperMeta, onEditQuestion, onMoveSection, onRemoveSection, onUpdateSection, onUploadPassageImage, onRemovePassageImage, onUpdatePassageQuestion, onAddPassageQuestion, onRemovePassageQuestion, onAssignSectionToPart }) {
  const passage = section.passage
  const kind = passage.passageKind || 'comprehension'
  const isMap = kind === 'map'
  const isDiagram = kind === 'diagram'
  const isSource = kind === 'source'
  // Diagram / map stimuli lead with an image and hide the long passage body.
  const isImageLed = isMap || isDiagram
  // Any stimulus kind (vs a plain reading comprehension) — used for labels.
  const passageText = toEditableText(passage.passageText)
  const wordCount = plainTextWordCount(passage.passageText)
  const fileInputRef = useRef(null)

  const PASSAGE_KIND_META = {
    comprehension: { icon: 'comprehension', label: 'Comprehension Passage' },
    map: { icon: 'map', label: 'Map Question' },
    diagram: { icon: 'science', label: 'Diagram-Based Question' },
    source: { icon: 'source', label: 'Source-Based Question' },
  }
  const meta = PASSAGE_KIND_META[kind] || PASSAGE_KIND_META.comprehension

  // Auto-total the sub-question marks; a teacher can pin an explicit total.
  const autoMarks = (passage.questions || []).reduce((sum, q) => sum + (Number(q.marks) || 0), 0)
  const manualMarks = passage.manualMarks
  const totalMarks = Number.isFinite(Number(manualMarks)) && manualMarks != null ? Number(manualMarks) : autoMarks

  function setKind(nextKind) {
    onUpdateSection(sectionIndex, s => ({
      ...s,
      passage: { ...s.passage, passageKind: nextKind },
    }))
  }

  function setManualMarks(value) {
    onUpdateSection(sectionIndex, s => ({
      ...s,
      passage: { ...s.passage, manualMarks: value },
    }))
  }

  // Switch a sub-question between MCQ and short answer in place. Picking the
  // wrong type used to mean delete-and-re-add; this resets only the answer
  // fields that don't carry over so the switch is deliberate, not destructive.
  function setQuestionType(qIndex, nextType) {
    onUpdateSection(sectionIndex, s => ({
      ...s,
      passage: {
        ...s.passage,
        questions: s.passage.questions.map((q, i) => {
          if (i !== qIndex) return q
          if (nextType === 'mcq') {
            return {
              ...q,
              type: 'mcq',
              options: Array.isArray(q.options) && q.options.length ? q.options : ['', '', '', ''],
              correctAnswer: Number.isInteger(q.correctAnswer) ? q.correctAnswer : 0,
            }
          }
          return { ...q, type: 'short_answer', correctAnswer: typeof q.correctAnswer === 'string' ? q.correctAnswer : '' }
        }),
      },
    }))
  }

  // Blocking issues on the passage itself (no passage text, no map image, no
  // linked questions) AND on any of its sub-questions — a comprehension section
  // is only finished when everything under it is. Same source as the export
  // gate and the Save check, so the three never disagree.
  const passageBlockers = [
    ...(questionIssues?.get?.(passage.localId) || []),
    ...(passage.questions || []).flatMap(q => questionIssues?.get?.(q.localId) || []),
  ]

  return (
    <>
      <div className={`sv-block b-passage${isImageLed ? ' b-passage-map' : ''}${passageBlockers.length ? ' is-incomplete' : ''}`}>
        <div className="sv-block-head">
          <span className="sv-ic"><Icon name={meta.icon} size={15} /></span> {meta.label}
          {passageBlockers.length > 0 && (
            <span className="sv-q-incomplete-tag" title={passageBlockers.join(' ')}>
              <Icon name="warn" size={12} /> Not finished
            </span>
          )}
          <select
            value={kind}
            onChange={e => setKind(e.target.value)}
            style={{ marginLeft: 'var(--sv-s2)', background: 'var(--sv-tinted)', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '2px 6px', fontSize: 11.5 }}
            title="Choose the stimulus type — the instruction prints first, then the diagram/source, then the questions"
          >
            <option value="comprehension">Comprehension</option>
            <option value="diagram">Diagram-based</option>
            <option value="source">Source-based</option>
            <option value="map">Map</option>
          </select>
          <span className="sv-paper-passage-total" style={{ marginLeft: 'auto', marginRight: 8, fontSize: 11.5, color: 'var(--sv-muted)' }} title="Auto-summed from the sub-questions below">
            Total: {totalMarks} mark{totalMarks === 1 ? '' : 's'}
          </span>
          <span className="sv-tools">
            <button className="sv-tool" title="Move up" onClick={() => onMoveSection(sectionIndex, -1)}><Icon name="moveUp" size={14} /></button>
            <button className="sv-tool" title="Move down" onClick={() => onMoveSection(sectionIndex, 1)}><Icon name="moveDown" size={14} /></button>
            <button className="sv-tool danger" title="Delete passage" onClick={() => onRemoveSection(sectionIndex)}><Icon name="delete" size={14} /></button>
          </span>
        </div>
        <div className="sv-passage-content">
          <div className="sv-passage-title">
            <input
              value={passage.title || ''}
              onChange={e => onUpdateSection(sectionIndex, s => ({ ...s, passage: { ...s.passage, title: e.target.value } }))}
              placeholder={
                isImageLed || isSource
                  ? 'Instruction / stem (e.g. "Study the diagram below and answer the questions that follow.")'
                  : 'Passage title'
              }
            />
            {!isImageLed && !isSource && <span className="sv-pword-count">~{wordCount} words</span>}
          </div>

          {/* Image upload area — required for Map kind, optional for comprehension. */}
          {(isImageLed || isSource || passage.imageUrl) && (
            <div style={{ margin: '8px 0' }}>
              {passage.imageUrl ? (
                <div className="sv-q-media filled filled-wrap" style={{ minHeight: 'auto' }}>
                  <img src={passage.imageUrl} alt="" />
                  <button
                    className="sv-media-remove"
                    onClick={() => onRemovePassageImage(sectionIndex)}
                    title="Remove image"
                    type="button"
                  >×</button>
                </div>
              ) : passage.imageUploading ? (
                <div className="sv-q-media"><div className="sv-ic"><Icon name="spinner" size={24} spin /></div><div>Uploading image…</div></div>
              ) : (
                <button
                  type="button"
                  className="sv-q-media"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="sv-ic"><Icon name={isMap ? 'map' : isDiagram ? 'science' : 'diagrams'} size={24} /></div>
                  <div>{isMap ? 'Upload the map image' : isDiagram ? 'Upload the diagram / figure' : 'Upload an image / table / chart (optional)'}</div>
                  <small>JPG, PNG or WEBP · up to 15 MB</small>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (file && onUploadPassageImage) onUploadPassageImage(sectionIndex, file)
                      e.target.value = ''
                    }}
                  />
                </button>
              )}
              {passage.imageUrl && (
                <div className="sv-field" style={{ marginTop: 6 }}>
                  <label>Image description (alt text)</label>
                  <input
                    type="text"
                    value={passage.imageAlt || ''}
                    onChange={e => onUpdateSection(sectionIndex, s => ({ ...s, passage: { ...s.passage, imageAlt: e.target.value } }))}
                    placeholder="Describe the map / illustration for screen readers"
                  />
                </div>
              )}
            </div>
          )}

          {/* Comprehension + source passages carry a text body; image-led
              (diagram / map) stimuli just need the image + optional caption,
              so we hide the long-text textarea entirely there. */}
          {!isImageLed && (
            <textarea
              className="sv-passage-text"
              value={passageText}
              onChange={e => onUpdateSection(sectionIndex, s => ({ ...s, passage: { ...s.passage, passageText: e.target.value } }))}
              placeholder={isSource ? 'Paste or type the source text here (passage extract, table caption, data…).' : 'Paste or type the passage text here.'}
              rows={6}
            />
          )}
          {isImageLed && (
            <input
              value={passageText}
              onChange={e => onUpdateSection(sectionIndex, s => ({ ...s, passage: { ...s.passage, passageText: e.target.value } }))}
              placeholder="Optional caption / instructions (e.g. 'Use the map above to answer the questions below.')"
              style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '6px 8px', fontSize: 13, marginTop: 4 }}
            />
          )}
        </div>

        <div style={{ marginTop: 'var(--sv-s3)', display: 'flex', alignItems: 'center', gap: 'var(--sv-s2)', fontSize: 12.5, color: 'var(--sv-muted)', flexWrap: 'wrap' }}>
          <span title="Total marks for this stimulus question">Total marks:</span>
          <strong style={{ color: 'var(--sv-text)' }}>{totalMarks}</strong>
          <span style={{ opacity: 0.8 }}>
            {manualMarks != null ? '(manually set)' : `(auto-summed from ${(passage.questions || []).length} sub-question${(passage.questions || []).length === 1 ? '' : 's'})`}
          </span>
          <input
            type="number"
            min="0"
            value={manualMarks ?? ''}
            placeholder="auto"
            onChange={e => setManualMarks(e.target.value === '' ? null : clampInt(e.target.value, 0, 999, 0))}
            title="Override the total marks (leave blank to auto-sum)"
            style={{ width: 64, padding: '2px 6px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', fontSize: 12.5 }}
          />
          {manualMarks != null && (
            <button className="sv-tool" type="button" title="Reset to auto" onClick={() => setManualMarks(null)}><Icon name="reset" size={13} /> auto</button>
          )}
        </div>

        {parts.length > 0 && (
          <div style={{ marginTop: 'var(--sv-s3)', display: 'flex', alignItems: 'center', gap: 'var(--sv-s2)', fontSize: 12.5, color: 'var(--sv-muted)' }}>
            <span>Belongs to:</span>
            <select
              value={section.partId || ''}
              onChange={e => onAssignSectionToPart(section.id, e.target.value)}
              style={{ padding: '4px 8px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'var(--sv-tinted)', fontSize: 12.5 }}
            >
              <option value="">— No section —</option>
              {parts.map(p => <option key={p.id} value={p.id}>{p.title || 'Untitled section'}</option>)}
            </select>
          </div>
        )}
      </div>

      {passage.questions.map((question, qIndex) => (
        <div key={question.localId || qIndex} className="sv-block b-question nested" style={{ marginLeft: 'calc(var(--sv-s4) * 2)' }}>
          <div className="sv-block-head">
            <span className="sv-ic"><Icon name="shortAnswer" size={15} /></span> Passage Question
            <span className="sv-tools">
              <button className="sv-tool" title="Edit in detail" onClick={() => onEditQuestion(question.localId)}><Icon name="edit" size={14} /></button>
              <button className="sv-tool danger" title="Delete question" onClick={() => onRemovePassageQuestion(sectionIndex, qIndex)}><Icon name="delete" size={14} /></button>
            </span>
          </div>
          <div className="sv-q-card-top">
            <div className="sv-q-num">{questionNumbers[question.localId] || qIndex + 1}.</div>
            <select
              value={question.type === 'mcq' || !question.type ? 'mcq' : question.type === 'short_answer' ? 'short_answer' : typeSelectValue(question.type)}
              onChange={e => {
                // Only mcq and short_answer can be set inline; other types
                // must be changed via "Edit in detail" (EditorSlide supports all 8).
                if (e.target.value === 'mcq' || e.target.value === 'short_answer') {
                  setQuestionType(qIndex, e.target.value)
                }
              }}
              title="Switch between multiple choice and short answer; for other types use 'Edit in detail'"
              style={{ background: 'var(--sv-tinted)', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '3px 8px', fontSize: 11.5 }}
            >
              <option value="mcq">Multiple choice</option>
              <option value="short_answer">Short answer</option>
              {question.type && question.type !== 'mcq' && question.type !== 'short_answer' && (
                // Show the real type as a disabled option so the select displays
                // the truth instead of silently coercing to short_answer. The
                // teacher can change it via "Edit in detail".
                <option
                  value={typeSelectValue(question.type)}
                  disabled
                >
                  {(STUDIO_QUESTION_TYPE_OPTIONS.find(o => o.value === typeSelectValue(question.type))?.label || question.type)} — edit via &quot;Edit in detail&quot;
                </option>
              )}
            </select>
            <label className="sv-q-marks-input">
              marks
              <input
                type="number"
                value={question.marks ?? 1}
                onChange={e => onUpdatePassageQuestion(sectionIndex, qIndex, 'marks', clampInt(e.target.value, 1, 100, 1))}
              />
            </label>
          </div>
          <CardQuestionText
            value={question.text}
            onChange={v => onUpdatePassageQuestion(sectionIndex, qIndex, 'text', v)}
            onEditDetail={() => onEditQuestion(question.localId)}
          />

          {(question.type === 'mcq' || !question.type) ? (
            <McqOptions
              question={question}
              maxOptions={typeof paperMeta?.mcqAnswerChoiceCount === 'number' ? paperMeta.mcqAnswerChoiceCount : undefined}
              onChangeOption={(optIndex, value) => {
                const next = [...(question.options || ['', '', '', ''])]
                next[optIndex] = value
                onUpdatePassageQuestion(sectionIndex, qIndex, 'options', next)
              }}
              onSelectCorrect={(optIndex) => onUpdatePassageQuestion(sectionIndex, qIndex, 'correctAnswer', optIndex)}
            />
          ) : (
            <>
              <ShortAnswerInputs
                correctAnswer={question.correctAnswer}
                onChange={value => onUpdatePassageQuestion(sectionIndex, qIndex, 'correctAnswer', value)}
              />
              <AnswerSpaceControl
                question={question}
                onUpdate={(field, value) => onUpdatePassageQuestion(sectionIndex, qIndex, field, value)}
              />
            </>
          )}
        </div>
      ))}

      <div style={{ marginLeft: 'calc(var(--sv-s4) * 2)', marginBottom: 'var(--sv-s3)' }}>
        <button
          className="sv-btn sv-btn-outline sv-btn-sm"
          onClick={() => onAddPassageQuestion(sectionIndex, 'mcq')}
        >
          + Add MCQ to passage
        </button>
        <button
          className="sv-btn sv-btn-outline sv-btn-sm"
          onClick={() => onAddPassageQuestion(sectionIndex, 'short_answer')}
          style={{ marginLeft: 6 }}
        >
          + Add short answer
        </button>
      </div>
    </>
  )
}

// Page break marker in the builder. Has no editable content — just a
// visible "PAGE BREAK" divider that the teacher can reorder or delete.
// The actual page-break behaviour lives in the PDF/DOCX exporters.
export function PagebreakBlock({ sectionIndex, onMoveSection, onRemoveSection }) {
  return (
    <div className="sv-block b-pagebreak" style={{ background: '#f8fafc', border: '1px dashed #94a3b8', borderRadius: 6 }}>
      <div className="sv-block-head" style={{ color: 'var(--zt-text-muted)' }}>
        <span className="sv-ic"><Icon name="pagebreak" size={15} /></span> Page break
        <span className="sv-tools">
          <button className="sv-tool" title="Move up" onClick={() => onMoveSection(sectionIndex, -1)}><Icon name="moveUp" size={14} /></button>
          <button className="sv-tool" title="Move down" onClick={() => onMoveSection(sectionIndex, 1)}><Icon name="moveDown" size={14} /></button>
          <button className="sv-tool danger" title="Delete" onClick={() => onRemoveSection(sectionIndex)}><Icon name="delete" size={14} /></button>
        </span>
      </div>
      <div style={{ textAlign: 'center', color: 'var(--zt-text-muted)', fontSize: 11, padding: '4px 0 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
        — Forces a new page when printed / exported —
      </div>
    </div>
  )
}

/* ==================================================================
 * FOOTER BLOCK
 * ================================================================== */
export function FooterBlock({ form, setF, footerCode }) {
  return (
    <div className="sv-block b-footer">
      <div className="sv-block-head">
        <span className="sv-ic"><Icon name="footer" size={15} /></span> Paper Footer
      </div>
      <div className="sv-field-grid two">
        <div className="sv-field">
          <label>Footer code (auto-generated)</label>
          <input type="text" value={footerCode} readOnly style={{ background: 'var(--sv-canvas-2)', color: 'var(--sv-muted)' }} />
        </div>
        <div className="sv-field">
          <label>End-of-paper text</label>
          <input
            type="text"
            value={form.endOfPaperText}
            onChange={e => setF('endOfPaperText', e.target.value)}
            placeholder="— END OF PAPER —"
          />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------
 * Local helper used by PassageBlock
 * ------------------------------------------------------------------ */
function plainTextWordCount(value) {
  const text = toEditableText(value)
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}
