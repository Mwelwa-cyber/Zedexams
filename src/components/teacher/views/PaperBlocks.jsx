/**
 * Shared "school paper" renderer.
 *
 * Walks the typed blocks produced by `buildPaperLayout`
 * (src/utils/assessmentPaperLayout.js) and renders them as the printed-paper
 * preview. Extracted out of AssessmentStudio so any surface that wants the
 * same exam-paper look — the Assessment Studio preview/marking-key AND the
 * SBA (School Based Assessment) task view — renders from one source of truth
 * instead of drifting.
 *
 * The CSS lives in `studio/assessmentStudio.css`, scoped under `.studio-v2`.
 * `PaperDocument` supplies that wrapper so callers outside the studio shell
 * (e.g. the SBA studio card, the library detail page) still get the styling.
 */

import DiagramSvg from '../../diagrams/DiagramSvg'
import { resolveImageWidthPercent } from '../../../utils/imageWidth'
import { splitStatementSegments, statementLabel } from '../../../utils/fillBlanks'
import '../studio/assessmentStudio.css'

const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/**
 * Wrap a list of layout blocks in the `.studio-v2` + `.sv-paper` shell so the
 * scoped paper CSS applies. Use this from any surface that wants the exam-paper
 * look without the full Assessment Studio chrome.
 */
export function PaperDocument({ blocks = [], className = '' }) {
  return (
    <div className={`studio-v2 ${className}`.trim()}>
      <div className="sv-preview-shell">
        <div className="sv-paper">
          {blocks.map((block, i) => <PaperBlock key={i} block={block} />)}
        </div>
      </div>
    </div>
  )
}

// Single-block renderer — switches on block.kind. Mirrors the shapes
// returned by buildPaperLayout in src/utils/assessmentPaperLayout.js.
export function PaperBlock({ block }) {
  switch (block.kind) {
    case 'header': return <PaperHeaderBlock block={block} />
    case 'learnerFields': return <PaperLearnerFieldsBlock block={block} />
    case 'instructions': return <PaperInstructionsBlock block={block} />
    case 'sectionHeader': return <PaperSectionHead block={block} />
    case 'passage': return <PaperPassageBlock block={block} />
    case 'question': return <PaperQuestionBlock block={block} />
    case 'passageTotal': return (
      <div className="sv-paper-passage-total" style={{ textAlign: 'right', fontWeight: 700, fontSize: 12.5, margin: '2px 0 14px', color: '#000' }}>
        Total: {block.totalMarks} mark{block.totalMarks === 1 ? '' : 's'}
      </div>
    )
    case 'pagebreak': return (
      <div style={{ borderTop: '2px dashed #94a3b8', margin: '28px 0 14px', position: 'relative' }}>
        <span style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: '#fff', padding: '0 10px', fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
          Page break
        </span>
      </div>
    )
    case 'endOfPaper': return (
      <div style={{ textAlign: 'center', marginTop: 24, paddingTop: 12, borderTop: '1px solid #000', fontSize: 11.5, fontStyle: 'italic', color: '#555' }}>
        {block.text}
      </div>
    )
    case 'footerCode': return <div className="sv-paper-footer-code">{block.code}</div>
    default: return null
  }
}

function PaperHeaderBlock({ block }) {
  return (
    <div className="sv-paper-banner">
      <div className="sv-paper-banner-text">
        <div className="sv-pbn-school">{(block.schoolName || 'YOUR SCHOOL NAME').toUpperCase()}</div>
        <div className="sv-pbn-title">{block.title}</div>
        {block.subject && <div className="sv-pbn-subject">{block.subject}</div>}
        {block.paperName && <div className="sv-pbn-paper">{block.paperName}</div>}
      </div>
    </div>
  )
}

function PaperLearnerFieldsBlock({ block }) {
  return (
    <>
      {(block.name || block.date) && (
        <div className="sv-paper-name-row">
          {block.name && <><span>NAME:</span><div className="sv-line" /></>}
          {block.date && <><span>DATE:</span><div className="sv-line" style={{ maxWidth: 180 }} /></>}
        </div>
      )}
      {block.classField && (
        <div className="sv-paper-name-row" style={{ marginTop: 0 }}>
          <span>CLASS:</span><div className="sv-line" />
        </div>
      )}
      {block.marks && (
        <div className="sv-paper-total-marks">
          TOTAL MARKS: _________ / {block.totalMarks || '____'}
        </div>
      )}
    </>
  )
}

// Render instructions with inline-bold (A) (B) (C) (D). The raw text comes
// from the form's coverInstructions textarea — split on blank lines for
// paragraphs, then bold every (A)/(B)/(C)/(D) tag inline.
function PaperInstructionsBlock({ block }) {
  const paragraphs = String(block.text || '').split(/\n\s*\n/).filter(p => p.trim())
  return (
    <div className="sv-paper-instr-box">
      <span className="sv-instr-label">{block.isMarkingKey ? 'Marking key' : 'Instructions'}</span>
      {paragraphs.map((p, i) => (
        <p key={i}>{renderInlineOptionLetters(p.replace(/\n/g, ' '))}</p>
      ))}
    </div>
  )
}

function renderInlineOptionLetters(text) {
  const parts = []
  const pattern = /\(([A-D])\)/g
  let cursor = 0
  let match
  let key = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(<span key={key++}>{text.slice(cursor, match.index)}</span>)
    parts.push(<strong key={key++} className="sv-opt-tag">({match[1]})</strong>)
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push(<span key={key++}>{text.slice(cursor)}</span>)
  return parts
}

function PaperSectionHead({ block }) {
  return (
    <div className="sv-paper-section">
      <div className="sv-paper-section-head">
        Section {block.letter}{block.title ? ` — ${block.title}` : ''}
        <span className="sv-marks">({block.marks} mark{block.marks === 1 ? '' : 's'})</span>
      </div>
      {block.instructions && (
        <div className="sv-paper-section-instr">{block.instructions}</div>
      )}
    </div>
  )
}

function PaperPassageBlock({ block }) {
  return (
    <div className="sv-paper-passage">
      {block.title && <strong className="sv-pass-h">{block.title}</strong>}
      {block.text && block.text.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
      {block.imageUrl && (
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <img src={block.imageUrl} alt={block.imageAlt || ''} style={{ maxWidth: '100%' }} />
        </div>
      )}
      {block.imageDiagram?.libraryKey && (
        <div className="sv-paper-diagram" style={{ textAlign: 'center', margin: '8px 0 2px' }}>
          <DiagramSvg
            libraryKey={block.imageDiagram.libraryKey}
            params={block.imageDiagram.params}
            color="#1c1612"
            alt=""
          />
        </div>
      )}
    </div>
  )
}

function PaperQuestionBlock({ block }) {
  const marks = block.marks ?? 1
  return (
    <div className="sv-paper-q">
      <div className="sv-qline">
        <strong>{block.number}.</strong> {block.text || '(no question text)'}
        {marks >= 1 && <em className="sv-qmarks">({marks}&nbsp;mark{marks === 1 ? '' : 's'})</em>}
      </div>
      {block.imageUrl && (
        <>
          <div
            className="sv-paper-diagram"
            style={{ position: 'relative', display: 'inline-block', maxWidth: `${resolveImageWidthPercent(block.imageWidth)}%` }}
          >
            <img src={block.imageUrl} alt={block.imageAlt || ''} style={{ width: '100%' }} />
            {/* Leader lines: a thin line from each label to the part it points
                at (tx,ty), ending in a small dot ON the part — so the diagram is
                labelled with a line, never a marker sitting on top of the part.
                Drawn only for labels that carry a target; legacy/maths labels
                without one keep sitting in place. */}
            {(block.diagramLabels || []).some((l) => Number.isFinite(l?.tx) && Number.isFinite(l?.ty)) && (
              <svg
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
                aria-hidden="true"
              >
                {(block.diagramLabels || []).map((label, i) => (
                  Number.isFinite(label?.tx) && Number.isFinite(label?.ty) ? (
                    <g key={i}>
                      <line
                        x1={`${label.x * 100}%`} y1={`${label.y * 100}%`}
                        x2={`${label.tx * 100}%`} y2={`${label.ty * 100}%`}
                        stroke="#000" strokeWidth="1"
                      />
                      <circle cx={`${label.tx * 100}%`} cy={`${label.ty * 100}%`} r="2.5" fill="#000" />
                    </g>
                  ) : null
                ))}
              </svg>
            )}
            {(block.diagramLabels || []).map((label, i) => (
              <span
                key={i}
                style={{
                  position: 'absolute',
                  left: `${label.x * 100}%`,
                  top: `${label.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  background: block.diagramMode === 'identify' ? '#000' : 'white',
                  color: block.diagramMode === 'identify' ? '#fff' : '#000',
                  border: '1px solid #000',
                  borderRadius: block.diagramMode === 'identify' ? '50%' : 3,
                  padding: block.diagramMode === 'identify' ? 0 : '1px 6px',
                  width: block.diagramMode === 'identify' ? 20 : undefined,
                  height: block.diagramMode === 'identify' ? 20 : undefined,
                  display: block.diagramMode === 'identify' ? 'grid' : 'inline-block',
                  placeItems: block.diagramMode === 'identify' ? 'center' : undefined,
                  fontSize: 11,
                  fontWeight: block.diagramMode === 'identify' ? 700 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                {block.diagramMode === 'identify' ? (i + 1) : label.text}
              </span>
            ))}
          </div>
          {block.diagramMode === 'identify' && block.type !== 'mcq' && (block.diagramLabels?.length > 0) && (
            <ol style={{ margin: '8px 0 0 18pt', padding: 0 }}>
              {block.diagramLabels.map((_, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  <span style={{ display: 'inline-block', minWidth: 180, borderBottom: '1px solid #000', height: 14 }} />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {block.imageDiagram?.libraryKey && (
        <div className="sv-paper-diagram" style={{ textAlign: 'center', margin: '6px 0' }}>
          <DiagramSvg
            libraryKey={block.imageDiagram.libraryKey}
            params={block.imageDiagram.params}
            color="#1c1612"
            alt=""
          />
        </div>
      )}
      {block.tableData && (
        <PaperDataTable tableData={block.tableData} />
      )}
      {block.type !== 'fill_blanks' && block.wordBank?.length > 0 && (
        <div style={{ display: 'inline-block', border: '1px solid #000', padding: '4px 10px', margin: '4px 0', fontSize: 12 }}>
          <strong>Word bank:</strong> {block.wordBank.join(' · ')}
        </div>
      )}
      {block.type === 'fill_blanks' && <PaperFillBlanks block={block} />}
      {block.type === 'mcq' && <PaperMcqOptions block={block} />}
      {(block.type === 'short_answer' || block.type === 'fill') && (
        <PaperAnswerSpace block={block} defaultLines={2} />
      )}
      {block.type === 'numeric' && (
        <div className="sv-paper-numeric-line" style={{ display: 'flex', alignItems: 'flex-end', gap: 8, margin: '6px 0' }}>
          <div className="sv-paper-answer-line" style={{ flex: '0 0 180px' }} />
          {block.numericUnit && (
            <span style={{ fontSize: 13, color: '#000', whiteSpace: 'nowrap' }}>{block.numericUnit}</span>
          )}
        </div>
      )}
      {block.type === 'matching' && (
        <PaperMatching block={block} />
      )}
      {block.type === 'sequence' && (
        <PaperSequence block={block} />
      )}
      {Number.isFinite(Number(block.drawingHeight)) && Number(block.drawingHeight) > 0 && (
        <div style={{
          border: '1px solid #000',
          background: '#fff',
          height: Number(block.drawingHeight),
          margin: '8px 0',
          borderRadius: 2,
        }} aria-label="Drawing canvas" />
      )}
      {block.type === 'diagram' && (
        <PaperAnswerSpace block={block} defaultLines={4} />
      )}
      {block.type === 'essay' && (
        <PaperAnswerSpace block={block} defaultLines={8} />
      )}
      {block.showAnswer && <PaperAnswerBlock block={block} />}
    </div>
  )
}

// Fill-in-the-Blanks renderer — the dedicated `fill_blanks` type. Prints an
// optional word bank, then each statement on its own line ("A. … ____ …")
// with generous vertical spacing. In marking-key mode (showAnswer) the blanks
// are filled with the expected answer in green; otherwise a long ruled gap.
function PaperFillBlanks({ block }) {
  const statements = Array.isArray(block.statements) ? block.statements : []
  const wordBank = Array.isArray(block.wordBank) ? block.wordBank : []
  return (
    <div className="sv-paper-fill-blanks" style={{ margin: '4px 0 2px' }}>
      {wordBank.length > 0 && (
        <div style={{ border: '1px solid #000', padding: '6px 10px', margin: '4px 0 12px', fontSize: 12.5 }}>
          <strong>Word Bank:</strong> {wordBank.join(', ')}
        </div>
      )}
      {statements.map((statement, i) => (
        <div
          key={i}
          style={{ display: 'flex', gap: 8, margin: '12px 0', fontSize: 13, lineHeight: 2 }}
        >
          <strong style={{ flex: '0 0 auto' }}>{statementLabel(i)}.</strong>
          <span style={{ flex: 1 }}>{renderFillStatement(statement, block.showAnswer)}</span>
        </div>
      ))}
    </div>
  )
}

// Split a statement on its blanks and weave a ruled gap (or the answer, in
// marking-key mode) between each text segment.
function renderFillStatement(statement, showAnswer) {
  const text = String(statement?.text ?? '')
  const segments = splitStatementSegments(text)
  const answers = Array.isArray(statement?.answers) ? statement.answers : []
  const nodes = []
  segments.forEach((segment, i) => {
    if (segment) nodes.push(<span key={`s${i}`}>{segment}</span>)
    if (i < segments.length - 1) {
      const answer = answers[i]
      if (showAnswer && answer) {
        nodes.push(<strong key={`b${i}`} style={{ color: '#047857' }}>{answer}</strong>)
      } else {
        nodes.push(
          <span
            key={`b${i}`}
            style={{ display: 'inline-block', minWidth: 110, borderBottom: '1px solid #000', margin: '0 4px', verticalAlign: 'middle', height: 14 }}
          />,
        )
      }
    }
  })
  return nodes
}

// Renders the blank answer space under a written-answer question, honouring the
// teacher's answer-space choice: 'none' (nothing), 'labelled_blanks' (one
// "P: ____" row per label) or the default N ruled lines.
function PaperAnswerSpace({ block, defaultLines = 2 }) {
  if (block.answerFormat === 'none') return null
  if (block.answerFormat === 'labelled_blanks' && block.blankLabels?.length > 0) {
    return (
      <div className="sv-paper-answer-lines sv-paper-labelled-blanks">
        {block.blankLabels.map((label, i) => (
          <div className="sv-paper-blank-row" key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, margin: '4px 0' }}>
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{label}:</span>
            <span className="sv-paper-answer-line" style={{ flex: 1 }} />
          </div>
        ))}
      </div>
    )
  }
  const count = Number.isFinite(Number(block.answerLines)) && Number(block.answerLines) >= 0
    ? Number(block.answerLines)
    : defaultLines
  return (
    <div className="sv-paper-answer-lines">
      {Array.from({ length: count }).map((_, i) => <div className="sv-paper-answer-line" key={i} />)}
    </div>
  )
}

function PaperMcqOptions({ block }) {
  const correct = Number(block.correctAnswer)
  // Use the readable plain mirror, not the raw stored option: options can hold
  // math markup (`<span class="mnode" data-latex="…">`) which would otherwise
  // print as escaped HTML in this text preview.
  const optText = (i) => block.optionsPlain?.[i] ?? block.options?.[i] ?? ''
  if (block.optionsMode === 'image') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '8px 0' }}>
        {(block.options || []).map((opt, i) => {
          const media = block.optionMedia?.[i]
          const isCorrect = block.showAnswer && correct === i
          return (
            <div key={i} style={{ border: `${isCorrect ? '2px solid #047857' : '1px solid #999'}`, borderRadius: 3, padding: 4, textAlign: 'center', background: '#fafafa' }}>
              <div style={{ aspectRatio: '1', display: 'grid', placeItems: 'center', background: 'white', borderRadius: 2, marginBottom: 2 }}>
                {media?.diagram?.libraryKey
                  ? <DiagramSvg libraryKey={media.diagram.libraryKey} params={media.diagram.params} color="#1c1612" alt={media.alt || ''} />
                  : media?.imageUrl
                    ? <img src={media.imageUrl} alt={media.alt || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 24, color: '#999' }}>?</span>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: isCorrect ? '#047857' : undefined }}>
                {SECTION_LETTERS[i]}.{optText(i) ? ` ${optText(i)}` : ''}{isCorrect ? ' ✓' : ''}
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  if (block.optionsMode === 'mixed') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '6px 0' }}>
        {(block.options || []).map((opt, i) => {
          const media = block.optionMedia?.[i]
          const isCorrect = block.showAnswer && correct === i
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: 6, alignItems: 'center', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3 }}>
              <strong style={{ color: isCorrect ? '#047857' : undefined }}>{SECTION_LETTERS[i]}.</strong>
              {media?.diagram?.libraryKey
                ? <span style={{ width: 40, height: 40, display: 'inline-block' }}><DiagramSvg libraryKey={media.diagram.libraryKey} params={media.diagram.params} color="#1c1612" alt={media.alt || ''} /></span>
                : media?.imageUrl
                  ? <img src={media.imageUrl} alt={media.alt || ''} style={{ width: 40, height: 40, objectFit: 'contain' }} />
                  : <span style={{ width: 40, height: 40, display: 'inline-block' }} />}
              <span style={{ color: isCorrect ? '#047857' : undefined, fontWeight: isCorrect ? 700 : 400 }}>
                {optText(i)}{isCorrect ? ' ✓' : ''}
              </span>
            </div>
          )
        })}
      </div>
    )
  }
  const long = (block.options || []).some((_, i) => String(optText(i)).length > 18)
  // Paper-level layout overrides the long-option auto-stack when the
  // teacher has picked one. Horizontal lays the options out in an N-column
  // row matching the choice count.
  const n = (block.options || []).length
  let stacked = long
  let colStyle
  if (block.mcqLayout === 'vertical') stacked = true
  else if (block.mcqLayout === 'horizontal') {
    stacked = false
    colStyle = { gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` }
  }
  return (
    <div className={`sv-paper-options ${stacked ? 'stacked' : ''}`} style={colStyle}>
      {(block.options || []).map((opt, i) => {
        const isCorrect = block.showAnswer && correct === i
        return (
          <div key={i} style={isCorrect ? { color: '#047857', fontWeight: 700 } : undefined}>
            <span className="sv-opt-letter">{SECTION_LETTERS[i]}.</span> {optText(i)}{isCorrect ? '  ✓' : ''}
          </div>
        )
      })}
    </div>
  )
}

// Data/Table render — a plain HTML table. Headers + body cells render
// with thin borders matching the typical school-paper style.
function PaperDataTable({ tableData }) {
  if (!tableData || !Array.isArray(tableData.headers) || !tableData.headers.length) return null
  const headers = tableData.headers
  const rows = Array.isArray(tableData.rows) ? tableData.rows : []
  return (
    <div style={{ margin: '8px 0', overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 280 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ border: '1px solid #000', padding: '4px 10px', background: '#f1f5f9', fontWeight: 600 }}>{h || ''}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {headers.map((_, j) => (
                <td key={j} style={{ border: '1px solid #000', padding: '4px 10px' }}>
                  {Array.isArray(row) ? (row[j] || '') : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Sequence question render — one column of items, each preceded by a
// short blank where the student writes the correct position (1..N).
// Printed in the order the teacher typed; the marking key shows the
// correctly-sorted sequence.
function PaperSequence({ block }) {
  const items = Array.isArray(block.sequenceItems) ? block.sequenceItems : []
  return (
    <div style={{ margin: '8px 0' }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', borderBottom: '1px dotted #999' }}>
          <span style={{ display: 'inline-block', width: 32, borderBottom: '1px solid #000', height: 16 }} />
          <span>{it || ''}</span>
        </div>
      ))}
    </div>
  )
}

// Matching question render — two columns side by side. Students draw
// lines between them on the printed paper; in the on-screen preview we
// just show the columns aligned.
function PaperMatching({ block }) {
  const left = Array.isArray(block.matchingLeft) ? block.matchingLeft : []
  const right = Array.isArray(block.matchingRight) ? block.matchingRight : []
  const rows = Math.max(left.length, right.length)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 48, margin: '8px 0' }}>
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ padding: '4px 0', borderBottom: '1px dotted #999' }}>
            <strong>{i + 1}.</strong> {left[i] || ''}
          </div>
        ))}
      </div>
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ padding: '4px 0', borderBottom: '1px dotted #999' }}>
            <strong>{SECTION_LETTERS[i] || '?'}.</strong> {right[i] || ''}
          </div>
        ))}
      </div>
    </div>
  )
}

function PaperAnswerBlock({ block }) {
  // Image-Identify diagram: marking key shows each numbered hotspot with
  // its expected answer ("1. Epidermis  2. Dermis  3. Hypodermis"), in
  // the same order the hotspots were placed.
  if (block.type === 'diagram' && block.diagramMode === 'identify' && Array.isArray(block.diagramLabels) && block.diagramLabels.length) {
    return (
      <div style={{ margin: '4px 0 4px 14px', padding: '4px 8px', background: '#ecfdf5', borderLeft: '3px solid #047857', fontSize: 12, color: '#047857' }}>
        <div>
          <strong>Answers:</strong>{' '}
          {block.diagramLabels.map((l, i) => (
            <span key={i} style={{ marginRight: 12 }}>{i + 1}. {l.text || '—'}</span>
          ))}
        </div>
        {block.explanation && (
          <div style={{ color: '#555', fontStyle: 'italic', fontSize: 11, marginTop: 2 }}>
            Notes: {block.explanation}
          </div>
        )}
      </div>
    )
  }
  let body = null
  if (block.type === 'mcq') {
    const i = Number(block.correctAnswer)
    const letter = SECTION_LETTERS[i] || '?'
    // Plain mirror first so a rich fraction option reads as "1/3" instead of
    // its literal `<span class="math-frac">` HTML.
    const opt = block.optionsPlain?.[i] ?? block.options?.[i] ?? ''
    body = <><strong>Answer:</strong> {letter}. {String(opt)}</>
  } else if (block.type === 'matching') {
    const left = Array.isArray(block.matchingLeft) ? block.matchingLeft : []
    const right = Array.isArray(block.matchingRight) ? block.matchingRight : []
    const answer = Array.isArray(block.matchingAnswer) ? block.matchingAnswer : []
    body = (
      <>
        <strong>Answer:</strong>{' '}
        {left.map((_, i) => {
          const j = Number(answer[i])
          const letter = Number.isInteger(j) && j >= 0 ? (SECTION_LETTERS[j] || '?') : '—'
          const r = Number.isInteger(j) && j >= 0 ? (right[j] || '') : ''
          return (
            <span key={i} style={{ marginRight: 12 }}>
              {i + 1}→{letter}{r ? ` (${r})` : ''}
            </span>
          )
        })}
      </>
    )
  } else if (block.type === 'sequence') {
    const items = Array.isArray(block.sequenceItems) ? block.sequenceItems : []
    const answer = Array.isArray(block.sequenceAnswer) ? block.sequenceAnswer : []
    // Show items in their CORRECT order. Build [pos, item] pairs and
    // sort by position. Items with no position assigned drift to the end.
    const ordered = items
      .map((it, idx) => ({ pos: Number(answer[idx]) || 999, text: it }))
      .sort((a, b) => a.pos - b.pos)
    body = (
      <>
        <strong>Correct order:</strong>{' '}
        {ordered.map((entry, i) => (
          <span key={i} style={{ marginRight: 10 }}>
            {entry.pos < 999 ? `${entry.pos}.` : '?'} {entry.text || '—'}
          </span>
        ))}
      </>
    )
  } else if (block.type === 'numeric') {
    body = (
      <>
        <strong>Expected answer:</strong>{' '}
        {String(block.correctAnswer ?? '')}
        {block.numericUnit ? ` ${block.numericUnit}` : ''}
        {Number(block.numericTolerance) > 0
          ? ` (±${block.numericTolerance})`
          : ''}
      </>
    )
  } else {
    body = <><strong>Expected answer:</strong> {String(block.correctAnswer ?? '')}</>
  }
  return (
    <div style={{ margin: '4px 0 4px 14px', padding: '4px 8px', background: '#ecfdf5', borderLeft: '3px solid #047857', fontSize: 12, color: '#047857' }}>
      <div>{body}</div>
      {block.explanation && (
        <div style={{ color: '#555', fontStyle: 'italic', fontSize: 11, marginTop: 2 }}>
          Notes: {block.explanation}
        </div>
      )}
    </div>
  )
}
