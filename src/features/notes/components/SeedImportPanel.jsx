// src/features/notes/components/SeedImportPanel.jsx
//
// Admin-only one-click importer for the Grade-7 sample content (Integrated
// Science + Social Studies): creates the study notes + their practice quizzes (published) and
// links them. Idempotent — notes already imported (matched by seedKey) are
// skipped, so it's safe to re-run. The heavy seed bundle is lazy-loaded only
// when the panel is opened, to keep the admin notes list lean.

import { useRef, useState } from 'react'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import { Sparkles, Loader2, Check, X as XIcon } from '../../../components/ui/icons'
import { createNote, updateNote, publishNote } from '../lib/firestore'

const STATUS_META = {
  created:  { icon: '✓', cls: 'text-emerald-600' },
  relinked: { icon: '↻', cls: 'text-blue-600' },
  skipped:  { icon: '↷', cls: 'text-neutral-400' },
  failed:   { icon: '✗', cls: 'text-red-600' },
}

export function SeedImportPanel() {
  const { currentUser } = useAuth()
  const { createQuiz, saveQuestions } = useFirestore()
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState(null)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState([])
  const [result, setResult] = useState(null)
  const modRef = useRef(null)

  const openPanel = async () => {
    setOpen(true); setResult(null); setLog([]); setSummary(null)
    if (!modRef.current) modRef.current = await import('../lib/seedImport')
    setSummary(modRef.current.seedSummary())
  }
  const close = () => { if (!running) setOpen(false) }

  const findBySeedKey = async (key) => {
    const snap = await getDocs(query(collection(db, 'lessons'), where('seedKey', '==', key), limit(1)))
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  }

  const run = async () => {
    if (!modRef.current || !currentUser?.uid) return
    setRunning(true); setLog([]); setResult(null)
    try {
      const res = await modRef.current.importGrade7Seed({
        createQuiz, saveQuestions, createNote, updateNote, publishNote, findBySeedKey,
        currentUid: currentUser.uid,
        onProgress: (evt) => setLog((l) => [...l, evt]),
      })
      setResult(res)
    } catch (err) {
      setResult({ error: err?.message || String(err) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <button
        onClick={openPanel}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-sm font-medium transition hover:scale-[1.02] active:scale-[0.98] shadow-sm bg-emerald-600"
        title="Import the Grade-7 sample study notes + quizzes (Integrated Science + Social Studies)"
      >
        <Sparkles size={16} /> Import Grade-7 set
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Import sample content" className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center notes-studio">
          <div aria-hidden="true" onClick={close} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full sm:max-w-lg max-h-[90vh] bg-white border border-neutral-200 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <header className="p-4 border-b border-neutral-100 flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Sample content</p>
                <h3 className="font-display text-xl text-neutral-900 mt-0.5">Import Grade-7 study notes</h3>
              </div>
              <button type="button" onClick={close} disabled={running} aria-label="Close" className="text-neutral-400 hover:text-neutral-700 disabled:opacity-40 rounded-full p-2"><XIcon size={18} /></button>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              {!result && (
                <p className="text-sm text-neutral-700 leading-relaxed">
                  {summary
                    ? <>This creates <strong>{summary.notes} study notes</strong> + <strong>{summary.quizzes} practice quizzes</strong> ({summary.questions} questions), published for Grade&nbsp;7. Notes already imported are <strong>skipped</strong>, so it's safe to run again.</>
                    : 'Loading…'}
                </p>
              )}

              {(running || log.length > 0) && (
                <ul className="mt-4 space-y-1 text-sm">
                  {log.map((e, i) => {
                    const m = STATUS_META[e.status] || STATUS_META.skipped
                    return (
                      <li key={i} className="flex items-start gap-2">
                        <span className={`${m.cls} font-bold`}>{m.icon}</span>
                        <span className="flex-1 min-w-0">
                          <span className="text-neutral-800">{e.title}</span>
                          {e.status === 'failed' && e.error && <span className="block text-xs text-red-600 truncate">{e.error}</span>}
                        </span>
                      </li>
                    )
                  })}
                  {running && <li className="flex items-center gap-2 text-neutral-400"><Loader2 size={14} className="animate-spin" /> Working…</li>}
                </ul>
              )}

              {result && (
                <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
                  {result.error ? (
                    <p className="text-red-600">Import failed: {result.error}</p>
                  ) : (
                    <p className="text-neutral-800">
                      <Check size={14} className="inline text-emerald-600" /> Done — <strong>{result.created}</strong> created
                      {result.relinked ? <>, <strong>{result.relinked}</strong> quiz-linked</> : ''}
                      {', '}{result.skipped} skipped{result.failed ? <>, <span className="text-red-600">{result.failed} failed</span></> : ''}
                      {' '}· {result.quizzes} quizzes created.
                    </p>
                  )}
                </div>
              )}
            </div>

            <footer className="p-4 border-t border-neutral-100 flex justify-end gap-2">
              {!result ? (
                <>
                  <button type="button" onClick={close} disabled={running} className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Cancel</button>
                  <button type="button" onClick={run} disabled={running || !summary} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1.5">
                    {running ? <><Loader2 size={14} className="animate-spin" /> Importing…</> : 'Import now'}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:opacity-90">Done</button>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  )
}

export default SeedImportPanel
