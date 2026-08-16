/**
 * ReaderBlock — renders one study block in the prototype-v3 reader
 * language. Presentational + per-card interaction state; the engine
 * (ReaderEngine.jsx) owns modes, paced reveal and the word sheet.
 *
 * Covers the FULL study vocabulary — the legacy authoring types render
 * in reader styling (tips → Zed tipboxes, keyterms → meaning rows,
 * quickchecks → tap-to-reveal cards) so a regenerated note can mix old
 * and new blocks freely.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { tokenizeInline } from './readerCore'
import LabelDiagram from './LabelDiagram'

export const ZED_ART = '/images/characters/zed-zara-reading.webp'

/** Inline text with **bold** and tappable [[keyword]] bubbles. The
 * engine resolves the tapped word against the glossary, so this only
 * needs the tap callback. */
export function InlineText({ text, onWord }) {
  const tokens = useMemo(() => tokenizeInline(text), [text])
  return tokens.map((tk, i) => {
    if (tk.t === 'bold') return <b key={i}>{tk.v}</b>
    if (tk.t === 'kw') {
      return (
        <button key={i} type="button" className="lhx-kw" onClick={() => onWord?.(tk.v)}>
          {tk.v}
        </button>
      )
    }
    return <span key={i}>{tk.v}</span>
  })
}

function Tipbox({ icon = null, lead, lines, onWord }) {
  return (
    <div className="lhx-tipbox">
      {icon === 'zed'
        ? <img className="lhx-tip-zed" src={ZED_ART} alt="" aria-hidden="true" />
        : <span aria-hidden="true" style={{ fontSize: 22, flexShrink: 0 }}>{icon}</span>}
      <div>
        {lead && <b>{lead} </b>}
        {lines.map((l, i) => (
          <span key={i}>
            <InlineText text={l} onWord={onWord} />
            {i < lines.length - 1 ? ' ' : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Tap-to-reveal card (renders the study `quickcheck` type). */
function RevealCard({ block, onWord }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      className="lhx-reveal-card"
      aria-expanded={open}
      onClick={() => setOpen(true)}
      disabled={open}
      style={open ? { cursor: 'default' } : undefined}
    >
      <div className="lhx-reveal-q"><InlineText text={block.q} onWord={onWord} /></div>
      {!open && <div className="lhx-reveal-hint">👆 Tap to see the answer</div>}
      {open && <div className="lhx-reveal-a"><InlineText text={block.a} onWord={onWord} /></div>}
    </button>
  )
}

/** Option chips shared by practice + section-check questions. */
function OptionChips({ options, onPick, locked, verdicts }) {
  return (
    <div className="lhx-try-chips">
      {options.map((o, i) => (
        <button
          key={i}
          type="button"
          disabled={locked}
          className={verdicts[i] === true ? 'is-ok' : verdicts[i] === false ? 'is-no' : ''}
          onClick={() => onPick(i)}
        >
          {o.text}
        </button>
      ))}
    </div>
  )
}

/**
 * "YOUR TURN" practice card: wrong picks shake and clear (stay
 * tappable); the correct pick locks the card with its feedback line.
 */
function PracticeCard({ block, onWord }) {
  const [verdicts, setVerdicts] = useState({})
  const [state, setState] = useState('idle') // idle | correct | wrong
  const clearTimer = useRef(null)

  // Cancel the pending wrong-answer reset on unmount. The clearTimeout in
  // pick() only covers a SECOND wrong pick; a learner who answers wrongly and
  // then navigates away within 450ms left a live timer holding a setState on a
  // gone component. In the browser that is a leak React swallows, but under
  // Vitest the timer fires after jsdom teardown and the whole run fails with
  // "ReferenceError: window is not defined" — every test passing and the job
  // still red, attributed to whichever spec happened to be running.
  useEffect(() => () => clearTimeout(clearTimer.current), [])

  const pick = (i) => {
    if (state === 'correct') return
    if (block.options[i]?.correct) {
      setVerdicts({ [i]: true })
      setState('correct')
    } else {
      setVerdicts((v) => ({ ...v, [i]: false }))
      setState('wrong')
      clearTimeout(clearTimer.current)
      clearTimer.current = setTimeout(() => setVerdicts((v) => {
        const next = { ...v }
        delete next[i]
        return next
      }), 450)
    }
  }

  return (
    <div className="lhx-try-card">
      <div className="lhx-try-label">✏️ YOUR TURN</div>
      <div className="lhx-try-q"><InlineText text={block.q} onWord={onWord} /></div>
      <OptionChips options={block.options} onPick={pick} locked={state === 'correct'} verdicts={verdicts} />
      {state === 'correct' && (
        <p className="lhx-try-fb is-ok" role="status">{block.correctNote || '✓ Correct!'}</p>
      )}
      {state === 'wrong' && (
        <p className="lhx-try-fb is-no" role="status">Not quite — try another answer.</p>
      )}
    </div>
  )
}

/**
 * SECTION CHECK with remediation. A wrong pick opens "Let's look at it
 * again" — re-teach + example + a similar retry question — instead of
 * just marking red. A wrong retry shows the hint; the right retry
 * celebrates the recovery.
 */
function SectionCheck({ block, onWord }) {
  const [verdicts, setVerdicts] = useState({})
  const [state, setState] = useState('idle') // idle | correct | remediate
  const [retryVerdicts, setRetryVerdicts] = useState({})
  const [retryState, setRetryState] = useState('idle') // idle | correct | wrong

  const pick = (i) => {
    if (state !== 'idle') return
    if (block.options[i]?.correct) {
      setVerdicts({ [i]: true })
      setState('correct')
    } else {
      setVerdicts({ [i]: false })
      setState('remediate')
    }
  }
  const retryPick = (i) => {
    if (retryState === 'correct') return
    if (block.remediation.retryOptions[i]?.correct) {
      setRetryVerdicts({ [i]: true })
      setRetryState('correct')
    } else {
      setRetryVerdicts((v) => ({ ...v, [i]: false }))
      setRetryState('wrong')
    }
  }

  const rem = block.remediation
  return (
    <div className="lhx-check-card">
      <div className="lhx-check-label">🎯 {block.label || 'SECTION CHECK'}</div>
      <div className="lhx-try-q"><InlineText text={block.q} onWord={onWord} /></div>
      <OptionChips
        options={block.options}
        onPick={pick}
        locked={state !== 'idle'}
        verdicts={verdicts}
      />
      {state === 'correct' && (
        <p className="lhx-try-fb is-ok" role="status">✓ Correct — you understood this section!</p>
      )}
      {state === 'remediate' && (
        <>
          <p className="lhx-try-fb is-no" role="status">✗ Not quite — let’s learn it a bit more, then try again 👇</p>
          <div className="lhx-remed">
            <div className="lhx-remed-head">
              <img className="lhx-remed-zed" src={ZED_ART} alt="" aria-hidden="true" />
              Let’s look at it again
            </div>
            <p className="lhx-remed-p"><InlineText text={rem.explain} onWord={onWord} /></p>
            {rem.example && (
              <div className="lhx-ex-card" style={{ fontSize: '13.5px' }}>
                <InlineText text={rem.example} onWord={onWord} />
              </div>
            )}
            <div className="lhx-try-q" style={{ fontSize: 15 }}>
              <InlineText text={rem.retryQ} onWord={onWord} />
            </div>
            <OptionChips
              options={rem.retryOptions}
              onPick={retryPick}
              locked={retryState === 'correct'}
              verdicts={retryVerdicts}
            />
            {retryState === 'correct' && (
              <p className="lhx-try-fb is-ok" role="status">✓ Now you have it! 🎉</p>
            )}
            {retryState === 'wrong' && (
              <p className="lhx-try-fb is-no" role="status">{rem.retryHint || 'Not quite — read the explanation once more.'}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** One block → its reader rendering. Unknown types render nothing. */
export default function ReaderBlock({ block, sectionNumber, onWord }) {
  const t = block?.type
  const inline = (text) => <InlineText text={text} onWord={onWord} />

  switch (t) {
    case 'heading':
      return (block.level ?? 2) === 2 ? (
        <h2 className="lhx-note-h2">
          {sectionNumber != null && <span className="lhx-h2-num" aria-hidden="true">{sectionNumber}</span>}
          {inline(block.text)}
        </h2>
      ) : (
        <h3 className="lhx-note-h3">{inline(block.text)}</h3>
      )
    case 'paragraph':
      return <p className="lhx-note-p">{inline(block.text)}</p>
    case 'keyidea':
      return (
        <div className="lhx-keypoints">
          <div className="lhx-kp-label">⚡ KEY IDEA</div>
          <div className="lhx-kp-body">{inline(block.text)}</div>
        </div>
      )
    case 'keypoints':
      return (
        <div className="lhx-keypoints">
          <div className="lhx-kp-label">🔑 KEY POINTS</div>
          <div className="lhx-kp-body">
            {(block.items || []).map((it, i) => (
              <span key={i}>{inline(it)}{i < block.items.length - 1 ? ' · ' : ''}</span>
            ))}
          </div>
        </div>
      )
    case 'tip':
      return <Tipbox icon="zed" lead="Zed’s tip:" lines={block.lines || []} onWord={onWord} />
    case 'note':
      return <Tipbox icon="🧠" lead="Remember:" lines={block.lines || []} onWord={onWord} />
    case 'think':
      return <Tipbox icon="💭" lead="Think first:" lines={block.lines || []} onWord={onWord} />
    case 'exam':
      return (
        <Tipbox
          icon="zed"
          lead="Exam alert!"
          lines={[block.q, block.a].filter(Boolean)}
          onWord={onWord}
        />
      )
    case 'mistake':
      return (
        <div className="lhx-try-card">
          <div className="lhx-try-label">⚠️ COMMON MISTAKE</div>
          <p className="lhx-try-fb is-no" style={{ marginTop: 0 }}>✗ {inline(block.wrong)}</p>
          <p className="lhx-try-fb is-ok">✓ {inline(block.correct)}</p>
        </div>
      )
    case 'objectives':
    case 'summary':
      return (
        <div className="lhx-keypoints">
          <div className="lhx-kp-label">{t === 'objectives' ? '🎯 WHAT YOU WILL LEARN' : '✅ SUMMARY'}</div>
          <ul className="lhx-note-ul" style={{ marginBottom: 0 }}>
            {(block.items || []).map((it, i) => <li key={i}>{inline(it)}</li>)}
          </ul>
        </div>
      )
    case 'bullets':
      return <ul className="lhx-note-ul">{(block.items || []).map((it, i) => <li key={i}>{inline(it)}</li>)}</ul>
    case 'numbers':
      return <ol className="lhx-note-ol">{(block.items || []).map((it, i) => <li key={i}>{inline(it)}</li>)}</ol>
    case 'keyterms':
      return (
        <div style={{ marginBottom: 16 }}>
          {(block.rows || []).map((r, i) => (
            <div key={i} className="lhx-mean-row">
              <span className="lhx-mean-term">{r.term}</span>
              <span className="lhx-mean-def">{inline(r.def || '')}</span>
            </div>
          ))}
        </div>
      )
    case 'table':
      return (
        <div className="lhx-note-table-wrap">
          <table className="lhx-note-table">
            <thead><tr>{(block.headers || []).map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>
              {(block.rows || []).map((r, i) => (
                <tr key={i}>{(r.cells || []).map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'picture':
      return (
        <div className="lhx-ex-card">
          <b>🖼 {block.caption}</b>
          {(block.lines || []).map((l, i) => <div key={i}>{inline(l)}</div>)}
        </div>
      )
    case 'image':
      return (
        <figure style={{ margin: 0 }}>
          <img className="lhx-note-img" src={block.url} alt={block.caption || ''} loading="lazy" />
          {block.caption && <figcaption className="lhx-note-figcap">{block.caption}</figcaption>}
        </figure>
      )
    case 'quickcheck':
      return <RevealCard block={block} onWord={onWord} />
    case 'practice':
      return <PracticeCard block={block} onWord={onWord} />
    case 'sectioncheck':
      return <SectionCheck block={block} onWord={onWord} />
    case 'labeldiagram':
      return <LabelDiagram block={block} />
    case 'quiz':
      return block.quizId ? (
        <Link to={`/quiz/${block.quizId}`} className="lhx-btn lhx-btn-primary lhx-btn-block" style={{ marginBottom: 16 }}>
          📝 {block.quizTitle ? `Take the ${block.quizTitle}` : 'Take the topic quiz'}
        </Link>
      ) : null
    case 'glossary':
      return null // resolved into the word sheet, never rendered inline
    default:
      return null
  }
}
