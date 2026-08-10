import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CircleCheck,
  Clock3,
  FolderOpen,
  MoreVertical,
} from 'lucide-react'
import { iconForTool } from '../../../components/teacher/dashboardV2/dashboardV2Config'
import useGlassTile from '../../../hooks/useGlassTile'
import '../../../components/teacher/dashboardV2/glassSurface.css'

export function RowMenu({ doc, onClose }) {
  const ref = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointer = (e) => {
      if (!ref.current?.contains(e.target)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose])

  const go = (to) => {
    onClose()
    navigate(to)
  }

  return (
    <div className="tdv2-rowmenu" role="menu" aria-label={`Actions for ${doc.title}`} ref={ref}>
      <button type="button" role="menuitem" className="tdv2-rowmenu-item" onClick={() => go(doc.to)}>
        Open
      </button>
      <button type="button" role="menuitem" className="tdv2-rowmenu-item" onClick={() => go('/teacher/library')}>
        View in My Library
      </button>
    </div>
  )
}

/* Quiet glass list row: press feedback only (gentler scale via .glass-row),
   hover is a pure CSS tint — no lift, no specular, no sheen. Rows that jump
   feel unstable. */
function DocRow({ children }) {
  const rowRef = useGlassTile({ specular: false, sheen: false })
  return (
    <div ref={rowRef} className="tdv2-doc-row glass-row">
      {children}
    </div>
  )
}

/** documents: [{ id, title, meta, date, status, tool, to }] */
export default function RecentDocumentsCard({ documents = [], loading = false }) {
  const [menuFor, setMenuFor] = useState(null)

  return (
    <section className="tdv2-card" aria-labelledby="tdv2-docs-h">
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-docs-h">
          <FolderOpen size={17} strokeWidth={2} aria-hidden="true" />
          Recent Documents
        </h2>
        <Link className="tdv2-link-action" to="/teacher/library">
          View all
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
      <div className="tdv2-doc-list">
        {loading ? (
          <div className="tdv2-empty">Loading your documents…</div>
        ) : documents.length === 0 ? (
          <div className="tdv2-empty">
            Nothing here yet — documents you create appear here.
          </div>
        ) : (
          documents.map((doc) => {
            const DocIcon = iconForTool(doc.tool)
            const ready = doc.status !== 'Draft'
            return (
              <DocRow key={doc.id}>
                <Link
                  to={doc.to}
                  aria-label={`Open ${doc.title}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 13, flex: 1, minWidth: 0 }}
                >
                  <span className="tdv2-doc-icon" aria-hidden="true">
                    <DocIcon size={19} strokeWidth={1.75} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="tdv2-doc-title" style={{ display: 'block' }}>{doc.title}</span>
                    <span className="tdv2-doc-meta" style={{ display: 'block' }}>{doc.meta}</span>
                  </span>
                </Link>
                <span className="tdv2-doc-side" style={{ position: 'relative' }}>
                  <span className="tdv2-doc-date">{doc.date}</span>
                  <span className={ready ? 'tdv2-badge-ready' : 'tdv2-badge-draft'}>
                    {ready ? (
                      <CircleCheck size={13} strokeWidth={2.25} aria-hidden="true" />
                    ) : (
                      <Clock3 size={13} strokeWidth={2.25} aria-hidden="true" />
                    )}
                    {doc.status}
                  </span>
                  <button
                    type="button"
                    className="tdv2-doc-more"
                    aria-label={`More actions for ${doc.title}`}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === doc.id}
                    onClick={() => setMenuFor((v) => (v === doc.id ? null : doc.id))}
                  >
                    <MoreVertical size={17} strokeWidth={2} aria-hidden="true" />
                  </button>
                  {menuFor === doc.id ? (
                    <RowMenu doc={doc} onClose={() => setMenuFor(null)} />
                  ) : null}
                </span>
              </DocRow>
            )
          })
        )}
      </div>
    </section>
  )
}
