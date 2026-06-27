// DiagramChoicePanel — slide-over panel that lets a teacher decide what to do
// with a diagram detected during a photo import scan.
//
// Props: open, diagramMeta, cropObjectUrl, choiceState, onSelectChoice,
//        onConfirm, onClose

import { DiagramChoiceStatus } from '../../../utils/diagramChoiceStateMachine.js'

const CHOICE_CONFIG = [
  { id: 'keep_original',  label: 'Keep Original Image',         desc: 'Use the photo crop as-is' },
  { id: 'clean_original', label: 'Clean Original Drawing',      desc: 'Auto-enhance contrast and reduce noise' },
  { id: 'redraw_ai',      label: 'Redraw Using AI',             desc: 'Generate clean B&W line art' },
  { id: 'replace_better', label: 'Replace with Better Diagram', desc: 'Upload a higher-quality image' },
  { id: 'remove',         label: 'Remove Diagram',              desc: 'Delete this diagram slot entirely' },
]

export default function DiagramChoicePanel({
  open,
  diagramMeta = {},
  cropObjectUrl,
  choiceState = {},
  onSelectChoice,
  onConfirm,
  onClose,
}) {
  if (!open) return null

  const { kind = '', caption = '' } = diagramMeta
  const { status, previewUrl, choice, errorMessage } = choiceState

  const isPreviewing = status === DiagramChoiceStatus.PREVIEWING
  const isReady      = status === DiagramChoiceStatus.READY
  const isError      = status === DiagramChoiceStatus.ERROR

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 92,
        background: 'rgba(14, 42, 50, 0.45)',
        display: 'flex', justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <aside
        style={{
          background: '#fff', width: 'min(400px, 100vw)',
          height: '100%', display: 'flex', flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #e5e0d6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#566f76', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                {kind || 'diagram'}
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0e2a32', lineHeight: 1.3 }}>
                {caption || 'Detected Diagram'}
              </h3>
            </div>
            {cropObjectUrl && (
              <img
                src={cropObjectUrl}
                alt="original crop"
                style={{ width: 72, height: 56, objectFit: 'contain', borderRadius: 8, border: '1.5px solid #d9cfb8', background: '#f8f6ef', flexShrink: 0 }}
              />
            )}
          </div>
        </div>

        {/* Choice buttons */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#566f76', marginBottom: 2 }}>
            What would you like to do?
          </div>
          {CHOICE_CONFIG.map(({ id, label, desc }) => {
            const isActive = choice === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectChoice(id)}
                style={{
                  textAlign: 'left', padding: '10px 14px', borderRadius: 10,
                  border: `1.5px solid ${isActive ? '#ff7a2e' : '#d9cfb8'}`,
                  background: isActive ? '#fff3e8' : '#fff',
                  cursor: 'pointer', width: '100%',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0e2a32' }}>{label}</div>
                <div style={{ fontSize: 12, color: '#566f76', marginTop: 2 }}>{desc}</div>
              </button>
            )
          })}

          {/* Async area */}
          {isPreviewing && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
              <div
                role="status"
                aria-label="Loading preview"
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  border: '3px solid #e5e0d6',
                  borderTopColor: '#ff7a2e',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {isReady && previewUrl && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#566f76', marginBottom: 6 }}>Preview</div>
              <img
                src={previewUrl}
                alt="diagram preview"
                style={{ width: '100%', borderRadius: 10, border: '1.5px solid #d9cfb8', background: '#f8f6ef', objectFit: 'contain', maxHeight: 200 }}
              />
            </div>
          )}

          {isError && errorMessage && (
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 10, background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#991b1b', fontSize: 13 }}>
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e0d6', display: 'flex', gap: 8 }}>
          {isReady && (
            <button
              type="button"
              onClick={onConfirm}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10, fontWeight: 800,
                fontSize: 14, background: '#ff7a2e', color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              Confirm
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flex: isReady ? 0 : 1, padding: '10px 20px', borderRadius: 10, fontWeight: 700,
              fontSize: 14, background: '#f1ede1', color: '#0e2a32', border: '1.5px solid #d9cfb8', cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </aside>
    </div>
  )
}
