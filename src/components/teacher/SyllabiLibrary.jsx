import { useMemo, useState } from 'react'
import {
  SYLLABI_CATALOG,
  SYLLABI_TOTAL_COUNT,
  formatSyllabusSize,
  syllabusIcon,
} from '../../data/syllabiCatalog'

const COLORS = {
  ink: '#0e2a32',
  inkMuted: '#566f76',
  faintInk: '#8a9aa1',
  paper: '#fdf8ed',
  card: '#fff',
  border: '#b8ad96',
  borderSoft: '#f0e8d8',
  orange: '#ff7a2e',
  orangeSoft: '#fff5e6',
  peach: '#fcd9c4',
  green: '#10864e',
  greenDark: '#0e6b3f',
}

const PDF_BASE_URL = 'https://firebasestorage.googleapis.com/v0/b/zedexams.appspot.com/o/syllabi'
function getPdfUrl(key) {
  return `${PDF_BASE_URL}%2F${encodeURIComponent(key)}.pdf?alt=media`
}

function SectionLabel({ children }) {
  return (
    <div
      className="flex items-center gap-2.5 mb-2"
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: COLORS.orange,
      }}
    >
      <span
        style={{
          width: 32,
          height: 3,
          background: COLORS.orange,
          borderRadius: 2,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {children}
    </div>
  )
}

function VersionToggle({ value, onChange }) {
  const tabBase = {
    padding: '9px 18px',
    border: 'none',
    background: 'transparent',
    color: COLORS.ink,
    font: "700 13px/1 system-ui",
    borderRadius: 10,
    cursor: 'pointer',
    letterSpacing: '.02em',
  }
  const activeTab = { ...tabBase, background: COLORS.orange, color: '#fff' }

  return (
    <div
      style={{
        display: 'inline-flex',
        background: COLORS.card,
        border: `2px solid ${COLORS.ink}`,
        borderRadius: 14,
        padding: 4,
        gap: 4,
        margin: '14px 0 6px',
      }}
    >
      <button type="button" onClick={() => onChange('new')} style={value === 'new' ? activeTab : tabBase}>
        New Syllabus (2023)
      </button>
      <button type="button" onClick={() => onChange('old')} style={value === 'old' ? activeTab : tabBase}>
        Old Syllabus (2013)
      </button>
    </div>
  )
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 14px',
        background: active ? COLORS.ink : COLORS.card,
        color: active ? COLORS.paper : COLORS.inkMuted,
        border: `1.5px solid ${active ? COLORS.ink : COLORS.border}`,
        borderRadius: 99,
        font: "600 12px/1 system-ui",
        cursor: 'pointer',
        transition: 'all .15s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.borderColor = COLORS.ink
          e.currentTarget.style.color = COLORS.ink
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.borderColor = COLORS.border
          e.currentTarget.style.color = COLORS.inkMuted
        }
      }}
    >
      {children}
    </button>
  )
}

function SyllabusCard({ item, onOpen }) {
  const isEmbedded = !!item.e
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      style={{
        background: COLORS.card,
        border: `2px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: 16,
        cursor: 'pointer',
        transition: 'all .18s',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 170,
        textAlign: 'left',
        position: 'relative',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 8px 22px rgba(14,42,50,.12)'
        e.currentTarget.style.borderColor = COLORS.ink
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.borderColor = COLORS.border
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 10,
          background: COLORS.peach,
          display: 'grid',
          placeItems: 'center',
          fontSize: 22,
          marginBottom: 10,
        }}
      >
        {syllabusIcon(item.t)}
      </div>
      <div
        style={{
          font: "700 10.5px/1 system-ui",
          color: COLORS.orange,
          letterSpacing: '.6px',
          textTransform: 'uppercase',
          marginBottom: 5,
        }}
      >
        {item.l}
      </div>
      <div
        style={{
          font: "700 15px/1.25 'Fraunces',serif",
          color: COLORS.ink,
          marginBottom: 6,
          flex: 1,
        }}
      >
        {item.t}
      </div>
      <div style={{ font: "600 11.5px/1.3 system-ui", color: COLORS.inkMuted, marginBottom: 10 }}>
        {item.g}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          font: "500 10.5px/1 system-ui",
          color: COLORS.faintInk,
          borderTop: `1px solid ${COLORS.borderSoft}`,
          paddingTop: 9,
          marginTop: 'auto',
        }}
      >
        <span>{formatSyllabusSize(item.s)}</span>
        <span
          style={{
            padding: '5px 12px',
            background: isEmbedded ? COLORS.green : COLORS.ink,
            color: COLORS.paper,
            borderRadius: 99,
            font: "700 10.5px/1 system-ui",
            letterSpacing: '.4px',
            textTransform: 'uppercase',
          }}
        >
          {isEmbedded ? 'View ›' : 'Preview'}
        </span>
      </div>
    </button>
  )
}

function PdfViewer({ item, onClose }) {
  if (!item) return null
  const pdfAvailable = !!item.e
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(14,42,50,.85)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          background: COLORS.ink,
          color: COLORS.paper,
          borderBottom: '2px solid #16505d',
        }}
      >
        <h3 style={{ margin: 0, font: "700 15px/1.2 'Fraunces',serif", display: 'flex', alignItems: 'center', gap: 10 }}>
          {item.t} — {item.g}
          <span
            style={{
              background: COLORS.orange,
              color: '#fff',
              padding: '3px 9px',
              borderRadius: 99,
              font: "700 10px/1 system-ui",
              letterSpacing: '.5px',
            }}
          >
            VIEW ONLY
          </span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: COLORS.paper,
            color: COLORS.ink,
            border: 'none',
            borderRadius: 10,
            padding: '8px 14px',
            font: "700 13px/1 system-ui",
            cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = COLORS.orange; e.currentTarget.style.color = '#fff' }}
          onMouseLeave={e => { e.currentTarget.style.background = COLORS.paper; e.currentTarget.style.color = COLORS.ink }}
        >
          ✕ Close
        </button>
      </div>
      <div style={{ flex: 1, background: '#1a1410', position: 'relative', overflow: 'hidden' }}>
        {pdfAvailable ? (
          <iframe
            title={item.t}
            src={`${getPdfUrl(item.k)}#toolbar=0&navpanes=0&scrollbar=1`}
            sandbox="allow-same-origin allow-scripts"
            onContextMenu={e => e.preventDefault()}
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: COLORS.paper, textAlign: 'center', padding: 40 }}>
            <div
              style={{
                maxWidth: 480,
                background: COLORS.paper,
                color: COLORS.ink,
                padding: 36,
                borderRadius: 18,
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 14 }}>{syllabusIcon(item.t)}</div>
              <h2 style={{ font: "800 24px/1.2 'Fraunces',serif", margin: '0 0 10px', color: COLORS.ink }}>
                {item.t}
              </h2>
              <p style={{ margin: '0 0 14px', font: "600 13px/1 system-ui" }}>
                <span style={chipStyle}>{item.l}</span>
                <span style={chipStyle}>{item.g}</span>
              </p>
              <p style={{ margin: '0 0 14px', color: COLORS.inkMuted, lineHeight: 1.5 }}>
                This syllabus PDF is hosted in the ZedExams secure cloud library. Once it is published it will load
                directly here for view-only access.
              </p>
              <p style={{ fontSize: 13, color: COLORS.faintInk, margin: 0 }}>
                A small set of sample syllabi is already embedded for preview; the rest of the catalogue activates as
                each PDF is uploaded.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const chipStyle = {
  display: 'inline-block',
  background: COLORS.orangeSoft,
  color: COLORS.orange,
  padding: '6px 12px',
  borderRadius: 8,
  font: "700 12px/1 system-ui",
  margin: '4px 4px 4px 0',
}

export default function SyllabiLibrary() {
  const [version, setVersion] = useState('new')
  const [filter, setFilter] = useState('all')
  const [active, setActive] = useState(null)

  const list = useMemo(() => SYLLABI_CATALOG[version] || [], [version])

  const categories = useMemo(() => {
    const seen = []
    for (const item of list) if (!seen.includes(item.l)) seen.push(item.l)
    return seen.map(name => ({ name, count: list.filter(x => x.l === name).length }))
  }, [list])

  const visible = useMemo(
    () => (filter === 'all' ? list : list.filter(x => x.l === filter)),
    [list, filter],
  )

  function handleVersionChange(next) {
    setVersion(next)
    setFilter('all')
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: COLORS.peach,
            display: 'grid',
            placeItems: 'center',
            fontSize: 30,
            flexShrink: 0,
          }}
        >
          🐘
        </div>
        <h1 style={{ font: "800 32px/1.05 'Fraunces',serif", color: COLORS.ink, margin: 0, letterSpacing: '-.3px' }}>
          Syllabi Library
        </h1>
      </div>
      <p style={{ color: COLORS.inkMuted, fontSize: 14, margin: '0 0 14px', maxWidth: 720, lineHeight: 1.55 }}>
        Browse the official Zambian Curriculum Development Centre syllabi — both the new 2023 framework and the 2013
        syllabus for grades still using them.
      </p>

      <div
        style={{
          background: `linear-gradient(135deg, ${COLORS.green} 0%, ${COLORS.greenDark} 100%)`,
          color: '#fff',
          borderRadius: 14,
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          margin: '14px 0 6px',
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: 'rgba(255,255,255,.18)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          🎁
        </div>
        <div style={{ font: "600 13.5px/1.4 system-ui" }}>
          <strong style={{ display: 'block', font: "800 15px/1.2 'Fraunces',serif", marginBottom: 2 }}>
            Free for all teachers
          </strong>
          View-only access — no subscription required.
        </div>
      </div>

      <VersionToggle value={version} onChange={handleVersionChange} />

      <div className="flex flex-wrap gap-2" style={{ margin: '10px 0 22px' }}>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All ({list.length})
        </FilterChip>
        {categories.map(c => (
          <FilterChip key={c.name} active={filter === c.name} onClick={() => setFilter(c.name)}>
            {c.name} ({c.count})
          </FilterChip>
        ))}
      </div>

      <SectionLabel>{visible.length} {visible.length === 1 ? 'syllabus' : 'syllabi'}</SectionLabel>

      {visible.length === 0 ? (
        <div
          className="text-center py-10 rounded-2xl border-2 border-dashed"
          style={{ background: COLORS.card, borderColor: COLORS.border }}
        >
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>🐘</div>
          <p style={{ font: "800 17px/1.2 'Fraunces',serif", color: COLORS.ink, marginBottom: 6 }}>
            No syllabi in this category
          </p>
          <p style={{ fontSize: 13, color: COLORS.faintInk, margin: 0 }}>
            Try the other version or another filter.
          </p>
        </div>
      ) : (
        <div
          className="grid gap-3.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
        >
          {visible.map(item => (
            <SyllabusCard key={item.k} item={item} onOpen={setActive} />
          ))}
        </div>
      )}

      <p style={{ marginTop: 22, fontSize: 12, color: COLORS.faintInk, textAlign: 'center' }}>
        {SYLLABI_TOTAL_COUNT} official CDC syllabi · view-only · sourced from the Zambian Curriculum Development Centre
      </p>

      <PdfViewer item={active} onClose={() => setActive(null)} />
    </div>
  )
}
