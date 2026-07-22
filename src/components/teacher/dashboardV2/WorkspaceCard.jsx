import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Layers,
} from 'lucide-react'
import { WORKSPACE_EXPANDABLE, WORKSPACE_TILES } from './mockData'

export default function WorkspaceCard() {
  const [expanded, setExpanded] = useState(() => new Set())

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="tdv2-card" aria-labelledby="tdv2-ws-h">
      <div className="tdv2-card-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 className="tdv2-eyebrow" id="tdv2-ws-h">
            <Layers size={17} strokeWidth={2} aria-hidden="true" />
            Teacher Workspace
          </h2>
          <p className="tdv2-card-sub">Your main tools — expand for everything else</p>
        </div>
        <Link className="tdv2-link-action" to="/teacher/library">
          View all
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>

      <div className="tdv2-eyebrow" style={{ fontSize: 11.5, marginBottom: 10 }}>
        <ClipboardList size={15} strokeWidth={2} aria-hidden="true" />
        Planning
      </div>
      <div className="tdv2-ws-grid">
        {WORKSPACE_TILES.map(({ id, title, description, saved, icon: TileIcon, to }) => (
          <Link key={id} to={to} className="tdv2-ws-tile">
            <span className="tdv2-ws-top">
              <span className="tdv2-ws-icon" aria-hidden="true">
                <TileIcon size={20} strokeWidth={1.75} />
              </span>
              <span className="tdv2-saved-badge">{saved} SAVED</span>
            </span>
            <span className="tdv2-ws-title">{title}</span>
            <span className="tdv2-ws-desc">{description}</span>
            <ArrowRight size={16} strokeWidth={2} className="tdv2-ws-arrow" aria-hidden="true" />
          </Link>
        ))}
      </div>

      {WORKSPACE_EXPANDABLE.map(({ id, title, icon: RowIcon, items }) => {
        const open = expanded.has(id)
        return (
          <div key={id}>
            <button
              type="button"
              className="tdv2-ws-expand"
              aria-expanded={open}
              aria-controls={`tdv2-ws-${id}`}
              onClick={() => toggle(id)}
            >
              <RowIcon size={18} strokeWidth={1.75} aria-hidden="true" />
              {title}
              {open ? (
                <ChevronDown size={17} strokeWidth={2} aria-hidden="true" />
              ) : (
                <ChevronRight size={17} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
            {open ? (
              <div className="tdv2-ws-sublist" id={`tdv2-ws-${id}`}>
                {items.map((item) => (
                  <Link key={item.id} to={item.to} className="tdv2-ws-subitem">
                    <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}

      <div className="tdv2-ws-footer">
        <Link className="tdv2-link-action" to="/teacher/library">
          View all teacher tools (13 more)
          <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}
