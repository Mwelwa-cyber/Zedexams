import { Link } from 'react-router-dom'
import { ArrowRight, CircleCheck, FolderOpen, MoreVertical } from 'lucide-react'
import { RECENT_DOCUMENTS } from './mockData'

export default function RecentDocumentsCard() {
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
        {RECENT_DOCUMENTS.map((doc) => {
          const DocIcon = doc.icon
          return (
            <div key={doc.id} className="tdv2-doc-row">
              <Link
                to="/teacher/library"
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
              <span className="tdv2-doc-side">
                <span className="tdv2-doc-date">{doc.date}</span>
                <span className="tdv2-badge-ready">
                  <CircleCheck size={13} strokeWidth={2.25} aria-hidden="true" />
                  {doc.status}
                </span>
                <button
                  type="button"
                  className="tdv2-doc-more"
                  aria-label={`More actions for ${doc.title}`}
                >
                  <MoreVertical size={17} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
