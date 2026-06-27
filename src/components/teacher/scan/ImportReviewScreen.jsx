// src/components/teacher/scan/ImportReviewScreen.jsx
import { useState, useEffect } from 'react'
import { useImportReview } from './useImportReview.js'
import OriginalPageViewer from './OriginalPageViewer.jsx'
import ImportReviewPageStrip from './ImportReviewPageStrip.jsx'
import DiagramChoicePanel from './DiagramChoicePanel.jsx'

// Counts leaf questions (not counting passage containers)
function countQuestions(sections) {
  let n = 0
  for (const s of sections) {
    if (s.kind === 'passage') n += (s.questions ?? []).length
    else n += 1
  }
  return n
}

// Renders a single section in the right panel
function SectionPreview({ section, sectionIndex, diagramChoices, onOpenDiagramPanel }) {
  const q = section.question ?? {}
  const hasWarning = (q.importWarnings?.length ?? 0) > 0

  return (
    <div
      style={{
        padding: '12px 14px', marginBottom: 10, borderRadius: 10,
        border: `1.5px solid ${hasWarning ? '#f59e0b' : '#e5e0d6'}`,
        background: hasWarning ? '#fffbeb' : '#fff',
        borderLeft: `4px solid ${hasWarning ? '#f59e0b' : '#e5e0d6'}`,
      }}
    >
      {/* Question type badge */}
      <div style={{ fontSize: 10, fontWeight: 700, color: '#566f76', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {q.type ?? section.kind}
        {q.marks > 0 && <span style={{ marginLeft: 6, fontWeight: 400 }}>({q.marks} mark{q.marks !== 1 ? 's' : ''})</span>}
        {hasWarning && <span style={{ marginLeft: 8, color: '#d97706' }}>⚠ Review needed</span>}
      </div>

      {/* Question text */}
      <div style={{ fontSize: 14, color: '#0e2a32', lineHeight: 1.5, marginBottom: q.options?.length > 0 || q.hasDiagram ? 8 : 0 }}>
        {q.text || <em style={{ color: '#94a3b8' }}>No text extracted</em>}
      </div>

      {/* MCQ options */}
      {q.options?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
          {q.options.map((opt, i) => (
            <div key={i} style={{ fontSize: 13, color: '#566f76' }}>
              {String.fromCharCode(65 + i)}. {opt}
            </div>
          ))}
        </div>
      )}

      {/* Fill blanks */}
      {q.type === 'fill_blanks' && q.statements?.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {q.statements.map((s, i) => (
            <div key={i} style={{ fontSize: 13, color: '#566f76' }}>{s.text}</div>
          ))}
          {q.wordBank?.length > 0 && (
            <div style={{ fontSize: 12, color: '#566f76', marginTop: 4 }}>
              Word bank: {q.wordBank.join(' · ')}
            </div>
          )}
        </div>
      )}

      {/* Matching */}
      {q.type === 'matching' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
          <div>
            {(q.matchingLeft ?? []).map((item, i) => <div key={i} style={{ fontSize: 13, color: '#566f76' }}>{item}</div>)}
          </div>
          <div>
            {(q.matchingRight ?? []).map((item, i) => <div key={i} style={{ fontSize: 13, color: '#566f76' }}>{item}</div>)}
          </div>
        </div>
      )}

      {/* Diagram button */}
      {q.hasDiagram && (q.diagrams ?? []).map((diag, di) => {
        const diagId = `${sectionIndex}-${di}`
        const choiceState = diagramChoices.get(diagId)
        return (
          <button
            key={di}
            type="button"
            onClick={() => onOpenDiagramPanel(diagId, diag)}
            style={{
              marginTop: 6, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: '#fff3e8', color: '#c05c16', border: '1.5px solid #fbbf91', cursor: 'pointer',
            }}
          >
            {choiceState?.choice
              ? `Diagram: ${choiceState.choice.replace(/_/g, ' ')}`
              : 'Choose what to do with diagram ▸'}
          </button>
        )
      })}

      {/* Import warnings */}
      {hasWarning && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#d97706' }}>
          {q.importWarnings.join(' · ')}
        </div>
      )}
    </div>
  )
}

export default function ImportReviewScreen({
  open,
  pageAssets = {},
  rawSections = [],
  warnings: _warnings = [],
  fileName = 'scanned paper',
  subject = '',
  grade = '',
  onApprove,
  onCancel,
}) {
  const { diagramChoices, pageApprovalState, selectDiagramChoice, confirmDiagramChoice } = useImportReview({ rawSections, pageAssets, subject, grade })
  const [selectedPage, setSelectedPage] = useState(1)
  const [diagramPanel, setDiagramPanel] = useState(null)

  // Sync selectedPage to first available page whenever pageAssets changes
  useEffect(() => {
    const nums = Object.keys(pageAssets).map(Number).sort((a, b) => a - b)
    if (nums.length > 0) setSelectedPage(nums[0])
  }, [pageAssets])

  if (!open) return null

  const pageNumbers = Object.keys(pageAssets).map(Number).sort((a, b) => a - b)

  const pageList = pageNumbers.map(n => ({ pageNumber: n, objectUrl: pageAssets[n]?.objectUrl }))
  const pageAsset = pageAssets[selectedPage]

  // Sections on the selected page
  const pageSections = rawSections
    .map((s, i) => ({ ...s, _origIndex: i }))
    .filter(s => (s.question?.sourcePage ?? 1) === selectedPage)

  const totalQuestions = countQuestions(rawSections)

  function handleOpenDiagramPanel(diagId, diagramMeta) {
    setDiagramPanel({
      diagId,
      diagramMeta,
      cropObjectUrl: pageAsset?.objectUrl ?? null,
    })
  }

  function handleCloseDiagramPanel() {
    setDiagramPanel(null)
  }

  function handleSelectDiagramChoice(choice) {
    if (!diagramPanel) return
    selectDiagramChoice(diagramPanel.diagId, choice, {
      cropUrl: diagramPanel.cropObjectUrl,
      diagramMeta: diagramPanel.diagramMeta,
    })
  }

  function handleConfirmDiagramChoice() {
    if (!diagramPanel) return
    confirmDiagramChoice(diagramPanel.diagId)
    setDiagramPanel(null)
  }

  const activeDiagramChoiceState = diagramPanel
    ? (diagramChoices.get(diagramPanel.diagId) ?? { status: 'pending', previewUrl: null, choice: null })
    : null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5e0d6', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#566f76', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Import Review</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0e2a32', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
        </div>
        <button
          type="button"
          onClick={() => onApprove(rawSections)}
          style={{ fontSize: 12, color: '#566f76', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: '4px 8px', flexShrink: 0 }}
        >
          Quick Import (skip review)
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ padding: '6px 16px', borderRadius: 8, border: '1.5px solid #d9cfb8', background: '#f1ede1', color: '#0e2a32', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}
        >
          Cancel
        </button>
      </div>

      {/* Page strip */}
      <ImportReviewPageStrip
        pages={pageList}
        approvalState={pageApprovalState}
        selectedPage={selectedPage}
        onSelectPage={setSelectedPage}
      />

      {/* Main body: two columns */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: original page */}
        <div style={{ width: '50%', borderRight: '1px solid #e5e0d6', overflow: 'auto', background: '#f8f6ef', padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#566f76', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Original Scan — Page {selectedPage}</div>
          {pageAsset?.objectUrl ? (
            <OriginalPageViewer
              objectUrl={pageAsset.objectUrl}
              diagrams={pageSections.flatMap(s => s.question?.diagrams ?? [])}
            />
          ) : (
            <div style={{ color: '#94a3b8', fontSize: 13, padding: 24, textAlign: 'center' }}>No image for this page</div>
          )}
        </div>

        {/* Right: reconstructed questions */}
        <div style={{ width: '50%', overflow: 'auto', padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#566f76', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            AI Reconstruction — Page {selectedPage}
          </div>
          {pageSections.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: 13, padding: 24, textAlign: 'center' }}>No questions extracted for this page</div>
          ) : (
            pageSections.map((section) => (
              <SectionPreview
                key={section.id ?? section._origIndex}
                section={section}
                sectionIndex={section._origIndex}
                diagramChoices={diagramChoices}
                onOpenDiagramPanel={handleOpenDiagramPanel}
              />
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e0d6', display: 'flex', justifyContent: 'flex-end', gap: 12, background: '#fff', flexShrink: 0 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid #d9cfb8', background: '#f1ede1', color: '#0e2a32', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          type="button"
          aria-label={`Import ${totalQuestions} question${totalQuestions !== 1 ? 's' : ''}`}
          onClick={() => onApprove(rawSections)}
          style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#ff7a2e', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
        >
          Import {totalQuestions} question{totalQuestions !== 1 ? 's' : ''}
        </button>
      </div>

      {/* Diagram choice panel slide-over */}
      {diagramPanel && (
        <DiagramChoicePanel
          open={true}
          diagramMeta={diagramPanel.diagramMeta}
          cropObjectUrl={diagramPanel.cropObjectUrl}
          choiceState={activeDiagramChoiceState}
          onSelectChoice={handleSelectDiagramChoice}
          onConfirm={handleConfirmDiagramChoice}
          onClose={handleCloseDiagramPanel}
        />
      )}
    </div>
  )
}
