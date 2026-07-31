// Assessment Studio — lightweight paper analyses (difficulty balance, Bloom's
// mix, CBC competency mapping, near-duplicate detection). Extracted from
// AssessmentStudio.jsx to keep that module focused on orchestration.
//
// These are read-only, props-in widgets: they operate on the already-computed
// `questions` array (no LLM round-trip, no Firestore) and render inline in the
// AI Assistant slide-over and on question cards. They rely on the parent
// providing the `.studio-v2` CSS scope (sv-* classes + design tokens).

import { useMemo, useState } from 'react'
import { richTextToPlainText } from '../../utils/quizRichText.js'
import {
  analyzeDifficulty,
  difficultyBucket,
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
} from '../../utils/assessmentDifficulty'
import {
  analyzeBloom,
  BLOOM_LABELS,
  BLOOM_LEVELS,
} from '../../utils/assessmentBloom'
import { SUBJECTS as CBC_SUBJECTS, COMPETENCIES } from '../../config/curriculum'
import Icon from './studio/studioIcons'

/* ==================================================================
 * BALANCE / MAP / DETECT — lightweight analyses over the current paper
 *
 * No LLM round-trip. Operates on `serializedPreview.questions` already
 * computed in the parent. Results render inline in the AI Assistant
 * slide-over so teachers see them without leaving the authoring view.
 * ================================================================== */

function questionPlainText(question) {
  const raw = question?.text
  if (!raw) return ''
  if (typeof raw === 'string') return raw
  try { return richTextToPlainText(raw) } catch { return '' }
}

// Compact difficulty selector for a question card. "Auto" clears the explicit
// tag so the balance meter infers difficulty from marks + type; picking a
// level pins it. The dot colour shows the level the question currently counts
// as (explicit tag, or inferred when on Auto).
const DIFFICULTY_DOT = { easy: '#16a34a', medium: '#d97706', hard: '#dc2626' }
export function DifficultySelect({ question, onUpdateQuestion }) {
  const value = DIFFICULTY_LEVELS.includes(String(question?.difficulty || '').toLowerCase())
    ? String(question.difficulty).toLowerCase()
    : ''
  const effective = difficultyBucket(question)
  return (
    <label
      className="sv-q-difficulty"
      title={value
        ? `Difficulty tagged ${DIFFICULTY_LABELS[value]}`
        : `Difficulty auto (inferred ${DIFFICULTY_LABELS[effective]})`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: '50%', background: DIFFICULTY_DOT[effective], flexShrink: 0 }}
      />
      <select
        aria-label="Question difficulty"
        value={value}
        onChange={e => onUpdateQuestion('difficulty', e.target.value)}
        style={{ background: 'var(--sv-tinted)', border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: '3px 6px', fontSize: 11.5, color: 'var(--sv-text)' }}
      >
        <option value="">Auto</option>
        {DIFFICULTY_LEVELS.map(level => (
          <option key={level} value={level}>{DIFFICULTY_LABELS[level]}</option>
        ))}
      </select>
    </label>
  )
}

export function BalanceDifficultyAction({ questions, questionNumbers, drift }) {
  const [open, setOpen] = useState(false)
  const stats = useMemo(() => analyzeDifficulty(questions || []), [questions])
  // "1 easy · 0 medium · 0 hard" told a teacher nothing about whether that was
  // right. With a blueprint the header reports drift from the mix the paper was
  // planned with instead.
  const planned = drift?.hasBlueprint ? driftSummary(drift, drift.difficulty) : ''
  const summary = stats.total === 0
    ? 'Add questions to see the distribution'
    : planned ||
      `${stats.buckets.easy} easy · ${stats.buckets.medium} medium · ${stats.buckets.hard} hard — ${stats.verdict}`
  return (
    <div className={`sv-ai-action ${open ? 'expanded' : ''}`} style={{ display: 'block', padding: 'var(--sv-s3)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sv-s3)', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div className="sv-ic"><Icon name="difficulty" size={20} /></div>
        <div style={{ flex: 1 }}>
          <strong style={{ display: 'block', fontWeight: 600 }}>Balance paper difficulty</strong>
          <small style={{ color: 'var(--sv-muted)', fontSize: 12 }}>{summary}</small>
        </div>
        <span style={{ color: 'var(--sv-muted)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && stats.total > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {drift?.hasBlueprint && <DriftRows rows={drift.difficulty} />}
          <DifficultyBar stats={stats} />
          <div style={{ fontSize: 12, color: 'var(--sv-muted)', lineHeight: 1.5 }}>
            Target mix is roughly 40% easy · 40% medium · 20% hard.{' '}
            {stats.tagged === stats.total
              ? 'Every question carries an explicit difficulty tag.'
              : stats.tagged > 0
                ? `${stats.tagged} of ${stats.total} questions are tagged; the rest are inferred from marks and type. Set a tag on a question to override.`
                : 'Difficulty is inferred from marks and question type — set a difficulty tag on a question to override it.'}
          </div>
          {['easy', 'medium', 'hard'].map(b => (
            <DifficultyBucketList key={b} bucket={b} items={stats.byBucket[b]} questionNumbers={questionNumbers} />
          ))}
        </div>
      )}
      {open && stats.total === 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--sv-muted)' }}>
          No questions in the paper yet.
        </div>
      )}
    </div>
  )
}

function DifficultyBar({ stats }) {
  const { buckets, total, target } = stats
  const easyPct = total ? Math.round((buckets.easy / total) * 100) : 0
  const medPct = total ? Math.round((buckets.medium / total) * 100) : 0
  const hardPct = total ? 100 - easyPct - medPct : 0
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--sv-border)' }}>
        <div style={{ width: `${easyPct}%`, background: '#86efac' }} title={`Easy ${easyPct}%`} />
        <div style={{ width: `${medPct}%`, background: '#fcd34d' }} title={`Medium ${medPct}%`} />
        <div style={{ width: `${hardPct}%`, background: '#fca5a5' }} title={`Hard ${hardPct}%`} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--sv-muted)', marginTop: 4 }}>
        <span>Easy {easyPct}% <em style={{ color: 'var(--sv-muted)' }}>(target {Math.round(target.easy * 100)}%)</em></span>
        <span>Medium {medPct}% <em>({Math.round(target.medium * 100)}%)</em></span>
        <span>Hard {hardPct}% <em>({Math.round(target.hard * 100)}%)</em></span>
      </div>
    </div>
  )
}

function DifficultyBucketList({ bucket, items, questionNumbers }) {
  if (!items.length) return null
  const label = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[bucket]
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--sv-muted)', marginBottom: 4 }}>
        {label} ({items.length})
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(({ q }) => (
          <li key={q.localId || q._id} style={{ fontSize: 12, display: 'flex', gap: 6 }}>
            <span style={{ color: 'var(--sv-muted)', minWidth: 26 }}>Q{questionNumbers?.[q.localId] || '?'}</span>
            <span style={{ flex: 1 }}>{truncate(questionPlainText(q), 80) || <em style={{ color: 'var(--sv-muted)' }}>(no question text)</em>}</span>
            <span style={{ color: 'var(--sv-muted)' }}>{Number(q.marks) || 1}m</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The planned-vs-actual strip shown at the top of an analysis action when the
 * paper HAS a blueprint (§3.4).
 *
 * This is the whole point of the inversion: "Analysis: planned 4, got 2" is
 * something a teacher can act on, where the old "2 analysis questions" was not,
 * because nothing had ever said how many there should be. With no blueprint the
 * strip renders nothing and the action's own discovery view is all there is —
 * which is the correct behaviour for a hand-built or imported paper.
 */
function DriftRows({ rows, emptyNote }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return emptyNote ? (
      <div style={{ fontSize: 12, color: 'var(--sv-muted)' }}>{emptyNote}</div>
    ) : null
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((row) => (
        <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ flex: 1, minWidth: 0, color: 'var(--sv-text)' }}>{row.label}</span>
          <span className="mono" style={{ color: 'var(--sv-muted)' }}>
            planned {row.planned}
          </span>
          <span className="mono" style={{
            fontWeight: 800,
            color: row.status === 'met' ? '#2C5A41'
              : row.status === 'unplanned' ? '#7A5A1F' : '#8A3D0F',
          }}>
            got {row.actual}
          </span>
          {row.status === 'unplanned' && (
            <span style={{ fontSize: 11, color: 'var(--warning-fg)' }}>not in the plan</span>
          )}
        </div>
      ))}
    </div>
  )
}

/** One-line verdict for an action's collapsed header, when a blueprint exists. */
function driftSummary(drift, rows) {
  if (!drift?.hasBlueprint) return ''
  const off = rows.filter((r) => r.status !== 'met').length
  if (off === 0) return 'Matches the plan'
  return `${off} ${off === 1 ? 'row' : 'rows'} off the plan`
}

// Bloom's-taxonomy ramp, lower-order → higher-order.
const BLOOM_COLORS = {
  remember: '#bfdbfe', understand: '#93c5fd', apply: '#86efac',
  analyze: '#fcd34d', evaluate: '#e4b190', create: '#fca5a5',
}

export function BloomBalanceAction({ questions, questionNumbers, drift }) {
  const [open, setOpen] = useState(false)
  const stats = useMemo(() => analyzeBloom(questions || []), [questions])
  // With a blueprint the header reports DRIFT from the planned mix. Without one
  // it keeps the old discovery wording — a hand-built paper genuinely has no
  // stated intent to compare against.
  const planned = drift?.hasBlueprint ? driftSummary(drift, drift.bloom) : ''
  const summary = stats.total === 0
    ? 'Add questions to map thinking skills'
    : planned || (stats.tagged === 0
      ? 'No cognitive levels tagged yet'
      : `${stats.tagged}/${stats.total} tagged · ${stats.lowerOrder} lower · ${stats.higherOrder} higher — ${stats.verdict}`)
  return (
    <div className={`sv-ai-action ${open ? 'expanded' : ''}`} style={{ display: 'block', padding: 'var(--sv-s3)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sv-s3)', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div className="sv-ic"><Icon name="bloom" size={20} /></div>
        <div style={{ flex: 1 }}>
          <strong style={{ display: 'block', fontWeight: 600 }}>Thinking skills (Bloom&apos;s)</strong>
          <small style={{ color: 'var(--sv-muted)', fontSize: 12 }}>{summary}</small>
        </div>
        <span style={{ color: 'var(--sv-muted)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && stats.total > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {drift?.hasBlueprint && <DriftRows rows={drift.bloom} />}
          <BloomBar stats={stats} />
          <div style={{ fontSize: 12, color: 'var(--sv-muted)', lineHeight: 1.5 }}>
            {drift?.hasBlueprint
              ? 'This paper was planned with a set mix of thinking levels. The rows above show what was planned against what the paper now has — edit a question’s level in its detailed editor (✏) to bring it back on plan.'
              : 'Tag each question’s Bloom’s level in its detailed editor (✏). Aim for a mix of lower-order (remember / understand / apply) and higher-order (analyse / evaluate / create) thinking.'}
            {stats.untagged > 0 ? ` ${stats.untagged} not yet tagged.` : ''}
          </div>
          {BLOOM_LEVELS.map(level => (
            <BloomBucketList key={level} level={level} items={stats.byBucket[level]} questionNumbers={questionNumbers} />
          ))}
        </div>
      )}
      {open && stats.total === 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--sv-muted)' }}>
          No questions in the paper yet.
        </div>
      )}
    </div>
  )
}

function BloomBar({ stats }) {
  const { buckets, total, untagged } = stats
  const seg = (count) => (total ? (count / total) * 100 : 0)
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--sv-border)' }}>
        {BLOOM_LEVELS.map(level => (buckets[level] > 0 ? (
          <div key={level} style={{ width: `${seg(buckets[level])}%`, background: BLOOM_COLORS[level] }} title={`${BLOOM_LABELS[level]} ${buckets[level]}`} />
        ) : null))}
        {untagged > 0 && (
          <div style={{ width: `${seg(untagged)}%`, background: '#e5e7eb' }} title={`Untagged ${untagged}`} />
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 10.5, color: 'var(--sv-muted)', marginTop: 4 }}>
        {BLOOM_LEVELS.filter(level => buckets[level] > 0).map(level => (
          <span key={level} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: BLOOM_COLORS[level] }} />
            {BLOOM_LABELS[level]} {buckets[level]}
          </span>
        ))}
        {untagged > 0 && <span>Untagged {untagged}</span>}
      </div>
    </div>
  )
}

function BloomBucketList({ level, items, questionNumbers }) {
  if (!items.length) return null
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--sv-muted)', marginBottom: 4 }}>
        {BLOOM_LABELS[level]} ({items.length})
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(({ q }) => (
          <li key={q.localId || q._id} style={{ fontSize: 12, display: 'flex', gap: 6 }}>
            <span style={{ color: 'var(--sv-muted)', minWidth: 26 }}>Q{questionNumbers?.[q.localId] || '?'}</span>
            <span style={{ flex: 1 }}>{truncate(questionPlainText(q), 80) || <em style={{ color: 'var(--sv-muted)' }}>(no question text)</em>}</span>
            <span style={{ color: 'var(--sv-muted)' }}>{Number(q.marks) || 1}m</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function truncate(text, n) {
  const s = String(text || '').trim()
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

function subjectIdFromLabel(label) {
  if (!label) return null
  const match = CBC_SUBJECTS.find(s => s.label === label || s.shortLabel === label)
  return match?.id || null
}

const COMPETENCY_HINTS = {
  english: {
    'Reading & Comprehension': ['read', 'passage', 'comprehension', 'meaning', 'paragraph', 'text', 'story'],
    'Writing Skills': ['write', 'compose', 'essay', 'paragraph', 'letter', 'composition', 'draft'],
    'Speaking & Listening': ['speak', 'listen', 'oral', 'pronounce', 'dialogue', 'conversation', 'discuss'],
    'Grammar & Language Structure': ['noun', 'verb', 'tense', 'adjective', 'adverb', 'sentence', 'grammar', 'pronoun', 'preposition', 'punctuation', 'plural', 'singular'],
    'Literature & Creative Expression': ['poem', 'poetry', 'character', 'plot', 'theme', 'novel', 'literature', 'figurative', 'metaphor', 'simile'],
  },
  science: {
    'Living Things & Biology': ['plant', 'animal', 'cell', 'organ', 'body', 'leaf', 'root', 'flower', 'photosynthesis', 'respiration', 'digestion', 'reproduction', 'ecosystem', 'living'],
    'Matter & Physical Science': ['matter', 'solid', 'liquid', 'gas', 'mixture', 'solution', 'element', 'compound', 'chemical', 'substance', 'state'],
    'Earth & Environment': ['soil', 'rock', 'weather', 'climate', 'water', 'pollution', 'environment', 'earth', 'erosion', 'rain'],
    'Scientific Inquiry': ['experiment', 'observe', 'hypothesis', 'method', 'measure', 'investigate', 'predict', 'conclusion'],
    'Energy & Forces': ['force', 'energy', 'motion', 'electric', 'magnet', 'light', 'sound', 'heat', 'gravity', 'friction', 'machine'],
  },
  mathematics: {
    'Number & Operations': ['add', 'sum', 'subtract', 'minus', 'multiply', 'product', 'divide', 'quotient', 'fraction', 'decimal', 'integer', 'whole', 'number', 'place value', 'digit'],
    'Measurement': ['length', 'metre', 'meter', 'centimetre', 'kilometre', 'kilogram', 'gram', 'litre', 'volume', 'mass', 'weight', 'time', 'hour', 'minute', 'temperature', 'measure'],
    'Geometry & Spatial Reasoning': ['angle', 'triangle', 'square', 'rectangle', 'circle', 'shape', 'polygon', 'perimeter', 'area', 'symmetry', 'parallel', 'perpendicular', 'geometry'],
    'Data Handling & Statistics': ['graph', 'chart', 'bar', 'pie', 'table', 'mean', 'median', 'mode', 'average', 'data', 'frequency', 'probability', 'statistic'],
    'Patterns & Algebra': ['pattern', 'sequence', 'equation', 'variable', 'expression', 'algebra', 'unknown', 'solve for'],
  },
  'social-studies': {
    'History & Heritage': ['history', 'past', 'colonial', 'independence', 'heritage', 'ancestor', 'kingdom', 'tradition'],
    'Civic Education': ['rights', 'duties', 'citizen', 'government', 'constitution', 'democracy', 'vote', 'law', 'parliament'],
    'Geography & Environment': ['map', 'country', 'province', 'continent', 'river', 'mountain', 'climate', 'population', 'geography'],
    'Culture & Society': ['culture', 'tradition', 'custom', 'family', 'community', 'language', 'religion', 'society'],
    'Economics & Livelihoods': ['money', 'trade', 'market', 'farming', 'agriculture', 'industry', 'income', 'economy', 'business'],
  },
  technology: {
    'Digital Literacy': ['computer', 'keyboard', 'mouse', 'monitor', 'file', 'folder', 'digital'],
    'Computer Applications': ['word', 'spreadsheet', 'document', 'application', 'software', 'program'],
    'Problem Solving & Design': ['design', 'algorithm', 'flowchart', 'problem', 'solution', 'code', 'program', 'block'],
    'Internet Safety': ['internet', 'online', 'password', 'safety', 'cyber', 'phishing', 'scam'],
    'Technology in Society': ['society', 'impact', 'communication', 'media', 'ethical', 'responsible'],
  },
  'expressive-arts': {
    'Music & Performance': ['music', 'song', 'rhythm', 'beat', 'tempo', 'instrument', 'note', 'melody'],
    'Visual Arts & Design': ['draw', 'paint', 'colour', 'sketch', 'design', 'pattern', 'sculpture'],
    'Drama & Theatre': ['drama', 'play', 'act', 'theatre', 'role', 'scene', 'character'],
    'Dance & Movement': ['dance', 'movement', 'choreograph', 'rhythm'],
    'Creative Expression': ['creative', 'express', 'imagination', 'idea'],
  },
  cinyanja: {
    'Kuwerenga (Reading)': ['werenga', 'nkhani', 'kuwerenga'],
    'Kulemba (Writing)': ['lemba', 'kalembedwe', 'kulemba'],
    'Kulankhula & Kumvera (Speaking & Listening)': ['lankhula', 'mvera', 'kuyankhula'],
    'Galamala (Grammar)': ['galamala', 'liwu', 'mawu', 'chiganizo'],
    'Chikhalidwe (Culture & Heritage)': ['chikhalidwe', 'mwambo', 'miyambo'],
  },
  'home-economics': {
    'Food & Nutrition': ['food', 'nutrition', 'vitamin', 'protein', 'carbohydrate', 'meal', 'diet', 'balanced'],
    'Personal & Family Health': ['health', 'hygiene', 'family', 'disease', 'clean', 'safety'],
    'Home Management': ['home', 'clean', 'tidy', 'organise', 'organize', 'kitchen'],
    'Clothing & Textiles': ['cloth', 'fabric', 'sew', 'garment', 'textile', 'iron', 'wash'],
    'Consumer Education': ['consumer', 'budget', 'money', 'price', 'shop', 'market'],
  },
}

function scoreCompetency(text, competency, hints) {
  const hay = text.toLowerCase()
  let score = 0
  const words = competency.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3)
  words.forEach(w => { if (hay.includes(w)) score += 2 })
  ;(hints || []).forEach(h => { if (hay.includes(h.toLowerCase())) score += 1 })
  return score
}

function mapQuestionToCompetency(question, subjectId) {
  const competencies = COMPETENCIES[subjectId] || []
  if (!competencies.length) return null
  const text = `${questionPlainText(question)} ${question.topic || ''}`.trim()
  if (!text) return null
  let best = null
  let bestScore = 0
  competencies.forEach(comp => {
    const hints = COMPETENCY_HINTS[subjectId]?.[comp] || []
    const s = scoreCompetency(text, comp, hints)
    if (s > bestScore) { bestScore = s; best = comp }
  })
  return bestScore > 0 ? best : null
}

export function MapCompetenciesAction({ questions, questionNumbers, subjectLabel, drift }) {
  const [open, setOpen] = useState(false)
  const subjectId = useMemo(() => subjectIdFromLabel(subjectLabel), [subjectLabel])
  const competencies = useMemo(() => (subjectId ? (COMPETENCIES[subjectId] || []) : []), [subjectId])
  const mappings = useMemo(() => {
    if (!subjectId) return []
    return (questions || []).map(q => ({ q, competency: mapQuestionToCompetency(q, subjectId) }))
  }, [questions, subjectId])
  const grouped = useMemo(() => {
    const map = new Map()
    competencies.forEach(c => map.set(c, []))
    map.set('__unmapped__', [])
    mappings.forEach(m => {
      const key = m.competency || '__unmapped__'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(m.q)
    })
    return map
  }, [mappings, competencies])
  const coverageCount = competencies.filter(c => (grouped.get(c) || []).length > 0).length
  // With a blueprint, curriculum COVERAGE is reported against what the paper set
  // out to assess — the planned topics and the syllabus outcomes it named —
  // rather than against a generic strand taxonomy the paper never referenced.
  // "0/5 strands covered · 1 unmapped" was technically true and useless.
  const plannedCoverage = drift?.hasBlueprint
    ? (() => {
        const off = drift.topics.filter(r => r.status !== 'met').length
        const outcomes = drift.outcomes
        const bits = []
        bits.push(off === 0
          ? `all ${drift.topics.length} planned topics covered`
          : `${off} of ${drift.topics.length} topics off the plan`)
        if (outcomes.planned > 0) {
          bits.push(`${outcomes.covered}/${outcomes.planned} syllabus outcomes assessed`)
        }
        return bits.join(' · ')
      })()
    : ''
  const summary = plannedCoverage || (!subjectId
    ? `No competency taxonomy for "${subjectLabel || 'this subject'}"`
    : (questions || []).length === 0
      ? 'Add questions to see mappings'
      : `${coverageCount}/${competencies.length} strands covered · ${(grouped.get('__unmapped__') || []).length} unmapped`)
  return (
    <div className={`sv-ai-action ${open ? 'expanded' : ''}`} style={{ display: 'block', padding: 'var(--sv-s3)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sv-s3)', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div className="sv-ic"><Icon name="target" size={20} /></div>
        <div style={{ flex: 1 }}>
          <strong style={{ display: 'block', fontWeight: 600 }}>Map to competencies</strong>
          <small style={{ color: 'var(--sv-muted)', fontSize: 12 }}>{summary}</small>
        </div>
        <span style={{ color: 'var(--sv-muted)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {drift?.hasBlueprint && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sv-text)' }}>
                Topics this paper set out to cover
              </div>
              <DriftRows rows={drift.topics} />
              {drift.outcomes.missing.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--warning-fg)', lineHeight: 1.5 }}>
                  No longer assessed: {drift.outcomes.missing.join('; ')}
                </div>
              )}
              {drift.outcomes.planned === 0 && (
                <div style={{ fontSize: 12, color: 'var(--sv-muted)', lineHeight: 1.5 }}>
                  The syllabus has no specific outcomes on file for these topics, so
                  the paper was planned by topic only. Nothing here is invented.
                </div>
              )}
            </>
          )}
          {!subjectId && (
            <div style={{ fontSize: 12, color: 'var(--sv-muted)' }}>
              Pick a CBC subject in the paper details to enable competency mapping.
            </div>
          )}
          {subjectId && (questions || []).length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--sv-muted)' }}>No questions in the paper yet.</div>
          )}
          {subjectId && (questions || []).length > 0 && (
            <>
              <div>
                <div className="sv-coverage-bar" title={`${coverageCount} of ${competencies.length} strands covered`}>
                  <span style={{ width: `${competencies.length ? Math.round((coverageCount / competencies.length) * 100) : 0}%` }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--sv-muted)' }}>
                  {coverageCount} of {competencies.length} strands covered
                  {(grouped.get('__unmapped__') || []).length > 0 && ` · ${(grouped.get('__unmapped__') || []).length} unmapped`}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--sv-muted)', lineHeight: 1.5 }}>
                Each question is matched to a CBC strand by keywords in its text and topic. Review and reassign as needed — this is a heuristic, not a verdict.
              </div>
              {competencies.map(comp => {
                const items = grouped.get(comp) || []
                return (
                  <CompetencyGroup key={comp} title={comp} items={items} questionNumbers={questionNumbers} />
                )
              })}
              <CompetencyGroup
                title="Unmapped"
                items={grouped.get('__unmapped__') || []}
                questionNumbers={questionNumbers}
                muted
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CompetencyGroup({ title, items, questionNumbers, muted }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: muted ? 'var(--sv-muted)' : 'var(--sv-text)', marginBottom: 4 }}>
        {title} <span style={{ color: 'var(--sv-muted)', fontWeight: 400 }}>({items.length})</span>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--sv-muted)', fontStyle: 'italic' }}>none</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map(q => (
            <li key={q.localId || q._id} style={{ fontSize: 12, display: 'flex', gap: 6 }}>
              <span style={{ color: 'var(--sv-muted)', minWidth: 26 }}>Q{questionNumbers?.[q.localId] || '?'}</span>
              <span style={{ flex: 1 }}>{truncate(questionPlainText(q), 80) || <em style={{ color: 'var(--sv-muted)' }}>(no question text)</em>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const DUPLICATE_THRESHOLD = 0.55
const DUPLICATE_STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'into', 'your', 'what', 'which', 'when', 'where', 'why', 'how', 'are', 'was', 'were', 'have', 'has', 'had', 'will', 'can', 'you', 'their', 'they', 'these', 'those', 'them', 'about', 'than', 'then',
])

function tokenizeForDuplicates(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !DUPLICATE_STOPWORDS.has(w))
  )
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  a.forEach(x => { if (b.has(x)) inter += 1 })
  return inter / (a.size + b.size - inter)
}

function detectDuplicates(questions, threshold = DUPLICATE_THRESHOLD) {
  const tokens = questions.map(q => tokenizeForDuplicates(questionPlainText(q)))
  const pairs = []
  for (let i = 0; i < questions.length; i += 1) {
    for (let j = i + 1; j < questions.length; j += 1) {
      const sim = jaccard(tokens[i], tokens[j])
      if (sim >= threshold) pairs.push({ a: questions[i], b: questions[j], sim })
    }
  }
  return pairs.sort((p1, p2) => p2.sim - p1.sim)
}

export function DetectDuplicatesAction({ questions, questionNumbers }) {
  const [open, setOpen] = useState(false)
  const pairs = useMemo(() => detectDuplicates(questions || []), [questions])
  const summary = (questions || []).length === 0
    ? 'Add questions to scan for duplicates'
    : pairs.length === 0
      ? 'No near-duplicates found'
      : `${pairs.length} similar pair${pairs.length === 1 ? '' : 's'} found`
  return (
    <div className={`sv-ai-action ${open ? 'expanded' : ''}`} style={{ display: 'block', padding: 'var(--sv-s3)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sv-s3)', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div className="sv-ic"><Icon name="verify" size={20} /></div>
        <div style={{ flex: 1 }}>
          <strong style={{ display: 'block', fontWeight: 600 }}>Detect duplicates</strong>
          <small style={{ color: 'var(--sv-muted)', fontSize: 12 }}>{summary}</small>
        </div>
        <span style={{ color: 'var(--sv-muted)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(questions || []).length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--sv-muted)' }}>No questions in the paper yet.</div>
          )}
          {(questions || []).length > 0 && pairs.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--sv-muted)' }}>
              Compared {(questions || []).length} questions — nothing crossed the {Math.round(DUPLICATE_THRESHOLD * 100)}% similarity threshold.
            </div>
          )}
          {pairs.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: 'var(--sv-muted)', lineHeight: 1.5 }}>
                Pairs sharing more than {Math.round(DUPLICATE_THRESHOLD * 100)}% of their wording. Review each pair — keep one, rewrite or remove the other.
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pairs.map((pair, i) => (
                  <li key={`${pair.a.localId || pair.a._id}-${pair.b.localId || pair.b._id}-${i}`} style={{ border: '1px solid var(--sv-border)', borderRadius: 'var(--sv-r-sm)', padding: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--sv-muted)', marginBottom: 4 }}>
                      {Math.round(pair.sim * 100)}% similar
                    </div>
                    <div style={{ fontSize: 12, display: 'flex', gap: 6, marginBottom: 4 }}>
                      <span style={{ color: 'var(--sv-muted)', minWidth: 26 }}>Q{questionNumbers?.[pair.a.localId] || '?'}</span>
                      <span style={{ flex: 1 }}>{truncate(questionPlainText(pair.a), 110) || <em>(no text)</em>}</span>
                    </div>
                    <div style={{ fontSize: 12, display: 'flex', gap: 6 }}>
                      <span style={{ color: 'var(--sv-muted)', minWidth: 26 }}>Q{questionNumbers?.[pair.b.localId] || '?'}</span>
                      <span style={{ flex: 1 }}>{truncate(questionPlainText(pair.b), 110) || <em>(no text)</em>}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
