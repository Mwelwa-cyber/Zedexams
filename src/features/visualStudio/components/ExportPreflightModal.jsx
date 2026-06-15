/* Pre-export checklist modal (brief item 8). Shown when an image's bytes
   can't be read before a handoff/export — lets the teacher fix it first or
   proceed knowingly. */

import { IconCheck } from './VsIcons'

const DOT = {
  pass: '✓', fail: '✕', manual: '!', info: 'i',
}

export default function ExportPreflightModal({ result, onClose, onProceed }) {
  const checklist = result?.checklist || []
  const hasFailures = !result?.ok

  return (
    <div className="vs-modal-overlay" onClick={onClose} role="presentation">
      <div className="vs-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Pre-export check</h3>
        <p className="vs-sub" style={{ marginBottom: 10 }}>
          {hasFailures
            ? 'Some checks failed. Diagrams may be missing from the exported paper.'
            : 'All automatic checks passed. Confirm the manual checks below.'}
        </p>
        <div>
          {checklist.map((c) => (
            <div className="vs-check" key={c.id}>
              <span className={`vs-check__dot ${c.status}`}>{DOT[c.status] || '·'}</span>
              <div>
                <b>{c.label}</b>
                <span>{c.detail}</span>
              </div>
            </div>
          ))}
        </div>
        {hasFailures && (
          <p className="vs-hint vs-note-warn" style={{ marginTop: 12 }}>
            ⚠ If an image can&apos;t be read, the export shows a red placeholder instead of the
            diagram. Re-generate or re-upload the image, or ask an admin to confirm Storage CORS
            is configured, then try again.
          </p>
        )}
        <div className="vs-actions" style={{ marginTop: 14 }}>
          <button type="button" className="vs-iconbtn" onClick={onClose}>Cancel</button>
          <button type="button" className="vs-iconbtn" onClick={onProceed}
            style={{ background: hasFailures ? '#b7791f' : '#1e6b5c', color: '#fff', border: 'none' }}>
            <IconCheck size={15} /> {hasFailures ? 'Send anyway' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
