import { useRef, useState } from 'react'
import { QUESTION_LETTERS } from '../../utils/quizSections.js'
import { clampInt } from '../../utils/inputs.js'

// PRISCA mock-paper question subtypes. Storage shape stays as 4-option MCQ;
// these labels just drive the editor preset — option input style, badge text.
const SUBTYPE_OPTIONS = [
  { value: '', label: 'Standard MCQ' },
  { value: 'vocab', label: 'Vocabulary / Meaning' },
  { value: 'spelling', label: 'Spelling' },
  { value: 'punctuation', label: 'Punctuation' },
  { value: 'sentence_ordering', label: 'Sentence ordering' },
]
const SUBTYPE_LABEL = Object.fromEntries(SUBTYPE_OPTIONS.map(option => [option.value, option.label]))
const PART_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

function partLabel(index) {
  return `Part ${PART_LETTERS[index] ?? index + 1}`
}
// Tiptap-based rich field (new). Accepts HTML strings or Tiptap JSON on the
// way in (legacy quizzes render fine) and emits Tiptap JSON. Saving passes
// the JSON straight through to Firestore.
import QuizRichField from './QuizRichField'
// RichContent is format-aware — handles both legacy HTML and Tiptap JSON.
// Used wherever we previously showed RichTextContent.
import RichContent from '../../editor/RichContent'

const THEMES = {
  create: {
    focus: 'focus:border-[var(--accent)]',
    accentText: 'theme-accent-text',
    accentSoftText: 'theme-text-muted',
    badge: 'theme-accent-bg theme-accent-text',
    cardBorder: 'theme-border',
    cardSoft: 'theme-bg-subtle',
    button: 'theme-border theme-accent-text hover:border-[var(--accent)] hover:theme-accent-bg',
    primaryButton: 'theme-accent-fill theme-on-accent hover:opacity-90',
    uploadBorder: 'theme-border hover:border-[var(--accent)] hover:theme-accent-bg',
    uploadFrame: 'theme-accent-bg theme-border',
    radioBorder: 'border-[var(--accent)] theme-accent-bg',
    ring: 'ring-[var(--border)]',
  },
  edit: {
    focus: 'focus:border-[var(--accent)]',
    accentText: 'theme-accent-text',
    accentSoftText: 'theme-text-muted',
    badge: 'theme-accent-bg theme-accent-text',
    cardBorder: 'theme-border',
    cardSoft: 'theme-bg-subtle',
    button: 'theme-border theme-accent-text hover:border-[var(--accent)] hover:theme-accent-bg',
    primaryButton: 'theme-accent-fill theme-on-accent hover:opacity-90',
    uploadBorder: 'theme-border hover:border-[var(--accent)] hover:theme-accent-bg',
    uploadFrame: 'theme-accent-bg theme-border',
    radioBorder: 'border-[var(--accent)] theme-accent-bg',
    ring: 'ring-[var(--border)]',
  },
}

const FIELD_BASE = 'theme-input w-full rounded-xl border-2 px-3 py-2.5 text-sm placeholder:text-gray-400 outline-none transition-colors'
const SMALL_FIELD_BASE = 'theme-input w-full rounded-lg border px-2.5 py-2 text-xs placeholder:text-gray-400 outline-none transition-colors'

function joinClasses(...parts) {
  return parts.filter(Boolean).join(' ')
}

function fieldClass(theme) {
  return joinClasses(FIELD_BASE, theme.focus)
}

function smallFieldClass(theme) {
  return joinClasses(SMALL_FIELD_BASE, theme.focus)
}

function FieldHeader({ title, note, badge }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="theme-text text-xs font-black uppercase tracking-wide">{title}</p>
      {badge && <span className="theme-accent-bg theme-accent-text rounded-full px-2 py-0.5 text-[10px] font-black">{badge}</span>}
      {note && <span className="theme-text-muted text-xs font-bold">{note}</span>}
    </div>
  )
}

function ImageUpload({
  label,
  hint,
  imageUrl,
  uploading,
  uploadStep,
  onFileSelect,
  onRemove,
  theme,
}) {
  const inputRef = useRef(null)

  function handleChange(event) {
    const file = event.target.files?.[0]
    if (file) onFileSelect(file)
    event.target.value = ''
  }

  if (uploading) {
    const isCompressing = uploadStep === 'compressing'
    return (
      <div className={joinClasses('rounded-xl border-2 p-4 text-center space-y-2', theme.uploadFrame)}>
        <div className="flex items-center justify-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-current" />
          <p className={joinClasses('text-sm font-bold', theme.accentText)}>
            {isCompressing ? 'Compressing image...' : 'Uploading...'}
          </p>
        </div>
        <div className="theme-text-muted flex items-center justify-center gap-2 text-xs">
          <span className={joinClasses('font-bold', isCompressing ? '' : theme.accentText)}>{isCompressing ? 'Compress' : '✓ Compress'}</span>
          <span>→</span>
          <span className={isCompressing ? 'opacity-60' : 'font-bold'}>{isCompressing ? 'Upload' : 'Uploading'}</span>
        </div>
      </div>
    )
  }

  if (imageUrl) {
    return (
      <div className={joinClasses('group theme-bg-subtle relative overflow-hidden rounded-xl border-2', theme.cardBorder)}>
        <img src={imageUrl} alt={label} className="mx-auto max-h-[60vh] w-full object-contain py-2" />
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-90 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="theme-card theme-border theme-text hover:theme-card-hover min-h-0 rounded-lg border px-3 py-1.5 text-xs font-bold shadow"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="min-h-0 rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-bold text-white shadow hover:bg-red-600"
          >
            Remove
          </button>
        </div>
        <p className="theme-text-muted pb-1 text-center text-xs">{hint}</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleChange}
        />
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={joinClasses(
          'group w-full min-h-0 rounded-xl border-2 border-dashed p-5 text-center transition-all bg-transparent shadow-none',
          theme.uploadBorder,
        )}
      >
        <div className="mb-1.5 inline-block text-3xl transition-transform group-hover:scale-110">🖼️</div>
        <p className="theme-text text-sm font-bold">{label}</p>
        <p className="theme-text-muted mt-0.5 text-xs">{hint}</p>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}

function StandaloneQuestionCard({
  question,
  questionNumber,
  totalQuestions,
  sectionIndex,
  totalSections,
  sectionId,
  parts,
  isNew,
  onChange,
  onRemove,
  onMove,
  onImageUpload,
  onImageRemove,
  onAssignToPart,
  theme,
}) {
  function set(field, value) {
    onChange(sectionIndex, field, value)
  }

  function setOption(optionIndex, value) {
    const nextOptions = [...question.options]
    nextOptions[optionIndex] = value
    onChange(sectionIndex, 'options', nextOptions)
  }

  const isTrueFalse = question.type === 'truefalse'
  const isFill = question.type === 'fill'
  const isTextAnswer = question.type === 'short_answer' || question.type === 'diagram' || isFill
  const subtype = question.subtype ?? null
  const subtypeBadge = subtype ? SUBTYPE_LABEL[subtype] : null
  // Spelling and punctuation options must persist as plain strings — Tiptap
  // would normalize whitespace and obscure the very characters being judged.
  const optionsAsPlainText = subtype === 'spelling' || subtype === 'punctuation' || subtype === 'sentence_ordering'
  const optionsAsTextarea = subtype === 'sentence_ordering'

  return (
    <div
      className={joinClasses(
        'theme-card theme-text space-y-4 rounded-2xl border-2 p-5 shadow-sm transition-colors',
        isNew ? joinClasses(theme.cardBorder, 'ring-2', theme.ring) : 'theme-border',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={joinClasses('rounded-full px-3 py-1 text-xs font-black', theme.badge)}>
            Q{questionNumber} of {totalQuestions}
          </span>
          {subtypeBadge && (
            <span className="theme-bg-subtle theme-text rounded-full border theme-border px-2 py-0.5 text-[11px] font-black">
              {subtypeBadge}
            </span>
          )}
          {isNew && <span className="theme-text-muted text-xs font-bold">New question</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={question.type}
            onChange={event => {
              const nextType = event.target.value
              set('type', nextType)
              if (nextType === 'truefalse') {
                onChange(sectionIndex, 'options', ['True', 'False'])
                onChange(sectionIndex, 'correctAnswer', 0)
              } else if (nextType === 'short_answer' || nextType === 'diagram' || nextType === 'fill') {
                onChange(sectionIndex, 'options', [])
                onChange(sectionIndex, 'correctAnswer', typeof question.correctAnswer === 'string' ? question.correctAnswer : '')
                // Subtype only makes sense for MCQ — clear it on type change.
                if (question.subtype) onChange(sectionIndex, 'subtype', null)
              } else if (question.options.length < 4) {
                onChange(sectionIndex, 'options', ['', '', '', ''])
                onChange(sectionIndex, 'correctAnswer', 0)
              }
            }}
            className={joinClasses('theme-input rounded-lg border px-2 py-1 text-xs outline-none', theme.focus)}
          >
            <option value="mcq">MCQ (4 options)</option>
            <option value="truefalse">True / False</option>
            <option value="short_answer">Short Answer</option>
            <option value="fill">Fill in the blank</option>
            <option value="diagram">Diagram / Image</option>
          </select>
          {question.type === 'mcq' && (
            <select
              value={question.subtype ?? ''}
              onChange={event => set('subtype', event.target.value || null)}
              className={joinClasses('theme-input rounded-lg border px-2 py-1 text-xs outline-none', theme.focus)}
              title="MCQ subtype — controls option input style"
            >
              {SUBTYPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
          {Array.isArray(parts) && parts.length > 0 && onAssignToPart && (
            <select
              value={question.partId ?? ''}
              onChange={event => onAssignToPart(sectionId, event.target.value || null)}
              className={joinClasses('theme-input rounded-lg border px-2 py-1 text-xs outline-none', theme.focus)}
              title="Move this question into a Part"
            >
              <option value="">Ungrouped</option>
              {parts.map((part, partIndex) => (
                <option key={part.id} value={part.id}>{partLabel(partIndex)} · {part.title || 'Untitled'}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => onMove(sectionIndex, -1)}
            disabled={sectionIndex === 0}
            className="theme-text-muted min-h-0 bg-transparent p-1 text-sm shadow-none hover:theme-text disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(sectionIndex, 1)}
            disabled={sectionIndex === totalSections - 1}
            className="theme-text-muted min-h-0 bg-transparent p-1 text-sm shadow-none hover:theme-text disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onRemove(sectionIndex)}
            className="min-h-0 rounded-lg bg-transparent px-2 py-1 text-xs font-bold text-red-500 shadow-none hover:bg-red-50 hover:text-red-600"
          >
            Remove
          </button>
        </div>
      </div>

      {question.requiresReview && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-black text-amber-900">Needs review</p>
          <ul className="mt-1 space-y-0.5">
            {(question.reviewNotes || question.importWarnings || ['Check this question before publishing.']).slice(0, 3).map((note, index) => (
              <li key={`${note}-${index}`} className="text-xs font-bold leading-relaxed text-amber-800">{note}</li>
            ))}
          </ul>
        </div>
      )}

      <ImageUpload
        label="Upload Question Image"
        hint="Optional · JPG, PNG, WEBP · max 5 MB"
        imageUrl={question.imageUrl}
        uploading={question.imageUploading}
        uploadStep={question.imageUploadStep}
        onFileSelect={file => onImageUpload(sectionIndex, file)}
        onRemove={() => onImageRemove(sectionIndex)}
        theme={theme}
      />

      <div className="space-y-2">
        <FieldHeader title="Instructions" badge="Optional" />
        <QuizRichField
          value={question.sharedInstruction}
          onChange={nextValue => set('sharedInstruction', nextValue)}
          placeholder="Add shared instructions for this question..."
          minHeight={96}
          compact
        />
      </div>

      <div className="space-y-2">
        <FieldHeader title="Question Text" badge="Required" />
        <QuizRichField
          value={question.text}
          onChange={nextValue => set('text', nextValue)}
          placeholder={question.imageUrl ? 'Describe what is shown in the image above, or ask your question...' : 'Write your question here...'}
          minHeight={144}
        />
      </div>

      {isTextAnswer ? (
        <div className="space-y-2">
          <p className="theme-text-muted text-xs font-bold">
            {isFill
              ? 'Fill in the blank — list every accepted answer separated by commas'
              : 'Short answer - expected answer recommended for accurate AI checking'}
          </p>
          <div className="theme-accent-bg flex items-center gap-2 rounded-xl border-2 border-[var(--accent)] p-3">
            <span className={joinClasses('text-lg', theme.accentText)}>✅</span>
            <input
              value={typeof question.correctAnswer === 'string' ? question.correctAnswer : ''}
              onChange={event => set('correctAnswer', event.target.value)}
              placeholder={isFill ? 'e.g. independence, freedom' : 'Expected answer (recommended)'}
              className="theme-text flex-1 border-none bg-transparent text-sm font-semibold outline-none"
            />
          </div>
          <p className="theme-text-muted text-xs">
            {isFill
              ? 'Use commas to accept multiple spellings or synonyms.'
              : 'If left blank, AI will judge from the question, subject, and grade.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="theme-text-muted text-xs font-bold">
            {optionsAsTextarea
              ? 'Sentence-ordering — paste each candidate paragraph variant as one option'
              : 'Answer choices - click the radio to mark the correct one'}
          </p>
          {question.options.map((option, optionIndex) => (
            <label
              key={`${question.localId}-${optionIndex}`}
              className={joinClasses(
                'flex cursor-pointer gap-3 rounded-xl border-2 p-3 transition-colors',
                optionsAsTextarea ? 'items-start' : 'items-center',
                question.correctAnswer === optionIndex ? theme.radioBorder : 'theme-border hover:border-[var(--accent)]',
              )}
            >
              <input
                type="radio"
                name={`standalone-correct-${question.localId}`}
                checked={question.correctAnswer === optionIndex}
                onChange={() => set('correctAnswer', optionIndex)}
                className={joinClasses('accent-[var(--accent)] flex-shrink-0', optionsAsTextarea && 'mt-2')}
              />
              <span className={joinClasses(
                'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-black',
                optionsAsTextarea && 'mt-1',
                question.correctAnswer === optionIndex ? 'theme-accent-fill theme-on-accent' : 'theme-bg-subtle theme-text-muted',
              )}>
                {isTrueFalse ? (optionIndex === 0 ? 'T' : 'F') : QUESTION_LETTERS[optionIndex]}
              </span>
              {optionsAsTextarea ? (
                <textarea
                  value={typeof option === 'string' ? option : ''}
                  onChange={event => setOption(optionIndex, event.target.value)}
                  placeholder={`Paragraph ordering ${QUESTION_LETTERS[optionIndex]}`}
                  rows={4}
                  className="theme-text flex-1 resize-y border-none bg-transparent text-sm leading-relaxed outline-none"
                />
              ) : (
                <input
                  value={typeof option === 'string' ? option : ''}
                  onChange={event => setOption(optionIndex, event.target.value)}
                  placeholder={isTrueFalse ? (optionIndex === 0 ? 'True' : 'False') : `Option ${QUESTION_LETTERS[optionIndex]}`}
                  disabled={isTrueFalse}
                  className="theme-text flex-1 border-none bg-transparent text-sm outline-none disabled:opacity-80"
                  spellCheck={!optionsAsPlainText}
                />
              )}
              {question.correctAnswer === optionIndex && (
                <span className={joinClasses('flex-shrink-0 text-xs font-black', optionsAsTextarea && 'mt-2', theme.accentText)}>✓ Correct</span>
              )}
            </label>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <textarea
          value={question.diagramText || ''}
          onChange={event => set('diagramText', event.target.value)}
          placeholder="Diagram description (optional)"
          rows={2}
          className={joinClasses('theme-input w-full resize-none rounded-xl border px-3 py-2 text-xs placeholder:text-gray-400 outline-none', theme.focus)}
        />
        <div className="space-y-2">
          <FieldHeader title="Explanation" badge="Shown after attempt" />
          <QuizRichField
            value={question.explanation}
            onChange={nextValue => set('explanation', nextValue)}
            placeholder="Explain the answer, steps, or reasoning..."
            minHeight={112}
            compact
          />
        </div>
        <div className="flex gap-2">
          <input
            value={question.topic}
            onChange={event => set('topic', event.target.value)}
            placeholder="Topic (e.g. Fractions)"
            className={joinClasses('flex-1', smallFieldClass(theme))}
          />
          <div className="theme-border flex items-center gap-1.5 rounded-lg border px-2.5 py-2">
            <span className="theme-text-muted text-xs font-bold">Marks:</span>
            <input
              type="number"
              min={1}
              max={10}
              value={question.marks}
              onChange={event => set('marks', clampInt(event.target.value, 1, 10, 1))}
              className="theme-text w-10 bg-transparent text-center text-xs font-black outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function PassageQuestionCard({
  question,
  questionIndex,
  questionNumber,
  totalPassageQuestions,
  totalQuestions,
  sectionIndex,
  onChange,
  onRemove,
  onMove,
}) {
  function set(field, value) {
    onChange(sectionIndex, questionIndex, field, value)
  }

  function setOption(optionIndex, value) {
    const nextOptions = [...question.options]
    nextOptions[optionIndex] = value
    onChange(sectionIndex, questionIndex, 'options', nextOptions)
  }

  const subtype = question.subtype ?? null
  const subtypeBadge = subtype ? SUBTYPE_LABEL[subtype] : null
  const optionsAsPlainText = subtype === 'spelling' || subtype === 'punctuation' || subtype === 'sentence_ordering'
  const optionsAsTextarea = subtype === 'sentence_ordering'

  return (
    <div className="theme-card theme-border theme-text space-y-4 rounded-2xl border p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="theme-accent-bg theme-accent-text rounded-full px-3 py-1 text-xs font-black">
            Q{questionNumber} of {totalPassageQuestions}
          </span>
          {subtypeBadge && (
            <span className="theme-bg-subtle theme-text rounded-full border theme-border px-2 py-0.5 text-[11px] font-black">
              {subtypeBadge}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={question.subtype ?? ''}
            onChange={event => set('subtype', event.target.value || null)}
            className="theme-input rounded-lg border px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
            title="MCQ subtype"
          >
            {SUBTYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onMove(sectionIndex, questionIndex, -1)}
            disabled={questionIndex === 0}
            className="theme-text-muted min-h-0 bg-transparent p-1 text-sm shadow-none hover:theme-text disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(sectionIndex, questionIndex, 1)}
            disabled={questionIndex === totalPassageQuestions - 1}
            className="theme-text-muted min-h-0 bg-transparent p-1 text-sm shadow-none hover:theme-text disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onRemove(sectionIndex, questionIndex)}
            className="min-h-0 rounded-lg bg-transparent px-2 py-1 text-xs font-bold text-red-500 shadow-none hover:bg-red-50 hover:text-red-600"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <FieldHeader title="Question Text" badge="Required" />
        <QuizRichField
          value={question.text}
          onChange={nextValue => set('text', nextValue)}
          placeholder="Write the question for this passage..."
          minHeight={128}
          compact
        />
      </div>

      <div className="space-y-2">
        <p className="theme-text-muted text-xs font-bold">
          {optionsAsTextarea
            ? 'Sentence-ordering — paste each candidate paragraph variant as one option'
            : 'Answer choices'}
        </p>
        {QUESTION_LETTERS.map((letter, optionIndex) => (
          <label
            key={`${question.localId}-${letter}`}
            className={joinClasses(
              'flex cursor-pointer gap-3 rounded-xl border-2 p-3 transition-colors',
              optionsAsTextarea ? 'items-start' : 'items-center',
              question.correctAnswer === optionIndex ? 'border-[var(--accent)] theme-accent-bg' : 'theme-border hover:border-[var(--accent)]',
            )}
          >
            <input
              type="radio"
              name={`passage-correct-${question.localId}`}
              checked={question.correctAnswer === optionIndex}
              onChange={() => set('correctAnswer', optionIndex)}
              className={joinClasses('accent-[var(--accent)] flex-shrink-0', optionsAsTextarea && 'mt-2')}
            />
            <span className={joinClasses(
              'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-black',
              optionsAsTextarea && 'mt-1',
              question.correctAnswer === optionIndex ? 'theme-accent-fill theme-on-accent' : 'theme-bg-subtle theme-text-muted',
            )}>
              {letter}
            </span>
            {optionsAsTextarea ? (
              <textarea
                value={question.options[optionIndex] || ''}
                onChange={event => setOption(optionIndex, event.target.value)}
                placeholder={`Paragraph ordering ${letter}`}
                rows={4}
                className="theme-text flex-1 resize-y border-none bg-transparent text-sm leading-relaxed outline-none"
              />
            ) : (
              <input
                value={question.options[optionIndex] || ''}
                onChange={event => setOption(optionIndex, event.target.value)}
                placeholder={`Option ${letter}`}
                className="theme-text flex-1 border-none bg-transparent text-sm outline-none"
                spellCheck={!optionsAsPlainText}
              />
            )}
          </label>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <input
          value={question.topic}
          onChange={event => set('topic', event.target.value)}
          placeholder="Topic (optional)"
          className="theme-input rounded-lg border px-2.5 py-2 text-xs placeholder:text-gray-400 outline-none focus:border-[var(--accent)]"
        />
        <div className="theme-border flex items-center gap-1.5 rounded-lg border px-2.5 py-2">
          <span className="theme-text-muted text-xs font-bold">Marks:</span>
          <input
            type="number"
            min={1}
            max={10}
            value={question.marks}
            onChange={event => set('marks', clampInt(event.target.value, 1, 10, 1))}
            className="theme-text w-10 bg-transparent text-center text-xs font-black outline-none"
          />
        </div>
      </div>

      <div className="space-y-2">
        <FieldHeader title="Explanation" badge="Shown after attempt" />
        <QuizRichField
          value={question.explanation}
          onChange={nextValue => set('explanation', nextValue)}
          placeholder="Add the explanation for this passage question..."
          minHeight={96}
          compact
        />
      </div>
    </div>
  )
}

function PassageSectionCard({
  section,
  sectionIndex,
  totalSections,
  totalQuestions,
  questionNumbers,
  storyNumber,
  parts,
  theme,
  onPassageChange,
  onPassageToggle,
  onPassageRemove,
  onPassageMove,
  onPassageImageUpload,
  onPassageImageRemove,
  onPassageQuestionChange,
  onPassageQuestionRemove,
  onPassageQuestionMove,
  onPassageAddQuestion,
  onAssignToPart,
}) {
  const passage = section.passage
  const isCollapsed = Boolean(passage.collapsed)
  const childNumbers = (passage.questions || [])
    .map(question => questionNumbers[question.localId])
    .filter(Boolean)
  const firstQ = childNumbers[0]
  const lastQ = childNumbers[childNumbers.length - 1]
  const questionRangeLabel = firstQ
    ? (firstQ === lastQ ? `QUESTION ${firstQ}` : `QUESTIONS ${firstQ}-${lastQ}`)
    : null

  return (
    <div className="theme-accent-bg theme-text theme-border space-y-4 rounded-2xl border-2 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {storyNumber ? (
              <span className="theme-card theme-border theme-accent-text rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide">
                Story {storyNumber}
              </span>
            ) : (
              <span className="theme-card theme-border theme-accent-text rounded-full border px-3 py-1 text-xs font-black">
                Comprehension Passage
              </span>
            )}
            {questionRangeLabel && (
              <span className="theme-accent-text rounded-full bg-white/40 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide">
                {questionRangeLabel}
              </span>
            )}
            <span className="theme-accent-text text-xs font-bold">
              {passage.questions.length} question{passage.questions.length === 1 ? '' : 's'}
            </span>
          </div>
          {!isCollapsed && (
            <p className="theme-text mt-2 text-sm font-bold leading-relaxed">
              Add the passage once, then attach all related questions below it.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.isArray(parts) && parts.length > 0 && onAssignToPart && (
            <select
              value={section.partId ?? ''}
              onChange={event => onAssignToPart(section.id, event.target.value || null)}
              className="theme-input rounded-lg border px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
              title="Move this passage into a Part"
            >
              <option value="">Ungrouped</option>
              {parts.map((part, partIndex) => (
                <option key={part.id} value={part.id}>{partLabel(partIndex)} · {part.title || 'Untitled'}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => onPassageToggle(sectionIndex)}
            className="theme-card theme-border theme-accent-text hover:theme-card-hover min-h-0 rounded-lg border px-3 py-1.5 text-xs font-bold shadow-sm"
          >
            {isCollapsed ? 'Expand' : 'Collapse'}
          </button>
          <button
            type="button"
            onClick={() => onPassageMove(sectionIndex, -1)}
            disabled={sectionIndex === 0}
            className="theme-text-muted min-h-0 bg-transparent p-1 text-sm shadow-none hover:theme-text disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onPassageMove(sectionIndex, 1)}
            disabled={sectionIndex === totalSections - 1}
            className="theme-text-muted min-h-0 bg-transparent p-1 text-sm shadow-none hover:theme-text disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onPassageRemove(sectionIndex)}
            className="min-h-0 rounded-lg bg-transparent px-2 py-1 text-xs font-bold text-red-500 shadow-none hover:bg-red-50 hover:text-red-600"
          >
            Remove
          </button>
        </div>
      </div>

      {isCollapsed ? (
        <div className="theme-card theme-border rounded-xl border px-4 py-3">
          <p className="theme-text text-sm font-black">{passage.title || 'Untitled passage'}</p>
          {passage.passageText ? (
            <RichContent value={passage.passageText} className="theme-text-muted mt-2 line-clamp-3 text-sm leading-relaxed" />
          ) : (
            <p className="theme-text-muted mt-1 text-sm leading-relaxed">No passage text yet.</p>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="theme-card theme-border space-y-3 rounded-2xl border p-4">
              <h3 className="theme-text text-sm font-black">Passage</h3>
              <input
                value={passage.title}
                onChange={event => onPassageChange(sectionIndex, 'title', event.target.value)}
                placeholder="Title (optional)"
                className="theme-input w-full rounded-xl border-2 px-3 py-2.5 text-sm placeholder:text-gray-400 outline-none focus:border-[var(--accent)]"
              />
              <div className="space-y-2">
                <FieldHeader title="Instructions" badge="Optional" />
                <QuizRichField
                  value={passage.instructions}
                  onChange={nextValue => onPassageChange(sectionIndex, 'instructions', nextValue)}
                  placeholder="Add optional instructions for this passage..."
                  minHeight={96}
                  compact
                />
              </div>
              <div className="space-y-2">
                <FieldHeader title="Passage / Story" badge="Required" />
                <QuizRichField
                  value={passage.passageText}
                  onChange={nextValue => onPassageChange(sectionIndex, 'passageText', nextValue)}
                  placeholder="Paste or type the passage / story here..."
                  minHeight={256}
                />
              </div>
              <ImageUpload
                label="Upload Passage Image"
                hint="Optional · JPG, PNG, WEBP · max 5 MB"
                imageUrl={passage.imageUrl}
                uploading={passage.imageUploading}
                uploadStep={passage.imageUploadStep}
                onFileSelect={file => onPassageImageUpload(sectionIndex, file)}
                onRemove={() => onPassageImageRemove(sectionIndex)}
                theme={theme}
              />
            </div>

            <div className="space-y-3">
              <div className="theme-card theme-border rounded-2xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="theme-text text-sm font-black">Questions Under Passage</h3>
                    <p className="theme-text-muted mt-1 text-xs font-bold">Each question stays linked to this passage.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onPassageAddQuestion(sectionIndex)}
                    className="theme-accent-fill theme-on-accent min-h-0 rounded-xl px-4 py-2 text-sm font-black hover:opacity-90"
                  >
                    + Add Question to Passage
                  </button>
                </div>
              </div>

              {passage.questions.length === 0 ? (
                <div className="theme-card theme-border rounded-2xl border-2 border-dashed px-4 py-8 text-center">
                  <p className="theme-text font-bold">No linked questions yet</p>
                  <p className="theme-text-muted mt-1 text-sm">Add at least one question before saving this quiz.</p>
                </div>
              ) : (
                passage.questions.map((question, questionIndex) => (
                  <PassageQuestionCard
                    key={question.localId}
                    question={question}
                    questionIndex={questionIndex}
                    questionNumber={questionNumbers[question.localId] || questionIndex + 1}
                    totalPassageQuestions={passage.questions.length}
                    totalQuestions={totalQuestions}
                    sectionIndex={sectionIndex}
                    onChange={onPassageQuestionChange}
                    onRemove={onPassageQuestionRemove}
                    onMove={onPassageQuestionMove}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function AddQuestionMenu({ onAddStandalone, onAddPassage, variant }) {
  const [open, setOpen] = useState(false)
  const theme = THEMES[variant] || THEMES.create

  function choose(action) {
    action()
    setOpen(false)
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className={joinClasses(
          'w-full min-h-0 rounded-2xl border-2 border-dashed py-4 font-black transition-all',
          theme.button,
        )}
      >
        + Add Question
      </button>
      {open && (
        <div className="theme-card theme-border grid gap-3 rounded-2xl border p-4 shadow-sm md:grid-cols-2">
          <button
            type="button"
            onClick={() => choose(onAddStandalone)}
            className="theme-bg-subtle theme-border hover:theme-card min-h-0 rounded-2xl border-2 p-4 text-left transition-colors"
          >
            <p className="theme-text text-sm font-black">Multiple Choice</p>
            <p className="theme-text-muted mt-1 text-xs font-bold leading-relaxed">
              Add a normal standalone question. You can still switch it to true/false, short answer, or diagram later.
            </p>
          </button>
          <button
            type="button"
            onClick={() => choose(onAddPassage)}
            className="theme-accent-bg theme-border hover:theme-card min-h-0 rounded-2xl border-2 p-4 text-left transition-colors"
          >
            <p className="theme-accent-text text-sm font-black">Comprehension Passage</p>
            <p className="theme-text-muted mt-1 text-xs font-bold leading-relaxed">
              Add one passage or story, then attach multiple linked questions under it.
            </p>
          </button>
        </div>
      )}
    </div>
  )
}

function PartCard({
  part,
  partIndex,
  totalParts,
  theme,
  children,
  memberCount,
  onChange,
  onMove,
  onRemove,
}) {
  const [exampleOpen, setExampleOpen] = useState(false)
  return (
    <div className="theme-card theme-border space-y-4 rounded-2xl border p-5 shadow-elev-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <span className={joinClasses('rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide', theme.badge)}>
            {partLabel(partIndex)}
          </span>
          <input
            value={part.title}
            onChange={event => onChange(part.id, 'title', event.target.value)}
            placeholder='Part title (e.g. "QUESTIONS 1-15")'
            className={joinClasses('flex-1 min-w-0 rounded-xl border-2 px-3 py-2 text-sm font-black outline-none transition-colors theme-input', theme.focus)}
          />
          <span className="theme-text-muted whitespace-nowrap text-xs font-bold">
            {memberCount} {memberCount === 1 ? 'item' : 'items'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onMove(part.id, -1)}
            disabled={partIndex === 0}
            className="theme-text-muted min-h-0 bg-transparent p-1 text-sm shadow-none hover:theme-text disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(part.id, 1)}
            disabled={partIndex === totalParts - 1}
            className="theme-text-muted min-h-0 bg-transparent p-1 text-sm shadow-none hover:theme-text disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onRemove(part.id)}
            className="min-h-0 rounded-lg bg-transparent px-2 py-1 text-xs font-bold text-red-500 shadow-none hover:bg-red-50 hover:text-red-600"
          >
            Remove Part
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <FieldHeader title="Part instructions" badge="Optional" />
        <QuizRichField
          value={part.instructions}
          onChange={nextValue => onChange(part.id, 'instructions', nextValue)}
          placeholder="Add the shared instructions for this Part (e.g. 'Each question contains a sentence from which a word is missing...')"
          minHeight={96}
          compact
        />
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setExampleOpen(open => !open)}
          className="theme-text-muted hover:theme-text min-h-0 bg-transparent px-0 py-0 text-xs font-black uppercase tracking-wide shadow-none"
        >
          {exampleOpen ? '▾' : '▸'} Worked Example {exampleOpen ? '' : '(optional)'}
        </button>
        {exampleOpen && (
          <QuizRichField
            value={part.example}
            onChange={nextValue => onChange(part.id, 'example', nextValue)}
            placeholder="Add a worked example (shown to learners before the Part's questions)..."
            minHeight={96}
            compact
          />
        )}
      </div>

      {memberCount === 0 ? (
        <div className="theme-bg-subtle theme-border rounded-xl border-2 border-dashed px-4 py-6 text-center">
          <p className="theme-text-muted text-xs font-bold">No questions in this Part yet — use a question's "Move to Part" dropdown below to add one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {children}
        </div>
      )}
    </div>
  )
}

export default function QuizSectionsEditor({
  variant = 'create',
  sections,
  parts = [],
  questionNumbers,
  totalQuestions,
  onStandaloneChange,
  onStandaloneRemove,
  onStandaloneMove,
  onStandaloneImageUpload,
  onStandaloneImageRemove,
  onPassageChange,
  onPassageToggle,
  onPassageRemove,
  onPassageMove,
  onPassageImageUpload,
  onPassageImageRemove,
  onPassageQuestionChange,
  onPassageQuestionRemove,
  onPassageQuestionMove,
  onPassageAddQuestion,
  onAddStandalone,
  onAddPassage,
  onAddPart,
  onPartChange,
  onPartMove,
  onPartRemove,
  onAssignSectionToPart,
  onShuffleSections,
  emptyStateTitle = 'No questions yet',
  emptyStateDescription = 'Click "Add Question" below to start building this quiz.',
}) {
  const theme = THEMES[variant] || THEMES.create
  const sortedParts = [...(parts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const partsAvailable = sortedParts.length > 0 && Boolean(onAssignSectionToPart)

  // Build a stable iteration order: ungrouped sections first (preserving the
  // sections[] order), then each Part with its members in sections[] order.
  // Story numbering follows the same iteration so STORY 1 / STORY 2 etc match
  // what the learner will see when the runner is later upgraded.
  const sectionPartOf = section => {
    if (section.kind === 'passage') return section.partId ?? null
    return section.question?.partId ?? null
  }
  const sectionIndexById = new Map(sections.map((section, index) => [section.id, index]))
  const ungrouped = sections.filter(section => !sectionPartOf(section))
  const groupedByPart = new Map(sortedParts.map(part => [part.id, []]))
  sections.forEach(section => {
    const partId = sectionPartOf(section)
    if (partId && groupedByPart.has(partId)) {
      groupedByPart.get(partId).push(section)
    }
  })

  // Compute story numbers across all passage sections in iteration order.
  let storyCounter = 0
  const storyNumberById = new Map()
  const allInOrder = [
    ...ungrouped,
    ...sortedParts.flatMap(part => groupedByPart.get(part.id) || []),
  ]
  allInOrder.forEach(section => {
    if (section.kind === 'passage') {
      storyCounter += 1
      storyNumberById.set(section.id, storyCounter)
    }
  })

  function renderSection(section) {
    const sectionIndex = sectionIndexById.get(section.id) ?? 0
    if (section.kind === 'passage') {
      return (
        <PassageSectionCard
          key={section.id}
          section={section}
          sectionIndex={sectionIndex}
          totalSections={sections.length}
          totalQuestions={totalQuestions}
          questionNumbers={questionNumbers}
          storyNumber={storyNumberById.get(section.id)}
          parts={partsAvailable ? sortedParts : []}
          theme={theme}
          onPassageChange={onPassageChange}
          onPassageToggle={onPassageToggle}
          onPassageRemove={onPassageRemove}
          onPassageMove={onPassageMove}
          onPassageImageUpload={onPassageImageUpload}
          onPassageImageRemove={onPassageImageRemove}
          onPassageQuestionChange={onPassageQuestionChange}
          onPassageQuestionRemove={onPassageQuestionRemove}
          onPassageQuestionMove={onPassageQuestionMove}
          onPassageAddQuestion={onPassageAddQuestion}
          onAssignToPart={onAssignSectionToPart}
        />
      )
    }
    return (
      <StandaloneQuestionCard
        key={section.id}
        question={section.question}
        questionNumber={questionNumbers[section.question.localId] || sectionIndex + 1}
        totalQuestions={totalQuestions}
        sectionIndex={sectionIndex}
        totalSections={sections.length}
        sectionId={section.id}
        parts={partsAvailable ? sortedParts : []}
        isNew={!section.question._id}
        onChange={onStandaloneChange}
        onRemove={onStandaloneRemove}
        onMove={onStandaloneMove}
        onImageUpload={onStandaloneImageUpload}
        onImageRemove={onStandaloneImageRemove}
        onAssignToPart={onAssignSectionToPart}
        theme={theme}
      />
    )
  }

  function handleShuffleClick() {
    if (!onShuffleSections) return
    if (totalQuestions < 2) return
    const ok = typeof window === 'undefined'
      ? true
      : window.confirm(
        'Shuffle the order of all questions?\n\n'
          + '• Ungrouped questions and passages will be randomised.\n'
          + '• Questions inside each Part will be randomised within that Part.\n'
          + '• Questions inside each comprehension passage will be randomised.\n'
          + '\nYou can still drag or use the ↑/↓ buttons to fine-tune.',
      )
    if (!ok) return
    onShuffleSections()
  }

  const canShuffle = Boolean(onShuffleSections) && totalQuestions >= 2

  return (
    <div className="space-y-4">
      {(sections.length > 0 || sortedParts.length > 0) && canShuffle && (
        <div className="theme-card theme-border flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3 shadow-sm">
          <div>
            <p className="theme-text text-sm font-black">Question order</p>
            <p className="theme-text-muted mt-0.5 text-xs font-bold">
              {totalQuestions} question{totalQuestions === 1 ? '' : 's'} · use Shuffle to randomise the order for fairness.
            </p>
          </div>
          <button
            type="button"
            onClick={handleShuffleClick}
            className={joinClasses(
              'min-h-0 rounded-xl border-2 px-4 py-2 text-sm font-black transition-all hover:-translate-y-px',
              theme.button,
            )}
            title="Randomise the order of questions (and within each Part / passage)"
          >
            🔀 Shuffle questions
          </button>
        </div>
      )}
      {sections.length === 0 && sortedParts.length === 0 ? (
        <div className="theme-card theme-border rounded-2xl border-2 border-dashed py-12 text-center">
          <div className="mb-2 text-4xl">📭</div>
          <p className="theme-text font-bold">{emptyStateTitle}</p>
          <p className="theme-text-muted mt-1 text-sm">{emptyStateDescription}</p>
        </div>
      ) : (
        <>
          {ungrouped.map(renderSection)}

          {sortedParts.map((part, partIndex) => {
            const members = groupedByPart.get(part.id) || []
            return (
              <PartCard
                key={part.id}
                part={part}
                partIndex={partIndex}
                totalParts={sortedParts.length}
                theme={theme}
                memberCount={members.length}
                onChange={onPartChange}
                onMove={onPartMove}
                onRemove={onPartRemove}
              >
                {members.map(renderSection)}
              </PartCard>
            )
          })}
        </>
      )}

      <AddQuestionMenu
        onAddStandalone={onAddStandalone}
        onAddPassage={onAddPassage}
        variant={variant}
      />

      {onAddPart && (
        <button
          type="button"
          onClick={onAddPart}
          className={joinClasses(
            'w-full min-h-0 rounded-2xl border-2 border-dashed py-3 text-sm font-black transition-all',
            theme.button,
          )}
        >
          + Add Part / Section group
        </button>
      )}
    </div>
  )
}
