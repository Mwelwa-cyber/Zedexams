// src/components/teacher/scan/ImportReviewPageStrip.jsx
// Horizontal scrollable thumbnail strip. Each page shows approval badge.
// Props: pages (array of {pageNumber, objectUrl}), approvalState, selectedPage, onSelectPage
export default function ImportReviewPageStrip({ pages, approvalState, selectedPage, onSelectPage }) {
  return (
    <div style={{
      display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 16px',
      borderBottom: '1px solid #e5e0d6', background: '#f8f6ef', flexShrink: 0
    }}>
      {pages.map(({ pageNumber, objectUrl }) => {
        const status = approvalState[pageNumber]
        const isSelected = pageNumber === selectedPage
        return (
          <button
            key={pageNumber}
            type="button"
            onClick={() => onSelectPage(pageNumber)}
            style={{
              flexShrink: 0, width: 64, padding: 0,
              border: `2px solid ${isSelected ? '#ff7a2e' : '#d9cfb8'}`,
              borderRadius: 8, background: '#fff', cursor: 'pointer', overflow: 'hidden', position: 'relative'
            }}
          >
            {objectUrl ? (
              <img src={objectUrl} alt={`Page ${pageNumber}`} style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ width: '100%', height: 80, background: '#e5e0d6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#566f76' }}>
                {pageNumber}
              </div>
            )}
            {status === 'approved' && (
              <div style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 900 }}>✓</div>
            )}
            {status === 'skipped' && (
              <div style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 900 }}>—</div>
            )}
            <div style={{ fontSize: 9, color: '#566f76', padding: '2px 0', textAlign: 'center' }}>p{pageNumber}</div>
          </button>
        )
      })}
    </div>
  )
}
