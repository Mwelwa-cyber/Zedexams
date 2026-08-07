// Assessment Studio — the per-question editor card (QuestionBlock) and its
// inline helpers (AiSuggestionNotice, ReviseQuestionPopover). Extracted from
// AssessmentStudio.jsx to keep that module focused on orchestration.
//
// QuestionBlock renders one question card in the builder: question text, the
// type-specific answer editor, image/diagram attachments, difficulty, and the
// AI suggest/revise affordances. Props-in; renders inside the parent's
// `.studio-v2` scope. Type-specific editors and CardQuestionText come from
// AssessmentQuestionEditors; DifficultySelect from AssessmentAnalysisActions.

import { useState, useRef, useEffect } from 'react'
import { clampInt } from '../../utils/inputs.js'
import { resolveImageWidthPercent } from '../../utils/imageWidth'
import { hasSubParts, sumSubPartMarks } from '../../utils/questionParts.js'
import { suggestAnswer as suggestAnswerCall } from '../../utils/suggestAnswer'
import { reviseQuestion as reviseQuestionCall } from '../../utils/reviseQuestion'
import { useAiOperationLock } from '../../hooks/useAiOperationLock'
import { stableFingerprint } from '../../hooks/aiOperationLockCore'
import Icon from './studio/studioIcons'
import { MoreHorizontal, Sparkles } from 'lucide-react'
import ActionMenu from '../ui/ActionMenu'
import ConfirmDialog from '../ui/ConfirmDialog'
import { BlockDragHandle, useBlockDropTarget } from './studio/BlockDragHandle'
import DiagramSvg from '../diagrams/DiagramSvg'
import DiagramPicker from '../diagrams/DiagramPicker'
import PictureBankPicker from './PictureBankPicker'
import CameraCaptureModal from './CameraCaptureModal'
import ImageEditorModal from './ImageEditorModal'
import { DifficultySelect } from './AssessmentAnalysisActions'
import {
  CardQuestionText,
  McqOptions,
  ShortAnswerInputs,
  AnswerSpaceControl,
  SubPartsEditor,
  SplitIntoPartsButton,
  FillBlanksInputs,
  NumericInputs,
  MatchingInputs,
  SequenceInputs,
  DataTableInputs,
  DiagramLabelEditor,
} from './AssessmentQuestionEditors'
import { STUDIO_QUESTION_TYPE_OPTIONS, typeSelectValue, patchForTypeChange } from './assessmentQuestionTypes'
import { isMathsSubject } from './mathsSubjects.js'
import { normalizeMathsInQuestion } from '../../utils/mathsTextNormalizer.js'

// Question fields whose edits invalidate any prior AI answer suggestion.
// Module-scope so the array is allocated once per page load, not per render.
const FIELDS_THAT_INVALIDATE_SUGGESTION = ['text', 'options', 'correctAnswer', 'wordBank', 'numericTolerance', 'numericUnit', 'matchingLeft', 'matchingRight', 'matchingAnswer', 'sequenceItems', 'sequenceAnswer', 'tableData']

// Module-scope colour palette for the AI suggestion notice — kept out of
// the component body so it isn't reallocated per render.
const AI_CONFIDENCE_META = {
  high: { bg: '#ECFDF5', border: '#A7F3D0', text: '#065F46', label: 'High confidence' },
  medium: { bg: '#FFFBEB', border: '#FCD34D', text: '#92400E', label: 'Medium confidence' },
  low: { bg: '#FEF2F2', border: '#FCA5A5', text: '#991B1B', label: 'Low confidence — verify carefully' },
}

// Inline notice rendered below a question's answer area when Claude has
// suggested the correct answer. Stays visible until the teacher either
// edits anything answer-related (auto-cleared) or hits "Confirm".
function AiSuggestionNotice({ rationale, confidence, routedTo, onConfirm }) {
  const m = AI_CONFIDENCE_META[confidence] || AI_CONFIDENCE_META.low
  const isVision = routedTo === 'gemini-vision'
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 'var(--sv-r-sm)', background: m.bg, border: `1px solid ${m.border}`, color: m.text, fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="ai" size={13} /> AI suggested · {m.label}
          {isVision && (
            <span style={{ background: 'rgba(0,0,0,0.06)', color: m.text, padding: '0 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, letterSpacing: 0.3, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Icon name="preview" size={11} /> Vision
            </span>
          )}
        </div>
        <div style={{ opacity: 0.9 }}>{rationale}</div>
      </div>
      <button
        type="button"
        onClick={onConfirm}
        style={{ background: 'transparent', border: `1px solid ${m.border}`, color: m.text, padding: '3px 8px', borderRadius: 'var(--sv-r-sm)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        <Icon name="check" size={12} /> Confirm
      </button>
    </div>
  )
}

/**
 * "Convert maths notation" — the §8 upgrade path for AI-generated and imported
 * questions, which arrive as plain strings saying "3/5" and "x^2".
 *
 * Shown only when there is something to do, and it states the count BEFORE
 * changing anything, because a bare `a/b` is the one pattern the normaliser
 * will not touch on its own: "3/5" is a fraction, a ratio and a date, and the
 * text does not say which. Powers, roots and mixed numbers have no second
 * reading, so those are offered as a plain one-click conversion; bare
 * fractions are a separate, explicitly-worded confirmation.
 *
 * Undo is the normal editor undo — this writes through the same updateQuestion
 * path every other edit takes, so nothing special is needed to reverse it.
 */
function ConvertMathsNotation({ question, onUpdate }) {
  const preview = normalizeMathsInQuestion(question)
  const unambiguous = preview.converted
  const ambiguous = preview.candidates
  if (!unambiguous && !ambiguous) return null

  const apply = (includeBareFractions) => {
    const { question: next, converted } = normalizeMathsInQuestion(question, { includeBareFractions })
    if (!converted) return
    // Field by field through the normal update path, so autosave, validation
    // and the dirty flag all behave exactly as they do for a typed edit.
    for (const field of ['text', 'correctAnswer', 'explanation', 'options']) {
      if (next[field] !== question[field]) onUpdate(field, next[field])
    }
  }

  return (
    <div style={{ margin: '4px 0 8px', padding: '6px 9px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'var(--sv-tinted)', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--sv-muted)' }}>
        This question uses typed maths notation.
      </span>
      {unambiguous > 0 && (
        <button
          type="button"
          className="sv-btn sv-btn-outline sv-btn-sm"
          onClick={() => apply(false)}
          title="Convert powers, roots and mixed numbers to proper maths"
        >
          Convert {unambiguous} {unambiguous === 1 ? 'expression' : 'expressions'}
        </button>
      )}
      {ambiguous > 0 && (
        <button
          type="button"
          className="sv-btn sv-btn-outline sv-btn-sm"
          onClick={() => apply(true)}
          title="Also convert plain a/b to stacked fractions — check none of them is a ratio or a date"
        >
          Also convert {ambiguous} {ambiguous === 1 ? 'fraction' : 'fractions'} like 3/5
        </button>
      )}
      {ambiguous > 0 && (
        <span style={{ color: 'var(--sv-muted)', flexBasis: '100%' }}>
          Check first — a ratio and a date are written the same way as a fraction.
        </span>
      )}
    </div>
  )
}

// Inline popover for the "Revise" per-question action. The teacher
// picks a target grade and/or modifier, hits Rewrite, then either
// Apply (overwrites question.text) or Discard (drops the preview).
function ReviseQuestionPopover({
  paperMeta, targetGrade, modifier, revising, error, preview,
  onTargetGradeChange, onModifierChange, onRevise, onApply, onDiscard, onClose,
}) {
  const GRADES = [
    { value: 'ECE_N', label: 'Nursery (3–4)' },
    { value: 'ECE_R', label: 'Reception (4–5)' },
    { value: 'G1', label: 'G1' }, { value: 'G2', label: 'G2' },
    { value: 'G3', label: 'G3' }, { value: 'G4', label: 'G4' },
    { value: 'G5', label: 'G5' }, { value: 'G6', label: 'G6' },
    { value: 'G7', label: 'G7' }, { value: 'G8', label: 'G8' },
    { value: 'G9', label: 'G9' }, { value: 'G10', label: 'G10' },
    { value: 'G11', label: 'G11' }, { value: 'G12', label: 'G12' },
  ]
  return (
    <div style={{ margin: '4px 0 8px', padding: 10, border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'var(--sv-paper)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 11, color: 'var(--sv-muted)' }}>Target grade</label>
          <select
            value={targetGrade}
            onChange={e => onTargetGradeChange(e.target.value)}
            disabled={revising}
            style={{ border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '4px 6px', fontSize: 12, background: 'var(--sv-paper)' }}
          >
            <option value="">— pick —</option>
            {GRADES.map(g => (
              <option key={g.value} value={g.value} disabled={g.value === paperMeta?.grade}>{g.label}{g.value === paperMeta?.grade ? ' (current)' : ''}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 11, color: 'var(--sv-muted)' }}>Tone (optional)</label>
          <select
            value={modifier}
            onChange={e => onModifierChange(e.target.value)}
            disabled={revising}
            style={{ border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '4px 6px', fontSize: 12, background: 'var(--sv-paper)' }}
          >
            <option value="">— none —</option>
            <option value="polish">Polish (grammar & clarity)</option>
            <option value="easier">Make easier</option>
            <option value="harder">Make harder</option>
            <option value="simpler">Simpler vocabulary</option>
          </select>
        </div>
        <button
          type="button"
          className="sv-btn sv-btn-primary"
          disabled={revising || (!targetGrade && !modifier)}
          onClick={onRevise}
          style={{ padding: '4px 12px', fontSize: 12 }}
        >
          <Icon name={revising ? 'spinner' : 'ai'} size={13} spin={revising} /> {revising ? 'Rewriting…' : 'Rewrite'}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--sv-muted)', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          Close <Icon name="remove" size={13} />
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 8, padding: '4px 8px', borderRadius: 'var(--sv-r-sm)', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="warn" size={13} /> {error}
        </div>
      )}
      {preview && (
        <div style={{ marginTop: 8, padding: 8, border: '1px solid #A7F3D0', borderRadius: 'var(--sv-r-sm)', background: '#ECFDF5' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#065F46', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="ai" size={12} /> Suggested rewrite</div>
          <div style={{ fontSize: 13, color: '#064E3B', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{preview}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              type="button"
              className="sv-btn sv-btn-primary"
              onClick={onApply}
              style={{ padding: '3px 10px', fontSize: 11 }}
            >
              <Icon name="check" size={12} /> Apply
            </button>
            <button
              type="button"
              onClick={onDiscard}
              style={{ padding: '3px 10px', fontSize: 11, background: 'transparent', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', cursor: 'pointer' }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function QuestionBlock({ section, sectionIndex, parts, questionNumbers, questionIssues, paperMeta, onEditQuestion, onMoveSection, onReorderSection, onRemoveSection, onDuplicateSection, onSaveToBank, onUpdateQuestion, onUploadImage, onRemoveImage, onUploadOptionImage, onRemoveOptionImage, onAssignSectionToPart, onToggleLock, onRewriteQuestion, rewriting = false }) {
  const question = section.question
  // Does this paper get the mathematics tools? Resolved from the paper's
  // subject through the canonical key system (mathsSubjects.js) — so a Grade 2
  // "Mathematics and Science" paper, which stores `numeracy` rather than
  // `mathematics`, gets them with no extra setup.
  const mathsPaper = isMathsSubject(paperMeta?.subject)
  // What still stops this question printing correctly (empty text, no options,
  // no correct answer chosen, an image mid-upload). Flagged on the card itself
  // so the teacher fixes it where they are, instead of meeting the list only
  // when a download is refused. Same source as the export gate and the Save
  // check — collectQuizIssues — so the three never disagree.
  const blockers = questionIssues?.get?.(question.localId) || []
  const type = question.type || 'mcq'
  const isMcq = type === 'mcq'
  const isEssay = type === 'essay'
  const isFillBlanks = type === 'fill_blanks'
  const isShortAnswer = type === 'short_answer' || type === 'fill' || type === 'short'
  const isStructured = type === 'diagram' && !isShortAnswer
  const isNumeric = type === 'numeric'
  const isMatching = type === 'matching'
  const isSequence = type === 'sequence'
  const imageInputRef = useRef(null)
  // Picture-bank picker target: null (closed) | 'question' | option index.
  const [bankTarget, setBankTarget] = useState(null)
  // Diagram-library picker target: null (closed) | 'question' | option index.
  // Lets the teacher insert or edit an exact maths shape (DiagramPicker).
  const [diagramTarget, setDiagramTarget] = useState(null)
  // Camera-capture + post-insert image-editor modals for the question stem.
  const [cameraOpen, setCameraOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [enhancingImage, setEnhancingImage] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState('')
  // AI suggestion lives in component-local state, NOT on the question
  // object. This keeps the AI badge out of the persisted paper schema
  // (no Firestore drift) and also clears the badge naturally when the
  // teacher closes the paper and reopens it — which is the right default
  // for an unconfirmed model output.
  const [aiSuggestion, setAiSuggestion] = useState(null)
  // AI revise-question state — same component-local pattern as
  // aiSuggestion above. The revision preview lives here until the
  // teacher hits Apply or Discard.
  const [revising, setRevising] = useState(false)
  const [reviseError, setReviseError] = useState('')
  const [reviseOpen, setReviseOpen] = useState(false)
  const [reviseTargetGrade, setReviseTargetGrade] = useState('')
  const [reviseModifier, setReviseModifier] = useState('')
  const [revisedPreview, setRevisedPreview] = useState(null) // suggested new text
  // Guards setState after unmount during an in-flight suggestion call.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  // Drop target for another block's drag handle.
  const { isOver, dropProps } = useBlockDropTarget({ index: sectionIndex, onReorder: onReorderSection })
  // Deleting a question asks first. The menu row opens this; the dialog does
  // the removing — the pattern ActionMenu documents for every danger item.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // Idempotency locks: one intentional Revise / Suggest → one provider call +
  // one charge, even across a double-click / rapid tap / refresh / a second tab.
  // The reviseQuestion / suggestAnswer callables now REFUSE a keyless call, so
  // the key travels with every request; these are the client-side belt.
  const { run: runReviseLocked } = useAiOperationLock('assessment-question:revise')
  const { run: runSuggestLocked } = useAiOperationLock('assessment-question:suggest-answer')

  function updateQuestion(field, value) {
    if (aiSuggestion && FIELDS_THAT_INVALIDATE_SUGGESTION.includes(field)) {
      setAiSuggestion(null)
    }
    onUpdateQuestion(field, value)
  }

  // The {libraryKey, params} currently on the picker's target slot, so
  // re-opening jumps straight to that shape's config pane for editing.
  function diagramInitial() {
    if (diagramTarget === 'question') return question.imageDiagram || null
    if (typeof diagramTarget === 'number') return question.optionMedia?.[diagramTarget]?.diagram || null
    return null
  }
  function onConfirmDiagram({ libraryKey, params }) {
    if (diagramTarget === 'question') {
      // A stem shape and an uploaded stem image are mutually exclusive.
      updateQuestion('imageDiagram', { libraryKey, params })
      updateQuestion('imageUrl', '')
      updateQuestion('imageAssetId', '')
    } else if (typeof diagramTarget === 'number') {
      const i = diagramTarget
      const optionCount = Array.isArray(question.options) ? question.options.length : 4
      const existing = Array.isArray(question.optionMedia) ? question.optionMedia : []
      const next = Array.from({ length: optionCount }, (_, k) => existing[k] || null)
      next[i] = { diagram: { libraryKey, params }, alt: existing[i]?.alt || String(params?.cap || libraryKey) }
      updateQuestion('optionMedia', next)
    }
    setDiagramTarget(null)
  }

  // Camera capture confirmed → push the enhanced/original File through the
  // same upload path used by file-picker, picture-bank and diagram inserts.
  function onCameraConfirm(file) {
    setCameraOpen(false)
    // A camera capture and a library shape are mutually exclusive on the stem.
    if (question.imageDiagram?.libraryKey) updateQuestion('imageDiagram', null)
    onUploadImage(file)
  }

  // Image editor applied → persist the new size preset and, when pixels
  // actually changed, re-upload the edited image to replace the stem.
  function onEditorApply({ file, imageWidth }) {
    setEditorOpen(false)
    if (imageWidth) updateQuestion('imageWidth', imageWidth)
    if (file) onUploadImage(file)
  }

  // One-click "Enhance again" on an already-inserted image: re-run the
  // document clean-up on the current stem image and replace it in place.
  async function onEnhanceAgain() {
    if (!question.imageUrl || enhancingImage) return
    setEnhancingImage(true)
    try {
      const { enhanceImageFile, blobToFile } = await import('../../utils/imageEnhance')
      const { blob } = await enhanceImageFile(question.imageUrl)
      onUploadImage(blobToFile(blob, `enhanced-${Date.now()}.jpg`))
    } catch {
      // Cross-origin read blocked or decode failed — leave the image as-is.
    } finally {
      if (mountedRef.current) setEnhancingImage(false)
    }
  }

  // Shared runner so the popover (handleRevise) and the one-click "Improve"
  // button (handleImprove) hit the same call without depending on async state.
  async function runRevise({ toGrade, modifier }) {
    const text = String(question.text || '').trim()
    if (!text) {
      setReviseError('Add the question text first, then ask AI to revise it.')
      return
    }
    if (!toGrade && !modifier) {
      setReviseError('Pick a target grade or modifier first.')
      return
    }
    setReviseError('')
    setRevising(true)
    try {
      const payload = {
        text,
        fromGrade: paperMeta?.grade,
        toGrade,
        subject: paperMeta?.subject,
        language: paperMeta?.language,
        // Preserve the paper's curriculum (framework: 2023 → CBC, 2013 →
        // previous) so the revision never drifts to another syllabus.
        curriculum: paperMeta?.framework,
        modifier,
      }
      const lockResult = await runReviseLocked({
        fingerprint: stableFingerprint(payload),
        action: (idempotencyKey) => reviseQuestionCall({ ...payload, idempotencyKey }),
      })
      if (!mountedRef.current) return
      if (lockResult.reason === 'locked') return
      if (!lockResult.ok) throw (lockResult.error || new Error('Could not revise the question.'))
      const result = lockResult.data
      if (result?.status === 'processing') return
      setRevisedPreview(result.text)
    } catch (err) {
      if (mountedRef.current) setReviseError(err?.message || 'Could not revise the question.')
    } finally {
      if (mountedRef.current) setRevising(false)
    }
  }

  function handleRevise() {
    return runRevise({ toGrade: reviseTargetGrade, modifier: reviseModifier })
  }

  // One-click polish: fix grammar + clarity at the SAME grade/difficulty. Opens
  // the revise panel (so the Apply/Discard preview shows) pre-set to 'polish'
  // and runs immediately.
  function handleImprove() {
    setReviseOpen(true)
    setReviseTargetGrade('')
    setReviseModifier('polish')
    return runRevise({ modifier: 'polish' })
  }

  function applyRevision() {
    if (!revisedPreview) return
    updateQuestion('text', revisedPreview)
    setRevisedPreview(null)
    setReviseOpen(false)
  }

  function discardRevision() {
    setRevisedPreview(null)
    setReviseError('')
  }

  async function handleSuggestAnswer() {
    const text = String(question.text || '').trim()
    if (!text) {
      setSuggestError('Add the question text first, then ask AI for the answer.')
      return
    }
    if (isMcq) {
      const nonEmpty = (question.options || []).filter(o => String(o || '').trim()).length
      if (nonEmpty < 2) {
        setSuggestError('Fill in at least two options before asking AI.')
        return
      }
    }
    setSuggestError('')
    setSuggesting(true)
    try {
      const payload = {
        type,
        text,
        options: isMcq ? question.options : undefined,
        wordBank: Array.isArray(question.wordBank) ? question.wordBank : undefined,
        // For numeric we pass the unit so Claude knows what physical
        // quantity the answer should be in (e.g. "kg" or "%"). Tolerance
        // is informational only — the model still returns a single value.
        unit: isNumeric ? (question.numericUnit || '') : undefined,
        tolerance: isNumeric ? Number(question.numericTolerance || 0) : undefined,
        // For matching we pass both columns. The model returns an array
        // of right-column indices — one per left-column item.
        matchingLeft: isMatching ? (question.matchingLeft || []) : undefined,
        matchingRight: isMatching ? (question.matchingRight || []) : undefined,
        // For sequence we pass the items as the teacher typed them. The
        // model returns an array of 1-based positions — one per item —
        // saying where each item should land in the correct order.
        sequenceItems: isSequence ? (question.sequenceItems || []) : undefined,
        // When the question carries an image (diagram / map / data table /
        // image-identify), the backend may route to Gemini Vision so the
        // model can actually *see* what's in the image. Falls back to
        // Claude text-only if the Gemini key isn't configured.
        imageUrl: question.imageUrl || undefined,
        grade: paperMeta?.grade,
        subject: paperMeta?.subject,
        language: paperMeta?.language,
        // Preserve the paper's curriculum so the predicted answer stays in the
        // question's own syllabus (2023 → CBC, 2013 → previous).
        curriculum: paperMeta?.framework,
      }
      const lockResult = await runSuggestLocked({
        fingerprint: stableFingerprint(payload),
        action: (idempotencyKey) => suggestAnswerCall({ ...payload, idempotencyKey }),
      })
      if (!mountedRef.current) return
      if (lockResult.reason === 'locked') return
      if (!lockResult.ok) throw (lockResult.error || new Error('Could not suggest an answer.'))
      const result = lockResult.data
      if (result?.status === 'processing') return
      // Write the predicted answer to the question via the raw prop —
      // bypasses the local wrapper that would otherwise clear the
      // suggestion badge. Matching and sequence both store the answer
      // as an index array on a dedicated field; everything else uses
      // the scalar `correctAnswer` field.
      if (isMatching && Array.isArray(result.answer)) {
        onUpdateQuestion('matchingAnswer', result.answer)
      } else if (isSequence && Array.isArray(result.answer)) {
        onUpdateQuestion('sequenceAnswer', result.answer)
      } else {
        onUpdateQuestion('correctAnswer', result.answer)
      }
      setAiSuggestion({
        rationale: result.rationale,
        confidence: result.confidence,
        routedTo: result.routedTo,
      })
    } catch (err) {
      if (mountedRef.current) {
        setSuggestError(err?.message || 'Could not suggest an answer.')
      }
    } finally {
      if (mountedRef.current) setSuggesting(false)
    }
  }

  const typeMeta = {
    mcq: { tag: 'mcq', label: 'Multiple Choice', icon: 'mcq' },
    short_answer: { tag: 'struct', label: 'Short Answer', icon: 'shortAnswer' },
    diagram: { tag: 'struct', label: 'Structured / Diagram', icon: 'structured' },
    essay: { tag: 'essay', label: 'Essay', icon: 'essay' },
    numeric: { tag: 'mcq', label: 'Numeric', icon: 'numeric' },
    matching: { tag: 'struct', label: 'Matching', icon: 'matching' },
    sequence: { tag: 'struct', label: 'Sequence', icon: 'sequence' },
    fill_blanks: { tag: 'struct', label: 'Fill in the Blanks', icon: 'fillBlanks' },
  }
  const meta = typeMeta[type] || typeMeta.mcq

  const questionNumber = questionNumbers[question.localId] || sectionIndex + 1

  return (
    <div
      className={`sv-block b-question nested${blockers.length ? ' is-incomplete' : ''}${isOver ? ' is-drop-target' : ''}`}
      {...dropProps}
    >
      {/* The header was eight icon buttons — up, down, edit, regenerate, lock,
          duplicate, star, delete — all the same size and weight, with Delete
          four pixels from Duplicate. It is now the grip and one menu. */}
      <div className="sv-block-head">
        <BlockDragHandle
          index={sectionIndex}
          label={`question ${questionNumber}`}
          onMove={onMoveSection}
        />
        <span className="sv-ic"><Icon name={meta.icon} size={15} /></span> {meta.label}
        {blockers.length > 0 && (
          <span className="sv-q-incomplete-tag" title={blockers.join(' ')}>
            <Icon name="warn" size={12} /> Not finished
          </span>
        )}
        {question.locked && (
          <span className="sv-q-locked-tag" title="Locked — nothing rewrites this question">
            <Icon name="lock" size={12} /> Locked
          </span>
        )}
        <span className="sv-tools">
          <ActionMenu
            icon={MoreHorizontal}
            ariaLabel={`More actions for question ${questionNumber}`}
            buttonClassName="sv-tool"
            items={[
              { label: 'Edit in detail', onSelect: () => onEditQuestion(question.localId) },
              { label: 'Duplicate', onSelect: () => onDuplicateSection(sectionIndex) },
              // The teacher's own "this one is finished" marker. Nothing — not a
              // rewrite, not a validation pass, not a future migration — may
              // overwrite a locked question.
              onToggleLock ? {
                label: question.locked ? 'Unlock this question' : 'Lock this question',
                onSelect: () => onToggleLock(question.localId, !question.locked),
              } : null,
              onSaveToBank ? {
                label: 'Save to your question bank',
                onSelect: () => onSaveToBank(question),
              } : null,
              { label: 'Delete', danger: true, onSelect: () => setConfirmDeleteOpen(true) },
            ]}
          />
        </span>
      </div>

      <div className="sv-q-card-top">
        <div className="sv-q-num">{questionNumber}.</div>
        {/* The "MULTIPLE CHOICE" badge that used to sit here said exactly what
            the dropdown beside it says. One of them had to go, and the dropdown
            is the one you can act on. */}
        <select
          value={typeSelectValue(type)}
          onChange={e => {
            // Apply type + any seeded fields in one pass via patchForTypeChange.
            const patches = patchForTypeChange(question, e.target.value)
            Object.entries(patches).forEach(([k, v]) => onUpdateQuestion(k, v))
          }}
          style={{ background: 'var(--sv-tinted)', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '3px 8px', fontSize: 11.5 }}
        >
          {STUDIO_QUESTION_TYPE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <label className="sv-q-marks-input">
          marks
          <input
            type="number"
            value={hasSubParts(question) ? sumSubPartMarks(question.subParts) : (question.marks ?? 1)}
            onChange={e => onUpdateQuestion('marks', clampInt(e.target.value, 1, 100, 1))}
            readOnly={hasSubParts(question)}
            title={hasSubParts(question) ? 'Total auto-sums from the sub-parts below' : 'Marks for this question'}
            style={hasSubParts(question) ? { background: 'var(--sv-tinted)', cursor: 'not-allowed' } : undefined}
          />
        </label>
        <DifficultySelect question={question} onUpdateQuestion={onUpdateQuestion} />
        {/* Three AI buttons sat here — Suggest answer, Improve, Revise ▾ — each
            wide enough to push the marks stepper off a phone. One menu. */}
        <ActionMenu
          label={suggesting || revising ? 'Thinking…' : 'AI'}
          icon={Sparkles}
          caret
          buttonClassName="sv-q-ai-trigger"
          items={[
            {
              label: isEssay ? 'Suggest marking notes' : 'Suggest answer',
              disabled: suggesting,
              onSelect: handleSuggestAnswer,
            },
            {
              label: 'Improve grammar & clarity',
              disabled: revising,
              onSelect: handleImprove,
            },
            {
              label: 'Revise for another grade or tone…',
              onSelect: () => setReviseOpen(true),
            },
            // Rewrite THIS question only. Every other question on the paper —
            // including the teacher's edits to them — is left exactly as it is.
            // Refused outright on a locked question.
            onRewriteQuestion ? {
              label: question.locked ? 'Locked — unlock to rewrite' : 'Rewrite just this question',
              disabled: rewriting || question.locked,
              disabledReason: question.locked ? 'Unlock this question first' : 'A rewrite is already running',
              onSelect: () => onRewriteQuestion(question.localId),
            } : null,
          ]}
        />
      </div>

      {mathsPaper && <ConvertMathsNotation question={question} onUpdate={updateQuestion} />}

      {reviseOpen && (
        <ReviseQuestionPopover
          paperMeta={paperMeta}
          targetGrade={reviseTargetGrade}
          modifier={reviseModifier}
          revising={revising}
          error={reviseError}
          preview={revisedPreview}
          onTargetGradeChange={setReviseTargetGrade}
          onModifierChange={setReviseModifier}
          onRevise={handleRevise}
          onApply={applyRevision}
          onDiscard={discardRevision}
          onClose={() => { setReviseOpen(false); discardRevision() }}
        />
      )}

      <CardQuestionText
        value={question.text}
        onChange={v => updateQuestion('text', v)}
        onEditDetail={() => onEditQuestion(question.localId)}
        maths={mathsPaper}
        grade={paperMeta?.grade}
        fieldId={`q:${question.localId}:text`}
      />

      {(isMcq || isStructured) && (
        question.imageDiagram?.libraryKey ? (
          <div className="sv-q-media filled filled-wrap" style={{ flexDirection: 'column', gap: 8 }}>
            <div style={{ maxWidth: 280 }}>
              <DiagramSvg
                libraryKey={question.imageDiagram.libraryKey}
                params={question.imageDiagram.params}
                color="#1c1612"
                alt=""
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="sv-btn sv-btn-outline" style={{ fontSize: 13 }}
                onClick={() => setDiagramTarget('question')}>
                <Icon name="edit" size={14} /> Edit shape
              </button>
              <button type="button" className="sv-btn sv-btn-outline" style={{ fontSize: 13 }}
                onClick={() => updateQuestion('imageDiagram', null)}>
                Remove
              </button>
            </div>
          </div>
        ) : question.imageUrl ? (
          isStructured ? (
            <DiagramLabelEditor
              imageUrl={question.imageUrl}
              labels={question.diagramLabels || []}
              mode={question.diagramMode || 'labeled'}
              onChangeLabels={value => updateQuestion('diagramLabels', value)}
              onChangeMode={value => updateQuestion('diagramMode', value)}
              onRemoveImage={onRemoveImage}
            />
          ) : (
            <div className="sv-q-media filled filled-wrap" style={{ flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ position: 'relative', maxWidth: `${resolveImageWidthPercent(question.imageWidth)}%` }}>
                <img src={question.imageUrl} alt={question.imageAlt || ''} style={{ width: '100%', display: 'block', borderRadius: 6 }} />
                <button
                  className="sv-media-remove"
                  onClick={onRemoveImage}
                  title="Remove image"
                  type="button"
                >
                  ×
                </button>
              </div>
              {/* Editing toolbar — works for any source (bank, AI, diagram raster, camera). */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="sv-btn sv-btn-outline" style={{ fontSize: 13 }}
                  onClick={() => setEditorOpen(true)}>
                  <Icon name="crop" size={14} /> Crop / resize / rotate
                </button>
                <button type="button" className="sv-btn sv-btn-outline" style={{ fontSize: 13 }}
                  disabled={enhancingImage} onClick={onEnhanceAgain}>
                  <Icon name={enhancingImage ? 'spinner' : 'enhance'} size={14} spin={enhancingImage} /> {enhancingImage ? 'Enhancing…' : 'Enhance again'}
                </button>
                <button type="button" className="sv-btn sv-btn-outline" style={{ fontSize: 13 }}
                  onClick={() => imageInputRef.current?.click()}>
                  <Icon name="replace" size={14} /> Replace
                </button>
                <button type="button" className="sv-btn sv-btn-outline" style={{ fontSize: 13 }}
                  onClick={onRemoveImage}>
                  <Icon name="delete" size={14} /> Delete
                </button>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) onUploadImage(file)
                  e.target.value = ''
                }}
              />
            </div>
          )
        ) : question.imageUploading ? (
          <div className="sv-q-media">
            <div className="sv-ic"><Icon name="spinner" size={24} spin /></div>
            <div>Uploading image…</div>
          </div>
        ) : (
          // ONE row for the stem's picture. Picture bank, Shape · diagram and
          // Camera used to be three permanent full-width buttons stacked under
          // the drop zone on every question — four controls for something most
          // questions never use. They are now the three routes INSIDE the row.
          <div className="sv-q-media-row">
            <button type="button" className="sv-q-media" onClick={() => imageInputRef.current?.click()}>
              <div className="sv-ic"><Icon name="diagrams" size={24} /></div>
              <div>Add a diagram or image (optional)</div>
              <small>JPG, PNG or WEBP · up to 15 MB</small>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) onUploadImage(file)
                  e.target.value = ''
                }}
              />
            </button>
            <div className="sv-q-media-routes">
              <button type="button" className="sv-q-media-route" onClick={() => setBankTarget('question')}>
                <Icon name="pictureBank" size={13} /> Picture bank
              </button>
              <button type="button" className="sv-q-media-route" onClick={() => setDiagramTarget('question')}>
                <Icon name="shape" size={13} /> Shape · diagram
              </button>
              <button type="button" className="sv-q-media-route" onClick={() => setCameraOpen(true)}>
                <Icon name="camera" size={13} /> Camera
              </button>
            </div>
          </div>
        )
      )}

      {/* Additional figures from a multi-figure scanned question. They render
          stacked below the primary in the paper / exports; each can be removed. */}
      {Array.isArray(question.images) && question.images.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {question.images.map((img, i) => (
            img && img.url ? (
              <div key={img.url || i} className="sv-q-media filled filled-wrap" style={{ flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                <div style={{ position: 'relative', maxWidth: `${resolveImageWidthPercent(img.width)}%` }}>
                  <img src={img.url} alt={img.alt || ''} style={{ width: '100%', display: 'block', borderRadius: 6 }} />
                  <button
                    className="sv-media-remove"
                    onClick={() => updateQuestion('images', question.images.filter((_, j) => j !== i))}
                    title="Remove figure"
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <small style={{ color: 'var(--sv-muted, #888)' }}>Additional figure {i + 2}</small>
              </div>
            ) : null
          ))}
        </div>
      )}

      {cameraOpen && (
        <CameraCaptureModal
          onConfirm={onCameraConfirm}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {editorOpen && question.imageUrl && (
        <ImageEditorModal
          imageUrl={question.imageUrl}
          imageWidth={question.imageWidth}
          onApply={onEditorApply}
          onClose={() => setEditorOpen(false)}
        />
      )}

      <DiagramPicker
        open={diagramTarget !== null}
        initial={diagramInitial()}
        onConfirm={onConfirmDiagram}
        onClose={() => setDiagramTarget(null)}
      />

      {(isMcq || isStructured) && question.imageUrl && (
        <div className="sv-field" style={{ marginTop: 'var(--sv-s2)' }}>
          <label>Image description (alt text)</label>
          <input
            type="text"
            value={question.imageAlt || ''}
            onChange={e => updateQuestion('imageAlt', e.target.value)}
            placeholder="Describe the picture — read by screen readers and the marking AI"
          />
        </div>
      )}

      {bankTarget !== null && (
        <PictureBankPicker
          subject={paperMeta?.subject || ''}
          onClose={() => setBankTarget(null)}
          onSelect={({ url, name }) => {
            // The bank tile's name is a ready-made alt description — use it as
            // the default so picked images aren't left without alt text (which
            // the save-time validator requires for option media).
            const defaultAlt = String(name || '').trim()
            if (bankTarget === 'question') {
              updateQuestion('imageUrl', url)
              updateQuestion('imageAssetId', '')
              if (defaultAlt && !String(question.imageAlt || '').trim()) {
                updateQuestion('imageAlt', defaultAlt)
              }
            } else {
              const optionCount = Array.isArray(question.options) ? question.options.length : 4
              const existing = Array.isArray(question.optionMedia) ? question.optionMedia : []
              const next = Array.from({ length: optionCount }, (_, i) => existing[i] || null)
              next[bankTarget] = { imageUrl: url, alt: existing[bankTarget]?.alt || defaultAlt }
              updateQuestion('optionMedia', next)
            }
            setBankTarget(null)
          }}
        />
      )}

      {isMcq && (
        <McqOptions
          question={question}
          maths={mathsPaper}
          grade={paperMeta?.grade}
          maxOptions={typeof paperMeta?.mcqAnswerChoiceCount === 'number' ? paperMeta.mcqAnswerChoiceCount : undefined}
          onChangeOption={(optIndex, value) => {
            const next = [...(question.options || ['', '', '', ''])]
            next[optIndex] = value
            updateQuestion('options', next)
          }}
          onSelectCorrect={(optIndex) => updateQuestion('correctAnswer', optIndex)}
          onUploadOptionImage={onUploadOptionImage}
          onRemoveOptionImage={onRemoveOptionImage}
          onPickFromBank={(optIndex) => setBankTarget(optIndex)}
          onPickDiagram={(optIndex) => setDiagramTarget(optIndex)}
          onChangeOptionAlt={(optIndex, alt) => {
            const optionCount = Array.isArray(question.options) ? question.options.length : 4
            const existing = Array.isArray(question.optionMedia) ? question.optionMedia : []
            const next = Array.from({ length: optionCount }, (_, i) => existing[i] || null)
            const slot = next[optIndex] || {}
            next[optIndex] = { ...slot, imageUrl: slot.imageUrl || '', alt }
            updateQuestion('optionMedia', next)
          }}
        />
      )}

      {isShortAnswer && (
        hasSubParts(question)
          ? <SubPartsEditor question={question} onUpdate={updateQuestion} />
          : (
            <>
              <ShortAnswerInputs
                correctAnswer={question.correctAnswer}
                onChange={value => updateQuestion('correctAnswer', value)}
                maths={mathsPaper}
                grade={paperMeta?.grade}
                fieldId={`q:${question.localId}:answer`}
              />
              <AnswerSpaceControl question={question} onUpdate={updateQuestion} />
              <SplitIntoPartsButton question={question} onUpdate={updateQuestion} />
            </>
          )
      )}

      {isFillBlanks && (
        <FillBlanksInputs question={question} onUpdate={updateQuestion} />
      )}

      {isStructured && !isMcq && (
        <>
          <div className="sv-field" style={{ marginBottom: 'var(--sv-s2)' }}>
            <label>Word bank (optional, separate with · or comma)</label>
            <input
              type="text"
              value={Array.isArray(question.wordBank) ? question.wordBank.join(' · ') : (question.wordBank || '')}
              onChange={e => updateQuestion('wordBank', e.target.value.split(/[·,]/).map(s => s.trim()).filter(Boolean))}
              placeholder="e.g. Lungs · Mouth · Nose · Trachea · Bronchi"
            />
          </div>
          {Number.isFinite(Number(question.drawingHeight)) && Number(question.drawingHeight) > 0 && (
            <div className="sv-field" style={{ marginBottom: 'var(--sv-s2)' }}>
              <label>Drawing canvas height: {Math.round(Number(question.drawingHeight))} pt</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={80}
                  max={500}
                  step={10}
                  value={Number(question.drawingHeight)}
                  onChange={e => updateQuestion('drawingHeight', Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => updateQuestion('drawingHeight', null)}
                  style={{ padding: '2px 10px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'transparent', cursor: 'pointer', fontSize: 11, color: 'var(--sv-muted)' }}
                  title="Remove the blank drawing canvas"
                >
                  Remove canvas
                </button>
              </div>
            </div>
          )}
          <ShortAnswerInputs
            correctAnswer={question.correctAnswer}
            onChange={value => updateQuestion('correctAnswer', value)}
            label="Expected response / marking notes"
            lines={4}
            maths={mathsPaper}
            grade={paperMeta?.grade}
            fieldId={`q:${question.localId}:answer`}
          />
          <AnswerSpaceControl question={question} onUpdate={updateQuestion} />
        </>
      )}

      {isEssay && (
        <div className="sv-answer-lines">
          <div className="sv-answer-meta"><Icon name="ruler" size={13} /> Answer space: One page (rendered on print)</div>
          <textarea
            value={String(question.correctAnswer ?? '')}
            onChange={e => updateQuestion('correctAnswer', e.target.value)}
            placeholder="Marking notes / sample answer (not printed on the question paper)"
            rows={3}
            style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 8, fontSize: 13, background: 'var(--sv-paper)', fontFamily: 'inherit', resize: 'vertical' }}
          />
        </div>
      )}

      {isNumeric && (
        <NumericInputs
          correctAnswer={question.correctAnswer}
          tolerance={question.numericTolerance}
          unit={question.numericUnit}
          onChangeAnswer={value => updateQuestion('correctAnswer', value)}
          onChangeTolerance={value => updateQuestion('numericTolerance', value)}
          onChangeUnit={value => updateQuestion('numericUnit', value)}
        />
      )}

      {isMatching && (
        <MatchingInputs
          left={question.matchingLeft || []}
          right={question.matchingRight || []}
          answer={question.matchingAnswer || []}
          onChangeLeft={value => updateQuestion('matchingLeft', value)}
          onChangeRight={value => updateQuestion('matchingRight', value)}
          onChangeAnswer={value => updateQuestion('matchingAnswer', value)}
        />
      )}

      {isSequence && (
        <SequenceInputs
          items={question.sequenceItems || []}
          answer={question.sequenceAnswer || []}
          onChangeItems={value => updateQuestion('sequenceItems', value)}
          onChangeAnswer={value => updateQuestion('sequenceAnswer', value)}
        />
      )}

      {question.tableData && (
        <DataTableInputs
          tableData={question.tableData}
          onChange={value => updateQuestion('tableData', value)}
        />
      )}

      {suggestError && (
        <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 'var(--sv-r-sm)', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="warn" size={13} /> {suggestError}
        </div>
      )}

      {aiSuggestion && (
        <AiSuggestionNotice
          rationale={aiSuggestion.rationale}
          confidence={aiSuggestion.confidence}
          routedTo={aiSuggestion.routedTo}
          onConfirm={() => setAiSuggestion(null)}
        />
      )}

      <div className="sv-q-footer">
        {question.topic && <span className="sv-q-mapping-tag"><Icon name="target" size={12} /> {question.topic}</span>}
        {parts.length > 0 && (
          <select
            value={question.partId || ''}
            onChange={e => onAssignSectionToPart(section.id, e.target.value)}
            style={{ padding: '3px 8px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'var(--sv-tinted)', fontSize: 11.5, color: 'var(--sv-muted)' }}
          >
            <option value="">No section</option>
            {parts.map(p => <option key={p.id} value={p.id}>{p.title || 'Untitled'}</option>)}
          </select>
        )}
        <div className="sv-q-mini-actions">
          <button onClick={() => onEditQuestion(question.localId)}><Icon name="edit" size={13} /> Edit details</button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete question ${questionNumber}?`}
        message="The question and everything on it — options, answer, marks and any figure — are removed from this paper. You can undo this with Ctrl+Z."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => { setConfirmDeleteOpen(false); onRemoveSection(sectionIndex) }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  )
}

