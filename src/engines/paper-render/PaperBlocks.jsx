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

import { useMemo } from 'react'
import DiagramSvg from '../../curriculum/diagrams/DiagramSvg'
import { resolveImageWidthPercent } from '../../utils/imageWidth'
import { resolveFigureLabels, resolveAnswerKeyLabels } from '../../utils/figureLabelLayout'
import { splitStatementSegments, statementLabel } from '../../utils/fillBlanks'
import { subPartLabel, splitPartBlanks, countPartBlanks } from '../../utils/questionParts'
import { DEFAULT_ANSWER_LINES } from '../../utils/assessmentPaperLayout'
import '../../shared/styles/assessmentStudio.css'

const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/**
 * An editor paragraph with nothing in it. `richTextToPaperHtml` returns this
 * for a field the teacher has not written, and rendering it would replace the
 * "(no question text)" placeholder with a blank line.
 */
const EMPTY_PARAGRAPH = /^<p>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/p>$/i

/**
 * Is there rich HTML worth rendering for this field?
 *
 * Every caller pairs `xHtml` with a plain `x` mirror and falls back to it, so a
 * block built by a caller that predates the rich twin — or a legacy question
 * stored as plain text — renders exactly as it did before.
 */
export function hasRichHtml(html) {
  if (typeof html !== 'string') return false
  const trimmed = html.trim()
  return Boolean(trimmed) && !EMPTY_PARAGRAPH.test(trimmed)
}

/**
 * A rich-text field of the paper, rendered as the markup the exports render.
 *
 * The HTML comes from `buildPaperLayout`, which built it with
 * `richTextToPaperHtml` — already sanitised (`toHTML` runs it through
 * `sanitizeHTML`) and already flattened: KaTeX nodes have become readable text
 * and the Grade-7 maths blocks have their inner structure baked in, because the
 * print window runs no JavaScript. So there is nothing to hydrate here, and the
 * preview shows what the PDF and Word will show rather than its own rendering
 * of the same content.
 *
 * This is why the preview lost formatting for so long: the layout published
 * `textHtml` and `optionsHtml` for exactly this, the PDF and DOCX read them, and
 * this renderer read the plain mirror beside them — so a bold word, a
 * superscript or a stacked fraction printed correctly and previewed as flat
 * text. The styles the flattened maths needs are in `assessmentStudio.css`
 * under "Rich paper text".
 */
function RichPaperHtml({ html, className }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

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
    case 'schoolFooter': return (
      <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: '#555' }}>
        {block.text}
      </div>
    )
    default: return null
  }
}

function PaperHeaderBlock({ block }) {
  // Address / EMIS share one small line under the school name; the motto sits
  // in italics below it. All are optional (Teacher Settings → My School).
  const addressLine = [block.address, block.emisNumber ? `EMIS: ${block.emisNumber}` : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="sv-paper-banner">
      <div className="sv-paper-banner-text">
        {block.schoolLogoUrl && (
          <img
            className="sv-pbn-logo"
            src={block.schoolLogoUrl}
            alt=""
            crossOrigin="anonymous"
            style={{ height: 56, margin: '0 auto 6px', display: 'block', objectFit: 'contain' }}
          />
        )}
        <div className="sv-pbn-school">{(block.schoolName || 'YOUR SCHOOL NAME').toUpperCase()}</div>
        {addressLine && (
          <div className="sv-pbn-address" style={{ fontSize: 11, letterSpacing: '.02em' }}>
            {addressLine}
          </div>
        )}
        {block.motto && (
          <div className="sv-pbn-motto" style={{ fontSize: 11, fontStyle: 'italic', marginBottom: 2 }}>
            “{block.motto}”
          </div>
        )}
        <div className="sv-pbn-title">{block.title}</div>
        {block.subject && <div className="sv-pbn-subject">{block.subject}</div>}
        {block.paperName && <div className="sv-pbn-paper">{block.paperName}</div>}
      </div>
    </div>
  )
}

function PaperLearnerFieldsBlock({ block }) {
  // The labels come off the block (§9). A mock examination says "CANDIDATE'S
  // NAME", a Grade 3 test says "PUPIL'S NAME", and the preview, the PDF and Word
  // print the same words because all three read the same resolved field rather
  // than each hard-coding "NAME". The fallbacks are exactly what was hard-coded
  // here before, so a block built without labels is unchanged.
  const labels = block.labels || {}
  const label = (key, fallback) => String(labels[key] || fallback).toUpperCase()
  return (
    <>
      {(block.name || block.date) && (
        <div className="sv-paper-name-row">
          {block.name && <><span>{label('name', 'Name')}:</span><div className="sv-line" /></>}
          {block.date && <><span>{label('date', 'Date')}:</span><div className="sv-line" style={{ maxWidth: 180 }} /></>}
        </div>
      )}
      {block.classField && (
        <div className="sv-paper-name-row" style={{ marginTop: 0 }}>
          <span>{label('classField', 'Class')}:</span><div className="sv-line" />
        </div>
      )}
      {block.marks && (
        <div className="sv-paper-total-marks">
          {label('marks', 'Total marks')}: _________ / {block.totalMarks || '____'}
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
      <span className={`sv-instr-label${block.isMarkingKey ? ' is-key' : ''}`}>{block.isMarkingKey ? 'Marking key' : 'Instructions'}</span>
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
        {/* A paper that hides marks from learners must not print the section's
            total in its heading either (§4). */}
        {block.showMarks !== false && (
          <span className="sv-marks">({block.marks} mark{block.marks === 1 ? '' : 's'})</span>
        )}
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
  // Print page-break hints (consumed only by the @media print rules in
  // assessmentStudio.css). Long answer blocks and questions that carry a data
  // table are allowed to flow across a page boundary instead of the default
  // "keep whole" — otherwise a tall block shoves a big blank gap to the next
  // page. The CSS still keeps the question stem with the start of its body.
  // Screen layout is unaffected: these classes have no on-screen rules.
  const hasTable = Boolean(block.tableData)
  const isLong = block.type === 'essay'
    || (Array.isArray(block.subParts) && block.subParts.length >= 4)
    || (Number.isFinite(Number(block.answerLines)) && Number(block.answerLines) >= 6)
  const qClass = ['sv-paper-q', hasTable && 'has-table', isLong && 'is-long']
    .filter(Boolean)
    .join(' ')
  // Resolved once per question: separated positions plus each label's leader
  // line. The same call runs in the PDF and Word exports, so a label that moved
  // here moved there — the whole point of §4.1's one-model rule applied to
  // geometry rather than text.
  // On the marking key an identify diagram is NAMED on the picture, not just
  // numbered with a list underneath (§4.3) — the numbers still correspond
  // because the markers resolve identically on both copies.
  const isAnswerKeyFigure = block.showAnswer && block.diagramMode === 'identify'
  const placedLabels = useMemo(
    () => resolveFigureLabels(block.diagramLabels || [], { mode: block.diagramMode }).labels,
    [block.diagramLabels, block.diagramMode],
  )
  const answerNames = useMemo(
    () => (isAnswerKeyFigure
      ? resolveAnswerKeyLabels(block.diagramLabels || []).names
      : []),
    [isAnswerKeyFigure, block.diagramLabels],
  )
  return (
    <div className={qClass}>
      <div className="sv-qline">
        <strong>{block.number}.</strong>{' '}
        {hasRichHtml(block.textHtml)
          ? <RichPaperHtml className="sv-qbody" html={block.textHtml} />
          : (block.text || '(no question text)')}
        {/* `showMarks` is the paper's or the section's decision (§4). Absent on
            a block built by a caller that predates it, which keeps the old
            behaviour of always printing the mark. */}
        {marks >= 1 && block.showMarks !== false && <em className="sv-qmarks">({marks}&nbsp;mark{marks === 1 ? '' : 's'})</em>}
      </div>
      {block.imageUrl && (
        <>
          <div
            className="sv-paper-diagram"
            // `width`, not `maxWidth` on an inline-block.
            //
            // Shrink-to-fit sized the figure by the SOURCE image's intrinsic
            // pixels: a 96px diagram printed at 96px however wide the teacher's
            // preset said, so the band's minimum (§4.2) never applied here and
            // the same figure came out at 25.4mm in the browser against 93mm in
            // Word. `minWidth` is the floor the preset cannot go under, and
            // `maxWidth: 100%` keeps the page winning over the floor — a figure
            // the column cannot fit is reported, never overflowed.
            style={{
              position: 'relative',
              display: 'block',
              width: `${resolveImageWidthPercent(block.imageWidth)}%`,
              minWidth: block.figureMinWidthPx ? `${block.figureMinWidthPx}px` : undefined,
              maxWidth: '100%',
              marginInline: 'auto',
            }}
          >
            <img src={block.imageUrl} alt={block.imageAlt || ''} style={{ width: '100%' }} />
            {/* Leader lines: a thin line from each label to the part it points
                at, ending in a small dot ON the part — so the diagram is
                labelled with a line, never a marker sitting on top of the part.
                Positions, targets and line endpoints all come from
                resolveFigureLabels so the preview, the print window and Word
                place them identically; it also separates labels that would
                otherwise print on top of each other, and gives a label it had
                to move a line back to the part it was dropped on. */}
            {[...placedLabels, ...answerNames].some((l) => l.leader) && (
              <svg
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
                aria-hidden="true"
              >
                {[...placedLabels, ...answerNames].map((label, i) => (
                  label.leader ? (
                    <g key={i}>
                      <line
                        x1={`${label.leader.x1 * 100}%`} y1={`${label.leader.y1 * 100}%`}
                        x2={`${label.leader.x2 * 100}%`} y2={`${label.leader.y2 * 100}%`}
                        stroke="#000" strokeWidth="1"
                      />
                      <circle cx={`${label.leader.x2 * 100}%`} cy={`${label.leader.y2 * 100}%`} r="2.5" fill="#000" />
                    </g>
                  ) : null
                ))}
              </svg>
            )}
            {placedLabels.map((label, i) => (
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
                {block.diagramMode === 'identify' ? (label.index + 1) : label.text}
              </span>
            ))}
            {/* The marking key's answer names, in the studio's answer green so a
                marker can tell at a glance what the learner's copy did NOT show. */}
            {answerNames.map((label, i) => (
              <span
                key={`ans-${i}`}
                style={{
                  position: 'absolute',
                  left: `${label.x * 100}%`,
                  top: `${label.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  background: 'white',
                  color: '#047857',
                  border: '1px solid #047857',
                  borderRadius: 3,
                  padding: '1px 6px',
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {label.text}
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
      {/* Additional figures stacked below the primary (multi-figure questions). */}
      {Array.isArray(block.images) && block.images.map((img, i) => (
        img && img.url ? (
          <div
            key={img.url || i}
            className="sv-paper-diagram"
            style={{ display: 'inline-block', maxWidth: `${resolveImageWidthPercent(img.width)}%`, marginTop: 6 }}
          >
            <img src={img.url} alt={img.alt || ''} style={{ width: '100%' }} />
          </div>
        ) : null
      ))}
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
      {/* True/False renders as a 2-option MCQ (options ['True','False']). */}
      {(block.type === 'mcq' || block.type === 'tf') && <PaperMcqOptions block={block} />}
      {(block.type === 'short_answer' || block.type === 'short' || block.type === 'fill') && (
        block.subParts?.length > 0
          ? <PaperSubParts block={block} />
          : <PaperAnswerSpace block={block} defaultLines={DEFAULT_ANSWER_LINES.short} />
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
        <PaperAnswerSpace block={block} defaultLines={DEFAULT_ANSWER_LINES.diagram} />
      )}
      {block.type === 'essay' && (
        <PaperAnswerSpace block={block} defaultLines={DEFAULT_ANSWER_LINES.essay} />
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

// Short-answer SUB-PARTS renderer — the "(a) … (b) … (c) …" structure under one
// instruction stem (the question's text). Each part prints on its own line:
//   (a)  <sentence with an inline dotted blank>           [1]
// honouring the part's answer-space choice ('inline' dotted gap — the default,
// Q17 style; 'lines' ruled lines below; or 'none'). In marking-key mode the
// blank is filled with the expected answer in green.
function PaperSubParts({ block }) {
  const parts = Array.isArray(block.subParts) ? block.subParts : []
  return (
    <div className="sv-paper-subparts" style={{ margin: '4px 0 2px' }}>
      {parts.map((part, i) => {
        const marks = Number(part?.marks) || 0
        const format = part?.answerFormat || 'inline'
        return (
          <div
            key={i}
            className="sv-paper-subpart"
            style={{ display: 'flex', gap: 8, margin: '8px 0', fontSize: 13, lineHeight: 1.9 }}
          >
            <strong style={{ flex: '0 0 auto' }}>({subPartLabel(i)})</strong>
            <span style={{ flex: 1 }}>
              {renderSubPartBody(part, format)}
              {marks > 0 && <span style={{ whiteSpace: 'nowrap' }}> [{marks}]</span>}
              {format === 'lines' && <PaperAnswerSpace block={part} defaultLines={DEFAULT_ANSWER_LINES.short} />}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Weave the inline dotted blank(s) into a sub-part's sentence. A blank authored
// in the text (underscores/dots/ellipsis) becomes a ruled gap; if the part is
// 'inline' but the author typed no blank, one is appended at the end (so a bare
// "… called" still gets a gap to write in). 'none'/'lines' print the text as-is
// (the answer space, if any, is drawn separately). The expected answers are
// listed in the green marking-key block below the question, like every other
// type — so the body always shows blank gaps, never the answer.
function renderSubPartBody(part, format) {
  const text = String(part?.text ?? '')
  if (format === 'none' || format === 'lines') {
    return <span>{text}</span>
  }
  const gap = (key) => (
    <span key={key} style={{ display: 'inline-block', minWidth: 110, borderBottom: '1px dotted #000', margin: '0 4px', verticalAlign: 'middle', height: 14 }} />
  )
  if (countPartBlanks(text) > 0) {
    const segments = splitPartBlanks(text)
    const nodes = []
    segments.forEach((segment, i) => {
      if (segment) nodes.push(<span key={`s${i}`}>{segment}</span>)
      if (i < segments.length - 1) nodes.push(gap(`b${i}`))
    })
    return nodes
  }
  // No authored blank — sentence then a trailing gap.
  return <>{text ? <span>{text} </span> : null}{gap('b-end')}</>
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
  // `answerLines == null` means "not set → use the default". Without the
  // `!= null` guard, Number(null) === 0 satisfies `isFinite && >= 0` and
  // collapses every default-spaced question (essay / short / diagram) to ZERO
  // ruled lines. An explicit 0 still renders no lines (answerFormat 'none' too).
  const count = block.answerLines != null && Number.isFinite(Number(block.answerLines)) && Number(block.answerLines) >= 0
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
  // The rich twin, when the option carries formatting. Used in all three option
  // modes because the print window uses it in all three (`opt-rich` in
  // assessmentToPdf.js) — an option is where a fraction or a superscript is most
  // likely to appear, and a maths choice list flattened to "34" for "3/4" is a
  // preview a teacher cannot check their paper against.
  const optBody = (i) => (hasRichHtml(block.optionsHtml?.[i])
    ? <RichPaperHtml className="sv-opt-rich" html={block.optionsHtml[i]} />
    : optText(i))
  if (block.optionsMode === 'image') {
    // Fixed-width option cells (140px) instead of `repeat(4, 1fr)`: a 1fr grid
    // stretches each picture to a quarter of the paper width, so on a wide
    // preview (or any render where `.sv-paper` isn't width-capped) the option
    // images balloon to 300px+ and overflow the page. A fixed 140px track
    // pins them to the SAME size the DOCX exporter uses for image options
    // (see loadImageRun width:140 in assessmentToDocx.js) so the studio
    // preview and the downloaded Word file agree, and `auto-fit` + centering
    // keeps them tidy for any option count and wraps on a narrow screen.
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, 140px)', gap: 8, margin: '8px 0', justifyContent: 'center' }}>
        {(block.options || []).map((opt, i) => {
          const media = block.optionMedia?.[i]
          const isCorrect = block.showAnswer && correct === i
          return (
            <div key={i} style={{ border: `${isCorrect ? '2px solid #047857' : '1px solid #888'}`, borderRadius: 3, padding: 4, textAlign: 'center', background: '#fafafa' }}>
              <div style={{ aspectRatio: '1', display: 'grid', placeItems: 'center', background: 'white', borderRadius: 2, marginBottom: 2 }}>
                {media?.diagram?.libraryKey
                  ? <DiagramSvg libraryKey={media.diagram.libraryKey} params={media.diagram.params} color="#1c1612" alt={media.alt || ''} />
                  : media?.imageUrl
                    ? <img src={media.imageUrl} alt={media.alt || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 24, color: '#888' }}>?</span>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: isCorrect ? '#047857' : undefined }}>
                {SECTION_LETTERS[i]}.{optText(i) ? <> {optBody(i)}</> : ''}{isCorrect ? ' ✓' : ''}
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
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: 6, alignItems: 'center', padding: '4px 6px', border: '1px solid #888', borderRadius: 3 }}>
              <strong style={{ color: isCorrect ? '#047857' : undefined }}>{SECTION_LETTERS[i]}.</strong>
              {media?.diagram?.libraryKey
                ? <span style={{ width: 40, height: 40, display: 'inline-block' }}><DiagramSvg libraryKey={media.diagram.libraryKey} params={media.diagram.params} color="#1c1612" alt={media.alt || ''} /></span>
                : media?.imageUrl
                  ? <img src={media.imageUrl} alt={media.alt || ''} style={{ width: 40, height: 40, objectFit: 'contain' }} />
                  : <span style={{ width: 40, height: 40, display: 'inline-block' }} />}
              <span style={{ color: isCorrect ? '#047857' : undefined, fontWeight: isCorrect ? 700 : 400 }}>
                {optBody(i)}{isCorrect ? ' ✓' : ''}
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
            <span className="sv-opt-letter">{SECTION_LETTERS[i]}.</span> {optBody(i)}{isCorrect ? '  ✓' : ''}
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
    <div className="sv-paper-table-wrap" style={{ margin: '8px 0', overflowX: 'auto' }}>
      <table className="sv-paper-table" style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 280 }}>
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
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', borderBottom: '1px dotted #888' }}>
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
          <div key={i} style={{ padding: '4px 0', borderBottom: '1px dotted #888' }}>
            <strong>{i + 1}.</strong> {left[i] || ''}
          </div>
        ))}
      </div>
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ padding: '4px 0', borderBottom: '1px dotted #888' }}>
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
        <SchemeNotes block={block} />
      </div>
    )
  }
  // Short-answer sub-parts: one expected answer per (a)(b)(c) part.
  if (Array.isArray(block.subParts) && block.subParts.length > 0) {
    return (
      <div style={{ margin: '4px 0 4px 14px', padding: '4px 8px', background: '#ecfdf5', borderLeft: '3px solid #047857', fontSize: 12, color: '#047857' }}>
        <div>
          <strong>Answers:</strong>{' '}
          {block.subParts.map((p, i) => (
            <span key={i} style={{ marginRight: 12 }}>({subPartLabel(i)}) {String(p?.answer ?? '').trim() || '—'}</span>
          ))}
        </div>
        <SchemeNotes block={block} />
      </div>
    )
  }
  let body = null
  if (block.type === 'mcq' || block.type === 'tf') {
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
  } else if (hasRichHtml(block.answerHtml)) {
    // A structured expected answer — "three fifths" written as a stacked
    // fraction. Rendered as the same paper HTML the stem uses, so the marking
    // key shows the notation the question asked for. `String(correctAnswer)`
    // printed "[object Object]" here.
    body = (
      <>
        <strong>Expected answer:</strong>{' '}
        <RichPaperHtml html={block.answerHtml} className="sv-opt-rich" />
      </>
    )
  } else {
    body = <><strong>Expected answer:</strong> {block.answerPlain ?? String(block.correctAnswer ?? '')}</>
  }
  return (
    <div style={{ margin: '4px 0 4px 14px', padding: '4px 8px', background: '#ecfdf5', borderLeft: '3px solid #047857', fontSize: 12, color: '#047857' }}>
      <div>{body}</div>
      <SchemeNotes block={block} />
    </div>
  )
}

/**
 * The marking note under an answer. Rich when the teacher wrote mathematics
 * into it, plain otherwise — the plain mirror is what every note written
 * before this existed still takes.
 */
function SchemeNotes({ block }) {
  if (hasRichHtml(block.explanationHtml)) {
    return (
      <div style={{ color: '#555', fontStyle: 'italic', fontSize: 11, marginTop: 2 }}>
        Notes: <RichPaperHtml html={block.explanationHtml} className="sv-opt-rich" />
      </div>
    )
  }
  if (!block.explanation) return null
  return (
    <div style={{ color: '#555', fontStyle: 'italic', fontSize: 11, marginTop: 2 }}>
      Notes: {block.explanation}
    </div>
  )
}
