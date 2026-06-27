// src/components/teacher/scan/OriginalPageViewer.jsx
// Shows the original scanned page image with SVG overlay boxes
// for detected diagrams (fractions → pixel coordinates).
// Props: objectUrl (string), diagrams (array of {box, kind, caption})
export default function OriginalPageViewer({ objectUrl, diagrams = [] }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'auto', background: '#f8f6ef' }}>
      <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
        <img
          src={objectUrl}
          alt="original page"
          style={{ width: '100%', display: 'block', objectFit: 'contain' }}
        />
        {diagrams.length > 0 && (
          <svg
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {diagrams.map((d, i) => (
              <rect
                key={i}
                x={d.box.x * 100}
                y={d.box.y * 100}
                width={d.box.w * 100}
                height={d.box.h * 100}
                fill="none"
                stroke="#ff7a2e"
                strokeWidth="0.5"
                strokeDasharray="2 1"
              />
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}
