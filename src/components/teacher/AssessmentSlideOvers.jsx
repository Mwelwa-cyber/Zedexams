// Assessment Studio — slide-overs and the paper render view. Extracted from
// AssessmentStudio.jsx to keep that module focused on orchestration.
//
// PaperRenderView (preview + marking key + export bar), the BlockPicker / AI /
// Editor slide-overs, and their private helpers (BlockPickerItem,
// AiTopicModeToggle, DiagramGeneratorAction). Props-in; they render inside the
// parent's `.studio-v2` CSS scope and reach the extracted analysis widgets
// and question-type editors via sibling imports.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { parsePastedQuestions } from '../../utils/pasteQuestionParser.js'
import RichEditor from '../../editor/components/RichEditor.jsx'
import { clampInt } from '../../utils/inputs.js'
import AiGenerationProgress from '../ui/AiGenerationProgress'
import { useSyllabusTopicOptions } from './syllabusTopicOptions'
import { QUIZ_DOCUMENT_ACCEPT } from '../quiz/documentQuizImporter'
import { PaperBlock } from './views/PaperBlocks'
import Icon from './studio/studioIcons'
import { bloomLevel, BLOOM_LABELS, BLOOM_LEVELS } from '../../utils/assessmentBloom'
import { STUDIO_SUBJECTS, STUDIO_GRADES } from './assessmentStudioMeta'
import {
  BalanceDifficultyAction,
  BloomBalanceAction,
  MapCompetenciesAction,
  DetectDuplicatesAction,
} from './AssessmentAnalysisActions'
import { McqOptions, FillBlanksInputs } from './AssessmentQuestionEditors'
import { CurriculumPicker } from './studio/sections/CurriculumPicker'
import './studio/lessonStudio.css'

/* ==================================================================
 * PAPER RENDER VIEW (preview + marking key)
 *
 * Walks the shared `buildPaperLayout` blocks so the in-studio rendering
 * matches the PDF and DOCX exports pixel-for-pixel. The `mode` prop
 * switches between the printable paper and the marking key.
 * ================================================================== */
export function PaperRenderView({ mode, blocks, assessment, changeView, onExport, onExportAnswerSheet, onSave, saving, exporting, showSave }) {
  const isKey = mode === 'scheme'
  return (
    <section className="sv-view">
      <div className="sv-builder-bar">
        <button className="sv-chip" onClick={() => changeView('builder')}><Icon name="builder" size={14} /> Builder</button>
        <button className={`sv-chip ${!isKey ? 'active' : ''}`} onClick={() => changeView('preview')}><Icon name="preview" size={14} /> Preview</button>
        <button className={`sv-chip ${isKey ? 'active' : ''}`} onClick={() => changeView('marking-key')}><Icon name="key" size={14} /> Marking key</button>
        <span className="sv-pages mono"><Icon name="pages" size={13} /> A4 · Portrait</span>
      </div>

      {isKey && (
        <div className="sv-key-note">
          <Icon name="key" size={14} /> <strong>Marking key</strong> — the answer and any explanation for every question. It&apos;s for you to mark from and is never shown to learners. Set or check answers back in the Builder.
        </div>
      )}

      <div className="sv-preview-shell">
        <div className="sv-paper">
          {blocks.map((block, i) => <PaperBlock key={i} block={block} />)}
        </div>

        <div className="sv-export-actions">
          <button className="sv-btn sv-btn-primary" onClick={() => onExport('docx')} disabled={exporting}>
            <Icon name={exporting ? 'spinner' : 'download'} size={15} spin={exporting} /> {exporting ? 'Working…' : (isKey ? 'Download key (Word)' : 'Download Word')}
          </button>
          <button className="sv-btn sv-btn-outline" onClick={() => onExport('print')} title="Use your browser's Print dialog — pick “Save as PDF” there if you need a PDF">
            <Icon name="print" size={15} /> Print / Save as PDF
          </button>
          {onExportAnswerSheet && (
            <button
              className="sv-btn sv-btn-outline"
              onClick={() => onExportAnswerSheet('docx')}
              disabled={exporting}
              title="A bubble answer sheet (Word) students fill in instead of writing on the paper"
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
          <BlockPickerItem icon="shape" title="Diagram-based" hint="Label or describe an image" onClick={() => onPick('structured')} />
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
            <strong style={{ color: '#065f46' }}>
              {preview.length} question{preview.length !== 1 ? 's' : ''} detected
            </strong>
            <span style={{ color: '#374151', marginLeft: 8 }}>
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
    padding: '3px 9px', borderRadius: 999, lineHeight: 1.6, color: '#64748b', cursor: 'pointer',
  }
  const onStyle = { background: '#fff', color: '#0f172a', boxShadow: 'inset 0 0 0 1.5px #fb923c' }
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

export function AiSlide({ open, onClose, aiForm, setAiForm, form, questions, questionNumbers, generating, onGenerate, onImport, onScan, importing, onGenerateDiagram, generatingDiagram, onOpenDiagramScanner, onOpenMarkingKey, onCreatePaper, onUpdatePaperMeta, diagramsNeeded = 0, onOpenDiagramFix, onVerifyPaper }) {
  const docInputRef = useRef(null)
  const [customCount, setCustomCount] = useState(false)
  // 'pick' = choose from the syllabus drop-down, 'write' = free text.
  const [topicMode, setTopicMode] = useState('pick')
  const { topics: topicOptions, loading: topicsLoading } = useSyllabusTopicOptions(form.grade, form.subject, aiForm.topic, aiForm.framework)
  const topicPickEmpty = !topicsLoading && topicOptions.length === 0
  // No syllabus rows for this grade/subject → free text is the only option.
  useEffect(() => {
    if (topicPickEmpty && topicMode === 'pick') setTopicMode('write')
  }, [topicPickEmpty, topicMode])
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
          A full {form.subject} paper for Grade {form.grade} — pick the topics,
          marks and question types, and it lands here as editable blocks with a
          marking key.
        </div>

        <div className="sv-block-cat">Quick questions</div>
        <div className="sv-ai-msg">
          <strong>Generate questions on a CBC topic</strong>
          Pick a topic, count and type — I&apos;ll draft them and drop them into the builder. Always review before saving.
        </div>

        <div className="sv-field-grid two" style={{ marginBottom: 12 }}>
          <div className="sv-field">
            <label>Grade</label>
            <select
              value={form.grade}
              onChange={e => { onUpdatePaperMeta?.('grade', e.target.value); setAiForm(prev => ({ ...prev, topic: '' })) }}
            >
              {STUDIO_GRADES.map(g => (
                <option key={g} value={g}>Grade {g}</option>
              ))}
            </select>
          </div>
          <div className="sv-field">
            <label>Subject</label>
            <select
              value={form.subject}
              onChange={e => { onUpdatePaperMeta?.('subject', e.target.value); setAiForm(prev => ({ ...prev, topic: '' })) }}
            >
              {STUDIO_SUBJECTS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <CurriculumPicker
            curriculumMode={aiForm.framework === '2013' ? 'previous' : 'cbc'}
            onSelect={(mode) => setAiForm(prev => ({ ...prev, framework: mode === 'previous' ? '2013' : '2023', topic: '' }))}
          />
        </div>
        <div className="sv-field" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <label style={{ marginBottom: 0 }}>Topic</label>
            <AiTopicModeToggle
              value={topicMode}
              onChange={(mode) => {
                // Drop a custom topic the syllabus doesn't list when switching
                // to the drop-down, so what's shown is what's sent.
                if (mode === 'pick' && aiForm.topic && !topicOptions.includes(aiForm.topic)) {
                  setAiForm(prev => ({ ...prev, topic: '' }))
                }
                setTopicMode(mode)
              }}
              pickDisabled={topicPickEmpty}
            />
          </div>
          {topicMode === 'pick' ? (
            <select
              value={topicOptions.includes(aiForm.topic) ? aiForm.topic : ''}
              disabled={topicsLoading}
              onChange={e => setAiForm(prev => ({ ...prev, topic: e.target.value }))}
            >
              <option value="">
                {topicsLoading ? 'Loading syllabus topics…' : 'Choose a topic from the syllabus…'}
              </option>
              {topicOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <>
              <input
                type="text"
                list="ai-slide-topic-options"
                value={aiForm.topic}
                onChange={e => setAiForm(prev => ({ ...prev, topic: e.target.value }))}
                placeholder={topicOptions[0] ? `e.g. ${topicOptions[0]}` : `e.g. ${form.subject === 'Mathematics' ? 'Fractions' : 'Body systems'}`}
              />
              <datalist id="ai-slide-topic-options">
                {topicOptions.map(t => <option key={t} value={t} />)}
              </datalist>
            </>
          )}
        </div>
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
              <option value="fill_blank">Fill in the blanks</option>
              <option value="mixed">Mixed (all three)</option>
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
          <BalanceDifficultyAction questions={questions} questionNumbers={questionNumbers} />
          <BloomBalanceAction questions={questions} questionNumbers={questionNumbers} />
          <MapCompetenciesAction questions={questions} questionNumbers={questionNumbers} subjectLabel={form.subject} />
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
 * epidermis, dermis, hypodermis"), calls the Recraft-backed callable,
 * and the resulting Storage URL is added as the question image of a
 * fresh "structured" question via the parent's onGenerate handler.
 * ================================================================== */
function DiagramGeneratorAction({ disabled, onGenerate }) {
  const [prompt, setPrompt] = useState('')
  const [open, setOpen] = useState(false)
  // 'recraft' = B&W line art (default, cheap, clean on photocopiers).
  // 'openai'  = photoreal photograph via gpt-image-1 — better for real-
  //             world subjects (maps, biology specimens, lab apparatus).
  const [provider, setProvider] = useState('recraft')
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
          <small style={{ color: 'var(--sv-muted)', fontSize: 12 }}>B&W line art or a photoreal image</small>
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
                onClick={() => setProvider('recraft')}
                style={{ flex: 1, padding: '6px 10px', border: `1px solid ${provider === 'recraft' ? 'var(--sv-primary)' : 'var(--sv-border)'}`, borderRadius: 'var(--sv-r-sm)', background: provider === 'recraft' ? 'var(--sv-tinted)' : 'var(--sv-paper)', cursor: disabled ? 'default' : 'pointer', fontSize: 12, color: 'var(--sv-text)' }}
              >
                <Icon name="scratch" size={13} /> Line art<small style={{ display: 'block', color: 'var(--sv-muted)', fontSize: 10, marginTop: 2 }}>B&W diagrams, prints crisply</small>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setProvider('openai')}
                style={{ flex: 1, padding: '6px 10px', border: `1px solid ${provider === 'openai' ? 'var(--sv-primary)' : 'var(--sv-border)'}`, borderRadius: 'var(--sv-r-sm)', background: provider === 'openai' ? 'var(--sv-tinted)' : 'var(--sv-paper)', cursor: disabled ? 'default' : 'pointer', fontSize: 12, color: 'var(--sv-text)' }}
              >
                <Icon name="camera" size={13} /> Photoreal<small style={{ display: 'block', color: 'var(--sv-muted)', fontSize: 10, marginTop: 2 }}>Photographs of real things</small>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setProvider('kie')}
                style={{ flex: 1, padding: '6px 10px', border: `1px solid ${provider === 'kie' ? 'var(--sv-primary)' : 'var(--sv-border)'}`, borderRadius: 'var(--sv-r-sm)', background: provider === 'kie' ? 'var(--sv-tinted)' : 'var(--sv-paper)', cursor: disabled ? 'default' : 'pointer', fontSize: 12, color: 'var(--sv-text)' }}
              >
                <Icon name="drawLabel" size={13} /> Colour<small style={{ display: 'block', color: 'var(--sv-muted)', fontSize: 10, marginTop: 2 }}>Bright illustrations</small>
              </button>
            </div>
          </div>
          <button
            type="button"
            className="sv-btn sv-btn-primary sv-btn-full"
            disabled={disabled || !prompt.trim()}
            onClick={() => onGenerate(prompt.trim(), provider).then(() => setPrompt(''))}
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
export function EditorSlide({ open, onClose, targetKey, sections, onUpdateStandaloneQuestion, onUpdatePassageQuestion, questionNumbers }) {
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
              value={type}
              onChange={e => update('type', e.target.value)}
            >
              <option value="mcq">Multiple choice</option>
              <option value="short_answer">Short answer</option>
              <option value="diagram">Structured / diagram</option>
              <option value="essay">Essay</option>
            </select>
          </div>
        )}

        <div className="sv-field-grid two" style={{ marginTop: 12 }}>
          <div className="sv-field">
            <label>Marks</label>
            <input
              type="number"
              value={question.marks || 1}
              onChange={e => update('marks', clampInt(e.target.value, 0, 100, 1))}
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
              onChangeOption={(optIndex, value) => {
                const next = [...(question.options || ['', '', '', ''])]
                next[optIndex] = value
                update('options', next)
              }}
              onSelectCorrect={(optIndex) => update('correctAnswer', optIndex)}
            />
          </>
        )}

        {(type === 'short_answer' || type === 'fill' || type === 'diagram') && (
          <div className="sv-field" style={{ marginTop: 12 }}>
            <label>Expected answer (used for marking key)</label>
            <textarea
              value={String(question.correctAnswer ?? '')}
              onChange={e => update('correctAnswer', e.target.value)}
              rows={3}
            />
          </div>
        )}

        {type === 'fill_blanks' && (
          <div className="sv-field" style={{ marginTop: 12 }}>
            <div className="sv-block-cat">Fill-in-the-Blanks</div>
            <FillBlanksInputs question={question} onUpdate={update} />
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
