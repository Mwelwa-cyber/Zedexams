import { useRef, useMemo } from 'react'
import { hasOnlyEmptyStarterSection, orderPaperGroups } from '../../../utils/quizSections.js'
import { toEditableText } from '../AssessmentQuestionEditors'
import { MathsEditingProvider } from '../MathsRichField.jsx'
import { QUIZ_DOCUMENT_ACCEPT } from '../../quiz/documentQuizImporter'
import { SECTION_LETTERS } from '../assessmentStudioMeta'
import { normalizeMarksMode, resolveQuestionMarks, marksLabel } from '../../../utils/paperMarksModel'
import { CHOICE_COUNT_OPTIONS, normalizeChoiceCount } from '../../../utils/mcqChoices'
import Icon from './studioIcons'
import {
  HeaderBlock,
  InstructionsBlock,
  SectionBlock,
  FooterBlock,
} from './AssessmentBlocks'

/* ==================================================================
 * BUILDER VIEW
 * ================================================================== */
export function BuilderView(props) {
  const {
    form, setF, sections, parts, questionNumbers, questionIssues, questionCount, totalMarks,
    pagination, estimatedMinutes, footerCode, changeView, warnings = [],
    onAddBlock, onOpenBank, onEditQuestion, onMoveSection, onMoveGroup, onRemoveSection, onDuplicateSection, onSaveToBank,
    onToggleLock, onRewriteQuestion, rewritingKey,
    onUpdateStandaloneQuestion, onUploadStandaloneImage, onRemoveStandaloneImage,
    onUploadStandaloneOptionImage, onRemoveStandaloneOptionImage,
    onUpdateSection, onUploadPassageImage, onRemovePassageImage, onUpdatePassageQuestion, onAddPassageQuestion, onRemovePassageQuestion,
    onUpdatePart, onRemovePart, onAssignSectionToPart,
    onImportDocument, onScan, importing, importSummary, onDismissImportSummary,
    onCreatePaper, onVerifyPaper, onClearAll, onOpenDiagramFix, diagramsNeeded = 0, onOpenAi,
    onSave, saving = false, health, onShowHealth, onShowTemplates,
    assessmentTypes = ['topic', 'weekly', 'mid_term', 'end_of_term'],
    assessmentTypeLabel = 'Assessment',
  } = props

  const emptyPaper = hasOnlyEmptyStarterSection(sections)
  const importInputRef = useRef(null)

  // Group sections by their Part membership for rendering Section headers, then
  // lay the groups out in the teacher-chosen order (sections by their order, the
  // loose-questions block by `ungroupedOrder`). Same ordering the preview / PDF
  // / DOCX use via orderPaperGroups, so the builder matches the printed paper.
  const grouped = useMemo(() => {
    const sectionIndexByPart = new Map()
    const ungrouped = []
    sections.forEach((section, index) => {
      const partId = section.kind === 'passage'
        ? section.partId ?? null
        : section.question?.partId ?? null
      if (partId) {
        if (!sectionIndexByPart.has(partId)) sectionIndexByPart.set(partId, [])
        sectionIndexByPart.get(partId).push({ section, index })
      } else {
        ungrouped.push({ section, index })
      }
    })
    return orderPaperGroups(parts, form.ungroupedOrder ?? 0, ungrouped.length > 0)
      .map(group => (group.type === 'ungrouped'
        ? { part: null, members: ungrouped }
        : { part: group.part, members: sectionIndexByPart.get(group.part.id) || [] }))
  }, [sections, parts, form.ungroupedOrder])

  return (
    <section className="sv-view">
      <div className="sv-builder-bar">
        <button className="sv-chip active"><Icon name="builder" size={14} /> Builder</button>
        <button className="sv-chip" onClick={() => changeView('preview')}><Icon name="preview" size={14} /> Preview</button>
        <button className="sv-chip" onClick={() => changeView('marking-key')}><Icon name="key" size={14} /> Marking key</button>
        {/* The teacher's filing copy, alongside the two documents the learner
            and the marker get. It used to be a download button on the plan
            step only, so a saved paper had no route back to it at all. */}
        <button className="sv-chip" onClick={() => changeView('tos')} title="Table of Specifications — the copy for your teacher's file"><Icon name="target" size={14} /> Spec table</button>
        {/* Measured, not estimated — "Calculating pages…" until it is, because
            a placeholder number reads as a fact. See usePaperPagination. */}
        <span className="sv-pages mono"><Icon name="pages" size={13} /> {pagination?.label ?? 'Calculating pages…'} · A4</span>
      </div>

      {/* The teacher's main tools, always one tap away (they used to live
          only inside the AI slide-over, which read as "missing"). Wraps on
          phones; same actions on desktop. */}
      <div className="sv-builder-bar sv-builder-tools">
        <button className="sv-chip" onClick={onShowTemplates}><Icon name="sections" size={14} /> Templates</button>
        <button className="sv-chip" onClick={onCreatePaper}><Icon name="ai" size={14} /> Create with AI</button>
        {onOpenBank && (
          <button className="sv-chip" onClick={onOpenBank}><Icon name="bank" size={14} /> Question bank</button>
        )}
        <button className="sv-chip" onClick={() => importInputRef.current?.click()} disabled={importing}>
          <Icon name={importing ? 'spinner' : 'import'} size={14} spin={importing} /> {importing ? 'Importing…' : 'Import paper'}
        </button>
        <button className="sv-chip" onClick={onVerifyPaper} disabled={questionCount === 0}><Icon name="verify" size={14} /> Check paper</button>
        <button className="sv-chip" onClick={onOpenDiagramFix}>
          <Icon name="diagrams" size={14} /> Diagrams{diagramsNeeded > 0 ? ` (${diagramsNeeded})` : ''}
        </button>
        <button className="sv-chip" onClick={onOpenAi}><Icon name="more" size={14} /> More AI tools</button>
        {/* Right-aligned group: the "Paper health" status chip opens the single
            pre-save checklist; the Save chip files the paper. On a phone the
            bar wraps and the group drops to the next row. */}
        <div className="sv-builder-bar-right">
          <button
            className="sv-chip sv-chip-danger"
            onClick={onClearAll}
            disabled={emptyPaper}
            title="Remove every question and start over"
          >
            <Icon name="delete" size={14} /> Clear all
          </button>
          {!emptyPaper && health && (
            <button
              className={`sv-chip sv-chip-health ${health.status}`}
              onClick={onShowHealth}
              title="Open the paper-health checklist"
            >
              <Icon name={health.status === 'ready' ? 'checkCircle' : 'warn'} size={14} />
              {health.status === 'blocked'
                ? `${health.blockerCount} to fix`
                : health.status === 'attention'
                  ? `${health.advisoryCount} to review`
                  : 'Paper health'}
            </button>
          )}
          <button
            className="sv-chip sv-chip-save"
            onClick={onSave}
            disabled={saving || questionCount === 0}
            title="Save this paper to your library"
          >
            <Icon name={saving ? 'spinner' : 'save'} size={14} spin={saving} /> {saving ? 'Saving…' : 'Save to library'}
          </button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept={QUIZ_DOCUMENT_ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            const files = Array.from(e.target.files || []).filter(Boolean)
            if (files.length) onImportDocument(files.length === 1 ? files[0] : files)
            e.target.value = ''
          }}
        />
      </div>

      {/* One mounted Tiptap instance for the whole paper (§14). Every
          mathematics field renders as static paper HTML until the teacher
          moves into it; the provider is what makes "the active question only"
          a property of the paper rather than of each card. */}
      <MathsEditingProvider>
      <div className="sv-doc-canvas">
        <SmartWarningsBanner warnings={warnings} />

        <HeaderBlock form={form} setF={setF} footerCode={footerCode} importing={importing} importSummary={importSummary} onDismissImportSummary={onDismissImportSummary} onImportDocument={onImportDocument} onScan={onScan} assessmentTypes={assessmentTypes} assessmentTypeLabel={assessmentTypeLabel} />

        {/* No-content recovery: route the teacher into a template, AI, import,
            or hand-building — instead of an empty canvas with no next step. */}
        {emptyPaper && (
          <div className="sv-empty-grid">
            <button type="button" className="sv-empty-card primary" onClick={onShowTemplates}>
              <span className="sv-empty-ic"><Icon name="sections" size={20} /></span>
              <strong>Start from a template</strong>
              <small>Pick a ready-made format — end-of-term, MCQ quiz, comprehension — with sections and marks already set up.</small>
            </button>
            <button type="button" className="sv-empty-card" onClick={onCreatePaper}>
              <span className="sv-empty-ic"><Icon name="ai" size={20} /></span>
              <strong>Create with AI</strong>
              <small>Choose grade, subject and topics for a full Zambian paper with a marking key.</small>
            </button>
            <button type="button" className="sv-empty-card" onClick={() => importInputRef.current?.click()} disabled={importing}>
              <span className="sv-empty-ic"><Icon name="import" size={20} /></span>
              <strong>{importing ? 'Importing…' : 'Import a paper'}</strong>
              <small>Turn a Word, PDF or photo of an existing paper into editable blocks.</small>
            </button>
            <button type="button" className="sv-empty-card" onClick={() => onAddBlock(null)}>
              <span className="sv-empty-ic"><Icon name="scratch" size={20} /></span>
              <strong>Build from scratch</strong>
              <small>Add your first question block and build the paper up yourself.</small>
            </button>
          </div>
        )}

        <AddHere onAdd={() => onAddBlock(null)} />

        <InstructionsBlock form={form} setF={setF} />

        {grouped.map((group, groupIndex) => (
          <BuilderGroup
            key={group.part?.id ?? `ungrouped-${groupIndex}`}
            group={group}
            groupIndex={groupIndex}
            groupCount={grouped.length}
            allParts={parts}
            questionNumbers={questionNumbers}
            questionIssues={questionIssues}
            paperMeta={{ grade: form.grade, subject: form.subject, language: form.language, mcqAnswerChoiceCount: form.mcqAnswerChoiceCount }}
            onAddBlock={onAddBlock}
            onEditQuestion={onEditQuestion}
            onMoveSection={onMoveSection}
            onMoveGroup={onMoveGroup}
            onRemoveSection={onRemoveSection}
            onDuplicateSection={onDuplicateSection}
            onSaveToBank={onSaveToBank}
            onToggleLock={onToggleLock}
            onRewriteQuestion={onRewriteQuestion}
            rewritingKey={rewritingKey}
            onUpdateStandaloneQuestion={onUpdateStandaloneQuestion}
            onUploadStandaloneImage={onUploadStandaloneImage}
            onRemoveStandaloneImage={onRemoveStandaloneImage}
            onUploadStandaloneOptionImage={onUploadStandaloneOptionImage}
            onRemoveStandaloneOptionImage={onRemoveStandaloneOptionImage}
            onUpdateSection={onUpdateSection}
            onUploadPassageImage={onUploadPassageImage}
            onRemovePassageImage={onRemovePassageImage}
            onUpdatePassageQuestion={onUpdatePassageQuestion}
            onAddPassageQuestion={onAddPassageQuestion}
            onRemovePassageQuestion={onRemovePassageQuestion}
            onUpdatePart={onUpdatePart}
            onRemovePart={onRemovePart}
            onAssignSectionToPart={onAssignSectionToPart}
          />
        ))}

        <AddHere onAdd={() => onAddBlock(sections.length - 1)} />

        <FooterBlock form={form} setF={setF} footerCode={footerCode} />
      </div>
      </MathsEditingProvider>

      <div className="sv-totals-bar">
        <span><Icon name="questions" size={14} /> <strong>{questionCount}</strong> questions</span>
        <span><Icon name="marks" size={14} /> <strong>{totalMarks}</strong> marks</span>
        <span><Icon name="sections" size={14} /> <strong>{parts.length}</strong> sections</span>
        <span><Icon name="pages" size={14} /> <strong>{pagination?.status === 'ready' ? pagination.pageCount : '—'}</strong> Print/PDF pages</span>
        {estimatedMinutes > 0 && <span><Icon name="time" size={14} /> <strong>~{estimatedMinutes}</strong> min</span>}
      </div>
    </section>
  )
}

export function AddHere({ onAdd }) {
  return (
    <div className="sv-add-here">
      <button className="sv-plus" onClick={onAdd} aria-label="Insert block here">+</button>
    </div>
  )
}

/* ==================================================================
 * SMART WARNINGS BANNER
 *
 * Computed by computeSmartWarnings(assessmentDoc, questions). Renders
 * one short row per warning at the top of the builder. Errors block
 * save (validated separately); warnings are advisory.
 * ================================================================== */
export function SmartWarningsBanner({ warnings }) {
  if (!warnings || !warnings.length) return null
  return (
    <div className="sv-warnings">
      {warnings.map(w => (
        <div key={w.key} className={`sv-warn sv-warn-${w.severity}`}>
          <span className="sv-warn-ic"><Icon name={w.severity === 'error' ? 'warn' : w.severity === 'warn' ? 'more' : 'info'} size={15} /></span>
          <span className="sv-warn-msg">{w.message}</span>
        </div>
      ))}
    </div>
  )
}

export function BuilderGroup({ group, groupIndex = 0, groupCount = 1, allParts, questionNumbers, questionIssues, paperMeta, onAddBlock, onEditQuestion, onMoveSection, onMoveGroup, onRemoveSection, onDuplicateSection, onSaveToBank, onToggleLock, onRewriteQuestion, rewritingKey, onUpdateStandaloneQuestion, onUploadStandaloneImage, onRemoveStandaloneImage, onUploadStandaloneOptionImage, onRemoveStandaloneOptionImage, onUpdateSection, onUploadPassageImage, onRemovePassageImage, onUpdatePassageQuestion, onAddPassageQuestion, onRemovePassageQuestion, onUpdatePart, onRemovePart, onAssignSectionToPart }) {
  const partIndex = allParts.findIndex(p => p.id === group.part?.id)
  const letter = partIndex >= 0 ? SECTION_LETTERS[partIndex] || '·' : null

  // The section's total, through the SAME rule the printed paper uses (§4).
  // Summing `q.marks` directly — which this did — prints a different number from
  // the paper the moment the section is set to "same marks for every question",
  // because a uniform section's questions are worth the section's mark and not
  // their own.
  const partMarks = useMemo(() => {
    const questions = group.members.flatMap(({ section }) => {
      if (section.kind === 'passage') return section.passage.questions || []
      if (section.kind === 'pagebreak') return []
      return section.question ? [section.question] : []
    })
    return questions.reduce((sum, q) => sum + resolveQuestionMarks(q, group.part), 0)
  }, [group.members, group.part])

  return (
    <>
      {group.part && (
        <div className="sv-block b-section">
          <div className="sv-block-head">
            <span className="sv-ic"><Icon name="section" size={15} /></span> Section
            <span className="sv-tools">
              <button
                className="sv-tool"
                title="Move section up"
                disabled={groupIndex <= 0}
                onClick={() => onMoveGroup?.(group.part.id, -1)}
              ><Icon name="moveUp" size={14} /></button>
              <button
                className="sv-tool"
                title="Move section down"
                disabled={groupIndex >= groupCount - 1}
                onClick={() => onMoveGroup?.(group.part.id, 1)}
              ><Icon name="moveDown" size={14} /></button>
              <button className="sv-tool danger" title="Delete section" onClick={() => onRemovePart(group.part.id)}><Icon name="delete" size={14} /></button>
            </span>
          </div>
          <div className="sv-section-title-row">
            <div className="sv-section-letter">{letter}</div>
            <div className="sv-section-name">
              <input
                className="sv-inline-title"
                value={group.part.title}
                onChange={e => onUpdatePart(group.part.id, 'title', e.target.value)}
                placeholder="Section title (e.g. Multiple Choice Questions)"
              />
              <div className="sv-meta">
                <span><Icon name="questions" size={13} /> {group.members.length} block{group.members.length === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div className="sv-section-marks">{partMarks} marks</div>
          </div>
          <input
            className="sv-section-instr-input"
            value={typeof group.part.instructions === 'string' ? group.part.instructions : toEditableText(group.part.instructions)}
            onChange={e => onUpdatePart(group.part.id, 'instructions', e.target.value)}
            placeholder="Section instructions (e.g. Choose the correct answer from the options given.)"
          />
          <SectionMarksControls
            part={group.part}
            partMarks={partMarks}
            onUpdatePart={onUpdatePart}
          />
        </div>
      )}

      {group.members.map(({ section, index }) => (
        <SectionBlock
          key={section.id || section.kind + '-' + index}
          section={section}
          sectionIndex={index}
          parts={allParts}
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
          rewritingKey={rewritingKey}
          onUpdateStandaloneQuestion={onUpdateStandaloneQuestion}
          onUploadStandaloneImage={onUploadStandaloneImage}
          onRemoveStandaloneImage={onRemoveStandaloneImage}
          onUploadStandaloneOptionImage={onUploadStandaloneOptionImage}
          onRemoveStandaloneOptionImage={onRemoveStandaloneOptionImage}
          onUpdateSection={onUpdateSection}
          onUploadPassageImage={onUploadPassageImage}
          onRemovePassageImage={onRemovePassageImage}
          onUpdatePassageQuestion={onUpdatePassageQuestion}
          onAddPassageQuestion={onAddPassageQuestion}
          onRemovePassageQuestion={onRemovePassageQuestion}
          onAssignSectionToPart={onAssignSectionToPart}
        />
      ))}

      <AddHere onAdd={() => onAddBlock(group.members.length ? group.members[group.members.length - 1].index : null)} />
    </>
  )
}


/* ==================================================================
 * SECTION MARKS + ANSWER-CHOICE CONTROLS (§3, §4)
 *
 * A 25-question multiple-choice section is "one mark each", and asking a
 * teacher to type 1 twenty-five times is how a section ends up with a 2 in it
 * by accident. So a section can declare a uniform mark, and every question in
 * it is worth that — except one the teacher deliberately locked, which keeps
 * its own. Switching to uniform must not silently rewrite a mark that was set
 * on purpose; the only evidence would be the total moving.
 *
 * The declared total sits beside the computed one rather than replacing it. A
 * section whose two numbers disagree is blocked at export with both named,
 * because whichever the learner is marked against, one of them is wrong.
 * ================================================================== */
export function SectionMarksControls({ part, partMarks, onUpdatePart }) {
  const mode = normalizeMarksMode(part.marksMode)
  const uniform = mode === 'uniform'
  const choiceCount = normalizeChoiceCount(part.answerChoiceCount)
  return (
    <div className="sv-section-settings">
      <div className="sv-section-setting">
        <span className="sv-section-setting-label">Marks</span>
        <select
          value={mode}
          onChange={(e) => onUpdatePart(part.id, 'marksMode', e.target.value)}
          aria-label="How this section awards marks"
        >
          <option value="individual">Set marks individually</option>
          <option value="uniform">Same marks for every question</option>
        </select>
        {uniform && (
          <label className="sv-section-setting-inline">
            <span>Marks per question</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={part.marksPerQuestion ?? 1}
              onChange={(e) => onUpdatePart(part.id, 'marksPerQuestion', Number(e.target.value))}
            />
          </label>
        )}
        <label className="sv-section-setting-inline">
          <input
            type="checkbox"
            checked={part.showMarks !== false}
            onChange={(e) => onUpdatePart(part.id, 'showMarks', e.target.checked)}
          />
          <span>Show marks beside questions</span>
        </label>
        <span className="sv-section-setting-total">Section total: {marksLabel(partMarks)}</span>
      </div>

      <div className="sv-section-setting">
        <span className="sv-section-setting-label">Answer choices</span>
        <select
          value={choiceCount ?? ''}
          onChange={(e) => onUpdatePart(
            part.id,
            'answerChoiceCount',
            e.target.value === '' ? null : Number(e.target.value),
          )}
          aria-label="Number of answer choices in this section"
        >
          <option value="">Use the paper&apos;s setting</option>
          {CHOICE_COUNT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label} — {o.description.toLowerCase()}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
