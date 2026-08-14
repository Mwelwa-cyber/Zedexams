// Assessment Studio — slide-overs and the paper render view. Extracted from
// AssessmentStudio.jsx to keep that module focused on orchestration.
//
// PaperRenderView (preview + marking key + export bar), the BlockPicker / AI /
// Editor slide-overs, and their private helpers (BlockPickerItem,
// AiTopicModeToggle, DiagramGeneratorAction). Props-in; they render inside the
// parent's `.studio-v2` CSS scope and reach the extracted analysis widgets
// and question-type editors via sibling imports.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { parsePastedQuestions } from '../lib/pasteQuestionParser.js'
import RichEditor from '../../../editor/components/RichEditor.jsx'
import { clampInt } from '../../../utils/inputs.js'
import AiGenerationProgress from '../../../shared/components/AiGenerationProgress'
import {
  useSyllabusTopicOptions, useStudioSubjectChoices, useSyllabusLevelOptions,
  normalizeStudioFramework,
} from '../../../components/teacher/syllabusTopicOptions'
import { QUIZ_DOCUMENT_ACCEPT } from '../../../services/quizImport/documentQuizImporter'
import PaperPagesPreview from './views/PaperPagesPreview'
import { isBodyBlock } from '../../../utils/assessmentDocument'
import { DEFAULT_PAPER_LAYOUT } from '../../../config/paperLayoutTokens'
import Icon from './studioIcons'
import { bloomLevel, BLOOM_LABELS, BLOOM_LEVELS } from '../lib/assessmentBloom'
import { paperGradeLabel } from '../../../components/teacher/paperTaxonomy'
import {
  BalanceDifficultyAction,
  BloomBalanceAction,
  MapCompetenciesAction,
  DetectDuplicatesAction,
} from './AssessmentAnalysisActions'
import {
  McqOptions,
  FillBlanksInputs,
  NumericInputs,
  MatchingInputs,
  SequenceInputs,
  DataTableInputs,
} from './AssessmentQuestionEditors'
import { STUDIO_QUESTION_TYPE_OPTIONS, typeSelectValue, patchForTypeChange } from '../lib/assessmentQuestionTypes'
import AiReviewPanel from './AiReviewPanel'
import { CurriculumPicker } from '../../../components/teacher/studio/sections/CurriculumPicker'
import '../../../components/teacher/studio/lessonStudio.css'

/* ==================================================================
 * PAPER RENDER VIEW (preview + marking key)
 *
 * Walks the shared `buildPaperLayout` blocks so the in-studio rendering
 * matches the PDF and DOCX exports pixel-for-pixel. The `mode` prop
 * switches between the printable paper and the marking key.
 * ================================================================== */
export function PaperRenderView({
  mode, blocks, assessment, changeView, onExport, onExportAnswerSheet, onSave, saving,
  exporting, showSave, exportGate, printGate, document: paperDocument = null, pagination = null,
}) {
  const isKey = mode === 'scheme'
  // The document's resolved layout tokens, when the caller passes the canonical
  // document. A caller that has not been migrated yet gets the A4 defaults, so
  // the paginated preview still draws real sheets rather than falling back to
  // the unlimited column it replaced.
  const layout = paperDocument?.layout || DEFAULT_PAPER_LAYOUT
  const bodyPreviewBlocks = blocks.filter(isBodyBlock)
  const footerCode = blocks.find((b) => b.kind === 'footerCode')?.code || ''
  // An unfinished paper prints blank questions, so every download route is held
  // shut until it is complete. The buttons stay visible (a hidden button reads
  // as a broken studio) but are disabled and explain themselves, and the notice
  // below names what to fix. handleExport re-checks the same gate, so this is
  // the signpost rather than the lock.
  const blocked = Boolean(exportGate?.blocked)
  const blockTitle = blocked ? exportGate.message : undefined
  // Print and PDF answer a stricter question than Word: not only "is this paper
  // finished" but "does it come out of a browser correctly". A blank trailing
  // sheet, a question split across a page turn or a table clipped at the right
  // edge is a real defect at the photocopier and is invisible to the base gate.
  //
  // Word is deliberately NOT held to it. Word paginates with its own engine and
  // its own font metrics, so a Chromium-measured layout says nothing about it,
  // and refusing a .docx on that basis would refuse a file that is very likely
  // fine. When `printGate` is absent the two are the same, so a caller that has
  // not wired pagination yet loses nothing.
  const printBlocked = Boolean(printGate ? printGate.blocked : blocked)
  const printTitle = printBlocked ? (printGate?.message || blockTitle) : undefined
  return (
    <section className="sv-view">
      <div className="sv-builder-bar">
        <button className="sv-chip" onClick={() => changeView('builder')}><Icon name="builder" size={14} /> Builder</button>
        <button className={`sv-chip ${!isKey ? 'active' : ''}`} onClick={() => changeView('preview')}><Icon name="preview" size={14} /> Preview</button>
        <button className={`sv-chip ${isKey ? 'active' : ''}`} onClick={() => changeView('marking-key')}><Icon name="key" size={14} /> Marking key</button>
        {/* The teacher's filing copy — a document in its own right, not an
            export of this one, so it gets a place in the rail rather than a
            button buried in the export row. */}
        <button className="sv-chip" onClick={() => changeView('tos')} title="Table of Specifications — the copy for your teacher's file"><Icon name="target" size={14} /> Spec table</button>
        {/* The page size and orientation come from the document rather than a
            hard-coded "A4 · Portrait" — a landscape or A5 paper used to be
            labelled as A4 portrait while printing as neither. */}
        <span className="sv-pages mono">
          <Icon name="pages" size={13} /> {layout.page.label} · {layout.orientation === 'landscape' ? 'Landscape' : 'Portrait'}
        </span>
      </div>

      {isKey && (
        <div className="sv-key-note">
          <Icon name="key" size={14} /> <strong>Marking key</strong> — the answer and any explanation for every question. It&apos;s for you to mark from and is never shown to learners. Set or check answers back in the Builder.
        </div>
      )}

      <div className="sv-preview-shell">
        {/* Real A4 sheets, with the breaks the measurement found in the print
            renderer — not a continuous column that hides every page boundary
            until the teacher is standing at the photocopier (§1). */}
        <PaperPagesPreview
          blocks={bodyPreviewBlocks}
          layout={layout}
          pagination={pagination}
          pageNumbering={paperDocument?.pageNumbering || null}
          footerCode={footerCode}
        />

        {blocked && (
          <div className="sv-export-block" role="status">
            <Icon name="warn" size={15} />
            <span>{exportGate.message}</span>
          </div>
        )}

        {/* Only shown when the paper itself is fine and the LAYOUT is not:
            stacking both notices would tell a teacher to finish question 3 and
            fix a page break that finishing question 3 is about to move. */}
        {!blocked && printBlocked && (
          <div className="sv-export-block" role="status">
            <Icon name="warn" size={15} />
            <span>{printGate.message}</span>
          </div>
        )}

        <div className="sv-export-actions">
          <button className="sv-btn sv-btn-primary" onClick={() => onExport('docx')} disabled={exporting || blocked} title={blockTitle}>
            <Icon name={exporting ? 'spinner' : 'download'} size={15} spin={exporting} /> {exporting ? 'Working…' : (isKey ? 'Download key (Word)' : 'Download Word')}
          </button>
          {!isKey && (
            <button className="sv-btn sv-btn-outline" onClick={() => onExport('pdf')} disabled={exporting || printBlocked} title={printTitle || 'Download a PDF from zedexams.com — cached, so repeat downloads are instant'}>
              <Icon name={exporting ? 'spinner' : 'download'} size={15} spin={exporting} /> Download PDF
            </button>
          )}
          <button className="sv-btn sv-btn-outline" onClick={() => onExport('print')} disabled={printBlocked} title={printTitle || "Use your browser's Print dialog — pick “Save as PDF” there if you need a PDF"}>
            <Icon name="print" size={15} /> Print / Save as PDF
          </button>
          {onExportAnswerSheet && (
            <button
              className="sv-btn sv-btn-outline"
              onClick={() => onExportAnswerSheet('docx')}
              disabled={exporting || blocked}
              title={blockTitle || 'A bubble answer sheet (Word) students fill in instead of writing on the paper'}
            >
              <Icon name="answerSheet" size={15} /> Answer sheet
            </button>
          )}
          {showSave && (
            <button className="sv-btn sv-btn-primary sv-export-save" onClick={onSave} disabled={saving}>
              <Icon name={saving ? 'spinner' : 'save'} size={15} spin={saving} /> {saving ? 'Saving…' : `Save · ${assessment.totalMarks || 0} marks`}
            </button>
          )}
          <button className={`sv-btn sv-btn-outline ${showSave ? '' : 'sv-export-save'}`} onClick={() => changeView('builder')}>
            <Icon name="edit" size={15} /> Edit paper
          </button>
        </div>
      </div>
    </section>
  )
}

/* ==================================================================
 * BLOCK PICKER SLIDE-OVER
 * ================================================================== */
export function BlockPickerSlide({ open, onClose, onPick }) {
  return (
    <aside className={`sv-slideover ${open ? 'open' : ''}`}>
      <div className="sv-slideover-head">
        <button className="sv-icon-btn sv-icon-btn-sm" onClick={onClose} aria-label="Close"><Icon name="remove" size={20} /></button>
        <h3 className="serif">Add a block<small>Drop into the document at the chosen position</small></h3>
      </div>
      <div className="sv-slideover-body">
        <div className="sv-block-cat">Structure</div>
        <div className="sv-block-picker-grid">
          <BlockPickerItem icon="section" title="Section" hint="Container with title & instructions" onClick={() => onPick('section')} />
          <BlockPickerItem icon="pagebreak" title="Page break" hint="Force a new page when printed / exported" onClick={() => onPick('pagebreak')} />
        </div>

        <div className="sv-block-cat">Questions</div>
        <div className="sv-block-picker-grid">
          <BlockPickerItem icon="mcq" title="Multiple Choice" hint="4 options, text" onClick={() => onPick('mcq')} />
          <BlockPickerItem icon="shortAnswer" title="Short Answer" hint="1–3 lines" onClick={() => onPick('short_answer')} />
          <BlockPickerItem icon="structured" title="Structured" hint="Multi-part with marks" onClick={() => onPick('structured')} />
          <BlockPickerItem icon="essay" title="Essay" hint="Long-form with rubric" onClick={() => onPick('essay')} />
          <BlockPickerItem icon="trueFalse" title="True / False" hint="Binary statement" onClick={() => onPick('true_false')} />
          <BlockPickerItem icon="fillBlanks" title="Fill in the Blanks" hint="Instruction + word bank + A/B/C/D statements" onClick={() => onPick('fill_in_blank')} />
          <BlockPickerItem icon="matching" title="Matching" hint="Pair items across two columns" onClick={() => onPick('matching')} />
          <BlockPickerItem icon="numeric" title="Numeric" hint="Number answer with optional ± tolerance & unit" onClick={() => onPick('numeric')} />
          <BlockPickerItem icon="sequence" title="Sequence" hint="Put items in the correct order" onClick={() => onPick('sequence')} />
        </div>

        <div className="sv-block-cat">Stimulus &amp; source</div>
        <div className="sv-block-picker-grid">
          <BlockPickerItem icon="science" title="Diagram-Based Question" hint="Instruction → diagram → follow-up sub-questions" onClick={() => onPick('diagram_stimulus')} />
          <BlockPickerItem icon="source" title="Source-Based Question" hint="Passage / table / map / chart → follow-up sub-questions" onClick={() => onPick('source_stimulus')} />
          <BlockPickerItem icon="labelledDiagram" title="Labelled Diagram" hint="Name labelled parts (P: __, Q: __, R: __)" onClick={() => onPick('labelled_diagram')} />
        </div>

        <div className="sv-block-cat">Media &amp; reading</div>
        <div className="sv-block-picker-grid">
          <BlockPickerItem icon="comprehension" title="Passage" hint="Comprehension passage" onClick={() => onPick('passage')} />
          <BlockPickerItem icon="shape" title="Diagram-based" hint="Label or describe an image" onClick={() => onPick('diagram_image')} />
          <BlockPickerItem icon="drawLabel" title="Draw & Label" hint="Blank canvas for students to draw + label" onClick={() => onPick('draw_label')} />
          <BlockPickerItem icon="map" title="Map Question" hint="Image-based passage with map questions" onClick={() => onPick('map')} />
          <BlockPickerItem icon="table" title="Data / Table" hint="Attach a data table to a question" onClick={() => onPick('data_table')} />
          <BlockPickerItem icon="imageIdentify" title="Image Identify" hint="Numbered hotspots — students name each part" onClick={() => onPick('image_identify')} />
        </div>

        <div className="sv-block-cat">Reusable</div>
        <div className="sv-block-picker-grid">
          <BlockPickerItem
            icon="bank"
            title="From question bank"
            hint="Insert a question you saved earlier"
            onClick={() => onPick('question_bank')}
          />
          <BlockPickerItem
            icon="paste"
            title="Paste questions"
            hint="Numbered list → auto-detect MCQ / short-answer / essay"
            onClick={() => onPick('paste_import')}
          />
        </div>

        <div className="sv-block-cat">AI-powered</div>
        <div className="sv-block-picker-grid">
          <BlockPickerItem
            icon="ai"
            title="Generate questions"
            hint="AI drafts from topic"
            gold
            onClick={() => onPick('ai_generate')}
          />
          <BlockPickerItem icon="diagrams" title="Generate diagram" hint="Describe a figure — AI draws it" gold onClick={() => onPick('generate_diagram')} />
        </div>
      </div>
    </aside>
  )
}

function BlockPickerItem({ icon, title, hint, onClick, disabled, gold }) {
  return (
    <button
      className={`sv-bp-item ${gold ? 'gold' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      type="button"
    >
      <div className="sv-bp-ic"><Icon name={icon} size={20} /></div>
      <strong>{title}</strong>
      <small>{hint}</small>
    </button>
  )
}

/* ==================================================================
 * PASTE IMPORT SLIDE-OVER
 * ================================================================== */
export function PasteImportSlide({ open, onClose, onInsert }) {
  const [text, setText] = useState('')
  const preview = useMemo(() => (text.trim() ? parsePastedQuestions(text) : []), [text])
  const mcqCount = preview.filter(q => q.type === 'mcq').length
  const saCount  = preview.filter(q => q.type === 'short_answer').length
  const essayCount = preview.filter(q => q.type === 'essay').length
  const tfCount  = preview.filter(q => q.type === 'true_false').length

  const handleInsert = useCallback(() => {
    if (!preview.length) return
    onInsert(preview)
    setText('')
  }, [preview, onInsert])

  return (
    <aside className={`sv-slideover ${open ? 'open' : ''}`}>
      <div className="sv-slideover-head">
        <button className="sv-icon-btn sv-icon-btn-sm" onClick={onClose} aria-label="Close">
          <Icon name="remove" size={20} />
        </button>
        <h3 className="serif">
          Paste questions
          <small>Numbered list — MCQ, short-answer, essay auto-detected</small>
        </h3>
      </div>
      <div className="sv-slideover-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="text-xs theme-text-secondary" style={{ lineHeight: 1.5 }}>
          Paste numbered questions below. MCQ: include A) B) C) D) options.
          Add <code>[2]</code> or <code>(3 marks)</code> for marks.
          Optionally add <code>Answer: A</code> after each question.
        </p>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={16}
          placeholder={`1. What is the capital of Zambia? [2]\nA) Lusaka\nB) Ndola\nC) Kitwe\nD) Livingstone\nAnswer: A\n\n2. Explain the water cycle. (5 marks)\nAnswer: Water evaporates…`}
          style={{
            width: '100%', resize: 'vertical', fontFamily: 'monospace',
            fontSize: 12, lineHeight: 1.55, padding: '10px 12px',
            border: '1.5px solid var(--sv-border, #d4cfc8)',
            borderRadius: 10, background: 'var(--sv-surface, #fff)',
            color: 'var(--sv-text, #0e2a32)',
          }}
        />

        {preview.length > 0 && (
          <div style={{
            background: '#f0faf4', border: '1.5px solid #6ee7b7',
            borderRadius: 10, padding: '10px 14px', fontSize: 12,
          }}>
            <strong style={{ color: 'var(--success-fg)' }}>
              {preview.length} question{preview.length !== 1 ? 's' : ''} detected
            </strong>
            <span style={{ color: 'var(--zt-text-muted)', marginLeft: 8 }}>
              {[
                mcqCount  && `${mcqCount} MCQ`,
                saCount   && `${saCount} short-answer`,
                essayCount && `${essayCount} essay`,
                tfCount   && `${tfCount} true/false`,
              ].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}

        {text.trim() && !preview.length && (
          <p className="text-xs" style={{ color: '#b91c1c' }}>
            No questions detected. Make sure each question starts with a number followed by a period or bracket (e.g. <code>1.</code> or <code>1)</code>).
          </p>
        )}

        <button
          className="sv-btn sv-btn-primary"
          onClick={handleInsert}
          disabled={!preview.length}
          style={{ marginTop: 4 }}
        >
          Insert {preview.length > 0 ? preview.length : ''} question{preview.length !== 1 ? 's' : ''}
        </button>
      </div>
    </aside>
  )
}

/* ==================================================================
 * AI ASSISTANT SLIDE-OVER
 * ================================================================== */
const AI_COUNT_PRESETS = [5, 10, 15, 20, 25]

// "From syllabus / Write my own" segmented toggle for the AI slide's topic
// field — lets the teacher pick from the syllabus drop-down or type their own.
function AiTopicModeToggle({ value, onChange, pickDisabled = false }) {
  const baseBtn = {
    border: 'none', background: 'none', fontSize: 11, fontWeight: 700,
    padding: '3px 9px', borderRadius: 999, lineHeight: 1.6, color: 'var(--zt-text-muted)', cursor: 'pointer',
  }
  const onStyle = { background: 'var(--zt-card)', color: 'var(--zt-text)', boxShadow: 'inset 0 0 0 1.5px #d88962' }
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 999, background: '#f1f5f9' }}>
      <button type="button"
        onClick={() => !pickDisabled && onChange('pick')}
        disabled={pickDisabled}
        title={pickDisabled ? 'No syllabus topics on file for this selection yet' : undefined}
        style={{ ...baseBtn, ...(value === 'pick' ? onStyle : null), opacity: pickDisabled ? 0.45 : 1, cursor: pickDisabled ? 'not-allowed' : 'pointer' }}>
        From syllabus
      </button>
      <button type="button"
        onClick={() => onChange('write')}
        style={{ ...baseBtn, ...(value === 'write' ? onStyle : null) }}>
        Write my own
      </button>
    </div>
  )
}

// A scrollable list of tickable options — lets the teacher pick several
// topics / sub-topics at once (mirrors the full-paper modal's CheckboxList).
function CheckboxList({ options, selected, onToggle }) {
  return (
    <div className="sv-cpm-checklist" role="group">
      {options.map((opt) => {
        const checked = selected.includes(opt)
        return (
          // Inline flex + fixed-size box (not just .sv-cpm-checkrow) so the
          // checkbox and label always sit tight together — see the matching
          // CheckboxList in CreatePaperModal.
          <label key={opt} className="sv-cpm-checkrow"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={checked}
              onChange={() => onToggle(opt)}
              style={{
                accentColor: 'var(--sv-primary)',
                width: 16, height: 16, flex: '0 0 auto', margin: '2px 0 0',
              }} />
            <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13, color: 'var(--sv-text)' }}>{opt}</span>
          </label>
        )
      })}
    </div>
  )
}

// Removable chips showing the currently-selected topics / sub-topics.
function SelectedChips({ values, onRemove }) {
  if (!values.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
      {values.map((v) => (
        <span key={v} className="sv-cpm-chip">
          {v}
          <button type="button" aria-label={`Remove ${v}`}
            onClick={() => onRemove(v)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </span>
      ))}
    </div>
  )
}

// Multi-topic + multi-sub-topic picker for the quick-questions generator.
// Same syllabus source + "From syllabus / Write my own" UX as the full
// "Create paper with AI" modal, so a teacher can spread one generation across
// several topics and sub-topics instead of a single topic at a time.
function AiTopicSubtopicPicker({ grade, subject, framework, topics, subtopics, onChangeTopics, onChangeSubtopics }) {
  const { topics: topicOptions, subtopics: subtopicOptions, loading } =
    useSyllabusTopicOptions(grade, subject, topics, framework)
  const [topicMode, setTopicMode] = useState('pick')
  const [subtopicMode, setSubtopicMode] = useState('pick')
  const [topicInput, setTopicInput] = useState('')
  const [subtopicInput, setSubtopicInput] = useState('')

  const topicPickEmpty = !loading && topicOptions.length === 0

  // No syllabus rows for this grade/subject → free text is the only option.
  useEffect(() => {
    if (topicPickEmpty && topicMode === 'pick') setTopicMode('write')
  }, [topicPickEmpty, topicMode])

  // Grade/subject/framework change re-scopes the syllabus page. The parent
  // already clears the selected topics/subtopics on those changes; reset the
  // local mode + typed inputs so a half-typed value can't leak across pages.
  const key = `${grade}|${subject}|${framework}`
  const lastKey = useRef(key)
  useEffect(() => {
    if (lastKey.current === key) return
    lastKey.current = key
    setTopicMode('pick'); setSubtopicMode('pick')
    setTopicInput(''); setSubtopicInput('')
  }, [key])

  function toggleTopic(value) {
    const t = String(value || '').trim()
    if (!t) return
    onChangeTopics(topics.includes(t) ? topics.filter((x) => x !== t) : [...topics, t])
  }
  function addTopicInput() {
    const t = topicInput.trim().slice(0, 80)
    if (!t || topics.includes(t)) { setTopicInput(''); return }
    onChangeTopics([...topics, t])
    setTopicInput('')
  }
  function toggleSubtopic(value) {
    const s = String(value || '').trim()
    if (!s) return
    onChangeSubtopics(subtopics.includes(s) ? subtopics.filter((x) => x !== s) : [...subtopics, s])
  }
  function addSubtopicInput() {
    const s = subtopicInput.trim().slice(0, 80)
    if (!s || subtopics.includes(s)) { setSubtopicInput(''); return }
    onChangeSubtopics([...subtopics, s])
    setSubtopicInput('')
  }

  return (
    <>
      <div className="sv-field" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <label style={{ marginBottom: 0 }}>Topics</label>
          <AiTopicModeToggle
            value={topicMode}
            onChange={(mode) => { if (mode === 'pick') setTopicInput(''); setTopicMode(mode) }}
            pickDisabled={topicPickEmpty}
          />
        </div>
        <SelectedChips values={topics} onRemove={(t) => onChangeTopics(topics.filter((x) => x !== t))} />
        {topicMode === 'pick' ? (
          loading ? (
            <p className="sv-cpm-hint">Loading syllabus topics…</p>
          ) : topicOptions.length === 0 ? (
            <p className="sv-cpm-hint">No syllabus topics on file — switch to “Write my own”.</p>
          ) : (
            <>
              <CheckboxList options={topicOptions} selected={topics} onToggle={toggleTopic} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                {topics.length > 0 && (
                  <button type="button" className="sv-btn" onClick={() => onChangeTopics([])}>Clear</button>
                )}
                <span className="sv-cpm-hint" style={{ margin: 0, marginLeft: 'auto' }}>
                  {topics.length} selected
                </span>
              </div>
            </>
          )
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text" style={{ flex: 1 }} list="ai-slide-topic-options"
              value={topicInput}
              onChange={e => setTopicInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTopicInput() } }}
              placeholder={topicOptions[0] ? `e.g. ${topicOptions[0]}` : `e.g. ${subject === 'Mathematics' ? 'Fractions' : 'Body systems'}`}
            />
            <button type="button" className="sv-btn" onClick={addTopicInput} disabled={!topicInput.trim()}>+ Add</button>
            <datalist id="ai-slide-topic-options">
              {topicOptions.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>
        )}
      </div>

      <div className="sv-field" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <label style={{ marginBottom: 0 }}>Sub-topics (optional)</label>
          <AiTopicModeToggle
            value={subtopicMode}
            onChange={(mode) => { if (mode === 'pick') setSubtopicInput(''); setSubtopicMode(mode) }}
            pickDisabled={subtopicOptions.length === 0}
          />
        </div>
        <SelectedChips values={subtopics} onRemove={(s) => onChangeSubtopics(subtopics.filter((x) => x !== s))} />
        {subtopicMode === 'pick' ? (
          subtopicOptions.length === 0 ? (
            <p className="sv-cpm-hint">Pick a topic first to see its sub-topics.</p>
          ) : (
            <>
              <CheckboxList options={subtopicOptions} selected={subtopics} onToggle={toggleSubtopic} />
              {subtopics.length > 0 && (
                <button type="button" className="sv-btn" style={{ marginTop: 6 }} onClick={() => onChangeSubtopics([])}>Clear</button>
              )}
            </>
          )
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text" style={{ flex: 1 }} list="ai-slide-subtopic-options"
              value={subtopicInput}
              onChange={e => setSubtopicInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtopicInput() } }}
              placeholder="Type a sub-topic"
            />
            <button type="button" className="sv-btn" onClick={addSubtopicInput} disabled={!subtopicInput.trim()}>+ Add</button>
            <datalist id="ai-slide-subtopic-options">
              {subtopicOptions.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
        )}
      </div>
    </>
  )
}

export function AiSlide({ open, onClose, aiForm, setAiForm, form, questions, questionNumbers, generating, onGenerate, review, onConfirmReview, onDiscardReview, onImport, onScan, importing, onGenerateDiagram, generatingDiagram, onOpenDiagramScanner, onOpenMarkingKey, onOpenSpecTable, onCreatePaper, onUpdatePaperMeta, diagramsNeeded = 0, onOpenDiagramFix, onVerifyPaper, drift }) {
  const docInputRef = useRef(null)
  const [customCount, setCustomCount] = useState(false)
  // The paper's curriculum framework drives both pickers below — one choice
  // shared with the header and the full-paper modal, not a slide-local one.
  const framework = normalizeStudioFramework(form.framework)
  // Subjects the syllabus actually carries for this grade + framework — strictly
  // from the Syllabus Studio, no static fallback (the paper's saved subject is
  // kept selectable by the hook).
  const { options: subjectChoices, loading: subjectsLoading } =
    useStudioSubjectChoices(form.grade, framework, form.subject)
  const noSubjects = !subjectsLoading && subjectChoices.length === 0
  // Levels come from the Syllabi Studio for the paper's curriculum — the same
  // curriculum-aware, ordered list the paper header shows (Nursery … Form N),
  // never a flat Grade 1–12. This picker writes straight to the shared paper
  // state, so header + AI assistant can never disagree on the level.
  const { levels: levelOptions, loading: levelsLoading } =
    useSyllabusLevelOptions(framework, form.grade)
  const noLevels = !levelsLoading && levelOptions.length === 0
  // A pending review batch takes over the slide: the generated questions
  // must be accepted or discarded before the tool list distracts from them.
  if (review) {
    return (
      <aside className={`sv-slideover ${open ? 'open' : ''}`}>
        <div className="sv-slideover-head">
          <button className="sv-icon-btn sv-icon-btn-sm" onClick={onClose} aria-label="Close"><Icon name="remove" size={20} /></button>
          <h3 className="serif">
            <Icon name="ai" size={17} /> Review generated questions
            <small>Untick any you don&apos;t want, then add the rest</small>
          </h3>
        </div>
        <div className="sv-slideover-body">
          <AiReviewPanel review={review} onConfirm={onConfirmReview} onDiscard={onDiscardReview} />
        </div>
      </aside>
    )
  }
  return (
    <aside className={`sv-slideover ${open ? 'open' : ''}`}>
      <div className="sv-slideover-head">
        <button className="sv-icon-btn sv-icon-btn-sm" onClick={onClose} aria-label="Close"><Icon name="remove" size={20} /></button>
        <h3 className="serif"><Icon name="ai" size={17} /> Zed AI Assistant<small>Context-aware help for this paper</small></h3>
      </div>
      <div className="sv-slideover-body">
        <button
          className="sv-btn sv-btn-primary sv-btn-full"
          onClick={onCreatePaper}
          style={{ marginBottom: 12 }}
        >
          <Icon name="ai" size={15} /> Create paper with AI
        </button>
        <div className="sv-ai-msg" style={{ marginBottom: 16 }}>
          A full {form.subject} paper for {paperGradeLabel(form.grade)} — pick the topics,
          marks and question types, and it lands here as editable blocks with a
          marking key.
        </div>

        <div className="sv-block-cat">Quick questions</div>
        <div className="sv-ai-msg">
          <strong>Generate questions on CBC topics</strong>
          Pick one or more topics and sub-topics, a count and type — I&apos;ll draft them for you to review, then you choose which ones go into the paper.
        </div>

        <div className="sv-field-grid two" style={{ marginBottom: 12 }}>
          <div className="sv-field">
            <label>Grade / level</label>
            <select
              value={form.grade}
              disabled={levelsLoading || noLevels}
              onChange={e => { onUpdatePaperMeta?.('grade', e.target.value); setAiForm(prev => ({ ...prev, topics: [], subtopics: [], topic: '' })) }}
            >
              {levelsLoading && <option value={form.grade}>Loading education levels…</option>}
              {noLevels && <option value="">No syllabus levels for this curriculum</option>}
              {!levelsLoading && !noLevels && levelOptions.map(lvl => (
                <option key={lvl.value} value={lvl.value}>{lvl.label}</option>
              ))}
            </select>
          </div>
          <div className="sv-field">
            <label>Subject</label>
            <select
              value={noSubjects ? '' : form.subject}
              disabled={subjectsLoading || noSubjects}
              onChange={e => { onUpdatePaperMeta?.('subject', e.target.value); setAiForm(prev => ({ ...prev, topics: [], subtopics: [], topic: '' })) }}
            >
              {subjectsLoading && <option value={form.subject}>Loading subjects…</option>}
              {noSubjects && <option value="">No subjects in this syllabus</option>}
              {subjectChoices.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <p style={{ fontSize: 11, color: 'var(--sv-muted)', margin: '0 0 12px' }}>
          Changing these updates the paper header too — quick questions always match the paper&apos;s grade and subject.
        </p>
        <div style={{ marginBottom: 12 }}>
          <CurriculumPicker
            curriculumMode={framework === '2013' ? 'previous' : 'cbc'}
            onSelect={(mode) => {
              // The framework belongs to the paper (like grade/subject) so the
              // header + full-paper modal follow the same choice.
              onUpdatePaperMeta?.('framework', mode === 'previous' ? '2013' : '2023')
              setAiForm(prev => ({ ...prev, topics: [], subtopics: [], topic: '' }))
            }}
          />
        </div>
        <AiTopicSubtopicPicker
          grade={form.grade}
          subject={form.subject}
          framework={framework}
          topics={aiForm.topics || []}
          subtopics={aiForm.subtopics || []}
          onChangeTopics={(next) => setAiForm(prev => ({ ...prev, topics: next }))}
          onChangeSubtopics={(next) => setAiForm(prev => ({ ...prev, subtopics: next }))}
        />
        <div className="sv-field-grid two">
          <div className="sv-field">
            <label>How many questions</label>
            {customCount ? (
              <input
                type="number"
                min={1}
                max={25}
                autoFocus
                value={aiForm.count}
                onChange={e => setAiForm(prev => ({ ...prev, count: clampInt(e.target.value, 1, 25, 5) }))}
              />
            ) : (
              <select
                value={AI_COUNT_PRESETS.includes(Number(aiForm.count)) ? String(aiForm.count) : 'custom'}
                onChange={e => {
                  if (e.target.value === 'custom') { setCustomCount(true); return }
                  setAiForm(prev => ({ ...prev, count: Number(e.target.value) }))
                }}
              >
                {AI_COUNT_PRESETS.map(n => (
                  <option key={n} value={String(n)}>{n} questions</option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            )}
          </div>
          <div className="sv-field">
            <label>Type</label>
            <select
              value={aiForm.type}
              onChange={e => setAiForm(prev => ({ ...prev, type: e.target.value }))}
            >
              <option value="mcq">Multiple choice</option>
              <option value="true_false">True / False</option>
              <option value="short_answer">Short answer</option>
              {/* fill_blank (singular) is the server wire value
                  (functions/aiService.js:760-762) — do NOT "fix" to plural. */}
              <option value="fill_blank">Fill in the blanks</option>
              <option value="mixed">Mixed (MCQ, true/false, short answer)</option>
            </select>
          </div>
        </div>
        <button
          className="sv-btn sv-btn-primary sv-btn-full"
          onClick={() => onGenerate()}
          disabled={generating}
          style={{ marginTop: 12 }}
        >
          <Icon name={generating ? 'spinner' : 'ai'} size={15} spin={generating} /> {generating ? 'Generating…' : 'Generate questions'}
        </button>

        {generating && (
          <div style={{ marginTop: 16 }}>
            <AiGenerationProgress variant="card" preset="assessment" running title="Writing your questions…" />
          </div>
        )}

        <div className="sv-block-cat">Other tools</div>
        <div className="sv-ai-action-grid">
          <button
            className="sv-ai-action"
            onClick={onScan}
            disabled={importing}
          >
            <div className="sv-ic"><Icon name="camera" size={20} /></div>
            <div><strong>Scan full test paper</strong><small>Photograph every page, preview them, then convert the whole paper at once</small></div>
          </button>
          <button
            className="sv-ai-action"
            onClick={() => docInputRef.current?.click()}
            disabled={importing}
          >
            <div className="sv-ic"><Icon name="import" size={20} /></div>
            <div><strong>{importing ? 'Importing…' : 'Import Word / PDF / Pictures'}</strong><small>Convert an existing paper (or photos of it) into editable blocks</small></div>
            <input
              ref={docInputRef}
              type="file"
              accept={QUIZ_DOCUMENT_ACCEPT}
              multiple
              style={{ display: 'none' }}
              onChange={e => {
                const files = Array.from(e.target.files || []).filter(Boolean)
                if (files.length) onImport(files.length === 1 ? files[0] : files)
                e.target.value = ''
              }}
            />
          </button>
          <button className="sv-ai-action" onClick={onOpenMarkingKey}>
            <div className="sv-ic"><Icon name="key" size={20} /></div>
            <div><strong>Open marking key</strong><small>Auto-generated answers + explanations</small></div>
          </button>
          <button className="sv-ai-action" onClick={onOpenSpecTable}>
            <div className="sv-ic"><Icon name="target" size={20} /></div>
            <div>
              <strong>Table of Specifications</strong>
              <small>Suggested from this paper — check the figures, then print or download it for your file</small>
            </div>
          </button>
          <button className="sv-ai-action" onClick={onVerifyPaper} disabled={!questions?.length}>
            <div className="sv-ic"><Icon name="verify" size={20} /></div>
            <div><strong>Check this paper</strong><small>Vex verifies answers, grade fit and clarity before you print</small></div>
          </button>
          <button className="sv-ai-action" onClick={onOpenDiagramFix}>
            <div className="sv-ic"><Icon name="diagrams" size={20} /></div>
            <div>
              <strong>
                Fix missing diagrams
                {diagramsNeeded > 0 && (
                  <span className="sv-ai-badge">{diagramsNeeded}</span>
                )}
              </strong>
              <small>Match from the picture bank or generate from the AI&apos;s description</small>
            </div>
          </button>
          {onOpenDiagramScanner && (
            <button className="sv-ai-action" onClick={onOpenDiagramScanner}>
              <div className="sv-ic"><Icon name="camera" size={20} /></div>
              <div>
                <strong>Diagram Scanner</strong>
                <small>Photograph one diagram, clean it for printing, then add it to a question or save it to the bank</small>
              </div>
            </button>
          )}
          <DiagramGeneratorAction
            disabled={generatingDiagram}
            onGenerate={onGenerateDiagram}
          />
          <BalanceDifficultyAction questions={questions} questionNumbers={questionNumbers} drift={drift} />
          <BloomBalanceAction questions={questions} questionNumbers={questionNumbers} drift={drift} />
          <MapCompetenciesAction questions={questions} questionNumbers={questionNumbers} subjectLabel={form.subject} drift={drift} />
          <DetectDuplicatesAction questions={questions} questionNumbers={questionNumbers} />
        </div>
      </div>
    </aside>
  )
}

/* ==================================================================
 * DIAGRAM GENERATOR (inline mini-form inside AiSlide)
 *
 * Takes a free-form description ("Cross-section of human skin labelled
 * epidermis, dermis, hypodermis"), calls the generateDiagram callable,
 * and the resulting Storage URL is added as the question image of a
 * fresh "structured" question via the parent's onGenerate handler.
 *
 * Every style renders on OpenAI gpt-image-1 — the Recraft and Kie
 * backends were decommissioned. The wire values ('recraft' | 'openai' |
 * 'kie') survive as pure STYLE selectors the server still accepts (see
 * ALLOWED_PROVIDERS in functions/teacherTools/generateDiagram.js):
 * 'recraft' = B&W line art, 'openai' = photoreal, 'kie' = colour
 * illustration.
 * ================================================================== */
function DiagramGeneratorAction({ disabled, onGenerate }) {
  const [prompt, setPrompt] = useState('')
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState('recraft')
  return (
    <div className={`sv-ai-action ${open ? 'expanded' : ''}`} style={{ display: 'block', padding: 'var(--sv-s3)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sv-s3)', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div className="sv-ic"><Icon name="shape" size={20} /></div>
        <div style={{ flex: 1 }}>
          <strong style={{ display: 'block', fontWeight: 600 }}>Generate diagram</strong>
          <small style={{ color: 'var(--sv-muted)', fontSize: 12 }}>Line art, photoreal, or colour illustration</small>
        </div>
        <span style={{ color: 'var(--sv-muted)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe the image (e.g. Cross-section of human skin labelled epidermis, dermis, hypodermis)"
            rows={3}
            style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 8, fontSize: 13, background: 'var(--sv-paper)', fontFamily: 'inherit', resize: 'vertical' }}
            disabled={disabled}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--sv-muted)' }}>Style</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setStyle('recraft')}
                style={{ flex: 1, padding: '6px 10px', border: `1px solid ${style === 'recraft' ? 'var(--sv-primary)' : 'var(--sv-border)'}`, borderRadius: 'var(--sv-r-sm)', background: style === 'recraft' ? 'var(--sv-tinted)' : 'var(--sv-paper)', cursor: disabled ? 'default' : 'pointer', fontSize: 12, color: 'var(--sv-text)' }}
              >
                <Icon name="scratch" size={13} /> Line art<small style={{ display: 'block', color: 'var(--sv-muted)', fontSize: 10, marginTop: 2 }}>B&W diagrams, prints crisply</small>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setStyle('openai')}
                style={{ flex: 1, padding: '6px 10px', border: `1px solid ${style === 'openai' ? 'var(--sv-primary)' : 'var(--sv-border)'}`, borderRadius: 'var(--sv-r-sm)', background: style === 'openai' ? 'var(--sv-tinted)' : 'var(--sv-paper)', cursor: disabled ? 'default' : 'pointer', fontSize: 12, color: 'var(--sv-text)' }}
              >
                <Icon name="camera" size={13} /> Photoreal<small style={{ display: 'block', color: 'var(--sv-muted)', fontSize: 10, marginTop: 2 }}>Photographs of real things</small>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setStyle('kie')}
                style={{ flex: 1, padding: '6px 10px', border: `1px solid ${style === 'kie' ? 'var(--sv-primary)' : 'var(--sv-border)'}`, borderRadius: 'var(--sv-r-sm)', background: style === 'kie' ? 'var(--sv-tinted)' : 'var(--sv-paper)', cursor: disabled ? 'default' : 'pointer', fontSize: 12, color: 'var(--sv-text)' }}
              >
                <Icon name="drawLabel" size={13} /> Colour<small style={{ display: 'block', color: 'var(--sv-muted)', fontSize: 10, marginTop: 2 }}>Bright illustrations</small>
              </button>
            </div>
          </div>
          <button
            type="button"
            className="sv-btn sv-btn-primary sv-btn-full"
            disabled={disabled || !prompt.trim()}
            onClick={() => onGenerate(prompt.trim(), style).then(() => setPrompt(''))}
          >
            <Icon name={disabled ? 'spinner' : 'ai'} size={15} spin={disabled} /> {disabled ? 'Generating…' : 'Generate image'}
          </button>
          <small style={{ color: 'var(--sv-muted)', fontSize: 11 }}>
            The image is added as a new structured question with the prompt as its question text. Counts toward your monthly diagram quota.
          </small>
        </div>
      )}
    </div>
  )
}

/* ==================================================================
 * QUESTION EDITOR SLIDE-OVER
 * ================================================================== */
export function EditorSlide({ open, onClose, targetKey, sections, onUpdateStandaloneQuestion, onUpdatePassageQuestion, questionNumbers, mcqChoiceCount }) {
  // Find the target question
  const target = useMemo(() => {
    if (!targetKey) return null
    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i]
      if (section.kind === 'passage') {
        const idx = (section.passage.questions || []).findIndex(q => q.localId === targetKey)
        if (idx >= 0) {
          return { kind: 'passage', sectionIndex: i, questionIndex: idx, question: section.passage.questions[idx] }
        }
      } else if (section.question?.localId === targetKey) {
        return { kind: 'standalone', sectionIndex: i, question: section.question }
      }
    }
    return null
  }, [targetKey, sections])

  if (!open || !target) {
    return (
      <aside className={`sv-slideover ${open ? 'open' : ''}`}>
        <div className="sv-slideover-head">
          <button className="sv-icon-btn sv-icon-btn-sm" onClick={onClose} aria-label="Close"><Icon name="remove" size={20} /></button>
          <h3 className="serif">Edit Question<small>Select a question to edit</small></h3>
        </div>
        <div className="sv-slideover-body">
          <p style={{ color: 'var(--sv-muted)', fontSize: 13 }}>No question selected.</p>
        </div>
      </aside>
    )
  }

  const update = (field, value) => {
    if (target.kind === 'passage') {
      onUpdatePassageQuestion(target.sectionIndex, target.questionIndex, field, value)
    } else {
      onUpdateStandaloneQuestion(target.sectionIndex, field, value)
    }
  }

  const num = questionNumbers[target.question.localId] || ''
  const question = target.question
  const type = question.type || 'mcq'

  return (
    <aside className={`sv-slideover ${open ? 'open' : ''}`}>
      <div className="sv-slideover-head">
        <button className="sv-icon-btn sv-icon-btn-sm" onClick={onClose} aria-label="Close"><Icon name="remove" size={20} /></button>
        <h3 className="serif">Edit Question<small>Q{num} · {type.toUpperCase()}</small></h3>
      </div>
      <div className="sv-slideover-body">
        <div className="sv-field">
          <RichEditor
            key={`${targetKey}-text`}
            label="Question text"
            initialContent={question.text || null}
            onChange={json => update('text', json)}
            placeholder="Type the question — use the toolbar for bold, superscript/subscript, fractions, tables…"
            minHeight={96}
          />
        </div>

        {target.kind === 'standalone' && (
          <div className="sv-field" style={{ marginTop: 12 }}>
            <label>Question type</label>
            <select
              value={typeSelectValue(type)}
              onChange={e => {
                const patches = patchForTypeChange(question, e.target.value)
                Object.entries(patches).forEach(([k, v]) => update(k, v))
              }}
            >
              {STUDIO_QUESTION_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="sv-field-grid two" style={{ marginTop: 12 }}>
          <div className="sv-field">
            <label>Marks</label>
            <input
              type="number"
              value={question.marks ?? 1}
              onChange={e => update('marks', clampInt(e.target.value, 1, 100, 1))}
            />
          </div>
          <div className="sv-field">
            <label>Topic (optional)</label>
            <input
              type="text"
              value={question.topic || ''}
              onChange={e => update('topic', e.target.value)}
              placeholder="e.g. Respiratory system"
            />
          </div>
        </div>

        <div className="sv-field" style={{ marginTop: 12 }}>
          <label>Cognitive level — Bloom&apos;s (optional)</label>
          <select
            value={bloomLevel(question)}
            onChange={e => update('bloom', e.target.value)}
          >
            <option value="">Not set</option>
            {BLOOM_LEVELS.map(level => (
              <option key={level} value={level}>{BLOOM_LABELS[level]}</option>
            ))}
          </select>
        </div>

        {type === 'mcq' && (
          <>
            <div className="sv-block-cat" style={{ marginTop: 16 }}>Options</div>
            <McqOptions
              question={question}
              maxOptions={typeof mcqChoiceCount === 'number' ? mcqChoiceCount : undefined}
              onChangeOption={(optIndex, value) => {
                const next = [...(question.options || ['', '', '', ''])]
                next[optIndex] = value
                update('options', next)
              }}
              onSelectCorrect={(optIndex) => update('correctAnswer', optIndex)}
            />
          </>
        )}

        {(type === 'short_answer' || type === 'fill' || type === 'diagram' || type === 'essay') && (
          <div className="sv-field" style={{ marginTop: 12 }}>
            <label>{type === 'essay' ? 'Marking notes / sample answer (not printed)' : 'Expected answer (used for marking key)'}</label>
            <textarea
              value={String(question.correctAnswer ?? '')}
              onChange={e => update('correctAnswer', e.target.value)}
              rows={3}
            />
          </div>
        )}

        {type === 'numeric' && (
          <div style={{ marginTop: 12 }}>
            <NumericInputs
              correctAnswer={question.correctAnswer}
              tolerance={question.numericTolerance}
              unit={question.numericUnit}
              onChangeAnswer={value => update('correctAnswer', value)}
              onChangeTolerance={value => update('numericTolerance', value)}
              onChangeUnit={value => update('numericUnit', value)}
            />
          </div>
        )}

        {type === 'matching' && (
          <div style={{ marginTop: 12 }}>
            <MatchingInputs
              left={question.matchingLeft || []}
              right={question.matchingRight || []}
              answer={question.matchingAnswer || []}
              onChangeLeft={value => update('matchingLeft', value)}
              onChangeRight={value => update('matchingRight', value)}
              onChangeAnswer={value => update('matchingAnswer', value)}
            />
          </div>
        )}

        {type === 'sequence' && (
          <div style={{ marginTop: 12 }}>
            <SequenceInputs
              items={question.sequenceItems || []}
              answer={question.sequenceAnswer || []}
              onChangeItems={value => update('sequenceItems', value)}
              onChangeAnswer={value => update('sequenceAnswer', value)}
            />
          </div>
        )}

        {type === 'fill_blanks' && (
          <div className="sv-field" style={{ marginTop: 12 }}>
            <div className="sv-block-cat">Fill-in-the-Blanks</div>
            <FillBlanksInputs question={question} onUpdate={update} />
          </div>
        )}

        {question.tableData && (
          <div style={{ marginTop: 12 }}>
            <DataTableInputs
              tableData={question.tableData}
              onChange={value => update('tableData', value)}
            />
          </div>
        )}

        <div className="sv-field" style={{ marginTop: 12 }}>
          <RichEditor
            key={`${targetKey}-explanation`}
            label="Explanation (optional, for marking key)"
            initialContent={question.explanation || null}
            onChange={json => update('explanation', json)}
            placeholder="Why is this the correct answer?"
            minHeight={72}
          />
        </div>
      </div>
      <div className="sv-slideover-foot">
        <button className="sv-btn sv-btn-primary sv-btn-full" onClick={onClose}>Done</button>
      </div>
    </aside>
  )
}
