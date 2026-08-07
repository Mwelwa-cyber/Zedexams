// Assessment Studio — per-question-type answer editors. Extracted from
// AssessmentStudio.jsx to keep that module focused on orchestration.
//
// Controlled, props-in editors (value + onChange/onUpdate callbacks; no internal
// component state beyond DOM refs). Consumed by QuestionBlock / PassageBlock /
// EditorSlide; they render inside the parent's `.studio-v2` CSS scope.

import { useRef } from 'react'
import { clampInt } from '../../utils/inputs.js'
import { countBlanks, statementLabel, BLANK_TOKEN } from '../../utils/fillBlanks.js'
import { subPartLabel, sumSubPartMarks, emptySubPart, normalizeSubParts } from '../../utils/questionParts.js'
import DiagramSvg from '../diagrams/DiagramSvg'
import { SECTION_LETTERS } from './assessmentStudioMeta'
import MenuButton, { MenuItem } from '../ui/MenuButton'
import Icon from './studio/studioIcons'
import { richTextToPlainText, richTextHasFormatting } from '../../utils/quizRichText.js'
import MathsRichField from './MathsRichField.jsx'

export function McqOptions({ question, onChangeOption, onSelectCorrect, onUploadOptionImage, onRemoveOptionImage, onPickFromBank, onPickDiagram, onChangeOptionAlt, maxOptions, maths = false, grade }) {
  const allOptions = Array.isArray(question.options) && question.options.length
    ? question.options
    : ['', '', '', '']
  const cap = (typeof maxOptions === 'number' && maxOptions >= 2 && maxOptions <= allOptions.length)
    ? maxOptions
    : allOptions.length
  const visibleOptions = allOptions.slice(0, cap)
  const hiddenOptions = allOptions.slice(cap)
  const hiddenHaveContent = hiddenOptions.some(o => String(o || '').trim().length > 0)
  const optionMedia = Array.isArray(question.optionMedia) ? question.optionMedia : []
  const correctIndex = typeof question.correctAnswer === 'number' ? question.correctAnswer : 0
  const correctIsHidden = correctIndex >= cap
  return (
    <div className="sv-mcq-options">
      {visibleOptions.map((option, optIndex) => {
        const media = optionMedia[optIndex]
        return (
          <McqOptionRow
            key={optIndex}
            optIndex={optIndex}
            option={option}
            media={media}
            maths={maths}
            grade={grade}
            questionId={question.localId}
            isCorrect={correctIndex === optIndex}
            onChangeOption={onChangeOption}
            onSelectCorrect={onSelectCorrect}
            onUploadOptionImage={onUploadOptionImage}
            onRemoveOptionImage={onRemoveOptionImage}
            onPickFromBank={onPickFromBank}
            onPickDiagram={onPickDiagram}
            onChangeOptionAlt={onChangeOptionAlt}
          />
        )
      })}
      {hiddenHaveContent && (
        <div style={{ fontSize: 11, color: 'var(--sv-muted)', padding: '4px 8px' }}>
          {hiddenOptions.filter(o => String(o || '').trim().length > 0).length} more option(s) hidden by the paper&apos;s Answer choices setting — kept, not printed.
        </div>
      )}
      {correctIsHidden && (
        <div style={{ fontSize: 11, color: '#B45309', padding: '4px 8px', background: '#FFFBEB', borderRadius: 4, marginTop: 4 }}>
          Warning: the correct answer (option {String.fromCharCode(65 + correctIndex)}) is hidden by the current Answer choices setting. Update the correct answer or increase the choice count.
        </div>
      )}
    </div>
  )
}

function McqOptionRow({ optIndex, option, media, isCorrect, onChangeOption, onSelectCorrect, onUploadOptionImage, onRemoveOptionImage, onPickFromBank, onPickDiagram, onChangeOptionAlt, maths = false, questionId, grade }) {
  const fileRef = useRef(null)
  // A diagram option also counts as media for the alt-text affordance (its alt
  // is auto-seeded by the converter/picker, so it won't be flagged as missing).
  const hasImage = Boolean(media?.imageUrl) || Boolean(media?.diagram?.libraryKey)
  const altMissing = hasImage && !String(media?.alt || '').trim()
  return (
    <div className="sv-mcq-option-wrap">
    <div
      className={`sv-mcq-option ${isCorrect ? 'correct' : ''}`}
      onClick={() => onSelectCorrect(optIndex)}
      role="button"
      tabIndex={0}
      // Only the ROW itself answers Enter/Space. The handler used to fire for
      // any key event that bubbled up, so a space typed into the option field
      // marked that option correct and preventDefault ate the space — the
      // teacher could not type "less than 1" into an answer choice. Nested
      // editors (and the maths field's Tiptap instance) need the same
      // exemption, so it is checked here once rather than stopped in each.
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectCorrect(optIndex) }
      }}
      style={{ gridTemplateColumns: '24px auto 1fr auto' }}
    >
      <div className="sv-letter">{SECTION_LETTERS[optIndex]}</div>
      {media?.diagram?.libraryKey ? (
        <div style={{ position: 'relative', width: 44, height: 44, borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: 'var(--zt-card)' }}
          onClick={e => { e.stopPropagation(); onPickDiagram?.(optIndex) }}
          role="button" tabIndex={0} title="Edit this shape"
          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onPickDiagram?.(optIndex) } }}>
          <DiagramSvg libraryKey={media.diagram.libraryKey} params={media.diagram.params} color="#1c1612" alt={media.alt || ''} />
          {onRemoveOptionImage && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRemoveOptionImage(optIndex) }}
              style={{
                position: 'absolute', top: -4, right: -4,
                width: 18, height: 18, borderRadius: '50%',
                background: 'var(--sv-primary)', color: 'white',
                border: '2px solid white', fontSize: 10, lineHeight: 1,
                display: 'grid', placeItems: 'center', cursor: 'pointer',
              }}
              aria-label="Remove option shape"
            >×</button>
          )}
        </div>
      ) : media?.imageUrl ? (
        <div style={{ position: 'relative', width: 44, height: 44, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
          <img src={media.imageUrl} alt={media.alt || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {onRemoveOptionImage && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRemoveOptionImage(optIndex) }}
              style={{
                position: 'absolute', top: -4, right: -4,
                width: 18, height: 18, borderRadius: '50%',
                background: 'var(--sv-primary)', color: 'white',
                border: '2px solid white', fontSize: 10, lineHeight: 1,
                display: 'grid', placeItems: 'center', cursor: 'pointer',
              }}
              aria-label="Remove option image"
            >×</button>
          )}
        </div>
      ) : onUploadOptionImage ? (
        // ONE affordance per option. This was three permanent dashed squares —
        // upload, picture bank, shape — on every option of every MCQ, so a
        // four-option question carried twelve buttons for a feature most
        // questions never use. The three routes now live behind "+ img".
        //
        // stopPropagation on the wrapper: the option row's own click marks that
        // option correct, so opening the picture menu must not silently change
        // the answer key.
        <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <MenuButton
            wrapClassName="sv-menu-wrap"
            menuClassName="sv-menu"
            triggerClassName="sv-opt-img-btn"
            ariaLabel={`Add a picture to option ${SECTION_LETTERS[optIndex]}`}
            title={`Add a picture to option ${SECTION_LETTERS[optIndex]}`}
            label={<><Icon name="add" size={11} /> img</>}
          >
            {({ close }) => (
              <>
                <MenuItem className="sv-menu-item" icon={<Icon name="import" size={15} />}
                  onClick={() => { close(); fileRef.current?.click() }}>Upload a picture</MenuItem>
                {onPickFromBank && (
                  <MenuItem className="sv-menu-item" icon={<Icon name="pictureBank" size={15} />}
                    onClick={() => { close(); onPickFromBank(optIndex) }}>Picture bank / AI picture</MenuItem>
                )}
                {onPickDiagram && (
                  <MenuItem className="sv-menu-item" icon={<Icon name="shape" size={15} />}
                    onClick={() => { close(); onPickDiagram(optIndex) }}>Shape · diagram</MenuItem>
                )}
              </>
            )}
          </MenuButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file && onUploadOptionImage) onUploadOptionImage(optIndex, file)
              e.target.value = ''
            }}
          />
        </div>
      ) : <span />}
      {/* A rich option gets the rich field even on a non-mathematics paper.
          A plain <input> would show "[object Object]" for a Tiptap option and
          flatten it on the first keystroke — which is reachable whenever a
          paper's subject is changed after its options were written. Same guard
          CardQuestionText already applies to question text. */}
      {(maths || richTextHasFormatting(option)) ? (
        // Structured mathematics inside an answer choice (§3): A, B, C and D
        // can each be a stacked fraction. The compact toolbar drops headings,
        // alignment and tables — none of which belong in an answer choice —
        // and keeps bold/italic/underline, sup/sub and the full maths toolset.
        //
        // The wrapper stops clicks reaching the row, whose onClick marks an
        // option correct: without it, clicking into the editor to fix a
        // denominator would silently change the answer key.
        <div className="sv-opt-maths" onClick={e => e.stopPropagation()}>
          <MathsRichField
            fieldId={`opt:${questionId || 'q'}:${optIndex}`}
            value={option}
            onChange={value => onChangeOption(optIndex, value)}
            toolbarVariant="compact"
            grade={grade}
            minHeight={38}
            placeholder={media?.imageUrl ? `Optional caption for ${SECTION_LETTERS[optIndex]}` : `Option ${SECTION_LETTERS[optIndex]}`}
            ariaLabel={`Option ${SECTION_LETTERS[optIndex]} — edit with mathematics tools`}
          />
        </div>
      ) : (
        <input
          className="sv-opt-text"
          type="text"
          value={option}
          onChange={e => onChangeOption(optIndex, e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder={media?.imageUrl ? `Optional caption for ${SECTION_LETTERS[optIndex]}` : `Option ${SECTION_LETTERS[optIndex]}`}
        />
      )}
      {isCorrect && <div className="sv-check"><Icon name="check" size={13} /></div>}
    </div>
      {hasImage && onChangeOptionAlt && (
        <div className="sv-opt-alt" onClick={e => e.stopPropagation()}>
          <input
            type="text"
            className={`sv-opt-alt-input ${altMissing ? 'missing' : ''}`}
            value={media?.alt || ''}
            onChange={e => onChangeOptionAlt(optIndex, e.target.value)}
            placeholder={`Describe image ${SECTION_LETTERS[optIndex]} (alt text — required)`}
            aria-label={`Alt text for option ${SECTION_LETTERS[optIndex]} image`}
          />
        </div>
      )}
    </div>
  )
}

// Dedicated Fill-in-the-Blanks editor. The instruction itself is the question
// text (edited above by the shared question-text field). Here the teacher sets
// the word bank (or chooses open mode), the reuse rule, and the individual
// A/B/C/D statements — each with its own blank(s) and the expected answer for
// each blank. Total marks track the blank count automatically (one per blank).
export function FillBlanksInputs({ question, onUpdate }) {
  const statements = Array.isArray(question.statements) ? question.statements : []
  const wordBank = Array.isArray(question.wordBank) ? question.wordBank : []
  const useWordBank = wordBank.length > 0
  const totalBlanks = statements.reduce((sum, s) => sum + countBlanks(s?.text ?? ''), 0)

  function commitStatements(next) {
    onUpdate('statements', next)
    // One mark per blank, clamped to the schema's [1, 20] range, so the
    // printed paper's [1] cues and the auto-marking stay in agreement.
    const blanks = next.reduce((sum, s) => sum + countBlanks(s?.text ?? ''), 0)
    onUpdate('marks', Math.max(1, Math.min(20, blanks || 1)))
  }

  function updateStatementText(index, text) {
    const next = statements.map((s, i) => {
      if (i !== index) return s
      // Resize the answers array to match the new blank count (keep at least
      // one slot so a not-yet-blanked sentence still shows an answer field).
      const blanks = countBlanks(text)
      const prev = Array.isArray(s.answers) ? s.answers : []
      const answers = Array.from({ length: Math.max(blanks, 1) }, (_, k) => prev[k] ?? '')
      return { text, answers }
    })
    commitStatements(next)
  }

  function setAnswer(index, blankIndex, value) {
    const next = statements.map((s, i) => {
      if (i !== index) return s
      const answers = [...(Array.isArray(s.answers) ? s.answers : [])]
      answers[blankIndex] = value
      return { ...s, answers }
    })
    onUpdate('statements', next)
  }

  function addStatement() {
    commitStatements([...statements, { text: '', answers: [''] }])
  }

  function removeStatement(index) {
    commitStatements(statements.filter((_, i) => i !== index))
  }

  function insertBlank(index) {
    const current = statements[index]?.text ?? ''
    const needsSpace = current && !/\s$/.test(current)
    updateStatementText(index, `${current}${needsSpace ? ' ' : ''}${BLANK_TOKEN} `)
  }

  // Quick-size presets (4 / 6 / 8 / 10 blanks) — add or trim statements so the
  // teacher gets the requested number of single-blank items in one click.
  function setCount(target) {
    const next = statements.slice(0, target)
    while (next.length < target) next.push({ text: '', answers: [''] })
    commitStatements(next)
  }

  return (
    <div className="sv-fill-blanks" style={{ marginTop: 'var(--sv-s2)' }}>
      {/* Word bank / open-mode controls */}
      <div className="sv-field" style={{ marginBottom: 'var(--sv-s2)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={useWordBank}
            onChange={e => onUpdate('wordBank', e.target.checked ? (wordBank.length ? wordBank : ['']) : [])}
          />
          Provide a word bank (learners pick from supplied words)
        </label>
        {useWordBank && (
          <>
            <input
              type="text"
              value={wordBank.join(', ')}
              onChange={e => onUpdate('wordBank', e.target.value.split(/[·,]/).map(s => s.trim()).filter(Boolean))}
              placeholder="e.g. soap, clean, germs, water"
              style={{ marginTop: 6 }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginTop: 6, color: 'var(--sv-muted)' }}>
              <input
                type="checkbox"
                checked={Boolean(question.wordBankReuse)}
                onChange={e => onUpdate('wordBankReuse', e.target.checked)}
              />
              Words may be used more than once
            </label>
          </>
        )}
      </div>

      {/* Size presets */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--sv-s2)', fontSize: 12 }}>
        <span style={{ color: 'var(--sv-muted)' }}>Number of blanks:</span>
        {[4, 6, 8, 10].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => setCount(n)}
            className="sv-btn sv-btn-outline sv-btn-sm"
          >
            {n}
          </button>
        ))}
        <span style={{ color: 'var(--sv-muted)' }}>· {totalBlanks} blank{totalBlanks === 1 ? '' : 's'} total</span>
      </div>

      {/* Statements */}
      {statements.length === 0 && (
        <div className="sv-empty-hint">
          No statements yet — tap a number above for a quick set, or “+ Add statement” to write your own.
        </div>
      )}
      {statements.map((statement, index) => {
        const blanks = countBlanks(statement?.text ?? '')
        const answers = Array.isArray(statement?.answers) ? statement.answers : []
        return (
          <div
            key={index}
            style={{ border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 8, marginBottom: 8, background: 'var(--sv-paper)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: 13 }}>{statementLabel(index)}.</strong>
              <button type="button" className="sv-btn sv-btn-outline sv-btn-sm" onClick={() => insertBlank(index)} title="Insert a blank where the cursor will go">
                + Insert blank
              </button>
              <button type="button" className="sv-btn sv-btn-outline sv-btn-sm" onClick={() => removeStatement(index)} style={{ marginLeft: 'auto', color: 'var(--sv-danger, #b91c1c)' }}>
                Remove
              </button>
            </div>
            <input
              type="text"
              value={statement?.text ?? ''}
              onChange={e => updateStatementText(index, e.target.value)}
              placeholder="e.g. We use ____ to wash our hands."
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {Array.from({ length: Math.max(blanks, 1) }).map((_, blankIndex) => (
                <label key={blankIndex} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--sv-muted)' }}>
                  Answer {blanks > 1 ? `#${blankIndex + 1}` : ''}
                  <input
                    type="text"
                    value={answers[blankIndex] ?? ''}
                    onChange={e => setAnswer(index, blankIndex, e.target.value)}
                    placeholder={blanks === 0 ? 'Add a ____ blank first' : 'expected answer'}
                    disabled={blanks === 0}
                    style={{ minWidth: 140 }}
                  />
                </label>
              ))}
            </div>
          </div>
        )
      })}

      <button type="button" className="sv-btn sv-btn-outline sv-btn-sm" onClick={addStatement}>
        + Add statement
      </button>
      <p style={{ fontSize: 11, color: 'var(--sv-muted)', marginTop: 6 }}>
        Tip: type underscores (<code>____</code>) where a blank should go. Use “/” to allow alternatives, e.g. <code>sunlight/sun</code>.
      </p>
    </div>
  )
}

export function ShortAnswerInputs({ correctAnswer, onChange, label, lines = 2, maths = false, fieldId, grade }) {
  const heading = label || 'Expected answer (used for marking key)'
  // The expected answer can carry mathematics too (§4) — "the answer is three
  // fifths" is a fraction, and the marking key, PDF and Word all render it.
  // A rich answer gets the field even off a mathematics paper, for the same
  // reason a rich option does: a textarea would flatten it on the first
  // keystroke.
  if (maths || richTextHasFormatting(correctAnswer)) {
    return (
      <div className="sv-answer-lines">
        <div className="sv-answer-meta"><Icon name="ruler" size={13} /> {heading}</div>
        <MathsRichField
          fieldId={fieldId || 'expected-answer'}
          value={correctAnswer}
          onChange={onChange}
          toolbarVariant="compact"
          grade={grade}
          minHeight={Math.max(38, lines * 20)}
          placeholder="Type the expected answer or marking notes"
          ariaLabel={`${heading} — edit with mathematics tools`}
        />
      </div>
    )
  }
  return (
    <div className="sv-answer-lines">
      <div className="sv-answer-meta"><Icon name="ruler" size={13} /> {heading}</div>
      <textarea
        value={String(correctAnswer ?? '')}
        onChange={e => onChange(e.target.value)}
        placeholder="Type the expected answer or marking notes"
        rows={lines}
        style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 8, fontSize: 13, background: 'var(--sv-paper)', fontFamily: 'inherit', resize: 'vertical' }}
      />
    </div>
  )
}

// Per-sub-question answer-space control. Lets the teacher pick how much blank
// space prints under a written-answer follow-up: no space, a fixed number of
// ruled lines, a custom count, or labelled blanks (P: ____, Q: ____, …).
export function AnswerSpaceControl({ question, onUpdate }) {
  const format = question.answerFormat || 'lines'
  const lines = Number.isInteger(question.answerLines) ? question.answerLines : null
  const labels = Array.isArray(question.blankLabels) ? question.blankLabels : []
  // The dropdown collapses the (format, answerLines) pair into one friendly
  // choice. 'none' / '1' / '2' / '3' / 'custom' / 'labelled_blanks'.
  const selectValue = format === 'none'
    ? 'none'
    : format === 'labelled_blanks'
      ? 'labelled_blanks'
      : (lines === 1 || lines === 2 || lines === 3)
        ? String(lines)
        : lines == null
          ? '2'
          : 'custom'

  function onSelect(value) {
    if (value === 'none') { onUpdate('answerFormat', 'none'); return }
    if (value === 'labelled_blanks') {
      onUpdate('answerFormat', 'labelled_blanks')
      if (!labels.length) onUpdate('blankLabels', ['P', 'Q', 'R'])
      return
    }
    if (value === 'custom') {
      onUpdate('answerFormat', 'lines')
      if (lines == null) onUpdate('answerLines', 4)
      return
    }
    // '1' | '2' | '3'
    onUpdate('answerFormat', 'lines')
    onUpdate('answerLines', Number(value))
  }

  const labelPresets = {
    'P, Q, R': ['P', 'Q', 'R'],
    'A, B, C': ['A', 'B', 'C'],
    '1, 2, 3': ['1', '2', '3'],
    'i, ii, iii': ['i', 'ii', 'iii'],
  }

  return (
    <div className="sv-answer-space-control" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '6px 0 2px', fontSize: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--sv-muted)' }}>
        <Icon name="ruler" size={13} /> Answer space:
        <select
          value={selectValue}
          onChange={e => onSelect(e.target.value)}
          style={{ padding: '2px 6px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', fontSize: 12 }}
        >
          <option value="none">No answer space</option>
          <option value="1">1 line</option>
          <option value="2">2 lines</option>
          <option value="3">3 lines</option>
          <option value="custom">Custom lines…</option>
          <option value="labelled_blanks">Labelled blanks</option>
        </select>
      </label>

      {selectValue === 'custom' && (
        <input
          type="number"
          min="0"
          max="40"
          value={lines ?? 4}
          onChange={e => onUpdate('answerLines', clampInt(e.target.value, 0, 40, 4))}
          title="Number of answer lines"
          style={{ width: 56, padding: '2px 6px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', fontSize: 12 }}
        />
      )}

      {format === 'labelled_blanks' && (
        <>
          <input
            type="text"
            value={labels.join(', ')}
            onChange={e => onUpdate('blankLabels', e.target.value.split(/[,]/).map(s => s.trim()).filter(Boolean).slice(0, 26))}
            placeholder="P, Q, R"
            title="Comma-separated labels — one blank prints per label"
            style={{ flex: '1 1 140px', minWidth: 120, padding: '2px 6px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', fontSize: 12 }}
          />
          <select
            value=""
            onChange={e => { if (e.target.value) onUpdate('blankLabels', labelPresets[e.target.value]) }}
            title="Quick label presets"
            style={{ padding: '2px 6px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', fontSize: 12 }}
          >
            <option value="">Preset…</option>
            {Object.keys(labelPresets).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </>
      )}
    </div>
  )
}

// "Split into parts" — converts a single short-answer question into a multi-part
// one. The question text becomes the instruction stem; the first lettered part
// inherits whatever the teacher already typed as the model answer. From here the
// SubPartsEditor takes over.
export function SplitIntoPartsButton({ question, onUpdate }) {
  function split() {
    const firstAnswer = String(question.correctAnswer ?? '').trim()
    const parts = [emptySubPart({ answer: firstAnswer }), emptySubPart()]
    onUpdate('subParts', parts)
    onUpdate('marks', sumSubPartMarks(parts))
    // The stem no longer carries a single answer — it lives on the parts now.
    onUpdate('correctAnswer', '')
  }
  return (
    <div style={{ margin: '8px 0 2px' }}>
      <button type="button" className="sv-btn sv-btn-outline sv-btn-sm" onClick={split}>
        <Icon name="sequence" size={14} /> Split into parts (a, b, c)
      </button>
      <p style={{ fontSize: 11, color: 'var(--sv-muted)', marginTop: 4 }}>
        Turns the question above into an instruction with lettered sub-questions — each with its own blank and marks.
      </p>
    </div>
  )
}

// Editor for short-answer SUB-PARTS — the "(a) … (b) … (c) …" structure. The
// question's text (edited above) is the instruction stem; each part here is a
// lettered follow-up with its own sentence, marks, model answer and answer
// space. The (a)(b)(c) labels follow position automatically. The question's
// total marks auto-sum the parts (kept in sync on every edit).
export function SubPartsEditor({ question, onUpdate }) {
  const parts = normalizeSubParts(question.subParts)

  function commit(next) {
    onUpdate('subParts', next)
    onUpdate('marks', sumSubPartMarks(next))
  }
  function updatePart(index, field, value) {
    commit(parts.map((p, i) => (i === index ? { ...p, [field]: value } : p)))
  }
  function addPart() {
    commit([...parts, emptySubPart()])
  }
  function removePart(index) {
    const next = parts.filter((_, i) => i !== index)
    if (next.length === 0) {
      // Removing the last part collapses back to a plain single-answer question.
      onUpdate('subParts', [])
      onUpdate('correctAnswer', String(parts[0]?.answer ?? ''))
      onUpdate('marks', Number(parts[0]?.marks) || 1)
      return
    }
    commit(next)
  }
  function movePart(index, dir) {
    const j = index + dir
    if (j < 0 || j >= parts.length) return
    const next = [...parts]
    ;[next[index], next[j]] = [next[j], next[index]]
    commit(next)
  }

  return (
    <div className="sv-subparts-editor" style={{ margin: '6px 0 2px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 10, background: 'var(--sv-tinted)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}><Icon name="sequence" size={13} /> Sub-parts</strong>
        <span style={{ fontSize: 11, color: 'var(--sv-muted)' }}>
          The question text above is the instruction. Total: {sumSubPartMarks(parts)} mark{sumSubPartMarks(parts) === 1 ? '' : 's'}.
        </span>
      </div>

      {parts.map((part, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 0', borderTop: i === 0 ? 'none' : '1px dashed var(--sv-border)' }}>
          <strong style={{ flex: '0 0 auto', width: 26, paddingTop: 6 }}>({subPartLabel(i)})</strong>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              type="text"
              value={part.text}
              onChange={e => updatePart(i, 'text', e.target.value)}
              placeholder="Sentence or question, e.g. Foods such as meat belong to the group called …"
              style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 6, fontSize: 13, background: 'var(--sv-paper)', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--sv-muted)' }}>
                Answer space:
                <select
                  value={part.answerFormat}
                  onChange={e => updatePart(i, 'answerFormat', e.target.value)}
                  style={{ padding: '2px 6px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', fontSize: 11 }}
                >
                  <option value="inline">Inline blank ……</option>
                  <option value="lines">Ruled lines</option>
                  <option value="none">No space</option>
                </select>
              </label>
              {part.answerFormat === 'lines' && (
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={part.answerLines ?? 2}
                  onChange={e => updatePart(i, 'answerLines', clampInt(e.target.value, 0, 20, 2))}
                  title="Number of ruled answer lines"
                  style={{ width: 52, padding: '2px 6px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', fontSize: 11 }}
                />
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--sv-muted)' }}>
                marks
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={part.marks}
                  onChange={e => updatePart(i, 'marks', clampInt(e.target.value, 0, 99, 1))}
                  style={{ width: 48, padding: '2px 6px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', fontSize: 11 }}
                />
              </label>
            </div>
            <input
              type="text"
              value={part.answer}
              onChange={e => updatePart(i, 'answer', e.target.value)}
              placeholder="Expected answer (used for the marking key)"
              style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 6, fontSize: 12.5, background: 'var(--sv-paper)', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button type="button" className="sv-subpart-btn" title="Move up" onClick={() => movePart(i, -1)} disabled={i === 0}><Icon name="moveUp" size={13} /></button>
            <button type="button" className="sv-subpart-btn" title="Move down" onClick={() => movePart(i, 1)} disabled={i === parts.length - 1}><Icon name="moveDown" size={13} /></button>
            <button type="button" className="sv-subpart-btn danger" title="Remove this part" onClick={() => removePart(i)}><Icon name="remove" size={13} /></button>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 8 }}>
        <button type="button" className="sv-btn sv-btn-outline sv-btn-sm" onClick={addPart}>
          + Add part ({subPartLabel(parts.length)})
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--sv-muted)', marginTop: 6 }}>
        Tip: for an inline blank, type a gap with dots or underscores (<code>……</code> / <code>____</code>) where the answer goes — or leave it and one is added at the end.
      </p>
    </div>
  )
}

// Generates a short string id used as the React key + stable identifier for
// dragged labels. We don't need cryptographic randomness — collisions across
// labels on the same question are effectively impossible at 12 random chars.
function newLabelId() {
  return `label_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36).slice(-4)}`
}

// Diagram label editor — overlays draggable labels on top of a question
// image. Used for AI-generated B&W diagrams (PR #422) where the image has
// no built-in labels and the teacher fills them in.
//
// Interaction model:
//   - Click anywhere on the image (where no label sits) → adds a label at
//     that point with the input focused for immediate typing.
//   - Click + drag a label → moves it. Coords are stored as 0..1 ratios
//     of the image's natural size so labels stay anchored when the image
//     is resized in preview / PDF / DOCX.
//   - Click "×" on a label → deletes it.
//   - Cap of 20 labels per image (matches the schema cap).
//
// Labels render as small white-background pills with a thin border so
// they remain readable over the B&W line art Recraft produces.
export function DiagramLabelEditor({ imageUrl, labels, mode = 'labeled', onChangeLabels, onChangeMode, onRemoveImage }) {
  const isIdentify = mode === 'identify'
  const wrapperRef = useRef(null)
  const dragRef = useRef(null) // { id, which:'label'|'target', startX, startY, origX, origY }

  // The point a label's leader line points AT. Defaults a little inward from
  // the label when not yet set so a freshly dropped label still shows a line.
  function targetOf(label) {
    const tx = Number.isFinite(label?.tx) ? label.tx : (label.x <= 0.5 ? Math.min(0.95, label.x + 0.22) : Math.max(0.05, label.x - 0.22))
    const ty = Number.isFinite(label?.ty) ? label.ty : label.y
    return { tx, ty }
  }

  function updateLabel(id, patch) {
    onChangeLabels(labels.map(l => l.id === id ? { ...l, ...patch } : l))
  }

  function addLabelAt(clientX, clientY) {
    if (!wrapperRef.current) return
    if (labels.length >= 20) return
    const rect = wrapperRef.current.getBoundingClientRect()
    const x = Math.max(0.02, Math.min(0.98, (clientX - rect.left) / rect.width))
    const y = Math.max(0.02, Math.min(0.98, (clientY - rect.top) / rect.height))
    // Seed a leader-line target pointing inward so the new label points at a
    // part instead of sitting on top of it; the teacher drags the tip on.
    const tx = x <= 0.5 ? Math.min(0.95, x + 0.22) : Math.max(0.05, x - 0.22)
    onChangeLabels([...labels, { id: newLabelId(), x, y, tx, ty: y, text: '' }])
  }

  function onImageMouseDown(e) {
    // Only handle clicks on the image background — not on labels or their
    // leader-tip handles. Those stop propagation in their own handlers below.
    if (e.target.closest('[data-label]') || e.target.closest('[data-target]')) return
    e.preventDefault()
    addLabelAt(e.clientX, e.clientY)
  }

  function onLabelMouseDown(e, id) {
    e.stopPropagation()
    e.preventDefault()
    const label = labels.find(l => l.id === id)
    if (!label) return
    dragRef.current = {
      id,
      which: 'label',
      startX: e.clientX,
      startY: e.clientY,
      origX: label.x,
      origY: label.y,
    }
  }
  function onTargetMouseDown(e, id) {
    e.stopPropagation()
    e.preventDefault()
    const label = labels.find(l => l.id === id)
    if (!label) return
    const { tx, ty } = targetOf(label)
    dragRef.current = {
      id,
      which: 'target',
      startX: e.clientX,
      startY: e.clientY,
      origX: tx,
      origY: ty,
    }
  }
  function onWrapperMouseMove(e) {
    const drag = dragRef.current
    if (!drag || !wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    const dx = (e.clientX - drag.startX) / rect.width
    const dy = (e.clientY - drag.startY) / rect.height
    const nx = Math.max(0.02, Math.min(0.98, drag.origX + dx))
    const ny = Math.max(0.02, Math.min(0.98, drag.origY + dy))
    updateLabel(drag.id, drag.which === 'target' ? { tx: nx, ty: ny } : { x: nx, y: ny })
  }
  function onWrapperMouseUp() {
    dragRef.current = null
  }
  function deleteLabel(id) {
    onChangeLabels(labels.filter(l => l.id !== id))
  }

  return (
    <div style={{ position: 'relative', marginBottom: 8 }}>
      <div
        ref={wrapperRef}
        onMouseDown={onImageMouseDown}
        onMouseMove={onWrapperMouseMove}
        onMouseUp={onWrapperMouseUp}
        onMouseLeave={onWrapperMouseUp}
        className="sv-q-media filled filled-wrap"
        style={{ position: 'relative', cursor: 'crosshair', userSelect: 'none' }}
      >
        <img src={imageUrl} alt="" draggable={false} style={{ pointerEvents: 'none' }} />
        {/* Leader lines from each label to the part it points at, ending in a
            dot on the part — same drawing the printed paper produces. */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }} aria-hidden="true">
          {labels.map((label) => {
            const { tx, ty } = targetOf(label)
            return (
              <g key={`ln-${label.id}`}>
                <line x1={`${label.x * 100}%`} y1={`${label.y * 100}%`} x2={`${tx * 100}%`} y2={`${ty * 100}%`} stroke="#000" strokeWidth="1" />
                <circle cx={`${tx * 100}%`} cy={`${ty * 100}%`} r="2.5" fill="#000" />
              </g>
            )
          })}
        </svg>
        {/* Draggable leader tip — teacher drags this onto the exact part. */}
        {labels.map((label) => {
          const { tx, ty } = targetOf(label)
          return (
            <div
              key={`tip-${label.id}`}
              data-target
              onMouseDown={e => onTargetMouseDown(e, label.id)}
              title="Drag onto the part this label points at"
              style={{
                position: 'absolute',
                left: `${tx * 100}%`,
                top: `${ty * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: '2px solid #2563eb',
                background: 'rgba(37,99,235,0.18)',
                cursor: 'move',
              }}
            />
          )
        })}
        {labels.map((label, i) => (
          <div
            key={label.id}
            data-label
            onMouseDown={e => onLabelMouseDown(e, label.id)}
            style={{
              position: 'absolute',
              left: `${label.x * 100}%`,
              top: `${label.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              background: 'white',
              border: '1px solid #000',
              borderRadius: 3,
              padding: '1px 6px',
              fontSize: 11,
              cursor: 'move',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              whiteSpace: 'nowrap',
            }}
          >
            {isIdentify && (
              <strong style={{ background: '#000', color: '#fff', borderRadius: '50%', width: 16, height: 16, display: 'inline-grid', placeItems: 'center', fontSize: 10 }}>
                {i + 1}
              </strong>
            )}
            <input
              type="text"
              value={label.text}
              onMouseDown={e => e.stopPropagation()} // let user click the input without starting a drag
              onChange={e => updateLabel(label.id, { text: e.target.value.slice(0, 80) })}
              placeholder={isIdentify ? 'Expected answer' : 'Label'}
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 11, width: Math.max(60, (label.text?.length || 6) * 7), padding: 0 }}
            />
            <button
              type="button"
              onClick={e => { e.stopPropagation(); deleteLabel(label.id) }}
              onMouseDown={e => e.stopPropagation()}
              title="Remove label"
              style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
            >×</button>
          </div>
        ))}
        <button
          className="sv-media-remove"
          onClick={e => { e.stopPropagation(); onRemoveImage() }}
          onMouseDown={e => e.stopPropagation()}
          title="Remove image"
          type="button"
        >
          ×
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--sv-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>
          {isIdentify
            ? 'Drop numbered hotspots · drag the blue tip onto the part each points at · each text becomes the expected answer · students fill in numbered blanks below'
            : 'Click the image to drop a label · drag the label to the margin and the blue tip onto the part it points at · ✕ to delete · max 20 labels'}
          {labels.length >= 20 && <span style={{ color: '#b91c1c', marginLeft: 6 }}>· limit reached</span>}
        </span>
        {onChangeMode && (
          <select
            value={mode}
            onChange={e => onChangeMode(e.target.value)}
            title="How the labels render on the printed paper"
            style={{ marginLeft: 'auto', background: 'var(--sv-tinted)', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '2px 6px', fontSize: 11 }}
          >
            <option value="labeled">Labels print as text</option>
            <option value="identify">Identify (numbered hotspots)</option>
          </select>
        )}
      </div>
    </div>
  )
}

// Matching question editor — two parallel columns with a "match" dropdown
// per left-column row. The left column shows the prompts the student
// matches FROM; the right column the labelled options (A, B, C…). Each
// left row picks the correct right-column letter via its dropdown.
//
//   matchingLeft   = ['Lion',  'Tilapia', 'Cobra']
//   matchingRight  = ['fish',  'mammal',  'reptile']
//   matchingAnswer = [1, 0, 2]   // Lion→B (mammal), Tilapia→A (fish), Cobra→C
//
// Add/remove rows operate on all three arrays together so they stay in
// lockstep. A -1 in matchingAnswer means "no correct match selected yet".
export function MatchingInputs({ left, right, answer, onChangeLeft, onChangeRight, onChangeAnswer }) {
  // Rows always render at max(left.length, right.length, 3) — minimum 3
  // so the editor has visible structure even on a fresh blank question.
  const rows = Math.max(left.length, right.length, 3)
  const leftPadded = Array.from({ length: rows }, (_, i) => left[i] ?? '')
  const rightPadded = Array.from({ length: rows }, (_, i) => right[i] ?? '')
  const answerPadded = Array.from({ length: rows }, (_, i) =>
    Number.isInteger(answer[i]) ? answer[i] : -1,
  )

  function setLeftAt(i, value) {
    const next = [...leftPadded]
    next[i] = value
    onChangeLeft(next)
  }
  function setRightAt(i, value) {
    const next = [...rightPadded]
    next[i] = value
    onChangeRight(next)
  }
  function setAnswerAt(i, value) {
    const next = [...answerPadded]
    const n = Number(value)
    next[i] = Number.isInteger(n) && n >= 0 && n < rightPadded.length ? n : -1
    onChangeAnswer(next)
  }
  function addRow() {
    if (rows >= 10) return
    onChangeLeft([...leftPadded, ''])
    onChangeRight([...rightPadded, ''])
    onChangeAnswer([...answerPadded, -1])
  }
  function removeRow(i) {
    if (rows <= 2) return
    const dropAt = arr => arr.filter((_, idx) => idx !== i)
    const remappedAnswer = dropAt(answerPadded).map(a =>
      // If the removed row's index was a target of some other answer,
      // clear that answer rather than silently pointing it at the wrong row.
      a === i ? -1 : (a > i ? a - 1 : a),
    )
    onChangeLeft(dropAt(leftPadded))
    onChangeRight(dropAt(rightPadded))
    onChangeAnswer(remappedAnswer)
  }

  return (
    <div className="sv-answer-lines">
      <div className="sv-answer-meta"><Icon name="matching" size={13} /> Matching pairs — students draw lines from left to right on the printed paper</div>
      <p className="sv-input-hint">
        Type each prompt on the left and its option on the right, then pick the letter it pairs with under <strong>Match →</strong>. The marking key lists the correct pairs.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 24px 1fr 90px 28px', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 11, color: 'var(--sv-muted)' }}>
        <div></div>
        <div>Left (prompt)</div>
        <div></div>
        <div>Right (option)</div>
        <div>Match →</div>
        <div></div>
      </div>
      {leftPadded.map((_, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 24px 1fr 90px 28px', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <strong style={{ textAlign: 'right', fontSize: 12, color: 'var(--sv-muted)' }}>{i + 1}.</strong>
          <input
            type="text"
            value={leftPadded[i]}
            onChange={e => setLeftAt(i, e.target.value)}
            placeholder={`Left ${i + 1}`}
            style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '4px 6px', fontSize: 13, background: 'var(--sv-paper)' }}
          />
          <strong style={{ textAlign: 'right', fontSize: 12, color: 'var(--sv-muted)' }}>{SECTION_LETTERS[i] || '?'}.</strong>
          <input
            type="text"
            value={rightPadded[i]}
            onChange={e => setRightAt(i, e.target.value)}
            placeholder={`Right ${SECTION_LETTERS[i] || ''}`}
            style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '4px 6px', fontSize: 13, background: 'var(--sv-paper)' }}
          />
          <select
            value={answerPadded[i] >= 0 ? answerPadded[i] : ''}
            onChange={e => setAnswerAt(i, e.target.value)}
            style={{ border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '4px 6px', fontSize: 12, background: 'var(--sv-paper)' }}
          >
            <option value="">— pick —</option>
            {rightPadded.map((r, j) => (
              <option key={j} value={j} disabled={!String(r || '').trim()}>
                {SECTION_LETTERS[j]}{String(r || '').trim() ? ` (${String(r).trim().slice(0, 18)})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => removeRow(i)}
            disabled={rows <= 2}
            title="Remove this pair"
            style={{ width: 24, height: 24, border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'transparent', cursor: rows <= 2 ? 'default' : 'pointer', color: 'var(--sv-muted)', fontSize: 14 }}
          >×</button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        disabled={rows >= 10}
        style={{ marginTop: 4, padding: '4px 10px', border: '1px dashed var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'transparent', cursor: rows >= 10 ? 'default' : 'pointer', fontSize: 12, color: 'var(--sv-muted)' }}
      >
        + Add pair {rows >= 10 ? '(max 10)' : ''}
      </button>
    </div>
  )
}

// Sequence question editor — one column of items, each with a "correct
// position" dropdown (1..N). Teachers can deliberately type items in
// jumbled order; the paper prints them as typed and the marking key
// shows the sorted-by-position sequence.
//
//   sequenceItems  = ['Frog', 'Tadpole', 'Egg', 'Adult']
//   sequenceAnswer = [3, 2, 1, 4]   // Frog→3, Tadpole→2, Egg→1, Adult→4
//
// 0 in sequenceAnswer means "no position set yet". A valid full answer
// is a permutation of [1..items.length]; we surface a soft warning if
// the teacher has duplicates or gaps but don't block save (lets them
// edit mid-flow without fighting the UI).
export function SequenceInputs({ items, answer, onChangeItems, onChangeAnswer }) {
  const rows = Math.max(items.length, 3)
  const itemsPadded = Array.from({ length: rows }, (_, i) => items[i] ?? '')
  const answerPadded = Array.from({ length: rows }, (_, i) =>
    Number.isInteger(answer[i]) ? answer[i] : 0,
  )

  function setItemAt(i, value) {
    const next = [...itemsPadded]
    next[i] = value
    onChangeItems(next)
  }
  function setPositionAt(i, value) {
    const next = [...answerPadded]
    const n = Number(value)
    next[i] = Number.isInteger(n) && n >= 1 && n <= rows ? n : 0
    onChangeAnswer(next)
  }
  function addRow() {
    if (rows >= 10) return
    onChangeItems([...itemsPadded, ''])
    onChangeAnswer([...answerPadded, 0])
  }
  function removeRow(i) {
    if (rows <= 2) return
    const removedPos = answerPadded[i]
    const dropAt = arr => arr.filter((_, idx) => idx !== i)
    // Shrinking the list shifts higher positions down by 1 so the
    // permutation stays well-formed.
    const remappedAnswer = dropAt(answerPadded).map(p => {
      if (p === removedPos) return 0
      if (p > removedPos) return p - 1
      return p
    })
    onChangeItems(dropAt(itemsPadded))
    onChangeAnswer(remappedAnswer)
  }

  // Soft validation — duplicates or unset positions among filled items.
  const filledIndices = itemsPadded
    .map((it, idx) => (String(it || '').trim() ? idx : -1))
    .filter(i => i >= 0)
  const positionsUsed = new Map()
  const dupPositions = new Set()
  let anyUnset = false
  for (const i of filledIndices) {
    const p = answerPadded[i]
    if (!p) { anyUnset = true; continue }
    if (positionsUsed.has(p)) dupPositions.add(p)
    positionsUsed.set(p, true)
  }
  const warnings = []
  if (filledIndices.length >= 2 && anyUnset) warnings.push('Some items have no position set.')
  if (dupPositions.size > 0) warnings.push(`Position ${[...dupPositions].join(', ')} is used more than once.`)

  return (
    <div className="sv-answer-lines">
      <div className="sv-answer-meta"><Icon name="sequence" size={13} /> Sequence — students write the correct position in the blanks on the printed paper</div>
      <p className="sv-input-hint">
        Type the items in any order, then set each one&apos;s <strong>correct position</strong> (1 = first). The paper prints them as typed; the key shows the right order.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 110px 28px', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 11, color: 'var(--sv-muted)' }}>
        <div></div>
        <div>Item (as printed)</div>
        <div>Correct position</div>
        <div></div>
      </div>
      {itemsPadded.map((_, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 110px 28px', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <strong style={{ textAlign: 'right', fontSize: 12, color: 'var(--sv-muted)' }}>{i + 1}.</strong>
          <input
            type="text"
            value={itemsPadded[i]}
            onChange={e => setItemAt(i, e.target.value)}
            placeholder={`Item ${i + 1}`}
            style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '4px 6px', fontSize: 13, background: 'var(--sv-paper)' }}
          />
          <select
            value={answerPadded[i] >= 1 ? answerPadded[i] : ''}
            onChange={e => setPositionAt(i, e.target.value)}
            style={{ border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '4px 6px', fontSize: 12, background: 'var(--sv-paper)' }}
          >
            <option value="">— position —</option>
            {Array.from({ length: rows }).map((_, p) => (
              <option key={p} value={p + 1}>{p + 1}{p === 0 ? ' (first)' : p === rows - 1 ? ' (last)' : ''}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => removeRow(i)}
            disabled={rows <= 2}
            title="Remove this item"
            style={{ width: 24, height: 24, border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'transparent', cursor: rows <= 2 ? 'default' : 'pointer', color: 'var(--sv-muted)', fontSize: 14 }}
          >×</button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        disabled={rows >= 10}
        style={{ marginTop: 4, padding: '4px 10px', border: '1px dashed var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'transparent', cursor: rows >= 10 ? 'default' : 'pointer', fontSize: 12, color: 'var(--sv-muted)' }}
      >
        + Add item {rows >= 10 ? '(max 10)' : ''}
      </button>
      {warnings.length > 0 && (
        <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 'var(--sv-r-sm)', background: '#FFFBEB', border: '1px solid #FCD34D', color: '#92400E', fontSize: 11 }}>
          {warnings.join(' ')}
        </div>
      )}
    </div>
  )
}

// Numeric question editor — three side-by-side fields:
//   • Expected value (number; stored as a string so teachers can type partial
//     entries like "0." while editing without losing focus)
//   • Tolerance (± number; default 0 for exact match)
//   • Unit (free-form short text, e.g. "kg", "m/s", "%")
// Data/Table editor — attaches a small data table to a structured
// question. Renders as an editable grid with add/remove buttons for
// rows and columns. Used by maths and science questions that need
// students to read values off a table before answering.
//
// Caps: max 6 columns and 12 rows (matches the hydrator limits).
export function DataTableInputs({ tableData, onChange }) {
  const data = tableData || { headers: ['Column A', 'Column B'], rows: [['', '']] }
  const headers = Array.isArray(data.headers) ? data.headers : []
  const rows = Array.isArray(data.rows) ? data.rows : []
  const cols = headers.length

  function setHeader(i, value) {
    const nextHeaders = [...headers]
    nextHeaders[i] = value
    onChange({ headers: nextHeaders, rows })
  }
  function setCell(rowIdx, colIdx, value) {
    const nextRows = rows.map((r, i) => {
      if (i !== rowIdx) return r
      const next = [...(Array.isArray(r) ? r : [])]
      next[colIdx] = value
      return next
    })
    onChange({ headers, rows: nextRows })
  }
  function addRow() {
    if (rows.length >= 12) return
    onChange({ headers, rows: [...rows, Array(cols).fill('')] })
  }
  function removeRow(i) {
    if (rows.length <= 1) return
    onChange({ headers, rows: rows.filter((_, idx) => idx !== i) })
  }
  function addCol() {
    if (cols >= 6) return
    onChange({
      headers: [...headers, `Column ${String.fromCharCode(65 + cols)}`],
      rows: rows.map(r => [...(Array.isArray(r) ? r : []), '']),
    })
  }
  function removeCol(colIdx) {
    if (cols <= 1) return
    onChange({
      headers: headers.filter((_, i) => i !== colIdx),
      rows: rows.map(r => (Array.isArray(r) ? r.filter((_, i) => i !== colIdx) : [])),
    })
  }
  function clearTable() {
    // Setting tableData to null removes the table from this question.
    onChange(null)
  }

  return (
    <div className="sv-answer-lines" style={{ marginTop: 4 }}>
      <div className="sv-answer-meta"><Icon name="table" size={13} /> Data table — students read values off this table to answer the question</div>
      <p className="sv-input-hint">
        Edit headers and cells directly; use <strong>+</strong> to add a column or row. The table prints above the question for students to read from.
      </p>
      <div style={{ overflowX: 'auto', marginTop: 4 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={{ border: '1px solid var(--sv-border)', padding: 0, background: '#f8fafc' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={h || ''}
                      onChange={e => setHeader(i, e.target.value)}
                      placeholder="Header"
                      style={{ width: 110, border: 'none', outline: 'none', padding: '4px 6px', fontSize: 12, background: 'transparent', fontWeight: 600 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeCol(i)}
                      disabled={cols <= 1}
                      title="Remove column"
                      style={{ border: 'none', background: 'transparent', cursor: cols <= 1 ? 'default' : 'pointer', color: 'var(--sv-muted)', fontSize: 12, padding: '0 4px' }}
                    >×</button>
                  </div>
                </th>
              ))}
              <th style={{ border: 'none', padding: 0 }}>
                <button
                  type="button"
                  onClick={addCol}
                  disabled={cols >= 6}
                  title="Add column"
                  style={{ marginLeft: 4, padding: '2px 8px', border: '1px dashed var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'transparent', cursor: cols >= 6 ? 'default' : 'pointer', fontSize: 11, color: 'var(--sv-muted)' }}
                >+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {headers.map((_, colIdx) => (
                  <td key={colIdx} style={{ border: '1px solid var(--sv-border)', padding: 0 }}>
                    <input
                      type="text"
                      value={(Array.isArray(row) ? row[colIdx] : '') || ''}
                      onChange={e => setCell(rowIdx, colIdx, e.target.value)}
                      placeholder="—"
                      style={{ width: 110, border: 'none', outline: 'none', padding: '4px 6px', fontSize: 12, background: 'var(--sv-paper)' }}
                    />
                  </td>
                ))}
                <td style={{ border: 'none', padding: 0 }}>
                  <button
                    type="button"
                    onClick={() => removeRow(rowIdx)}
                    disabled={rows.length <= 1}
                    title="Remove row"
                    style={{ marginLeft: 4, padding: '2px 6px', border: 'none', background: 'transparent', cursor: rows.length <= 1 ? 'default' : 'pointer', color: 'var(--sv-muted)', fontSize: 12 }}
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= 12}
          style={{ padding: '2px 10px', border: '1px dashed var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'transparent', cursor: rows.length >= 12 ? 'default' : 'pointer', fontSize: 11, color: 'var(--sv-muted)' }}
        >
          + Add row {rows.length >= 12 ? '(max 12)' : ''}
        </button>
        <button
          type="button"
          onClick={clearTable}
          style={{ padding: '2px 10px', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', background: 'transparent', cursor: 'pointer', fontSize: 11, color: 'var(--sv-muted)' }}
          title="Remove the table from this question"
        >
          Remove table
        </button>
      </div>
    </div>
  )
}

export function NumericInputs({ correctAnswer, tolerance, unit, onChangeAnswer, onChangeTolerance, onChangeUnit }) {
  return (
    <div className="sv-answer-lines">
      <div className="sv-answer-meta"><Icon name="numeric" size={13} /> Numeric answer (rendered as a blank line on the paper; the unit prints after the line)</div>
      <p className="sv-input-hint">
        Leave tolerance at <code>0</code> to mark only the exact value correct, or set e.g. <code>0.5</code> to accept answers within ±0.5. The unit is optional.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div className="sv-field">
          <label style={{ fontSize: 11, color: 'var(--sv-muted)' }}>Expected value</label>
          <input
            type="text"
            inputMode="decimal"
            value={String(correctAnswer ?? '')}
            onChange={e => onChangeAnswer(e.target.value)}
            placeholder="e.g. 56"
            style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '6px 8px', fontSize: 13, background: 'var(--sv-paper)' }}
          />
        </div>
        <div className="sv-field">
          <label style={{ fontSize: 11, color: 'var(--sv-muted)' }}>Tolerance ±</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={String(tolerance ?? 0)}
            onChange={e => onChangeTolerance(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '6px 8px', fontSize: 13, background: 'var(--sv-paper)' }}
          />
        </div>
        <div className="sv-field">
          <label style={{ fontSize: 11, color: 'var(--sv-muted)' }}>Unit (optional)</label>
          <input
            type="text"
            value={String(unit ?? '')}
            onChange={e => onChangeUnit(e.target.value.slice(0, 12))}
            placeholder="kg, m, %"
            style={{ width: '100%', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '6px 8px', fontSize: 13, background: 'var(--sv-paper)' }}
          />
        </div>
      </div>
    </div>
  )
}

export function toEditableText(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    // If it looks like rich text (HTML or Tiptap JSON), strip to plain text.
    // The new builder uses plain textarea; rich formatting is preserved
    // round-trip only on questions that aren't edited here.
    if (value.startsWith('<') || value.trim().startsWith('{')) {
      return richTextToPlainText(value)
    }
    // A plain string is returned VERBATIM rather than round-tripped through
    // the HTML path, which would collapse the runs of spaces and newlines a
    // teacher is in the middle of typing.
    return value
  }
  // A Tiptap doc object — the shape a saved paper comes back as, because the
  // write path stores `textJSON` beside the HTML and the loader prefers it.
  // This used to reach `String(value)` and print "[object Object]" into the
  // question box of every reopened paper.
  if (typeof value === 'object') return richTextToPlainText(value)
  return String(value)
}

// Question-text field for the inline builder cards. A plain textarea is fine
// while the content is plain (editing it can't lose formatting that isn't
// there). But once a question carries formatting — bold, sup/sub, a fraction,
// a table, etc. (typically from the detailed editor, AI, or an import) — a
// quick textarea edit would silently flatten it. In that case we show a
// read-only plain view plus an "edit in detail" affordance, so the rich
// content is only ever changed in the full RichEditor (which preserves it).
export function CardQuestionText({ value, onChange, onEditDetail, placeholder = 'Question text', maths = false, fieldId, grade }) {
  // On a mathematics paper the card edits rich content in place (§2). The
  // teacher inserts a fraction where they are working; opening the detailed
  // editor to add one is exactly what this phase removes. Note this replaces
  // BOTH branches below — the read-only "edit in detail" fallback existed only
  // because a textarea could not hold the content safely, and a real editor can.
  if (maths) {
    return (
      <MathsRichField
        fieldId={fieldId || 'question-text'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        ariaLabel="Question text — edit with mathematics tools"
        grade={grade}
        minHeight={72}
      />
    )
  }
  if (richTextHasFormatting(value)) {
    return (
      <div className="sv-q-text-formatted">
        <div className="sv-q-text-plain">{toEditableText(value) || <span className="sv-q-text-empty">(formatted question)</span>}</div>
        <button type="button" className="sv-q-text-editlink" onClick={onEditDetail}>
          <Icon name="edit" size={12} /> Formatted — edit in detail to keep formatting
        </button>
      </div>
    )
  }
  return (
    <textarea
      className="sv-q-text-input"
      value={toEditableText(value)}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  )
}
