/**
 * ImportQuizPanel — Word/PDF document upload UI for quiz creation and
 * editing. Used by both CreateQuizV2 (new quiz from scratch) and
 * EditQuizV2 (e.g. populating a past-paper-linked quiz).
 *
 * The parent owns the busy state, the most-recent import summary, and
 * the actual call to documentQuizImporter.importQuizDocument(). This
 * component is purely presentational + file-picker.
 */

import { useState } from 'react'
import { QUIZ_DOCUMENT_ACCEPT } from './documentQuizImporter'

export default function ImportQuizPanel({
  importing,
  importSummary,
  onImport,
  intro,
  title = 'Import Quiz (Word/PDF)',
}) {
  // Bump the input key after each pick so re-selecting the same file
  // still fires onChange — without this, a teacher who chose the wrong
  // file would have to refresh to retry the same path.
  const [inputKey, setInputKey] = useState(0)

  return (
    <div className="theme-accent-bg theme-border space-y-4 rounded-2xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="theme-text font-black">{title}</h2>
          <p className="theme-text mt-1 max-w-3xl text-sm font-bold leading-relaxed">
            {intro || 'Upload a .doc, .docx, or .pdf file. ZedExams will extract questions, options, short answers, and image-based questions into editable cards, then use smart cleanup on tricky formatting when available.'}
          </p>
        </div>
        <label className="theme-accent-fill theme-on-accent cursor-pointer rounded-xl px-4 py-2.5 text-sm font-black">
          {importing ? 'Importing...' : 'Choose File'}
          <input
            key={inputKey}
            type="file"
            accept={QUIZ_DOCUMENT_ACCEPT}
            className="hidden"
            disabled={importing}
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) onImport(file)
              setInputKey(current => current + 1)
            }}
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="theme-card theme-border rounded-xl border p-3">
          <p className="theme-accent-text text-xs font-black uppercase tracking-wide">Editable import</p>
          <p className="theme-text mt-1 text-xs font-bold leading-relaxed">The document is converted into editable quiz cards, not embedded as a static file.</p>
        </div>
        <div className="theme-card theme-border rounded-xl border p-3">
          <p className="theme-accent-text text-xs font-black uppercase tracking-wide">Images</p>
          <p className="theme-text mt-1 text-xs font-bold leading-relaxed">DOCX images and PDF snapshots attach to matching questions and upload when you save.</p>
        </div>
        <div className="theme-card theme-border rounded-xl border p-3">
          <p className="theme-accent-text text-xs font-black uppercase tracking-wide">Needs review</p>
          <p className="theme-text mt-1 text-xs font-bold leading-relaxed">Unclear answers, diagrams, and imperfect extraction are marked before publishing.</p>
        </div>
      </div>
      {importSummary && (
        <div className={`rounded-xl border px-4 py-3 ${
          importSummary.importStatus === 'needs_review'
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'theme-card theme-border theme-text'
        }`}>
          <p className="text-sm font-black">
            Imported {importSummary.questions} question{importSummary.questions === 1 ? '' : 's'} from {importSummary.fileName}
          </p>
          <p className="mt-1 text-xs font-bold leading-relaxed">
            {importSummary.smartApplied ? 'Smart cleanup applied · ' : ''}
            {importSummary.passages ? `${importSummary.passages} passage${importSummary.passages === 1 ? '' : 's'} detected · ` : ''}
            {importSummary.images} image-based question{importSummary.images === 1 ? '' : 's'} · {importSummary.needsReview} need review · Status: {importSummary.importStatus}
          </p>
          {importSummary.warnings?.length ? (
            <ul className="mt-2 space-y-0.5">
              {importSummary.warnings.slice(0, 3).map((warning, index) => (
                <li key={`${warning}-${index}`} className="text-xs font-bold leading-relaxed">{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  )
}
