import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import Button from '../../../components/ui/Button'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import { previewImport, runImport, regradeExistingQuestions } from '../lib/questionBankImport'
import { bulkApproveOwnedPending } from '../lib/adminQuestionBankService'

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
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(null)
  const [regrading, setRegrading] = useState(false)
  const [regrade, setRegrade] = useState(null) // { found, regraded, unchanged } | { phase, ... }

  async function onPreview() {
    setPhase('previewing'); setError(''); setPreview(null)
    try {
      setPreview(await previewImport({ uid: currentUser?.uid }))
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

  async function onApproveAll() {
    if (!currentUser?.uid) { setError('Please sign in as an admin.'); return }
    if (!window.confirm(
      'Approve all your still-pending imported questions into the Master Bank now?\n\n' +
      'This makes them available to every teacher’s smart paper generation.',
    )) return
    setApproving(true); setError(''); setApproved(null)
    const { approved: n, error: err } = await bulkApproveOwnedPending(
      currentUser.uid,
      (p) => setApproved(p.approved),
    )
    setApproving(false)
    if (err) { setError(err); return }
    setApproved(n)
  }

  async function onRegrade() {
    if (!currentUser?.uid) { setError('Please sign in as an admin.'); return }
    if (!window.confirm(
      'Re-grade your imported questions and re-file each under the grade it really belongs to?\n\n' +
      'This re-checks every imported question (quizzes and exam papers) and reads the tricky ones with the AI ' +
      '(uses a little AI credit) — it fixes the past/exam papers that mix Grades 4–7.',
    )) return
    setRegrading(true); setError(''); setRegrade(null)
    try {
      const totals = await regradeExistingQuestions({
        uid: currentUser.uid,
        onProgress: (p) => setRegrade(p),
      })
      setRegrade(totals)
    } catch (e) {
      setError(e?.message || 'Re-grade failed.')
    }
    setRegrading(false)
  }

  const busy = phase === 'previewing' || phase === 'importing' || approving || regrading
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
          <li><b>Import</b> adds the questions straight to the shared Master Bank, so every teacher can see and reuse them.</li>
          <li>Keep this tab open while it runs. It’s safe to re-run — already-added questions are skipped, and any earlier import still sitting in review is published.</li>
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
          <p>✅ Already in the Master Bank (will skip): <b>{preview.alreadyBanked}</b></p>
          <p>➕ Will be added to the Master Bank: <b>{preview.toImport}</b></p>
          {preview.toPromote > 0 && (
            <p>⬆️ Earlier imports to publish to the Master Bank: <b>{preview.toPromote}</b></p>
          )}
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
            {progress.promoted > 0 && <span>Published from earlier import: <b>{progress.promoted}</b></span>}
            <span>Skipped (already there): <b>{progress.skipped}</b></span>
            <span>Re-graded: <b>{progress.regraded}</b></span>
          </div>
          {phase === 'done' && (
            <p className="text-sm text-green-700 font-bold">
              Added {progress.imported + (progress.promoted || 0)} questions to the Master Bank. They’re now visible
              to every teacher in the Question Bank, inside the{' '}
              <a className="underline" href="/teacher/assessment-papers/new?view=bank">Assessment Paper Studio</a>.
            </p>
          )}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
        <div>
          <p className="font-black text-amber-900">⚡ Push imported questions live now</p>
          <p className="text-amber-800 text-sm mt-1">
            After importing, questions sit waiting for the AI reviewer — until they’re approved they
            show as <b>“0 from the Master Bank”</b> and won’t appear in smart paper generation. Click below
            to approve all of your still-pending questions into the Master Bank straight away.
          </p>
        </div>
        <Button variant="primary" disabled={busy} onClick={onApproveAll}>
          {approving ? `Approving… (${approved ?? 0})` : 'Approve all into the Master Bank'}
        </Button>
        {approved != null && !approving && (
          <p className="text-sm text-green-700 font-bold">
            ✓ Approved {approved} question{approved === 1 ? '' : 's'} into the Master Bank. They’re live now.
          </p>
        )}
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 space-y-3">
        <div>
          <p className="font-black text-purple-900">🎯 Fix mixed grades (re-grade imported questions)</p>
          <p className="text-purple-800 text-sm mt-1">
            Past papers and exam papers mix grades — a Grade 7 paper pulls questions from Grades 4–7 — and the import
            filed them all under the paper’s grade. This re-checks every imported question (quizzes and exam papers):
            a clear syllabus match wins, otherwise the AI reads the question and re-files it under the grade it really
            belongs to. Uses a little AI credit; safe to re-run.
          </p>
        </div>
        <Button variant="primary" disabled={busy} onClick={onRegrade}>
          {regrading
            ? `Re-grading… (${regrade?.processed ?? 0}/${regrade?.found ?? '…'})`
            : 'Re-grade imported questions'}
        </Button>
        {regrade && !regrading && (
          <p className="text-sm text-green-700 font-bold">
            ✓ Checked {regrade.found} imported question{regrade.found === 1 ? '' : 's'} — re-filed{' '}
            <b>{regrade.regraded}</b> under a corrected grade, {regrade.unchanged} were already right.
          </p>
        )}
      </div>
    </div>
  )
}
