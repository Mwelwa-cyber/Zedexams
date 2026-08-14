import { useEffect, useMemo, useRef, useState } from 'react'
import SeoHelmet from '../../shared/components/SeoHelmet'
import { getMergedSyllabi } from '../../utils/syllabusKbService'
import {
  resolveColumnRoles, splitSpecificOutcomes, splitPoints,
  repairColumnShiftedRow, isHeaderEchoRow, joinCellText,
} from '../../utils/curriculum2013Parser'
import { splitConcatenatedTopicCell } from '../../utils/curriculumTopicCell'

// Subject metadata — maps the raw JSON keys to icon + category + short label.
// Keep aligned with public/syllabi/curriculum-data.json. New subjects fall
// back to the generic META at render time.
const META = {
  'Early Childhood Education Syllabi (3-5 Years)':       { icon: '🌱', cat: 'Early Childhood', short: 'Early Childhood Ed.' },
  'Lower Primary Syllabi (Grades 1-3)':                  { icon: '📚', cat: 'Lower Primary',   short: 'Lower Primary' },
  'English Language Syllabus (Grades 4-6)':              { icon: '📖', cat: 'Upper Primary',   short: 'English (Gr. 4)' },
  'Mathematics Syllabus (Grades 4-6)':                   { icon: '➗', cat: 'Upper Primary',   short: 'Mathematics (Gr. 4)' },
  'Science Syllabus (Grades 4-6)':                       { icon: '🔬', cat: 'Upper Primary',   short: 'Science (Gr. 4)' },
  'Social Studies Syllabus (Grades 4-6)':                { icon: '🌍', cat: 'Upper Primary',   short: 'Social Studies (Gr. 4)' },
  'Home Economics & Hospitality Syllabus (Grades 4-6)':  { icon: '🏠', cat: 'Upper Primary',   short: 'Home Economics (Gr. 4)' },
  'Technology Studies Syllabus (Grades 4-6)':            { icon: '⚙️', cat: 'Upper Primary',   short: 'Technology Studies (Gr. 4)' },
  'Mathematics Syllabus (Forms 1-4)':                    { icon: '📐', cat: 'Secondary',       short: 'Mathematics' },
  'Mathematics II Syllabus (Forms 1-4)':                 { icon: '📏', cat: 'Secondary',       short: 'Mathematics II' },
  'Physics Syllabus (Forms 1-4)':                        { icon: '⚡', cat: 'Secondary',       short: 'Physics' },
  'History Syllabus (Forms 1-4)':                        { icon: '🏛️', cat: 'Secondary',       short: 'History' },
  'Geography Syllabus (Forms 1-4)':                      { icon: '🗺️', cat: 'Secondary',       short: 'Geography' },
  'ICT Syllabus (Forms 1-4)':                            { icon: '💻', cat: 'Secondary',       short: 'ICT' },
  'Literature in English Syllabus (Forms 1-4)':          { icon: '📖', cat: 'Secondary',       short: 'Literature in English' },
  'Religious Education Syllabus (Forms 1-4)':            { icon: '✝️', cat: 'Secondary',       short: 'Religious Education' },
  'Physical Education Syllabus (Forms 1-4)':             { icon: '🏃', cat: 'Secondary',       short: 'Physical Education' },
  'Food & Nutrition Syllabus (Forms 1-4)':               { icon: '🥗', cat: 'Secondary',       short: 'Food & Nutrition' },
  'Fashion & Fabrics Syllabus (Forms 1-4)':              { icon: '🧵', cat: 'Secondary',       short: 'Fashion & Fabrics' },
  'Hospitality Management Syllabus (Forms 1-4)':         { icon: '🏨', cat: 'Secondary',       short: 'Hospitality Management' },
  'Travel & Tourism Syllabus (Forms 1-4)':               { icon: '✈️', cat: 'Secondary',       short: 'Travel & Tourism' },
  'Art & Design Syllabus (Forms 1-4)':                   { icon: '🎨', cat: 'Secondary',       short: 'Art & Design' },
  'Zambian Languages Syllabus (Forms 1-4)':              { icon: '🗣️', cat: 'Secondary',       short: 'Zambian Languages' },
  'Commerce & Principles of Accounts Syllabus (Forms 1-4)': { icon: '🧾', cat: 'Secondary',    short: 'Commerce & Accounts' },
  'Design & Technology Studies Syllabus (Forms 1-4)':    { icon: '🛠️', cat: 'Secondary',       short: 'Design & Technology' },
  'Music & Creative Arts Syllabus (Forms 1-4)':          { icon: '🎵', cat: 'Secondary',       short: 'Music & Creative Arts' },
  'Biology Syllabus (Forms 1-4)':                        { icon: '🧬', cat: 'Secondary',       short: 'Biology' },
  'Agricultural Science Syllabus (Forms 1-4)':           { icon: '🌾', cat: 'Secondary',       short: 'Agricultural Science' },
  'English Syllabus (Forms 1-4)':                        { icon: '📖', cat: 'Secondary',       short: 'English' },
}

const CAT_ORDER = ['Early Childhood', 'Lower Primary', 'Upper Primary', 'Secondary']
const CAT_LABELS = {
  'Early Childhood': 'ECE · Ages 3–5',
  'Lower Primary':   'Lower Primary · Grades 1–3',
  'Upper Primary':   'Upper Primary · Grades 4–6',
  'Secondary':       'Secondary · Forms 1–4',
}

// ─── 2013 legacy curriculum ──────────────────────────────────────────────────
// Same shape as the current META above but pointing at the pre-CBC 2013 syllabi.
// Loaded lazily — only the first switch to the legacy era pulls
// /syllabi/curriculum-data-2013.json. Overrides aren't supported on this era;
// it's strictly read-only reference material.
const META_2013 = {
  'Integrated Science Syllabus (Grades 1-7, 2013)':         { icon: '🔬', cat: 'Primary',           short: 'Integrated Science' },
  'Mathematics Syllabus (Grades 1-7, 2013)':                { icon: '➗', cat: 'Primary',           short: 'Mathematics' },
  'Social Studies Syllabus (Grades 1-7, 2013)':             { icon: '🌍', cat: 'Primary',           short: 'Social Studies' },
  'English Language Syllabus (Grades 2-7, 2013)':           { icon: '📖', cat: 'Primary',           short: 'English Language' },
  'Creative & Technology Studies Syllabus (2013)':           { icon: '🎨', cat: 'Primary',           short: 'Creative & Technology Studies' },
  'Home Economics Syllabus (Grades 5-7, 2013)':             { icon: '🏠', cat: 'Upper Primary',     short: 'Home Economics' },
  'Technology Studies Syllabus (Grades 5-7, 2013)':         { icon: '⚙️', cat: 'Upper Primary',     short: 'Technology Studies (Gr. 5–7)' },
  'Expressive Arts Syllabus (Grades 5-7, 2013)':            { icon: '🎭', cat: 'Upper Primary',     short: 'Expressive Arts' },
  'Zambian Language Syllabus (Grades 5-7, 2013)':           { icon: '🗣️', cat: 'Upper Primary',     short: 'Zambian Language' },
  'Physical Education Syllabus (Grades 8-9, 2013)':         { icon: '🏃', cat: 'Junior Secondary',  short: 'Physical Education' },
  'Agricultural Science Syllabus (Grades 10-12, 2013)':     { icon: '🌾', cat: 'Senior Secondary',  short: 'Agricultural Science' },
  'Art & Design Syllabus (Grades 10-12, 2013)':             { icon: '🎨', cat: 'Senior Secondary',  short: 'Art & Design' },
  'Biology Syllabus (Grades 10-12, 2013)':                  { icon: '🧬', cat: 'Senior Secondary',  short: 'Biology' },
  'Chemistry Syllabus (Grades 10-12, 2013)':                { icon: '⚗️', cat: 'Senior Secondary',  short: 'Chemistry' },
  'Civic Education Syllabus (Grades 10-12, 2013)':          { icon: '🏛️', cat: 'Senior Secondary',  short: 'Civic Education' },
  'Food & Nutrition Syllabus (Grades 10-12, 2013)':         { icon: '🥗', cat: 'Senior Secondary',  short: 'Food & Nutrition' },
  'Geography Syllabus (Grades 10-12, 2013)':                { icon: '🗺️', cat: 'Senior Secondary',  short: 'Geography' },
  'History Syllabus (Senior Secondary, 2013)':              { icon: '📜', cat: 'Senior Secondary',  short: 'History' },
  'Home Management Syllabus (Grades 10-12, 2013)':          { icon: '🏡', cat: 'Senior Secondary',  short: 'Home Management' },
  'Mathematics Syllabus (Grades 10-12, 2013)':              { icon: '📐', cat: 'Senior Secondary',  short: 'Mathematics' },
  'Physical Education Syllabus (Grades 10-12, 2013)':       { icon: '⚽', cat: 'Senior Secondary',  short: 'Physical Education (Sr.)' },
  'Religious Education 2044 Syllabus (Grades 10-12, 2013)': { icon: '✝️', cat: 'Senior Secondary',  short: 'Religious Education 2044' },
  'Religious Education 2046 Syllabus (Grades 10-12, 2013)': { icon: '☪️', cat: 'Senior Secondary',  short: 'Religious Education 2046' },
}

const CAT_ORDER_2013 = ['Primary', 'Upper Primary', 'Junior Secondary', 'Senior Secondary']
const CAT_LABELS_2013 = {
  'Primary':          'Primary · Grades 1–4',
  'Upper Primary':    'Upper Primary · Grades 5–7',
  'Junior Secondary': 'Junior Secondary · Grades 8–9',
  'Senior Secondary': 'Senior Secondary · Grades 10–12',
}

// Several 2013 primary subjects shipped as ONE multi-grade document that
// straddles the Primary (G1–G4) / Upper Primary (G5–G7) divide — e.g.
// "Mathematics Syllabus (Grades 1-7, 2013)". Left whole, every grade (incl.
// 5–7) lands under "Primary", so the upper-primary grades never appear in the
// Upper Primary section. We split these subjects' grade sheets across the two
// sections instead. Maps the raw subject key → its base short label.
const SPLIT_PRIMARY_SUBJECTS_2013 = {
  'English Language Syllabus (Grades 2-7, 2013)':   'English Language',
  'Integrated Science Syllabus (Grades 1-7, 2013)': 'Integrated Science',
  'Mathematics Syllabus (Grades 1-7, 2013)':        'Mathematics',
  'Social Studies Syllabus (Grades 1-7, 2013)':     'Social Studies',
}

// Parse a 2013 sheet name ("Grade 5") to its grade number, or null.
function legacySheetGrade(name) {
  const m = /(\d+)/.exec(String(name || ''))
  return m ? Number(m[1]) : null
}

// Order sheets by grade number (the source JSON stores some out of order).
function sortSheetsByGrade(sheets) {
  return Object.fromEntries(
    Object.entries(sheets).sort(
      ([a], [b]) => (legacySheetGrade(a) ?? 99) - (legacySheetGrade(b) ?? 99),
    ),
  )
}

// Short "Gr. 2–4" / "Gr. 1" range label for the actual grades in a sheet set.
function legacyGradeRangeLabel(sheets) {
  const nums = Object.keys(sheets)
    .map(legacySheetGrade)
    .filter((n) => n != null)
    .sort((a, b) => a - b)
  if (!nums.length) return ''
  const lo = nums[0]
  const hi = nums[nums.length - 1]
  return lo === hi ? `Gr. ${lo}` : `Gr. ${lo}–${hi}`
}

// Build the enriched {subjectKey → {icon,cat,short,sheets}} map for the 2013
// era. Cross-phase primary subjects (SPLIT_PRIMARY_SUBJECTS_2013) are emitted
// as two cards — a Primary card (grades ≤4) and an Upper Primary card (grades
// ≥5) — so each grade sheet lands in the section it belongs to.
function buildLegacyEnriched(raw) {
  const enriched = {}
  for (const [subj, sheets] of Object.entries(raw)) {
    const meta = META_2013[subj] || { icon: '📄', cat: 'Other', short: subj.slice(0, 30) }
    const splitBase = SPLIT_PRIMARY_SUBJECTS_2013[subj]
    if (!splitBase) {
      enriched[subj] = { ...meta, sheets }
      continue
    }
    const primarySheets = {}
    const upperSheets = {}
    for (const [name, sheet] of Object.entries(sheets)) {
      const g = legacySheetGrade(name)
      if (g != null && g >= 5) upperSheets[name] = sheet
      else primarySheets[name] = sheet
    }
    if (Object.keys(primarySheets).length) {
      const s = sortSheetsByGrade(primarySheets)
      enriched[`${subj}__primary`] = {
        icon: meta.icon, cat: 'Primary', short: `${splitBase} (${legacyGradeRangeLabel(s)})`, sheets: s,
      }
    }
    if (Object.keys(upperSheets).length) {
      const s = sortSheetsByGrade(upperSheets)
      enriched[`${subj}__upper`] = {
        icon: meta.icon, cat: 'Upper Primary', short: `${splitBase} (${legacyGradeRangeLabel(s)})`, sheets: s,
      }
    }
  }
  return enriched
}

function catOrderForEra(era) {
  return era === 'legacy' ? CAT_ORDER_2013 : CAT_ORDER
}
function catLabelsForEra(era) {
  return era === 'legacy' ? CAT_LABELS_2013 : CAT_LABELS
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Wraps occurrences of `q` (case-insensitive) inside `text` in <mark>.
// Returns a React node array, or the original text if no query.
function highlight(text, q) {
  if (!q || !text) return text
  const re = new RegExp(escapeRegex(q), 'gi')
  const parts = []
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<mark key={`${m.index}-${parts.length}`}>{m[0]}</mark>)
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// Multi-line cells from the source data use '\n' (and often a leading '•') to
// list bullet points. Render them as a real <ul> so the structure matches the
// PDFs the teachers expect. Single-line cells get returned as plain text.
function renderCell(val, q) {
  if (!val) return null
  if (val.includes('\n')) {
    const lines = val.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length > 1) {
      return (
        <ul>
          {lines.map((line, i) => {
            const cleaned = line.replace(/^•\s*/, '')
            if (!cleaned) return null
            return <li key={i}>{highlight(cleaned, q)}</li>
          })}
        </ul>
      )
    }
    return highlight(lines[0] || '', q)
  }
  return highlight(val, q)
}

// 2013 curriculum cells are malformed at the SOURCE: a single SPECIFIC OUTCOMES
// cell holds many outcomes ("1.3.1.1 Identify… 1.3.1.2 Distinguish…") and
// CONTENT/SKILLS/VALUES pack their points onto one bulleted line. Rendered raw
// they read as one blob and the 2nd/3rd outcome codes look like headings. This
// renderer splits them through the canonical parser so each outcome and each
// content point is its own list item — the structural fix, not a visual patch.
function renderLegacyCell(colName, val, roles, q) {
  if (!val) return null
  if (roles && colName === roles.outcomes) {
    const items = splitSpecificOutcomes(val)
    if (items.length > 1 || (items[0] && items[0].code)) {
      return (
        <ul className="ss-outcome-list">
          {items.map((o, i) => (
            <li key={i}>
              {o.code ? <span className="ss-outcome-code">{highlight(o.code, q)}</span> : null}
              {o.code ? ' ' : ''}{highlight(o.statement, q)}
            </li>
          ))}
        </ul>
      )
    }
  }
  if (roles && ((roles.content || []).includes(colName) || colName === roles.skills || colName === roles.values || colName === roles.activities)) {
    const points = splitPoints(val)
    // Always render list columns (learning activities / content / skills /
    // values) as a bulleted list — even a SINGLE activity — so every activity
    // carries a bullet, matching the source syllabus (where each activity is
    // bulleted regardless of count). Rendering a lone activity as plain text
    // made single-activity cells look bullet-less next to multi-activity ones.
    if (points.length >= 1) {
      return <ul>{points.map((p, i) => <li key={i}>{highlight(p, q)}</li>)}</ul>
    }
  }
  return renderCell(val, q)
}

function groupByCategory(data) {
  const grouped = {}
  for (const [subj, meta] of Object.entries(data)) {
    if (!grouped[meta.cat]) grouped[meta.cat] = []
    grouped[meta.cat].push([subj, meta])
  }
  return grouped
}

function countTopicsInSheet(sheet) {
  if (!sheet?.rows) return 0
  let count = 0
  for (const row of sheet.rows) {
    if (row.type === 'data' && row.cells?.TOPIC && row.cells.TOPIC.trim()) count++
  }
  return count
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SyllabiLibrary() {
  // Two independent caches — one per era. Current uses the merged service so
  // admin overrides apply; 2013 is a flat read-only fetch of the static JSON.
  const [currentData, setCurrentData] = useState(null)
  const [legacyData, setLegacyData] = useState(null)
  const [loadingCurrent, setLoadingCurrent] = useState(true)
  const [loadingLegacy, setLoadingLegacy] = useState(false)
  const [error, setError] = useState('')

  const [era, setEra] = useState('current') // 'current' | 'legacy'
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [currentSubject, setCurrentSubject] = useState(null)
  const [currentSheet, setCurrentSheet] = useState(null)
  const [rowFilter, setRowFilter] = useState('')
  // Reading-first chrome. `subjectPanelOpen` is the slide-out subject list —
  // opened from the phone hamburger or the tablet/desktop icon rail (in
  // subject view the sidebar auto-collapses to a rail so the table gets the
  // width). `reading` is Full Screen Reading Mode: the studio takes over the
  // viewport and every non-essential control is hidden.
  const [subjectPanelOpen, setSubjectPanelOpen] = useState(false)
  const [reading, setReading] = useState(false)
  const rootRef = useRef(null)

  const rawData = era === 'legacy' ? legacyData : currentData
  const loading = era === 'legacy' ? loadingLegacy : loadingCurrent

  // Load the structured curriculum data via the merged-source helper so any
  // admin overrides made in the CBC KB editor are reflected here too. The
  // helper caches both the raw JSON (~1.3MB, fetched once per session) and
  // the overrides snapshot, so this is cheap on subsequent mounts.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const merged = await getMergedSyllabi()
        if (cancelled) return
        const enriched = {}
        for (const [subj, sheets] of Object.entries(merged || {})) {
          const meta = META[subj] || { icon: '📄', cat: 'Other', short: subj.slice(0, 30) }
          enriched[subj] = { ...meta, sheets }
        }
        setCurrentData(enriched)
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load curriculum data.')
      } finally {
        if (!cancelled) setLoadingCurrent(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Lazy-load the 2013 dataset the first time the user switches eras. We
  // deliberately don't preload it — teachers default to the current
  // curriculum, and the file is another ~850KB they may never need.
  useEffect(() => {
    // Don't gate on loadingLegacy here — keeping it in deps re-fires this
    // effect when we call setLoadingLegacy(true) below, which then runs the
    // cleanup (cancelled = true) and silently drops the in-flight fetch.
    // The early-return on legacyData is enough to keep us from double-
    // fetching the JSON.
    if (era !== 'legacy' || legacyData) return undefined
    let cancelled = false
    setLoadingLegacy(true)
    fetch('/syllabi/curriculum-data-2013.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(raw => {
        if (cancelled) return
        setLegacyData(buildLegacyEnriched(raw))
      })
      .catch(err => {
        if (!cancelled) setError(err?.message || 'Could not load 2013 curriculum data.')
      })
      .finally(() => {
        if (!cancelled) setLoadingLegacy(false)
      })
    return () => { cancelled = true }
  }, [era, legacyData])

  // Inject Playfair Display once — used for the brand serif headings to
  // match the uploaded design. The app's global font stack (Fraunces /
  // Outfit / Nunito) doesn't ship the right weights, so we add the link
  // only when this page renders.
  useEffect(() => {
    const id = 'syllabi-studio-playfair'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&display=swap'
    document.head.appendChild(link)
  }, [])

  // Debounce the global search box so we don't iterate ~thousands of rows
  // on every keystroke.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setDebouncedQuery('')
      return undefined
    }
    const t = setTimeout(() => setDebouncedQuery(trimmed), 250)
    return () => clearTimeout(t)
  }, [query])

  const view = debouncedQuery ? 'search' : (currentSubject ? 'subject' : 'home')

  function showHome() {
    setCurrentSubject(null)
    setCurrentSheet(null)
    setQuery('')
    setRowFilter('')
    setReading(false)
  }

  function showSubject(subj) {
    const sheetNames = Object.keys(rawData[subj].sheets)
    setCurrentSubject(subj)
    setCurrentSheet(sheetNames[0] || null)
    setRowFilter('')
    setQuery('')
    setSubjectPanelOpen(false)
  }

  // Switching eras invalidates the current selection — the subject key for
  // "Mathematics" in 2013 is a different document from "Mathematics" in the
  // current curriculum.
  function switchEra(nextEra) {
    if (nextEra === era) return
    setEra(nextEra)
    setCurrentSubject(null)
    setCurrentSheet(null)
    setQuery('')
    setDebouncedQuery('')
    setRowFilter('')
    setError('')
    setReading(false)
    setSubjectPanelOpen(false)
  }

  // Escape backs out of the subject panel first, then reading mode.
  useEffect(() => {
    if (!reading && !subjectPanelOpen) return undefined
    function onKey(e) {
      if (e.key !== 'Escape') return
      // A stacked modal (e.g. SubscriptionReminderPopup, fixed z-[9998] with
      // its own Escape handler + body-overflow lock) may sit above reading
      // mode; let Escape close it alone, or one keypress kills both and the
      // interleaved overflow restores can leave the page scroll stuck.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (subjectPanelOpen) setSubjectPanelOpen(false)
      else setReading(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading, subjectPanelOpen])

  // Reading mode owns the viewport (position: fixed), so freeze the page
  // scroll behind it while it's up.
  useEffect(() => {
    if (!reading) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [reading])

  // How much of the viewport the page chrome above the studio (the shell's
  // top padding + the teacher top bar) actually eats. It used to be a
  // hard-coded 160px in the stylesheet, which is only ever right by accident:
  // when the guess ran short the studio pushed past the fold, and when it ran
  // long the card stopped short of the bottom of the screen. Measuring the
  // studio's own document offset makes it end exactly at the viewport edge.
  // Skipped in reading mode — the root is position:fixed there and owns the
  // whole viewport already, so a measurement taken then would read 0.
  useEffect(() => {
    const el = rootRef.current
    if (!el || reading) return undefined
    function measure() {
      const top = el.getBoundingClientRect().top + (window.scrollY || 0)
      el.style.setProperty('--ss-vh-offset', `${Math.max(0, Math.round(top)) + 8}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [reading])

  // ── Home + sidebar derived state ────────────────────────────────────────
  const grouped = useMemo(() => (rawData ? groupByCategory(rawData) : {}), [rawData])

  const stats = useMemo(() => {
    if (!rawData) return { subjects: 0, levels: 0, topics: 0 }
    let levels = 0
    let topics = 0
    for (const meta of Object.values(rawData)) {
      const sheetList = Object.values(meta.sheets)
      levels += sheetList.length
      for (const sh of sheetList) topics += countTopicsInSheet(sh)
    }
    return { subjects: Object.keys(rawData).length, levels, topics }
  }, [rawData])

  // ── Global search results, grouped by (subject, sheet) ──────────────────
  const searchResults = useMemo(() => {
    if (!rawData || !debouncedQuery) return []
    const lq = debouncedQuery.toLowerCase()
    const results = []
    outer:
    for (const [subj, meta] of Object.entries(rawData)) {
      for (const [sheetName, sheet] of Object.entries(meta.sheets)) {
        let count = 0
        for (const row of sheet.rows) {
          if (row.type !== 'data') continue
          if (Object.values(row.cells).some(c => c && c.toLowerCase().includes(lq))) count++
        }
        if (count > 0) {
          results.push({ subj, sheetName, count, icon: meta.icon, short: meta.short, cat: meta.cat })
          if (results.length >= 60) break outer
        }
      }
    }
    return results
  }, [rawData, debouncedQuery])

  // ─────────────────────────────────────────────────────────────────────────

  const isLegacy = era === 'legacy'
  const rootClass = `ss-root${isLegacy ? ' is-legacy' : ''}${reading ? ' is-reading' : ''}`

  return (
    <section className={rootClass} data-view={view} data-era={era} ref={rootRef}>
      <SeoHelmet title="Syllabi Studio" noIndex />
      <SyllabiStudioStyles />

      <div className="ss-header">
        <button
          type="button"
          className="ss-menu-btn"
          aria-label="Browse subjects"
          onClick={() => setSubjectPanelOpen(true)}
          disabled={!rawData}
        >
          ☰
        </button>
        <div className="ss-logo-mark" aria-hidden>{isLegacy ? '📜' : '📘'}</div>
        <div className="ss-logo-text-wrap">
          <div className="ss-logo-text">Syllabi Studio</div>
          <div className="ss-logo-sub">
            {isLegacy ? '2013 Zambian Curriculum (still in use)' : 'Zambian National Curriculum'}
          </div>
        </div>

        <div className="ss-era-switcher" role="tablist" aria-label="Curriculum era">
          <button
            type="button"
            role="tab"
            aria-selected={era === 'current'}
            className={`ss-era-btn ${era === 'current' ? 'is-active' : ''}`}
            onClick={() => switchEra('current')}
          >
            ✦ Current Curriculum
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={era === 'legacy'}
            className={`ss-era-btn ${era === 'legacy' ? 'is-active is-legacy' : ''}`}
            onClick={() => switchEra('legacy')}
          >
            📜 2013 Curriculum
          </button>
        </div>

        <div className="ss-spacer" />
        <label className="ss-search-wrap">
          <span className="sr-only">Search topics or competences</span>
          <input
            type="text"
            className="ss-search-box"
            placeholder={isLegacy ? 'Search 2013 topics…' : 'Search topics, competences…'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            disabled={!rawData}
          />
        </label>
      </div>

      <div className="ss-layout">
        {subjectPanelOpen && (
          <div
            className="ss-backdrop"
            aria-hidden
            onClick={() => setSubjectPanelOpen(false)}
          />
        )}
        <Sidebar
          data={rawData}
          grouped={grouped}
          currentSubject={currentSubject}
          onSelectSubject={showSubject}
          era={era}
          onSwitchEra={switchEra}
          panelOpen={subjectPanelOpen}
          onOpenPanel={() => setSubjectPanelOpen(true)}
          onClosePanel={() => setSubjectPanelOpen(false)}
        />

        <main className="ss-main">
          {loading && (
            <div className="ss-loading">
              <div className="ss-loading-dot" />
              <p>Loading{isLegacy ? ' 2013 ' : ' '}curriculum data…</p>
            </div>
          )}

          {!loading && error && (
            <div className="ss-error">
              <p className="ss-error-title">Could not load curriculum data</p>
              <p className="ss-error-detail">{error}</p>
            </div>
          )}

          {!loading && !error && view === 'home' && rawData && (
            <HomeView
              stats={stats}
              grouped={grouped}
              onSelectSubject={showSubject}
              era={era}
            />
          )}

          {!loading && !error && view === 'subject' && currentSubject && rawData && rawData[currentSubject] && (
            <SubjectDetail
              meta={rawData[currentSubject]}
              currentSheet={currentSheet}
              onSelectSheet={setCurrentSheet}
              rowFilter={rowFilter}
              onRowFilter={setRowFilter}
              onBack={showHome}
              era={era}
              reading={reading}
              onToggleReading={() => setReading(r => !r)}
            />
          )}

          {!loading && !error && view === 'search' && (
            <SearchResults
              query={debouncedQuery}
              results={searchResults}
              onOpenResult={(subj, sheetName) => {
                setQuery('')
                setCurrentSubject(subj)
                setCurrentSheet(sheetName)
                setRowFilter(debouncedQuery)
              }}
              era={era}
            />
          )}
        </main>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

// The sidebar renders in three modes, all CSS-driven off the root's
// data-view + the is-open class:
//   • full column (home/search on wide screens)
//   • icon rail   (subject view ≥701px — auto-collapses so the table wins)
//   • slide-out panel (phones via the ☰ button, or expanding the rail)
function Sidebar({ data, grouped, currentSubject, onSelectSubject, era, onSwitchEra, panelOpen, onOpenPanel, onClosePanel }) {
  if (!data) {
    return (
      <nav className="ss-sidebar" aria-label="Subjects">
        <div className="ss-sidebar-placeholder">Loading subjects…</div>
      </nav>
    )
  }
  return (
    <nav className={`ss-sidebar${panelOpen ? ' is-open' : ''}`} aria-label="Subjects">
      <div className="ss-panel-head">
        <span>Subjects</span>
        <button
          type="button"
          className="ss-panel-close"
          aria-label="Close subject list"
          onClick={onClosePanel}
        >
          ✕
        </button>
      </div>
      <div className="ss-panel-era-switch" role="tablist" aria-label="Curriculum era">
        <button
          type="button"
          role="tab"
          aria-selected={era === 'current'}
          className={`ss-panel-era-btn${era === 'current' ? ' is-active' : ''}`}
          onClick={() => onSwitchEra('current')}
        >
          ✦ Current
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={era === 'legacy'}
          className={`ss-panel-era-btn${era === 'legacy' ? ' is-active is-legacy' : ''}`}
          onClick={() => onSwitchEra('legacy')}
        >
          📜 2013
        </button>
      </div>
      <button
        type="button"
        className="ss-rail-toggle"
        aria-label="Show subject names"
        title="Show subject names"
        onClick={onOpenPanel}
      >
        »
      </button>
      {catOrderForEra(era).map(cat => {
        const list = grouped[cat]
        if (!list || list.length === 0) return null
        return (
          <div key={cat} className="ss-sb-group">
            <div className="ss-sb-label">{cat.toUpperCase()}</div>
            {list.map(([subj, meta]) => (
              <button
                key={subj}
                type="button"
                className={`ss-nav-item ${currentSubject === subj ? 'is-active' : ''}`}
                title={meta.short}
                onClick={() => onSelectSubject(subj)}
              >
                <span className="ss-nav-icon" aria-hidden>{meta.icon}</span>
                <span className="ss-nav-text">{meta.short}</span>
              </button>
            ))}
          </div>
        )
      })}
    </nav>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function HomeView({ stats, grouped, onSelectSubject, era }) {
  const isLegacy = era === 'legacy'
  const labels = catLabelsForEra(era)
  return (
    <div className="ss-home">
      <section className="ss-hero" aria-label="Studio overview">
        <div className="ss-hero-text">
          <div className="ss-hero-label">
            {isLegacy ? '📜 2013 CURRICULUM' : '✦ SYLLABI STUDIO'}
          </div>
          {isLegacy ? (
            <>
              <h1 className="ss-hero-title">2013 Curriculum<br />Still in Classrooms</h1>
              <p className="ss-hero-blurb">
                The 2013 syllabi are still in active use by some grades —<br />
                full reference across Primary and Secondary levels.
              </p>
            </>
          ) : (
            <>
              <h1 className="ss-hero-title">Zambian National<br />Curriculum</h1>
              <p className="ss-hero-blurb">
                Browse all 20 subjects across Early Childhood,<br />
                Primary and Secondary levels.
              </p>
            </>
          )}
        </div>
        <div className="ss-hero-emoji" aria-hidden>{isLegacy ? '📜' : '📘'}</div>
      </section>

      <div className="ss-stats-row">
        <StatCard value={stats.subjects} label="Subjects" />
        <StatCard value={stats.levels}   label={isLegacy ? 'Grade Levels' : 'Grade/Form Levels'} />
        <StatCard value={stats.topics}   label="Topics" />
        <StatCard value={isLegacy ? '2013' : 'Live'} label="Edition" />
      </div>

      {catOrderForEra(era).map(cat => {
        const list = grouped[cat]
        if (!list || list.length === 0) return null
        return (
          <section key={cat} className="ss-cat-section">
            <div className="ss-section-heading">
              <span className="ss-sh-dash">{cat.toUpperCase()}</span>
              <h2 className="ss-sh-title">{labels[cat] || cat}</h2>
            </div>
            <div className="ss-cards-grid">
              {list.map(([subj, meta]) => {
                const sheetCount = Object.keys(meta.sheets).length
                let topicCount = 0
                for (const sh of Object.values(meta.sheets)) topicCount += countTopicsInSheet(sh)
                return (
                  <button
                    key={subj}
                    type="button"
                    className="ss-subj-card"
                    onClick={() => onSelectSubject(subj)}
                  >
                    <span className="ss-card-badge">
                      {sheetCount} level{sheetCount > 1 ? 's' : ''}
                    </span>
                    <div className="ss-card-icon-wrap" aria-hidden>{meta.icon}</div>
                    <div className="ss-card-name">{meta.short}</div>
                    <div className="ss-card-meta">{topicCount} topics</div>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function StatCard({ value, label }) {
  return (
    <div className="ss-stat-card">
      <div className="ss-stat-num">{value === 0 ? '—' : value}</div>
      <div className="ss-stat-lbl">{label}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

// Width hints (percent) for the content columns after the always-grouped
// first column (TOPIC) is hidden. Tuned to the reading priorities: sub-topic
// ~25%, specific competences/outcomes ~45%, the rest (activities / expected
// standard / skills / values) share the remaining ~30%. Applied via
// <colgroup> with table-layout auto, so long content can still stretch a
// column beyond its hint — the numbers steer, they don't clamp.
const COLUMN_WIDTHS = {
  1: [100],
  2: [40, 60],
  3: [25, 45, 30],
  4: [22, 40, 23, 15],
  5: [20, 34, 18, 14, 14],
  6: [18, 30, 15, 13, 12, 12],
}

function columnWidths(totalColumns, showTopicCell) {
  const n = Math.max(totalColumns - 1, 1)
  const base = COLUMN_WIDTHS[n] || Array(n).fill(Math.round(100 / n))
  // When a row filter is active the TOPIC column comes back — give it a
  // slim 10% and scale the rest down proportionally.
  return showTopicCell ? [10, ...base.map(w => w * 0.9)] : base
}

function SubjectDetail({ meta, currentSheet, onSelectSheet, rowFilter, onRowFilter, onBack, era, reading, onToggleReading }) {
  const sheetNames = useMemo(() => Object.keys(meta.sheets), [meta])
  const activeSheetName = sheetNames.includes(currentSheet) ? currentSheet : sheetNames[0]
  const sheet = activeSheetName ? meta.sheets[activeSheetName] : null

  // Resolve which physical column holds the outcomes/competences vs
  // content/skills/values/activities so the cell renderer can split each into
  // independent list items (see renderLegacyCell). Both eras need this: the
  // 2013 books join outcomes in one cell, and the 2023 CBC's ECE sheets do the
  // same with specific competences ("0.1.1.6.1 Name… 0.1.1.6.2 Use…").
  const colRoles = useMemo(
    () => (sheet ? resolveColumnRoles(sheet.columns) : null),
    [sheet],
  )
  const isLegacyEra = era === 'legacy'

  // Recompute the visible rows whenever the sheet or filter changes. Each
  // visible "topic group" is represented by a header row followed by zero or
  // more data rows. Section banners (e.g. "LISTENING AND SPEAKING") are
  // surfaced verbatim.
  const renderedRows = useMemo(() => {
    if (!sheet) return { rows: [], shown: 0 }
    const out = []
    const q = rowFilter.trim().toLowerCase()
    let lastTopic = ''
    let groupOddCounter = 0
    let shown = 0
    let idx = 0
    for (const row of sheet.rows) {
      if (row.type === 'section') {
        out.push({ kind: 'section', key: `s-${idx++}`, label: row.label })
        lastTopic = ''
        groupOddCounter = 0
        continue
      }
      if (row.type !== 'data') continue
      let cellsObj = row.cells || {}
      let shiftedRow = false
      // Both eras: drop repeated column-header rows (KNOWLEDGE/SKILLS/… in
      // 2013, TOPIC/SUB-TOPIC/SPECIFIC COMPETENCES/… in the CBC sheets) —
      // otherwise "TOPIC" even renders as a bogus full-width topic heading.
      if (isHeaderEchoRow(cellsObj)) continue
      // CBC sheets: defensively split a TOPIC cell that glued a topic + its
      // first sub-topic ("1.2.1 COMPREHENSION 1.2.1.1 …") with an empty
      // SUB-TOPIC cell, so the table shows a topic header and a separate
      // sub-topic row even if the source is re-imported malformed. No-op on
      // well-formed cells. (2013 sheets keep their own repair path below.)
      if (!isLegacyEra) {
        const tSplit = splitConcatenatedTopicCell(
          cellsObj.TOPIC, cellsObj['SUB-TOPIC'] || cellsObj.SUBTOPIC,
        )
        if (tSplit.split) {
          cellsObj = { ...cellsObj, TOPIC: tSplit.topic, 'SUB-TOPIC': tSplit.subtopic }
        }
        // Same split one tier down: a SUB-TOPIC cell that glued a sub-topic +
        // its first competence, backfilling an empty competences cell.
        const sSplit = splitConcatenatedTopicCell(
          cellsObj['SUB-TOPIC'] || cellsObj.SUBTOPIC, cellsObj['SPECIFIC COMPETENCES'],
        )
        if (sSplit.split) {
          cellsObj = { ...cellsObj, 'SUB-TOPIC': sSplit.topic, 'SPECIFIC COMPETENCES': sSplit.subtopic }
        }
      }
      if (isLegacyEra && colRoles) {
        // 2013 sheets: re-align page-break rows whose cells shifted left —
        // otherwise outcome text in the TOPIC column renders as a heading.
        const repaired = repairColumnShiftedRow(cellsObj, sheet.columns, colRoles)
        cellsObj = repaired.cells
        shiftedRow = repaired.shifted
      }
      const cells = sheet.columns.map(c => (cellsObj[c] || ''))
      if (q && !cells.some(c => c.toLowerCase().includes(q))) continue

      const prevData = out.length && out[out.length - 1].kind === 'data' ? out[out.length - 1] : null
      // A repaired shifted row is the second half of the previous physical row
      // (split at a PDF page break). A plain continuation row (blank topic +
      // sub-topic + outcomes/competences but carrying activities/content) is
      // the same thing without the column shift — both eras have them. Merge
      // either back into the parent row so the subtopic reads as one row with
      // all its outcomes and full content.
      const structuralIdx = [colRoles?.topic, colRoles?.subtopic, colRoles?.outcomes]
        .map((c) => (c ? sheet.columns.indexOf(c) : -1))
        .filter((i) => i >= 0)
      const isContinuation = colRoles && structuralIdx.length >= 2 &&
        structuralIdx.every((i) => !(cells[i] || '').trim()) &&
        cells.some((v, i) => !structuralIdx.includes(i) && (v || '').trim())
      if ((shiftedRow || isContinuation) && prevData) {
        prevData.cells = prevData.cells.map((v, i) => joinCellText(v, cells[i]))
        continue
      }
      shown++

      const rawTopic = (cells[0] || '').trim()
      if (rawTopic && rawTopic !== lastTopic) {
        out.push({ kind: 'topic', key: `t-${idx++}`, label: rawTopic })
        lastTopic = rawTopic
        groupOddCounter = 0
      }
      groupOddCounter++
      out.push({
        kind: 'data',
        key: `d-${idx++}`,
        cells,
        odd: groupOddCounter % 2 === 0,
        firstInGroup: groupOddCounter === 1,
        rawTopic,
      })
    }
    return { rows: out, shown }
  }, [sheet, rowFilter, colRoles, isLegacyEra])

  if (!sheet) {
    return <p className="ss-empty">No sheet to display.</p>
  }

  const showTopicCell = Boolean(rowFilter.trim())
  const columnCount = sheet.columns.length
  const widths = columnWidths(columnCount, showTopicCell)

  return (
    <div className="ss-detail">
      <button type="button" className="ss-back-btn" onClick={onBack}>
        ← All Subjects
      </button>

      <section className="ss-detail-hero">
        <div className="ss-dh-icon" aria-hidden>{meta.icon}</div>
        <div className="ss-dh-text">
          <h1>{meta.short}</h1>
          <p>
            {sheetNames.length} level{sheetNames.length > 1 ? 's' : ''}
            {sheetNames.length > 0 ? '  ·  ' : ''}
            {sheetNames.join('  ·  ')}
            {era === 'legacy' ? '  ·  2013 Curriculum' : ''}
          </p>
        </div>
      </section>

      {reading && (
        <div className="ss-reading-bar">
          <span className="ss-rb-icon" aria-hidden>{meta.icon}</span>
          <div className="ss-rb-title">
            <strong>{meta.short}</strong>
            <span>{activeSheetName}{era === 'legacy' ? ' · 2013 Curriculum' : ''}</span>
          </div>
          <input
            type="text"
            className="ss-rb-filter"
            placeholder="Filter rows…"
            value={rowFilter}
            onChange={e => onRowFilter(e.target.value)}
          />
          <span className="ss-rb-count">
            {renderedRows.shown} row{renderedRows.shown !== 1 ? 's' : ''}
          </span>
          <button type="button" className="ss-rb-exit" onClick={onToggleReading}>
            ✕ Exit full screen
          </button>
        </div>
      )}

      <div className="ss-tabs-bar">
        <div className="ss-tabs-scroll" role="tablist" aria-label="Levels">
          {sheetNames.map(name => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={name === activeSheetName}
              className={`ss-tab-btn ${name === activeSheetName ? 'is-active' : ''}`}
              onClick={() => onSelectSheet(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ss-fullscreen-btn"
          onClick={onToggleReading}
          title="Full screen reading mode"
        >
          <span aria-hidden>⛶</span>
          <span className="ss-fs-label">Full screen</span>
        </button>
      </div>

      <div className="ss-table-wrap">
        <div className="ss-table-toolbar">
          <input
            type="text"
            className="ss-tbl-search"
            placeholder="Filter rows in this level…"
            value={rowFilter}
            onChange={e => onRowFilter(e.target.value)}
          />
          <span className="ss-row-count">
            {renderedRows.shown} row{renderedRows.shown !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="ss-tbl-container">
          <table className="ss-table">
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {sheet.columns.map((col, i) => {
                  if (i === 0 && !showTopicCell) return null
                  return <th key={col}>{col}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {renderedRows.rows.map(row => {
                if (row.kind === 'section') {
                  return (
                    <tr key={row.key} className="ss-section-row">
                      <td colSpan={showTopicCell ? columnCount : columnCount - 1}>
                        {/* Span sticks horizontally on phones so the banner
                            text stays readable while the table h-scrolls */}
                        <span className="ss-rowlabel">{row.label}</span>
                      </td>
                    </tr>
                  )
                }
                if (row.kind === 'topic') {
                  return (
                    <tr key={row.key} className="ss-topic-header-row">
                      <td colSpan={showTopicCell ? columnCount : columnCount - 1}>
                        <span className="ss-rowlabel">{row.label}</span>
                      </td>
                    </tr>
                  )
                }
                // Data row
                return (
                  <tr key={row.key} className={`ss-data-row ${row.odd ? 'ss-odd-row' : ''}`}>
                    {row.cells.map((val, ci) => {
                      if (ci === 0 && !showTopicCell) return null
                      const className = ci === 0
                        ? 'ss-topic-cell-dim'
                        : ci === 1
                          ? `ss-subtopic-cell ${row.firstInGroup ? 'ss-first-in-group' : ''}`
                          : ci === 2
                            ? 'ss-competences-cell'
                            : ci === 3
                              ? 'ss-activities-cell'
                              : 'ss-standard-cell'
                      const colName = sheet.columns[ci]
                      return (
                        <td key={ci} className={className}>
                          {colRoles
                            ? renderLegacyCell(colName, val, colRoles, rowFilter.trim())
                            : renderCell(val, rowFilter.trim())}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function SearchResults({ query, results, onOpenResult, era }) {
  const isLegacy = era === 'legacy'
  return (
    <div className="ss-search-results">
      <div className="ss-sr-header">
        <h2>
          Search results
          {' '}
          <span className={`ss-era-tag ${isLegacy ? 'is-legacy' : ''}`}>
            {isLegacy ? '2013 Syllabi' : 'Current'}
          </span>
        </h2>
        <p>
          {results.length}{results.length >= 60 ? '+' : ''} levels match
          {' '}&ldquo;<strong>{query}</strong>&rdquo;
        </p>
      </div>
      {results.length === 0 && (
        <p className="ss-sr-empty">No results found.</p>
      )}
      <div className="ss-sr-list">
        {results.map(r => (
          <button
            key={`${r.subj}||${r.sheetName}`}
            type="button"
            className="ss-sri"
            onClick={() => onOpenResult(r.subj, r.sheetName)}
          >
            <span className="ss-sri-icon" aria-hidden>{r.icon}</span>
            <span className="ss-sri-body">
              <span className="ss-sri-title">{r.short}</span>
              <span className="ss-sri-meta">{r.cat} · {r.sheetName}</span>
            </span>
            <span className="ss-pill">{r.count} match{r.count > 1 ? 'es' : ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoped styles — kept inline so the brand colours don't bleed into the rest
// of the app's theming system. Class names all start with `ss-` to avoid
// collisions with the global Tailwind utilities.

function SyllabiStudioStyles() {
  return (
    <style>{`
/* The one rule in this stylesheet that reaches OUTSIDE .ss-root, and it has to:
   the studio is a child of TeacherLayout's .studio-shell, which caps content at
   --studio-shell-max (1600px) for reading-width pages. A syllabus table is the
   opposite of a reading-width page — every capped pixel is a column the teacher
   scrolls to instead of reads. Scoped with :has() so it lifts the cap only while
   this page is mounted; a browser without :has() simply keeps the 1600px cap. */
.studio-shell:has(> .ss-root) { max-width: none; }

.ss-root {
  --ss-cream:  #F2EDE3;
  --ss-cream2: #EBE4D8;
  --ss-teal:   #1B3A4B;
  --ss-orange: #C66E4F;
  --ss-white:  #FFFFFF;
  --ss-text:   #1a1a1a;
  --ss-muted:  #6B6B6B;
  /* --ss-teal does two jobs that pull in opposite directions when the palette
     inverts: it FILLS the header, the chips and the active pills (which stay
     dark in both themes), and it also INKS headings and labels drawn on cream
     (which must go light). One value cannot do both, so the ink half has its
     own token. In this theme they are the same colour, so nothing moves. */
  --ss-ink-strong: var(--ss-teal);
  /* Same split for --ss-orange, for the second reason: it FILLS accent bars,
     the active-tab underline and badges that carry white text, and it also
     INKS the sidebar group labels — where #C66E4F on white measures 3.66:1,
     under the 4.5 a 10px label needs. The ink half is darkened; the fills are
     untouched, so nothing in the layout moves. */
  --ss-accent-ink: #A5522F;
  /* And a third: the same accent as a FILL under white text. #C66E4F carries
     white at 3.66:1 — a 11px bold pill fails. Deepened just enough to clear
     4.5 while staying the same hue, so the chips read as they always did. */
  --ss-orange-solid: #AE5A39;
  --ss-radius: 14px;
  /* Replaced at runtime with the measured height of the chrome above the
     studio (see the effect in SyllabiLibrary). The literal here is only the
     value used for the first paint, before the measurement lands. */
  --ss-vh-offset: 160px;
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: var(--ss-cream);
  color: var(--ss-text);
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - var(--ss-vh-offset));
  /* Edge to edge inside the page shell at every width: cancel the shell's own
     side gutters (px-3 / sm:px-5 / lg:px-8) rather than sitting inside them.
     The gutters are what pushed the header controls and the last table column
     past the clip edge on a laptop. Keep these in step with .studio-shell. */
  margin-left: -0.75rem; margin-right: -0.75rem;
  border: 1.5px solid var(--ss-cream2);
  border-left: none; border-right: none;
  border-radius: 0;
}
@media (min-width: 640px) {
  .ss-root { margin-left: -1.25rem; margin-right: -1.25rem; }
}
@media (min-width: 1024px) {
  .ss-root { margin-left: -2rem; margin-right: -2rem; }
}

.ss-root *, .ss-root *::before, .ss-root *::after { box-sizing: border-box; }
.ss-root mark { background: #FFE082; border-radius: 2px; padding: 0 2px; color: inherit; }
.ss-root .sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}

/* ── HEADER ───────────────────────────────────────────────────────────── */
/* The header sizes to its contents instead of being pinned to 64px. At 64px
   fixed, a squeezed logo block wrapped to two lines and was then clipped top
   and bottom by the root's overflow:hidden — the title read as a cut-off
   "Syllabi / Studio". Wrapping is allowed too, so the search moves onto its
   own row rather than off the right edge. */
.ss-root .ss-header {
  min-height: 64px;
  background: var(--ss-teal);
  color: white;
  display: flex; align-items: center; flex-wrap: wrap;
  padding: 10px 24px; gap: 10px 16px;
  flex-shrink: 0; z-index: 5;
}
.ss-root .ss-logo-mark {
  width: 36px; height: 36px;
  background: var(--ss-orange); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; flex-shrink: 0;
}
/* Title + subtitle shrink to an ellipsis before they ever wrap — a second
   line is what overflowed the header, and a truncated subtitle costs nothing
   (the same words are on the hero below). */
.ss-root .ss-logo-text-wrap {
  display: flex; flex-direction: column; line-height: 1.15;
  min-width: 0; flex: 0 1 auto;
}
.ss-root .ss-logo-text {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 20px; font-weight: 700;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ss-root .ss-logo-sub {
  font-size: 12px; opacity: 0.6;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* Inert: the search's own margin-left:auto does the pushing now, so spare
   width goes to the search box (up to its max) instead of to empty space. */
.ss-root .ss-spacer { flex: 0 0 0; min-width: 0; }
/* Flexible, not a fixed 280px: the input used to keep its width while its
   wrapper shrank, so the right-hand end of the search box was clipped off. */
.ss-root .ss-search-wrap {
  position: relative; display: flex;
  flex: 1 1 180px; min-width: 140px; max-width: 340px;
  margin-left: auto;
}
.ss-root .ss-search-box {
  background: rgba(255,255,255,0.12);
  border: 1.5px solid rgba(255,255,255,0.25);
  border-radius: 8px;
  color: white;
  padding: 8px 14px 8px 36px;
  font-size: 14px;
  width: 100%; min-width: 0;
  outline: none;
  font-family: inherit;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='rgba(255,255,255,0.5)' viewBox='0 0 16 16'%3E%3Cpath d='M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: 12px center;
  transition: background 0.2s, border-color 0.2s;
}
.ss-root .ss-search-box::placeholder { color: rgba(255,255,255,0.5); }
.ss-root .ss-search-box:focus { background-color: rgba(255,255,255,0.2); border-color: rgba(255,255,255,0.5); }
.ss-root .ss-search-box:disabled { opacity: 0.55; cursor: not-allowed; }

/* Hamburger — opens the subject panel on screens where the sidebar column
   is hidden. Shown via the responsive rules at the bottom. */
.ss-root .ss-menu-btn {
  display: none;
  width: 36px; height: 36px;
  align-items: center; justify-content: center;
  background: rgba(255,255,255,0.12);
  border: 1.5px solid rgba(255,255,255,0.25);
  border-radius: 8px;
  color: white; font-size: 16px;
  cursor: pointer; flex-shrink: 0;
  font-family: inherit;
}
.ss-root .ss-menu-btn:disabled { opacity: 0.55; cursor: not-allowed; }

/* ── LAYOUT (sidebar + main) ───────────────────────────────────────────── */
.ss-root .ss-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ── SIDEBAR ──────────────────────────────────────────────────────────── */
.ss-root .ss-sidebar {
  width: 260px;
  background: var(--ss-white);
  border-right: 1.5px solid var(--ss-cream2);
  display: flex; flex-direction: column;
  flex-shrink: 0;
  padding: 16px 0 24px;
  overflow-y: auto;
  max-height: calc(100dvh - var(--ss-vh-offset));
  position: sticky;
  top: 0;
}
.ss-root .ss-sidebar-placeholder {
  padding: 16px 20px;
  font-size: 12px; color: var(--ss-muted);
}
.ss-root .ss-sb-group { margin-bottom: 6px; }
.ss-root .ss-sb-label {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 20px 6px;
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.2px;
  color: var(--ss-accent-ink);
}
.ss-root .ss-sb-label::before {
  content: ''; display: inline-block;
  width: 18px; height: 2px;
  background: var(--ss-orange); border-radius: 2px;
}
.ss-root .ss-nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 20px;
  font-size: 13.5px;
  cursor: pointer;
  color: var(--ss-text);
  border-left: 3px solid transparent;
  background: transparent;
  border-top: none; border-right: none; border-bottom: none;
  width: 100%;
  text-align: left;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ss-root .ss-nav-item:hover { background: var(--ss-cream); }
.ss-root .ss-nav-item.is-active {
  background: var(--ss-cream);
  border-left-color: var(--ss-orange);
  font-weight: 600;
  color: var(--ss-ink-strong);
}
.ss-root .ss-nav-icon { font-size: 15px; flex-shrink: 0; }

/* ── SIDEBAR MODES: icon rail + slide-out panel ───────────────────────── */
/* Reading comes first: once a subject is open the sidebar auto-collapses
   to a slim icon rail (≥701px) so the syllabus table takes ~85–90% of the
   width. The » toggle or any hamburger opens the full panel as an overlay
   — it never squeezes the table again. */
.ss-root .ss-panel-head {
  display: none;
  align-items: center; justify-content: space-between;
  padding: 14px 20px 8px;
  font-size: 14px; font-weight: 800;
  color: var(--ss-ink-strong);
}
.ss-root .ss-panel-close {
  width: 30px; height: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--ss-cream);
  border: 1.5px solid var(--ss-cream2);
  border-radius: 8px;
  color: var(--ss-ink-strong); font-size: 13px;
  cursor: pointer; font-family: inherit;
}
.ss-root .ss-rail-toggle {
  display: none;
  width: 34px; height: 34px;
  margin: 0 auto 6px;
  align-items: center; justify-content: center;
  background: var(--ss-white);
  border: 1.5px solid var(--ss-cream2);
  border-radius: 8px;
  color: var(--ss-ink-strong); font-size: 15px; font-weight: 700;
  cursor: pointer; font-family: inherit;
  transition: background 0.15s;
}
.ss-root .ss-rail-toggle:hover { background: var(--ss-cream); }

@media (min-width: 701px) {
  .ss-root[data-view="subject"] .ss-sidebar:not(.is-open) {
    display: flex;
    width: 64px;
    padding: 10px 0 18px;
  }
  .ss-root[data-view="subject"] .ss-sidebar:not(.is-open) .ss-rail-toggle { display: inline-flex; }
  .ss-root[data-view="subject"] .ss-sidebar:not(.is-open) .ss-sb-label {
    /* Category names collapse to their orange dash — a quiet group divider. */
    font-size: 0;
    justify-content: center;
    padding: 10px 0 4px;
  }
  .ss-root[data-view="subject"] .ss-sidebar:not(.is-open) .ss-nav-item {
    justify-content: center;
    padding: 10px 4px;
  }
  .ss-root[data-view="subject"] .ss-sidebar:not(.is-open) .ss-nav-text { display: none; }
  .ss-root[data-view="subject"] .ss-sidebar:not(.is-open) .ss-nav-icon { font-size: 18px; }
  /* Tighter main padding in subject view — the table is the page. */
  .ss-root[data-view="subject"] .ss-main { padding: 22px 24px; }
}

/* Slide-out panel — shared by the phone drawer and the expanded rail. */
.ss-root .ss-sidebar.is-open {
  display: flex;
  position: fixed;
  top: 0; left: 0; bottom: 0;
  width: min(320px, 86vw);
  max-height: none;
  z-index: 80;
  border-right: none;
  box-shadow: 12px 0 40px rgba(15,23,42,0.28);
  animation: ssSlideIn 0.22s ease;
  padding-top: calc(8px + env(safe-area-inset-top, 0px));
}
.ss-root .ss-sidebar.is-open .ss-panel-head { display: flex; }
@keyframes ssSlideIn {
  from { transform: translateX(-48px); opacity: 0.4; }
  to   { transform: none; opacity: 1; }
}
.ss-root .ss-backdrop {
  position: fixed; inset: 0;
  background: rgba(15,23,42,0.45);
  z-index: 79;
}

/* ── MAIN ─────────────────────────────────────────────────────────────── */
.ss-root .ss-main {
  flex: 1;
  min-width: 0;
  padding: 28px 32px;
  overflow-y: auto;
  max-height: calc(100dvh - var(--ss-vh-offset));
}

.ss-root .ss-loading,
.ss-root .ss-error {
  background: var(--ss-white);
  border: 1.5px solid var(--ss-cream2);
  border-radius: var(--ss-radius);
  padding: 24px;
  text-align: center;
  color: var(--ss-muted);
}
.ss-root .ss-loading-dot {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--ss-orange);
  margin: 0 auto 10px;
  animation: ssPulse 1.1s ease-in-out infinite;
}
@keyframes ssPulse {
  0%,100% { transform: scale(0.7); opacity: 0.5; }
  50%     { transform: scale(1.1); opacity: 1; }
}
.ss-root .ss-error-title { font-weight: 700; color: #B7331C; margin-bottom: 4px; }
.ss-root .ss-error-detail { font-size: 13px; }

.ss-root .ss-empty { color: var(--ss-muted); font-size: 14px; padding: 24px; }

/* ── HOME — HERO ─────────────────────────────────────────────────────── */
.ss-root .ss-hero {
  background: var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 28px 32px;
  color: white;
  margin-bottom: 28px;
  display: flex; align-items: center; gap: 20px;
}
.ss-root .ss-hero-label {
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.2px;
  color: var(--ss-accent-ink);
  margin-bottom: 8px;
}
.ss-root .ss-hero-title {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 30px; font-weight: 900; line-height: 1.1;
  margin: 0 0 6px;
}
.ss-root .ss-hero-blurb { font-size: 14px; opacity: 0.8; margin: 0; }
.ss-root .ss-hero-emoji { font-size: 56px; margin-left: auto; }

/* ── HOME — STATS ─────────────────────────────────────────────────────── */
.ss-root .ss-stats-row {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 32px;
}
.ss-root .ss-stat-card {
  background: var(--ss-white);
  border: 1.5px solid var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 16px 18px;
  border-left: 4px solid var(--ss-orange);
}
.ss-root .ss-stat-num {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 28px; font-weight: 900;
  color: var(--ss-ink-strong);
}
.ss-root .ss-stat-lbl {
  font-size: 11px; color: var(--ss-muted);
  text-transform: uppercase; letter-spacing: 0.8px;
  font-weight: 600;
  margin-top: 2px;
}

/* ── HOME — SECTIONS + CARDS ─────────────────────────────────────────── */
.ss-root .ss-cat-section { margin-bottom: 36px; }
.ss-root .ss-section-heading {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 16px;
  margin-top: 8px;
}
.ss-root .ss-sh-dash {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.2px;
  color: var(--ss-accent-ink);
}
.ss-root .ss-sh-dash::before {
  content: ''; display: inline-block;
  width: 22px; height: 2.5px;
  background: var(--ss-orange); border-radius: 2px;
}
.ss-root .ss-sh-title {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 22px; font-weight: 900;
  color: var(--ss-ink-strong);
  margin: 0;
}

.ss-root .ss-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 14px;
}
.ss-root .ss-subj-card {
  background: var(--ss-white);
  border: 1.5px solid var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 20px 18px 16px;
  cursor: pointer;
  position: relative;
  transition: transform 0.15s, box-shadow 0.15s;
  text-align: left;
  font-family: inherit;
  color: inherit;
  width: 100%;
}
.ss-root .ss-subj-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(27,58,75,0.13);
}
.ss-root .ss-card-icon-wrap {
  width: 48px; height: 48px;
  background: var(--ss-cream);
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 24px;
  margin-bottom: 12px;
}
.ss-root .ss-card-name {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 15px; font-weight: 700;
  color: var(--ss-ink-strong);
  line-height: 1.3;
  margin-bottom: 6px;
}
.ss-root .ss-card-meta { font-size: 12px; color: var(--ss-muted); }
.ss-root .ss-card-badge {
  position: absolute; top: 14px; right: 14px;
  background: var(--ss-teal); color: white;
  font-size: 10px; font-weight: 700;
  padding: 3px 8px; border-radius: 20px;
}

/* ── DETAIL ──────────────────────────────────────────────────────────── */
.ss-root .ss-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px;
  background: var(--ss-white);
  border: 1.5px solid var(--ss-teal);
  border-radius: 8px;
  font-size: 13px; cursor: pointer;
  color: var(--ss-ink-strong); font-weight: 600;
  margin-bottom: 20px;
  font-family: inherit;
  transition: background 0.15s;
}
.ss-root .ss-back-btn:hover { background: var(--ss-cream); }

.ss-root .ss-detail-hero {
  background: var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 22px 28px;
  color: white;
  margin-bottom: 20px;
  display: flex; align-items: center; gap: 18px;
}
.ss-root .ss-dh-icon {
  width: 56px; height: 56px;
  background: rgba(255,255,255,0.15);
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 30px;
  flex-shrink: 0;
}
.ss-root .ss-dh-text h1 {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 22px; font-weight: 900;
  margin: 0 0 4px;
}
.ss-root .ss-dh-text p { font-size: 13px; opacity: 0.75; margin: 0; }

/* Grade tabs stay pinned while the teacher scrolls the syllabus. The bar is
   sticky against ss-main's scrollport on wide screens; on narrow screens the
   page body scrolls instead, so the offset clears the fixed glass header. */
.ss-root .ss-tabs-bar {
  position: sticky; top: 0; z-index: 15;
  display: flex; align-items: center; gap: 10px;
  background: var(--ss-cream);
  padding: 10px 0;
  margin-bottom: 12px;
}
.ss-root .ss-tabs-scroll {
  display: flex; gap: 6px; flex-wrap: wrap;
  flex: 1; min-width: 0;
}
.ss-root .ss-fullscreen-btn {
  display: inline-flex; align-items: center; gap: 6px;
  margin-left: auto; flex-shrink: 0;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1.5px solid var(--ss-teal);
  background: var(--ss-white);
  color: var(--ss-ink-strong);
  font-weight: 700; font-size: 12.5px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}
.ss-root .ss-fullscreen-btn:hover { background: var(--ss-cream); }
.ss-root .ss-tab-btn {
  padding: 8px 18px;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  border-radius: 8px;
  border: 1.5px solid var(--ss-teal);
  background: var(--ss-white);
  color: var(--ss-ink-strong);
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.ss-root .ss-tab-btn:hover { background: var(--ss-cream); }
.ss-root .ss-tab-btn.is-active {
  background: var(--ss-teal);
  color: white;
  border-color: var(--ss-teal);
}

/* ── TABLE ───────────────────────────────────────────────────────────── */
.ss-root .ss-table-wrap {
  background: var(--ss-white);
  border: 2px solid var(--ss-teal);
  border-radius: var(--ss-radius);
  overflow: hidden;
}
.ss-root .ss-table-toolbar {
  padding: 12px 18px;
  display: flex; align-items: center; gap: 12px;
  background: var(--ss-cream2);
  border-bottom: 2px solid var(--ss-teal);
}
.ss-root .ss-tbl-search {
  padding: 7px 14px;
  border: 1.5px solid var(--ss-teal);
  border-radius: 8px;
  font-size: 13px;
  flex: 0 1 260px; min-width: 0;
  outline: none;
  font-family: inherit;
  background: white;
  color: var(--ss-text);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ss-root .ss-tbl-search:focus {
  border-color: var(--ss-orange);
  box-shadow: 0 0 0 2px rgba(198,110,79,0.15);
}
.ss-root .ss-row-count {
  font-size: 12px; color: var(--ss-muted);
  margin-left: auto; font-weight: 600;
}

.ss-root .ss-tbl-container {
  overflow-x: auto;
  /* The studio's own chrome above the table (back button, subject hero, grade
     tabs, toolbar) is ~180px; the rest of the subtraction is the page chrome
     the studio measured for itself, so this tracks the real viewport. */
  max-height: calc(100dvh - var(--ss-vh-offset) - 180px);
  min-height: 280px;
}
.ss-root .ss-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
}
.ss-root .ss-table thead th {
  background: var(--ss-teal);
  color: white;
  padding: 12px 16px;
  text-align: left;
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  /* Headings wrap. They used to be nowrap, which set the table's minimum width
     to the sum of "SPECIFIC COMPETENCES" + "LEARNING ACTIVITIES" + "EXPECTED
     STANDARD" laid out on one line each — wider than a laptop column, so the
     last heading was always cut off at the edge no matter how much room the
     rows themselves needed. Two-line headings cost one row of height once. */
  white-space: normal;
  overflow-wrap: break-word;
  position: sticky; top: 0; z-index: 10;
  border-right: 1px solid rgba(255,255,255,0.15);
}
.ss-root .ss-table thead th:last-child { border-right: none; }

.ss-root .ss-section-row td {
  background: var(--ss-teal);
  color: white;
  font-weight: 700;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 10px 16px;
  border: none;
}
.ss-root .ss-topic-header-row td {
  background: #D4E4EC;
  color: var(--ss-ink-strong);
  font-weight: 800;
  font-size: 15px;
  padding: 11px 16px;
  border-top: 2.5px solid var(--ss-teal);
  border-bottom: 1.5px solid #9BBECE;
  letter-spacing: 0.2px;
  border-left: 4px solid var(--ss-orange);
}

.ss-root .ss-data-row { border-bottom: 1px solid #E8E0D4; }
.ss-root .ss-data-row:last-child { border-bottom: none; }
.ss-root .ss-data-row:hover { background: #FBF8F3; }
.ss-root .ss-data-row.ss-odd-row { background: #FAFAF8; }
.ss-root .ss-data-row.ss-odd-row:hover { background: #F5F2EC; }

.ss-root .ss-table td {
  padding: 11px 16px;
  vertical-align: top;
  line-height: 1.55;
  border-right: 1px solid #EDE7DB;
  overflow-wrap: break-word;
}
.ss-root .ss-table td:last-child { border-right: none; }

/* Column proportions come from the <colgroup> width hints (≈25% sub-topic /
   45% competences / 30% for the rest) — no hard min-widths, so the table
   always fits the available width and text wraps instead of forcing a
   horizontal scroll. */
.ss-root .ss-topic-cell-dim { opacity: 0.45; font-size: 12px; }
.ss-root .ss-subtopic-cell {
  font-weight: 600; color: var(--ss-ink-strong);
  border-left: 3px solid transparent;
}
.ss-root .ss-subtopic-cell.ss-first-in-group { border-left-color: #9BBECE; }
.ss-root .ss-standard-cell {
  color: #555;
  font-style: italic;
  font-size: 14px;
}
.ss-root .ss-table td ul { padding-left: 16px; margin: 3px 0; }
.ss-root .ss-table td ul li { margin: 4px 0; }

/* 2013 curriculum: each specific outcome is its own list item with its code
   badged, so joined outcomes never render as one blob or a false heading. */
.ss-root .ss-outcome-list { list-style: none; padding-left: 0; margin: 2px 0; }
.ss-root .ss-outcome-list li {
  margin: 6px 0; padding-left: 0; line-height: 1.4;
}
.ss-root .ss-outcome-code {
  display: inline-block;
  font-weight: 700; color: var(--ss-ink-strong);
  font-variant-numeric: tabular-nums;
  margin-right: 4px;
}

/* ── SEARCH RESULTS ──────────────────────────────────────────────────── */
.ss-root .ss-search-results .ss-sr-header { margin-bottom: 20px; }
.ss-root .ss-sr-header h2 {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 24px; font-weight: 900;
  color: var(--ss-ink-strong);
  margin: 0 0 4px;
}
.ss-root .ss-sr-header p { font-size: 13px; color: var(--ss-muted); margin: 0; }
.ss-root .ss-sr-empty { font-size: 14px; color: var(--ss-muted); }
.ss-root .ss-sr-list { display: flex; flex-direction: column; gap: 10px; }
.ss-root .ss-sri {
  background: var(--ss-white);
  border: 1.5px solid var(--ss-teal);
  border-radius: var(--ss-radius);
  padding: 14px 18px;
  cursor: pointer;
  display: flex; align-items: center; gap: 14px;
  transition: box-shadow 0.15s, transform 0.1s;
  font-family: inherit;
  text-align: left;
  width: 100%;
  color: inherit;
}
.ss-root .ss-sri:hover {
  box-shadow: 0 4px 16px rgba(27,58,75,0.12);
  transform: translateY(-1px);
}
.ss-root .ss-sri-icon {
  width: 40px; height: 40px;
  background: var(--ss-cream);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}
.ss-root .ss-sri-body { flex: 1; display: flex; flex-direction: column; }
.ss-root .ss-sri-title { font-size: 14px; font-weight: 700; color: var(--ss-ink-strong); margin-bottom: 2px; }
.ss-root .ss-sri-meta { font-size: 12px; color: var(--ss-muted); }
.ss-root .ss-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px; font-weight: 700;
  background: var(--ss-orange-solid); color: white;
}

/* ── ERA SWITCHER ────────────────────────────────────────────────────── */
.ss-root .ss-era-switcher {
  display: inline-flex;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid rgba(255,255,255,0.3);
  flex-shrink: 0;
}
.ss-root .ss-era-btn {
  padding: 6px 16px;
  font-size: 12px; font-weight: 700;
  cursor: pointer;
  border: none;
  background: transparent;
  color: rgba(255,255,255,0.65);
  font-family: inherit;
  letter-spacing: 0.3px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.ss-root .ss-era-btn:hover { background: rgba(255,255,255,0.1); color: white; }
.ss-root .ss-era-btn.is-active { background: var(--ss-orange-solid); color: white; }
.ss-root .ss-era-btn.is-active.is-legacy { background: #8A6408; }

/* ── ERA SWITCHER IN SLIDE-OUT PANEL ─────────────────────────────────── */
/* Hidden outside the panel; visible only when the slide-out is open.
   Gives phone users access to the 2013 curriculum era that the header
   switcher hides at ≤700px. */
.ss-root .ss-panel-era-switch {
  display: none;
  margin: 0 20px 10px;
  border-radius: 10px;
  overflow: hidden;
  border: 1.5px solid var(--ss-cream2);
}
.ss-root .ss-sidebar.is-open .ss-panel-era-switch { display: flex; }
.ss-root .ss-panel-era-btn {
  flex: 1;
  padding: 7px 10px;
  font-size: 12px; font-weight: 700;
  cursor: pointer;
  border: none;
  background: var(--ss-white);
  color: var(--ss-muted);
  font-family: inherit;
  text-align: center;
  transition: background 0.15s, color 0.15s;
}
.ss-root .ss-panel-era-btn:hover { background: var(--ss-cream); color: var(--ss-ink-strong); }
.ss-root .ss-panel-era-btn.is-active { background: var(--ss-orange-solid); color: white; }
.ss-root .ss-panel-era-btn.is-active.is-legacy { background: #8A6408; }

.ss-root .ss-era-tag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px; font-weight: 700;
  background: var(--ss-orange-solid); color: white;
  vertical-align: middle;
  margin-left: 6px;
}
.ss-root .ss-era-tag.is-legacy { background: #8A6408; }

/* ── LEGACY (2013) PALETTE OVERRIDES ─────────────────────────────────── */
/* Swap the warm-teal/orange brand for a warm-amber palette so teachers
   immediately see they're reading the retired 2013 syllabi. */
.ss-root.is-legacy {
  --ss-orange: #B8860B;          /* primary accent */
  --ss-accent-ink: #7C5A07;       /* the ink half — #B8860B is 2.5:1 on white */
  --ss-orange-solid: #8A6408;     /* white on #B8860B is 3.25:1 */
  --ss-teal:   #6B4C00;           /* deep brown for hero + table chrome */
  --ss-cream:  #FFF8E1;           /* hover/background tint */
  --ss-cream2: #F5EBC9;           /* toolbar tint */
}
.ss-root.is-legacy .ss-hero {
  background: linear-gradient(135deg, #3d2b00, #6b4c00);
}
.ss-root.is-legacy .ss-detail-hero {
  background: linear-gradient(135deg, #3d2b00, #6b4c00);
}
.ss-root.is-legacy .ss-topic-header-row td {
  background: #FFF8E1;
  color: #5D4000;
  border-top-color: #8B6914;
  border-bottom-color: #D4A017;
}
.ss-root.is-legacy .ss-topic-header-row td:first-child {
  border-left-color: #B8860B;
}
.ss-root.is-legacy .ss-hero-blurb,
.ss-root.is-legacy .ss-dh-text p { opacity: 0.85; }

/* ── FULL SCREEN READING MODE ────────────────────────────────────────── */
/* The studio takes over the whole viewport: no app shell, no studio header
   or search bar, no sidebar — just the reading bar, sticky grade tabs and
   the syllabus table. z-index clears the teacher glass header (z-40) and
   its dropdowns (z-50). */
.ss-root.is-reading {
  position: fixed; inset: 0;
  z-index: 90;
  margin: 0;
  height: 100dvh;
  min-height: 0;
  border: none; border-radius: 0;
}
.ss-root.is-reading .ss-header,
.ss-root.is-reading .ss-sidebar,
.ss-root.is-reading .ss-backdrop,
.ss-root.is-reading .ss-back-btn,
.ss-root.is-reading .ss-detail-hero,
.ss-root.is-reading .ss-table-toolbar,
.ss-root.is-reading .ss-fullscreen-btn { display: none; }
.ss-root.is-reading .ss-layout { height: 100%; min-height: 0; }
.ss-root.is-reading .ss-main {
  max-height: none; height: 100%;
  padding: 0;
  overflow: hidden;
  display: flex; flex-direction: column;
}
.ss-root.is-reading .ss-detail {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
}
.ss-root.is-reading .ss-tabs-bar {
  position: static;
  margin: 0; padding: 8px 16px;
  border-bottom: 1.5px solid var(--ss-cream2);
  flex-shrink: 0;
}
.ss-root.is-reading .ss-tabs-scroll {
  flex-wrap: nowrap; overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
/* A tab in a scrolling row must keep its size — the default flex-shrink
   squashed "3-4 Years - Pre-Maths & Science" into a four-line sliver instead
   of letting the row scroll. */
.ss-root.is-reading .ss-tabs-scroll .ss-tab-btn { flex: 0 0 auto; white-space: nowrap; }
.ss-root.is-reading .ss-table-wrap {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  border: none; border-radius: 0;
  border-top: 2px solid var(--ss-teal);
}
.ss-root.is-reading .ss-tbl-container {
  flex: 1;
  max-height: none; min-height: 0;
}

.ss-root .ss-reading-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px;
  padding-top: calc(10px + env(safe-area-inset-top, 0px));
  background: var(--ss-teal);
  color: white;
  flex-shrink: 0;
}
.ss-root .ss-rb-icon {
  width: 32px; height: 32px;
  background: var(--ss-orange);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; flex-shrink: 0;
}
.ss-root .ss-rb-title { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.ss-root .ss-rb-title strong {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 15px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ss-root .ss-rb-title span { font-size: 11px; opacity: 0.65; white-space: nowrap; }
.ss-root .ss-rb-filter {
  margin-left: auto;
  width: 200px;
  padding: 7px 12px;
  background: rgba(255,255,255,0.12);
  border: 1.5px solid rgba(255,255,255,0.25);
  border-radius: 8px;
  color: white; font-size: 13px;
  outline: none; font-family: inherit;
}
.ss-root .ss-rb-filter::placeholder { color: rgba(255,255,255,0.5); }
.ss-root .ss-rb-filter:focus { background: rgba(255,255,255,0.2); border-color: rgba(255,255,255,0.5); }
.ss-root .ss-rb-count { font-size: 11px; opacity: 0.7; white-space: nowrap; }
.ss-root .ss-rb-exit {
  flex-shrink: 0;
  padding: 7px 12px;
  background: rgba(255,255,255,0.1);
  border: 1.5px solid rgba(255,255,255,0.4);
  border-radius: 8px;
  color: white; font-weight: 700; font-size: 12px;
  cursor: pointer; font-family: inherit;
  transition: background 0.15s;
}
.ss-root .ss-rb-exit:hover { background: rgba(255,255,255,0.22); }

/* ── RESPONSIVE ──────────────────────────────────────────────────────── */
/* 1300, not 1100: the studio never gets the whole viewport on desktop — the
   teacher sidebar takes ~260px of it — so the era switcher has to go compact
   while the window still looks wide, or it eats the search box's room. */
@media (max-width: 1300px) {
  .ss-root .ss-era-btn { padding: 6px 12px; font-size: 11px; }
}
@media (max-width: 900px) {
  .ss-root .ss-sidebar { display: none; }
  .ss-root .ss-menu-btn { display: inline-flex; }
  .ss-root .ss-main { padding: 20px 18px; max-height: none; }
  /* Body scrolls here — keep the grade tabs pinned below the fixed glass
     header (5rem tall on mobile/tablet). */
  .ss-root:not(.is-reading) .ss-tabs-bar { top: calc(5rem + env(safe-area-inset-top, 0px)); }
  .ss-root .ss-tbl-container { max-height: calc(100dvh - 15rem); }
  .ss-root .ss-stats-row { grid-template-columns: repeat(2, 1fr); }
  .ss-root .ss-hero { padding: 20px 22px; }
  .ss-root .ss-hero-title { font-size: 24px; }
  .ss-root .ss-hero-emoji { font-size: 40px; }
  .ss-root .ss-search-wrap { flex-basis: 180px; max-width: 260px; }
  .ss-root .ss-era-btn { padding: 5px 10px; font-size: 10.5px; }
}
/* 701–900px in subject view: the icon rail is on screen, so the hamburger
   would be redundant. */
@media (min-width: 701px) and (max-width: 900px) {
  .ss-root[data-view="subject"] .ss-menu-btn { display: none; }
  /* The rail rides below the fixed glass header while the body scrolls. */
  .ss-root[data-view="subject"] .ss-sidebar:not(.is-open) {
    top: calc(5rem + env(safe-area-inset-top, 0px));
    max-height: calc(100dvh - 6rem);
  }
}
@media (max-width: 700px) {
  .ss-root .ss-era-switcher { display: none; }
  .ss-root[data-view="subject"]:not(.is-reading) .ss-main { padding: 14px 10px; }
  /* Phone: auto layout + the phone reading-column widths below — SUB-TOPIC
     (~35%) and SPECIFIC COMPETENCES (~58%) fill the first screen; the
     remaining columns are reached by horizontal scroll with the first
     column pinned. The colgroup percentage hints are neutralised here
     (inline styles need the !important) so they don't fight the vw widths. */
  .ss-root .ss-table { table-layout: auto; font-size: 13.5px; }
  .ss-root .ss-table col { width: auto !important; }
  .ss-root .ss-table thead th { white-space: normal; padding: 10px 10px; }
  .ss-root .ss-table td { padding: 9px 10px; }
  .ss-root .ss-tabs-scroll {
    flex-wrap: nowrap; overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .ss-root .ss-tabs-scroll::-webkit-scrollbar { display: none; }
  /* See the reading-mode twin above: keep each tab its natural width and let
     the row scroll, rather than shrinking every tab to fit. */
  .ss-root .ss-tabs-scroll .ss-tab-btn { flex: 0 0 auto; white-space: nowrap; }
  .ss-root .ss-fs-label { display: none; }
  .ss-root .ss-fullscreen-btn { padding: 8px 10px; }
  .ss-root .ss-rb-filter, .ss-root .ss-rb-count { display: none; }
}
@media (max-width: 560px) {
  .ss-root .ss-stats-row { grid-template-columns: 1fr 1fr; }
  .ss-root .ss-header { padding: 8px 12px; gap: 8px 10px; }
  /* Phone: the search takes the full second row rather than a 130px stub
     squeezed in beside the logo. */
  .ss-root .ss-search-wrap {
    flex: 1 1 100%; max-width: none; min-width: 0; margin-left: 0;
  }
  .ss-root .ss-search-box { padding-left: 32px; }
  .ss-root .ss-logo-sub { display: none; }
}

/* ── PHONE READING COLUMNS + PINNED SUB-TOPIC ────────────────────────── */
/* Kept after the blocks above so these win the cascade at equal
   specificity. SUB-TOPIC gets ~35% of the screen and SPECIFIC COMPETENCES
   ~58%; LEARNING ACTIVITIES / EXPECTED STANDARD overflow into a horizontal
   scroll with the first visible column pinned, so the teacher never loses
   the current sub-topic. */
@media (max-width: 700px) {
  .ss-root .ss-subtopic-cell    { width: 35vw; min-width: 35vw; max-width: 35vw; }
  .ss-root .ss-competences-cell { min-width: 58vw; }
  .ss-root .ss-activities-cell  { min-width: 240px; max-width: 300px; }
  .ss-root .ss-standard-cell    { min-width: 180px; }
  /* When the row filter shows TOPIC it becomes the pinned column — it can't
     keep element opacity while sticky (its bg would go translucent), so
     emulate the dimming with a muted text colour instead. */
  .ss-root .ss-table td.ss-topic-cell-dim {
    width: 30vw; min-width: 30vw;
    opacity: 1; color: rgba(26,26,26,0.55);
  }

  /* Pinned first visible column (hidden TOPIC cells aren't rendered, so
     :first-child is always the first visible one). Banner rows are excluded
     — their full-width colSpan cells keep their own backgrounds and stick
     their label text instead (below). Opaque per-row-state backgrounds stop
     scrolled content bleeding through; the tints mirror the tr backgrounds
     above, which are era-independent. */
  .ss-root .ss-table thead th:first-child,
  .ss-root .ss-data-row td:first-child { position: sticky; left: 0; }
  /* Above the sticky thead (z-10) at the corner; keeps top:0 from the base rule */
  .ss-root .ss-table thead th:first-child { z-index: 12; }
  .ss-root .ss-data-row td:first-child {
    z-index: 5; background: var(--ss-white);
    /* border-collapse tables paint tr borders in the table layer, which
       doesn't travel with sticky cells (and sits under their opaque bg) —
       redraw the row separator with an inset shadow that moves with the cell */
    box-shadow: inset 0 -1px 0 #E8E0D4;
  }
  /* same for the group-start accent that normally comes from border-left */
  .ss-root .ss-data-row td.ss-subtopic-cell.ss-first-in-group:first-child {
    box-shadow: inset 3px 0 0 #9BBECE, inset 0 -1px 0 #E8E0D4;
  }
  .ss-root .ss-data-row.ss-odd-row td:first-child { background: #FAFAF8; }
  .ss-root .ss-data-row:hover td:first-child { background: #FBF8F3; }
  .ss-root .ss-data-row.ss-odd-row:hover td:first-child { background: #F5F2EC; }
  /* seam shadow at the pinned edge */
  .ss-root .ss-table thead th:first-child::after,
  .ss-root .ss-data-row td:first-child::after {
    content: ''; position: absolute; top: 0; right: -6px; bottom: 0; width: 6px;
    pointer-events: none;
    background: linear-gradient(to right, rgba(15,23,42,0.10), transparent);
  }

  /* Section/topic banner labels stay readable during horizontal scroll: the
     colSpan td scrolls, the label inside sticks. */
  .ss-root .ss-section-row td .ss-rowlabel,
  .ss-root .ss-topic-header-row td .ss-rowlabel {
    display: inline-block; position: sticky; left: 10px;
    max-width: calc(100vw - 56px);
  }

  /* Compact subject card (~100px → ~68px ≈ 30% shorter) so more of the
     syllabus is visible without scrolling. */
  .ss-root .ss-detail-hero { padding: 12px 14px; gap: 12px; margin-bottom: 12px; border-radius: 12px; }
  .ss-root .ss-dh-icon { width: 40px; height: 40px; font-size: 22px; border-radius: 10px; }
  .ss-root .ss-dh-text h1 { font-size: 17px; margin-bottom: 2px; }
  .ss-root .ss-dh-text p { font-size: 11.5px; line-height: 1.4; }
  .ss-root .ss-back-btn { margin-bottom: 12px; }

  /* Toolbar: the filter input grows to fill the phone width */
  .ss-root .ss-table-toolbar { padding: 10px; gap: 8px; }
  .ss-root .ss-tbl-search { flex: 1 1 120px; }
}

/* Reading mode owns the viewport; body overflow:hidden alone doesn't stop
   iOS touch scroll-chaining, so contain edge swipes at the scroller. */
.ss-root.is-reading .ss-tbl-container { overscroll-behavior: contain; }

/* ── NIGHT THEME ─────────────────────────────────────────────────────── */
/* This studio paints itself from its own six tokens rather than the
   workspace ones, so a teacher on Night got the one page in /teacher still
   at full cream brightness. Restating the tokens is most of the fix; the
   rules below it are the places the stylesheet reached past them for a
   literal. Kept LAST in the sheet so it wins the cascade against the
   .is-legacy palette, which sits at the same specificity.

   --ss-teal deliberately keeps a dark value: it FILLS the header, the
   section rows, the active tab and the reading bar, all of which are dark
   in both themes and carry white text. Ink that was drawn IN teal reads
   --ss-ink-strong and inverts (see the base block). */
[data-theme='night'] .ss-root,
[data-theme='night'] .ss-root.is-legacy {
  --ss-cream:  #1A222E;
  --ss-cream2: #3B4757;
  --ss-teal:   #16303F;
  --ss-orange: #D9784F;
  --ss-white:  #232D3B;
  --ss-text:   #EDE7DC;
  --ss-muted:  #94A0AF;
  --ss-ink-strong: #CFE3EE;
  --ss-accent-ink: #E58A62;
  --ss-orange-solid: #AE5A39;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
}
[data-theme='night'] .ss-root.is-legacy {
  /* The retired-syllabus amber has to stay distinguishable from the live
     palette without going back to a cream page. */
  --ss-orange: #E0B54A;
  --ss-teal:   #3A2B06;
  --ss-ink-strong: #F0D89B;
  --ss-accent-ink: #E7C86E;
  --ss-orange-solid: #7C5A07;
}
[data-theme='night'] .ss-root mark { background: #7A5F00; color: #FFE9A8; }
[data-theme='night'] .ss-root .ss-error-title { color: #F1A08C; }

/* Table chrome: every one of these was a literal light tint. */
[data-theme='night'] .ss-root .ss-topic-header-row td {
  background: #223543;
  border-bottom-color: #3E5A6B;
}
[data-theme='night'] .ss-root.is-legacy .ss-topic-header-row td {
  background: #33280A;
  color: #F0D89B;
  border-top-color: #6B5410;
  border-bottom-color: #8A6D14;
}
[data-theme='night'] .ss-root .ss-data-row { border-bottom-color: #313D4C; }
[data-theme='night'] .ss-root .ss-data-row:hover { background: #2A3646; }
[data-theme='night'] .ss-root .ss-data-row.ss-odd-row { background: #1F2836; }
[data-theme='night'] .ss-root .ss-data-row.ss-odd-row:hover { background: #2A3646; }
[data-theme='night'] .ss-root .ss-table td { border-right-color: #313D4C; }
[data-theme='night'] .ss-root .ss-subtopic-cell.ss-first-in-group { border-left-color: #3E5A6B; }
[data-theme='night'] .ss-root .ss-standard-cell { color: #AEB8C4; }

/* The pinned phone column repeats those tints as opaque backgrounds and
   redraws the row separator as an inset shadow — both need the dark twin or
   the first column scrolls as a bright stripe. */
@media (max-width: 700px) {
  [data-theme='night'] .ss-root .ss-table td.ss-topic-cell-dim { color: rgba(237,231,220,0.55); }
  [data-theme='night'] .ss-root .ss-data-row td:first-child { box-shadow: inset 0 -1px 0 #313D4C; }
  [data-theme='night'] .ss-root .ss-data-row td.ss-subtopic-cell.ss-first-in-group:first-child {
    box-shadow: inset 3px 0 0 #3E5A6B, inset 0 -1px 0 #313D4C;
  }
  [data-theme='night'] .ss-root .ss-data-row.ss-odd-row td:first-child { background: #1F2836; }
  [data-theme='night'] .ss-root .ss-data-row:hover td:first-child { background: #2A3646; }
  [data-theme='night'] .ss-root .ss-data-row.ss-odd-row:hover td:first-child { background: #2A3646; }
  [data-theme='night'] .ss-root .ss-table thead th:first-child::after,
  [data-theme='night'] .ss-root .ss-data-row td:first-child::after {
    background: linear-gradient(to right, rgba(0,0,0,0.35), transparent);
  }
}
`}</style>
  )
}
