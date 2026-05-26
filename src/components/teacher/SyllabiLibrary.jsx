import { useEffect, useMemo, useState } from 'react'
import SeoHelmet from '../seo/SeoHelmet'

// Subject metadata — maps the raw JSON keys to icon + category + short label.
// Keep aligned with public/syllabi/curriculum-data.json. New subjects fall
// back to the generic META at render time.
const META = {
  'Early Childhood Education Syllabi (3-5 Years)':       { icon: '🌱', cat: 'Early Childhood', short: 'Early Childhood Ed.' },
  'Lower Primary Syllabi (Grades 1-3)':                  { icon: '📚', cat: 'Lower Primary',   short: 'Lower Primary' },
  'Mathematics Syllabus (Grades 4-6)':                   { icon: '➗', cat: 'Upper Primary',   short: 'Mathematics (Gr. 4–6)' },
  'Science Syllabus (Grades 4-6)':                       { icon: '🔬', cat: 'Upper Primary',   short: 'Science (Gr. 4–6)' },
  'Social Studies Syllabus (Grades 4-6)':                { icon: '🌍', cat: 'Upper Primary',   short: 'Social Studies (Gr. 4–6)' },
  'Home Economics & Hospitality Syllabus (Grades 4-6)':  { icon: '🏠', cat: 'Upper Primary',   short: 'Home Economics (Gr. 4–6)' },
  'Technology Studies Syllabus (Grades 4-6)':            { icon: '⚙️', cat: 'Upper Primary',   short: 'Technology Studies (Gr. 4–6)' },
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
}

const CAT_ORDER = ['Early Childhood', 'Lower Primary', 'Upper Primary', 'Secondary']
const CAT_LABELS = {
  'Early Childhood': 'ECE · Ages 3–5',
  'Lower Primary':   'Lower Primary · Grades 1–3',
  'Upper Primary':   'Upper Primary · Grades 4–6',
  'Secondary':       'Secondary · Forms 1–4',
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
  const [rawData, setRawData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [currentSubject, setCurrentSubject] = useState(null)
  const [currentSheet, setCurrentSheet] = useState(null)
  const [rowFilter, setRowFilter] = useState('')

  // Load the structured curriculum data lazily from /public. The file is
  // ~1.3MB so we don't want it in the main bundle — it's keep-in-cache once
  // fetched (the asset has a content hash via the dev server / hosting).
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await fetch('/syllabi/curriculum-data.json')
        if (!response.ok) throw new Error(`Curriculum data request failed: ${response.status}`)
        const raw = await response.json()
        if (cancelled) return
        const enriched = {}
        for (const [subj, sheets] of Object.entries(raw)) {
          const meta = META[subj] || { icon: '📄', cat: 'Other', short: subj.slice(0, 30) }
          enriched[subj] = { ...meta, sheets }
        }
        setRawData(enriched)
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load curriculum data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

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
  }

  function showSubject(subj) {
    const sheetNames = Object.keys(rawData[subj].sheets)
    setCurrentSubject(subj)
    setCurrentSheet(sheetNames[0] || null)
    setRowFilter('')
    setQuery('')
  }

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

  return (
    <section className="ss-root" data-view={view}>
      <SeoHelmet title="Syllabi Studio" noIndex />
      <SyllabiStudioStyles />

      <div className="ss-header">
        <div className="ss-logo-mark" aria-hidden>📘</div>
        <div className="ss-logo-text-wrap">
          <div className="ss-logo-text">Syllabi Studio</div>
          <div className="ss-logo-sub">Zambian National Curriculum</div>
        </div>
        <div className="ss-spacer" />
        <label className="ss-search-wrap">
          <span className="sr-only">Search topics or competences</span>
          <input
            type="text"
            className="ss-search-box"
            placeholder="Search topics, competences…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            disabled={!rawData}
          />
        </label>
      </div>

      <div className="ss-layout">
        <Sidebar
          data={rawData}
          grouped={grouped}
          currentSubject={currentSubject}
          onSelectSubject={showSubject}
        />

        <main className="ss-main">
          {loading && (
            <div className="ss-loading">
              <div className="ss-loading-dot" />
              <p>Loading curriculum data…</p>
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
            />
          )}

          {!loading && !error && view === 'subject' && currentSubject && rawData && (
            <SubjectDetail
              meta={rawData[currentSubject]}
              currentSheet={currentSheet}
              onSelectSheet={setCurrentSheet}
              rowFilter={rowFilter}
              onRowFilter={setRowFilter}
              onBack={showHome}
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
            />
          )}
        </main>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Sidebar({ data, grouped, currentSubject, onSelectSubject }) {
  if (!data) {
    return (
      <nav className="ss-sidebar" aria-label="Subjects">
        <div className="ss-sidebar-placeholder">Loading subjects…</div>
      </nav>
    )
  }
  return (
    <nav className="ss-sidebar" aria-label="Subjects">
      {CAT_ORDER.map(cat => {
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

function HomeView({ stats, grouped, onSelectSubject }) {
  return (
    <div className="ss-home">
      <section className="ss-hero" aria-label="Studio overview">
        <div className="ss-hero-text">
          <div className="ss-hero-label">✦ SYLLABI STUDIO</div>
          <h1 className="ss-hero-title">Zambian National<br />Curriculum</h1>
          <p className="ss-hero-blurb">
            Browse all 20 subjects across Early Childhood,<br />
            Primary and Secondary levels.
          </p>
        </div>
        <div className="ss-hero-emoji" aria-hidden>📘</div>
      </section>

      <div className="ss-stats-row">
        <StatCard value={stats.subjects} label="Subjects" />
        <StatCard value={stats.levels}   label="Grade/Form Levels" />
        <StatCard value={stats.topics}   label="Topics" />
        <StatCard value={4}              label="Education Stages" />
      </div>

      {CAT_ORDER.map(cat => {
        const list = grouped[cat]
        if (!list || list.length === 0) return null
        return (
          <section key={cat} className="ss-cat-section">
            <div className="ss-section-heading">
              <span className="ss-sh-dash">{cat.toUpperCase()}</span>
              <h2 className="ss-sh-title">{CAT_LABELS[cat] || cat}</h2>
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

function SubjectDetail({ meta, currentSheet, onSelectSheet, rowFilter, onRowFilter, onBack }) {
  const sheetNames = useMemo(() => Object.keys(meta.sheets), [meta])
  const activeSheetName = sheetNames.includes(currentSheet) ? currentSheet : sheetNames[0]
  const sheet = activeSheetName ? meta.sheets[activeSheetName] : null

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
      const cells = sheet.columns.map(c => (row.cells?.[c] || ''))
      if (q && !cells.some(c => c.toLowerCase().includes(q))) continue
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
  }, [sheet, rowFilter])

  if (!sheet) {
    return <p className="ss-empty">No sheet to display.</p>
  }

  const showTopicCell = Boolean(rowFilter.trim())
  const columnCount = sheet.columns.length

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
          </p>
        </div>
      </section>

      <div className="ss-tabs-bar" role="tablist" aria-label="Levels">
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
            <thead>
              <tr>
                {sheet.columns.map((col, i) => (
                  <th key={col} style={i === 0 && !showTopicCell ? { display: 'none' } : undefined}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderedRows.rows.map(row => {
                if (row.kind === 'section') {
                  return (
                    <tr key={row.key} className="ss-section-row">
                      <td colSpan={showTopicCell ? columnCount : columnCount - 1}>{row.label}</td>
                    </tr>
                  )
                }
                if (row.kind === 'topic') {
                  return (
                    <tr key={row.key} className="ss-topic-header-row">
                      <td colSpan={showTopicCell ? columnCount : columnCount - 1}>{row.label}</td>
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
                      return (
                        <td key={ci} className={className}>
                          {renderCell(val, rowFilter.trim())}
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

function SearchResults({ query, results, onOpenResult }) {
  return (
    <div className="ss-search-results">
      <div className="ss-sr-header">
        <h2>Search results</h2>
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
.ss-root {
  --ss-cream:  #F2EDE3;
  --ss-cream2: #EBE4D8;
  --ss-teal:   #1B3A4B;
  --ss-orange: #E8722A;
  --ss-white:  #FFFFFF;
  --ss-text:   #1a1a1a;
  --ss-muted:  #6B6B6B;
  --ss-radius: 14px;
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: var(--ss-cream);
  color: var(--ss-text);
  border-radius: 22px;
  overflow: hidden;
  border: 1.5px solid var(--ss-cream2);
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 160px);
}

.ss-root *, .ss-root *::before, .ss-root *::after { box-sizing: border-box; }
.ss-root mark { background: #FFE082; border-radius: 2px; padding: 0 2px; color: inherit; }
.ss-root .sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}

/* ── HEADER ───────────────────────────────────────────────────────────── */
.ss-root .ss-header {
  height: 64px;
  background: var(--ss-teal);
  color: white;
  display: flex; align-items: center;
  padding: 0 24px; gap: 16px;
  flex-shrink: 0; z-index: 5;
}
.ss-root .ss-logo-mark {
  width: 36px; height: 36px;
  background: var(--ss-orange); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; flex-shrink: 0;
}
.ss-root .ss-logo-text-wrap { display: flex; flex-direction: column; line-height: 1.1; }
.ss-root .ss-logo-text {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 20px; font-weight: 700;
}
.ss-root .ss-logo-sub { font-size: 12px; opacity: 0.6; }
.ss-root .ss-spacer { flex: 1; }
.ss-root .ss-search-wrap { position: relative; display: inline-flex; }
.ss-root .ss-search-box {
  background: rgba(255,255,255,0.12);
  border: 1.5px solid rgba(255,255,255,0.25);
  border-radius: 8px;
  color: white;
  padding: 8px 14px 8px 36px;
  font-size: 14px;
  width: 280px;
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
  max-height: calc(100vh - 160px);
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
  color: var(--ss-orange);
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
  color: var(--ss-teal);
}
.ss-root .ss-nav-icon { font-size: 15px; flex-shrink: 0; }

/* ── MAIN ─────────────────────────────────────────────────────────────── */
.ss-root .ss-main {
  flex: 1;
  min-width: 0;
  padding: 28px 32px;
  overflow-y: auto;
  max-height: calc(100vh - 160px);
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
  color: var(--ss-orange);
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
  color: var(--ss-teal);
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
  color: var(--ss-orange);
}
.ss-root .ss-sh-dash::before {
  content: ''; display: inline-block;
  width: 22px; height: 2.5px;
  background: var(--ss-orange); border-radius: 2px;
}
.ss-root .ss-sh-title {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 22px; font-weight: 900;
  color: var(--ss-teal);
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
  color: var(--ss-teal);
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
  color: var(--ss-teal); font-weight: 600;
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

.ss-root .ss-tabs-bar {
  display: flex; gap: 6px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.ss-root .ss-tab-btn {
  padding: 8px 18px;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  border-radius: 8px;
  border: 1.5px solid var(--ss-teal);
  background: var(--ss-white);
  color: var(--ss-teal);
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
  font-size: 13px; width: 260px;
  outline: none;
  font-family: inherit;
  background: white;
  color: var(--ss-text);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ss-root .ss-tbl-search:focus {
  border-color: var(--ss-orange);
  box-shadow: 0 0 0 2px rgba(232,114,42,0.15);
}
.ss-root .ss-row-count {
  font-size: 12px; color: var(--ss-muted);
  margin-left: auto; font-weight: 600;
}

.ss-root .ss-tbl-container {
  overflow-x: auto;
  max-height: calc(100vh - 380px);
}
.ss-root .ss-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ss-root .ss-table thead th {
  background: var(--ss-teal);
  color: white;
  padding: 12px 16px;
  text-align: left;
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  white-space: nowrap;
  position: sticky; top: 0; z-index: 10;
  border-right: 1px solid rgba(255,255,255,0.15);
}
.ss-root .ss-table thead th:last-child { border-right: none; }

.ss-root .ss-section-row td {
  background: var(--ss-teal);
  color: white;
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 10px 16px;
  border: none;
}
.ss-root .ss-topic-header-row td {
  background: #D4E4EC;
  color: var(--ss-teal);
  font-weight: 800;
  font-size: 13px;
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
  line-height: 1.6;
  border-right: 1px solid #EDE7DB;
}
.ss-root .ss-table td:last-child { border-right: none; }

.ss-root .ss-topic-cell-dim { opacity: 0.45; font-size: 11px; }
.ss-root .ss-subtopic-cell {
  font-weight: 600; color: var(--ss-teal);
  min-width: 180px;
  border-left: 3px solid transparent;
}
.ss-root .ss-subtopic-cell.ss-first-in-group { border-left-color: #9BBECE; }
.ss-root .ss-competences-cell { min-width: 180px; }
.ss-root .ss-activities-cell { min-width: 260px; max-width: 380px; }
.ss-root .ss-standard-cell {
  min-width: 160px;
  color: #555;
  font-style: italic;
  font-size: 12.5px;
}
.ss-root .ss-table td ul { padding-left: 16px; margin: 3px 0; }
.ss-root .ss-table td ul li { margin: 4px 0; }

/* ── SEARCH RESULTS ──────────────────────────────────────────────────── */
.ss-root .ss-search-results .ss-sr-header { margin-bottom: 20px; }
.ss-root .ss-sr-header h2 {
  font-family: 'Playfair Display', 'Fraunces', Georgia, serif;
  font-size: 24px; font-weight: 900;
  color: var(--ss-teal);
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
.ss-root .ss-sri-title { font-size: 14px; font-weight: 700; color: var(--ss-teal); margin-bottom: 2px; }
.ss-root .ss-sri-meta { font-size: 12px; color: var(--ss-muted); }
.ss-root .ss-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px; font-weight: 700;
  background: var(--ss-orange); color: white;
}

/* ── RESPONSIVE ──────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .ss-root .ss-sidebar { display: none; }
  .ss-root .ss-main { padding: 20px 18px; max-height: none; }
  .ss-root .ss-stats-row { grid-template-columns: repeat(2, 1fr); }
  .ss-root .ss-hero { padding: 20px 22px; }
  .ss-root .ss-hero-title { font-size: 24px; }
  .ss-root .ss-hero-emoji { font-size: 40px; }
  .ss-root .ss-search-box { width: 160px; }
}
@media (max-width: 560px) {
  .ss-root .ss-stats-row { grid-template-columns: 1fr 1fr; }
  .ss-root .ss-header { padding: 0 14px; }
  .ss-root .ss-search-box { width: 140px; padding-left: 32px; }
  .ss-root .ss-logo-sub { display: none; }
}
`}</style>
  )
}
