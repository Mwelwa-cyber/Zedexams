import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import Button from '../ui/Button'
import SeoHelmet from '../seo/SeoHelmet'
import { previewImport, runImport } from '../../utils/questionBankImport'

/**
 * Admin → Import questions. One-click backfill of the platform's existing
 * quiz + exam-paper questions into the Central Question Bank, regraded by the
 * CBC syllabus. Runs in the admin's browser with a progress bar; idempotent.
 */
export default function ImportQuestionBankPanel() {
  const { currentUser } = useAuth()
  const [useAi, setUseAi] = useState(true)
  const [preview, setPreview] = useState(null)
  const [progress, setProgress] = useState(null)
  const [phase, setPhase] = useState('idle') // idle | previewing | importing | done | error
  const [error, setError] = useState('')

  async function onPreview() {
    setPhase('previewing'); setError(''); setPreview(null)
    try {
      setPreview(await previewImport())
      setPhase('idle')
    } catch (e) {
      setError(e?.message || 'Preview failed.'); setPhase('error')
    }
  }

  async function onImport() {
    if (!currentUser?.uid) { setError('Please sign in as an admin.'); setPhase('error'); return }
    setPhase('importing'); setError(''); setProgress(null)
    try {
      const totals = await runImport({
        uid: currentUser.uid,
        useAi,
        onProgress: (p) => setProgress(p),
      })
      setProgress(totals)
      setPhase('done')
    } catch (e) {
      setError(e?.message || 'Import failed.'); setPhase('error')
    }
  }

  const busy = phase === 'previewing' || phase === 'importing'
  const pct = progress && progress.found
    ? Math.min(100, Math.round((progress.processed / progress.found) * 100))
    : 0

  return (
    <div className="space-y-5 max-w-2xl">
      <SeoHelmet title="Import questions" noIndex />

      <div>
        <h1 className="text-2xl font-black text-gray-800">📥 Import existing questions</h1>
        <p className="text-gray-500 text-sm mt-1">
          This adds the questions already on ZedExams — from your published quizzes and exam papers —
          into the Question Bank, and files each one under the grade it belongs to (using the syllabus).
          New questions are added automatically; this is a one-time catch-up for the older ones.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-900 space-y-1">
        <p className="font-bold">Before you start</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Click <b>Preview</b> first — it just counts, it changes nothing.</li>
          <li><b>Import</b> adds the questions and the AI reviews each one (uses a little AI credit).</li>
          <li>Keep this tab open while it runs. It’s safe to re-run — already-added questions are skipped.</li>
        </ul>
      </div>

      <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
        <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} disabled={busy} />
        Let AI work out the grade for tricky questions (recommended)
      </label>

      <div className="flex gap-2">
        <Button variant="secondary" disabled={busy} onClick={onPreview}>
          {phase === 'previewing' ? 'Counting…' : 'Preview'}
        </Button>
        <Button variant="primary" disabled={busy || !preview} onClick={onImport}>
          {phase === 'importing' ? 'Importing…' : 'Import now'}
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">⚠ {error}</div>
      )}

      {preview && (
        <div className="bg-white border theme-border rounded-2xl p-4 text-sm space-y-1">
          <p className="font-black text-gray-800">Preview</p>
          <p>📚 Questions found: <b>{preview.found}</b></p>
          <p>✅ Already in the bank (will skip): <b>{preview.alreadyBanked}</b></p>
          <p>➕ Will be imported: <b>{preview.toImport}</b></p>
          <p className="text-gray-500 text-xs pt-1">
            Of those: {preview.regrade.syllabus} graded straight from the syllabus,
            {' '}{preview.regrade.needsAi} need the AI to decide the grade,
            {' '}{preview.regrade.unchanged} keep their current grade.
          </p>
        </div>
      )}

      {(phase === 'importing' || phase === 'done') && progress && (
        <div className="bg-white border theme-border rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-sm font-bold text-gray-700">
            <span>{phase === 'done' ? 'Done ✓' : `Working… (${progress.phase})`}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-xs text-gray-500 flex gap-4 flex-wrap">
            <span>Imported: <b>{progress.imported}</b></span>
            <span>Skipped (already there): <b>{progress.skipped}</b></span>
            <span>Re-graded: <b>{progress.regraded}</b></span>
          </div>
          {phase === 'done' && (
            <p className="text-sm text-green-700 font-bold">
              Imported {progress.imported} questions. They’re now being reviewed and will appear in the
              {' '}Question Bank shortly — check <a className="underline" href="/admin/question-review">Question review</a>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
