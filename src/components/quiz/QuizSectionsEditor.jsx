import { useRef, useState } from 'react'
import { QUESTION_LETTERS } from '../../utils/quizSections'
import RichEditor from '../editor/RichEditor'

const THEMES = {
  create: {
    focus: 'focus:border-green-500',
    accentText: 'text-green-700',
    accentSoftText: 'text-green-600',
    badge: 'bg-green-100 text-green-700',
    cardBorder: 'border-green-200',
    cardSoft: 'bg-green-50',
    button: 'border-green-300 text-green-600 hover:border-green-400 hover:bg-green-50',
    primaryButton: 'bg-green-600 hover:bg-green-700 text-white',
    uploadBorder: 'border-green-200 hover:border-green-400 hover:bg-green-50',
    uploadFrame: 'border-green-200 bg-green-50',
    radioBorder: 'border-green-400 bg-green-50',
    ring: 'ring-green-100',
  },
  edit: {
    focus: 'focus:border-blue-500',
    accentText: 'text-blue-700',
    accentSoftText: 'text-blue-600',
    badge: 'bg-blue-100 text-blue-700',
    cardBorder: 'border-blue-200',
    cardSoft: 'bg-blue-50',
    button: 'border-blue-300 text-blue-600 hover:border-blue-400 hover:bg-blue-50',
    primaryButton: 'bg-blue-600 hover:bg-blue-700 text-white',
    uploadBorder: 'border-blue-200 hover:border-blue-400 hover:bg-blue-50',
    uploadFrame: 'border-blue-200 bg-blue-50',
    radioBorder: 'border-blue-400 bg-blue-50',
    ring: 'ring-blue-100',
  },
}

const FIELD_BASE = 'w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors'
const SMALL_FIELD_BASE = 'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-900 placeholder-gray-400 outline-none transition-colors'

function joinClasses(...parts) {
  return parts.filter(Boolean).join(' ')
}

function fieldClass(theme) {
  return joinClasses(FIELD_BASE, theme.focus)
}

function smallFieldClass(theme) {
  return joinClasses(SMALL_FIELD_BASE, theme.focus)
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
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <span className={isCompressing ? 'font-bold' : 'font-bold text-green-600'}>{isCompressing ? 'Compress' : '✓ Compress'}</span>
          <span>→</span>
          <span className={isCompressing ? 'text-gray-400' : 'font-bold'}>{isCompressing ? 'Upload' : 'Uploading'}</span>
        </div>
      </div>
    )
  }

  if (imageUrl) {
    return (
      <div className={joinClasses('group relative overflow-hidden rounded-xl border-2 bg-gray-50', theme.cardBorder)}>
        <img src={imageUrl} alt={label} className="max-h-56 w-full object-contain py-2" />
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-90 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 shadow hover:bg-gray-50"
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
        <p className="pb-1 text-center text-xs text-gray-400">{hint}</p>
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
        <p className="text-sm font-bold text-gray-600">{label}</p>
        <p className="mt-0.5 text-xs text-gray-400">{hint}</p>
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
  isNew,
  onChange,
  onRemove,
  onMove,
  onImageUpload,
  onImageRemove,
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
  const isTextAnswer = question.type === 'short_answer' || question.type === 'diagram'

  return (
    <div
      className={joinClasses(
        'space-y-4 rounded-2xl border-2 bg-white p-5 shadow-sm transition-colors',
        isNew ? joinClasses(theme.cardBorder, 'ring-2', theme.ring) : 'border-gray-100',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={joinClasses('rounded-full px-3 py-1 text-xs font-black', theme.badge)}>
            Q{questionNumber} of {totalQuestions}
          </span>
          {isNew && <span className="text-xs font-bold text-gray-400">New question</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={question.type}
            onChange={event => {
              const nextType = event.target.value
              set('type', nextType)
              if (nextType === 'truefalse') {
                onChange(sectionIndex, 'options', ['True', 'False'])
                onChange(sectionIndex, 'correctAnswer', 0)
              } else if (nextType === 'short_answer' || nextType === 'diagram') {
                onChange(sectionIndex, 'options', [])
                onChange(sectionIndex, 'correctAnswer', typeof question.correctAnswer === 'string' ? question.correctAnswer : '')
              } else if (question.options.length < 4) {
                onChange(sectionIndex, 'options', ['', '', '', ''])
                onChange(sectionIndex, 'correctAnswer', 0)
              }
            }}
            className={joinClasses('rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 outline-none', theme.focus)}
          >
            <option value="mcq">MCQ (4 options)</option>
            <option value="truefalse">True / False</option>
            <option value="short_answer">Short Answer</option>
            <option value="diagram">Diagram / Image</option>
          </select>
          <button
            type="button"
            onClick={() => onMove(sectionIndex, -1)}
            disabled={sectionIndex === 0}
            className="min-h-0 bg-transparent p-1 text-sm text-gray-400 shadow-none hover:text-gray-600 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(sectionIndex, 1)}
            disabled={sectionIndex === totalSections - 1}
            className="min-h-0 bg-transparent p-1 text-sm text-gray-400 shadow-none hover:text-gray-600 disabled:opacity-30"
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

      <RichEditor
        value={question.text}
        onChange={v => set('text', v)}
        placeholder={question.imageUrl ? 'Describe what is shown in the image above, or ask your question...' : 'Write your question here...'}
        minHeight={80}
        borderClass={theme === THEMES.edit ? 'border-blue-200' : 'border-gray-200'}
        focusClass={theme === THEMES.edit ? 'focus-within:border-blue-500' : 'focus-within:border-green-500'}
        focusColor={theme === THEMES.edit ? 'indigo' : 'green'}
      />

      {isTextAnswer ? (
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-500">Short answer - expected answer recommended for accurate AI checking</p>
          <div className="flex items-center gap-2 rounded-xl border-2 border-green-300 bg-green-50 p-3">
            <span className="text-lg text-green-600">✅</span>
            <input
              value={typeof question.correctAnswer === 'string' ? question.correctAnswer : ''}
              onChange={event => set('correctAnswer', event.target.value)}
              placeholder="Expected answer (recommended)"
              className="flex-1 border-none bg-transparent text-sm font-semibold text-gray-900 outline-none"
            />
          </div>
          <p className="text-xs text-gray-400">If left blank, AI will judge from the question, subject, and grade.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-500">Answer choices - click the radio to mark the correct one</p>
          {question.options.map((option, optionIndex) => (
            <label
              key={`${question.localId}-${optionIndex}`}
              className={joinClasses(
                'flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-colors',
                question.correctAnswer === optionIndex ? 'border-green-400 bg-green-50' : 'border-gray-100 hover:border-gray-200',
              )}
            >
              <input
                type="radio"
                name={`standalone-correct-${question.localId}`}
                checked={question.correctAnswer === optionIndex}
                onChange={() => set('correctAnswer', optionIndex)}
                className="flex-shrink-0 accent-green-600"
              />
              <span className={joinClasses(
                'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-black',
                question.correctAnswer === optionIndex ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600',
              )}>
                {isTrueFalse ? (optionIndex === 0 ? 'T' : 'F') : QUESTION_LETTERS[optionIndex]}
              </span>
              <input
                value={option}
                onChange={event => setOption(optionIndex, event.target.value)}
                placeholder={isTrueFalse ? (optionIndex === 0 ? 'True' : 'False') : `Option ${QUESTION_LETTERS[optionIndex]}`}
                disabled={isTrueFalse}
                className="flex-1 border-none bg-transparent text-sm text-gray-900 outline-none disabled:text-gray-700"
              />
              {question.correctAnswer === optionIndex && <span className="flex-shrink-0 text-xs font-black text-green-500">✓ Correct</span>}
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
          className={joinClasses('w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 placeholder-gray-400 outline-none', theme.focus)}
        />
        <RichEditor
          value={question.explanation}
          onChange={v => set('explanation', v)}
          placeholder="Explanation (optional) — shown after answering in practice mode"
          minHeight={60}
          borderClass="border-gray-200"
          focusClass={theme === THEMES.edit ? 'focus-within:border-blue-500' : 'focus-within:border-green-500'}
          focusColor={theme === THEMES.edit ? 'indigo' : 'green'}
        />
        <div className="flex gap-2">
          <input
            value={question.topic}
            onChange={event => set('topic', event.target.value)}
            placeholder="Topic (e.g. Fractions)"
            className={joinClasses('flex-1', smallFieldClass(theme))}
          />
          <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-2">
            <span className="text-xs font-bold text-gray-500">Marks:</span>
            <input
              type="number"
              min={1}
              max={10}
              value={question.marks}
              onChange={event => set('marks', Number(event.target.value) || 1)}
              className="w-10 bg-transparent text-center text-xs font-black text-gray-900 outline-none"
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

  return (
    <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700">
          Q{questionNumber} of {totalQuestions}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onMove(sectionIndex, questionIndex, -1)}
            disabled={questionIndex === 0}
            className="min-h-0 bg-transparent p-1 text-sm text-gray-400 shadow-none hover:text-gray-600 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(sectionIndex, questionIndex, 1)}
            disabled={questionIndex === totalPassageQuestions - 1}
            className="min-h-0 bg-transparent p-1 text-sm text-gray-400 shadow-none hover:text-gray-600 disabled:opacity-30"
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

      <RichEditor
        value={question.text}
        onChange={v => set('text', v)}
        placeholder="Write the question for this passage..."
        minHeight={60}
        borderClass="border-gray-200"
        focusClass="focus-within:border-orange-500"
        focusColor="orange"
      />

      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-500">Answer choices</p>
        {QUESTION_LETTERS.map((letter, optionIndex) => (
          <label
            key={`${question.localId}-${letter}`}
            className={joinClasses(
              'flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-colors',
              question.correctAnswer === optionIndex ? 'border-orange-400 bg-orange-50' : 'border-gray-100 hover:border-gray-200',
            )}
          >
            <input
              type="radio"
              name={`passage-correct-${question.localId}`}
              checked={question.correctAnswer === optionIndex}
              onChange={() => set('correctAnswer', optionIndex)}
              className="flex-shrink-0 accent-orange-600"
            />
            <span className={joinClasses(
              'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-black',
              question.correctAnswer === optionIndex ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600',
            )}>
              {letter}
            </span>
            <input
              value={question.options[optionIndex] || ''}
              onChange={event => setOption(optionIndex, event.target.value)}
              placeholder={`Option ${letter}`}
              className="flex-1 border-none bg-transparent text-sm text-gray-900 outline-none"
            />
          </label>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <input
          value={question.topic}
          onChange={event => set('topic', event.target.value)}
          placeholder="Topic (optional)"
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-900 placeholder-gray-400 outline-none focus:border-orange-500"
        />
        <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-2">
          <span className="text-xs font-bold text-gray-500">Marks:</span>
          <input
            type="number"
            min={1}
            max={10}
            value={question.marks}
            onChange={event => set('marks', Number(event.target.value) || 1)}
            className="w-10 bg-transparent text-center text-xs font-black text-gray-900 outline-none"
          />
        </div>
      </div>

      <RichEditor
        value={question.explanation}
        onChange={v => set('explanation', v)}
        placeholder="Explanation (optional)"
        minHeight={50}
        borderClass="border-gray-200"
        focusClass="focus-within:border-orange-500"
        focusColor="orange"
      />
    </div>
  )
}

function PassageSectionCard({
  section,
  sectionIndex,
  totalSections,
  totalQuestions,
  questionNumbers,
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
}) {
  const passage = section.passage
  const isCollapsed = Boolean(passage.collapsed)

  return (
    <div className="space-y-4 rounded-2xl border-2 border-orange-200 bg-orange-50/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700">
              Comprehension Passage
            </span>
            <span className="text-xs font-bold text-orange-600">
              {passage.questions.length} question{passage.questions.length === 1 ? '' : 's'}
            </span>
          </div>
          {!isCollapsed && (
            <p className="mt-2 text-sm font-bold leading-relaxed text-orange-800">
              Add the passage once, then attach all related questions below it.
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPassageToggle(sectionIndex)}
            className="min-h-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-orange-700 shadow-sm hover:bg-orange-100"
          >
            {isCollapsed ? 'Expand' : 'Collapse'}
          </button>
          <button
            type="button"
            onClick={() => onPassageMove(sectionIndex, -1)}
            disabled={sectionIndex === 0}
            className="min-h-0 bg-transparent p-1 text-sm text-orange-400 shadow-none hover:text-orange-600 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onPassageMove(sectionIndex, 1)}
            disabled={sectionIndex === totalSections - 1}
            className="min-h-0 bg-transparent p-1 text-sm text-orange-400 shadow-none hover:text-orange-600 disabled:opacity-30"
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
        <div className="rounded-xl border border-orange-200 bg-white/80 px-4 py-3">
          <p className="text-sm font-black text-gray-800">{passage.title || 'Untitled passage'}</p>
          <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-gray-600">
            {passage.passageText || 'No passage text yet.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="space-y-3 rounded-2xl border border-orange-100 bg-white p-4">
              <h3 className="text-sm font-black text-gray-800">Passage</h3>
              <input
                value={passage.title}
                onChange={event => onPassageChange(sectionIndex, 'title', event.target.value)}
                placeholder="Title (optional)"
                className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-orange-500"
              />
              <input
                value={passage.instructions}
                onChange={event => onPassageChange(sectionIndex, 'instructions', event.target.value)}
                placeholder="Instructions (optional)"
                className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-orange-500"
              />
              <RichEditor
                value={passage.passageText}
                onChange={v => onPassageChange(sectionIndex, 'passageText', v)}
                placeholder="Paste or type the passage / story here..."
                minHeight={180}
                borderClass="border-gray-200"
                focusClass="focus-within:border-orange-500"
                focusColor="orange"
              />
              <ImageUpload
                label="Upload Passage Image"
                hint="Optional · JPG, PNG, WEBP · max 5 MB"
                imageUrl={passage.imageUrl}
                uploading={passage.imageUploading}
                uploadStep={passage.imageUploadStep}
                onFileSelect={file => onPassageImageUpload(sectionIndex, file)}
                onRemove={() => onPassageImageRemove(sectionIndex)}
                theme={{
                  ...THEMES.create,
                  uploadBorder: 'border-orange-200 hover:border-orange-400 hover:bg-orange-50',
                  uploadFrame: 'border-orange-200 bg-orange-50',
                  cardBorder: 'border-orange-200',
                  accentText: 'text-orange-700',
                }}
              />
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-orange-100 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-black text-gray-800">Questions Under Passage</h3>
                    <p className="mt-1 text-xs font-bold text-gray-500">Each question stays linked to this passage.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onPassageAddQuestion(sectionIndex)}
                    className="min-h-0 rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white hover:bg-orange-600"
                  >
                    + Add Question to Passage
                  </button>
                </div>
              </div>

              {passage.questions.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-orange-200 bg-white px-4 py-8 text-center">
                  <p className="font-bold text-gray-600">No linked questions yet</p>
                  <p className="mt-1 text-sm text-gray-400">Add at least one question before saving this quiz.</p>
                </div>
              ) : (
                passage.questions.map((question, questionIndex) => (
                  <PassageQuestionCard
                    key={question.localId}
                    question={question}
                    questionIndex={questionIndex}
                    questionNumber={questionNumbers[question.localId] || questionIndex + 1}
                    totalPassageQuestions={passage.questions.length}
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
        <div className="grid gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:grid-cols-2">
          <button
            type="button"
            onClick={() => choose(onAddStandalone)}
            className="min-h-0 rounded-2xl border-2 border-gray-100 bg-gray-50 p-4 text-left transition-colors hover:border-gray-200 hover:bg-white"
          >
            <p className="text-sm font-black text-gray-800">Multiple Choice</p>
            <p className="mt-1 text-xs font-bold leading-relaxed text-gray-500">
              Add a normal standalone question. You can still switch it to true/false, short answer, or diagram later.
            </p>
          </button>
          <button
            type="button"
            onClick={() => choose(onAddPassage)}
            className="min-h-0 rounded-2xl border-2 border-orange-200 bg-orange-50 p-4 text-left transition-colors hover:border-orange-300 hover:bg-orange-100/70"
          >
            <p className="text-sm font-black text-orange-800">Comprehension Passage</p>
            <p className="mt-1 text-xs font-bold leading-relaxed text-orange-700">
              Add one passage or story, then attach multiple linked questions under it.
            </p>
          </button>
        </div>
      )}
    </div>
  )
}

export default function QuizSectionsEditor({
  variant = 'create',
  sections,
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
  emptyStateTitle = 'No questions yet',
  emptyStateDescription = 'Click "Add Question" below to start building this quiz.',
}) {
  const theme = THEMES[variant] || THEMES.create

  return (
    <div className="space-y-4">
      {sections.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white py-12 text-center">
          <div className="mb-2 text-4xl">📭</div>
          <p className="font-bold text-gray-600">{emptyStateTitle}</p>
          <p className="mt-1 text-sm text-gray-400">{emptyStateDescription}</p>
        </div>
      ) : (
        sections.map((section, sectionIndex) => {
          if (section.kind === 'passage') {
            return (
              <PassageSectionCard
                key={section.id}
                section={section}
                sectionIndex={sectionIndex}
                totalSections={sections.length}
                totalQuestions={totalQuestions}
                questionNumbers={questionNumbers}
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
              isNew={!section.question._id}
              onChange={onStandaloneChange}
              onRemove={onStandaloneRemove}
              onMove={onStandaloneMove}
              onImageUpload={onStandaloneImageUpload}
              onImageRemove={onStandaloneImageRemove}
              theme={theme}
            />
          )
        })
      )}

      <AddQuestionMenu
        onAddStandalone={onAddStandalone}
        onAddPassage={onAddPassage}
        variant={variant}
      />
    </div>
  )
}
