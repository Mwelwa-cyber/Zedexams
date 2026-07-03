/**
 * OfflineLibraryPage — the learner/teacher home for offline content (Objectives
 * 6 & 7). Two parts:
 *   • The Storage panel (usage breakdown + management actions).
 *   • The Offline Library: the items the user explicitly downloaded (pinned),
 *     grouped by type, each removable.
 *
 * Routed at /offline. Lazy-loaded in App.jsx like every other page.
 */
import { useCallback, useEffect, useState } from 'react'
import StorageSettingsPanel from './StorageSettingsPanel.jsx'
import { listEntries } from './offlineStore.js'
import { unpin } from './contentCache.js'
import { formatBytes } from './storageStatsCore.js'

const TYPE_LABELS = {
  quiz: 'Quizzes', test: 'Tests', exam: 'Exams', 'exam-paper': 'Exam papers',
  lesson: 'Lessons', 'lesson-notes': 'Lesson notes', note: 'Notes',
  worksheet: 'Worksheets', flashcards: 'Flashcards', 'past-paper': 'Past papers',
  curriculum: 'Curriculum', image: 'Images', diagram: 'Diagrams',
}

export default function OfflineLibraryPage() {
  const [pinned, setPinned] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const entries = await listEntries()
    setPinned(entries.filter((e) => e.pinned))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const remove = useCallback(async (entry) => {
    await unpin(entry.type, entry.id)
    await load()
  }, [load])

  const grouped = pinned.reduce((acc, e) => {
    (acc[e.type] = acc[e.type] || []).push(e)
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold text-slate-900 dark:text-white">Offline Library</h1>
      <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
        Content you&apos;ve downloaded works without internet and is never removed automatically.
      </p>

      <StorageSettingsPanel />

      <section className="mt-6">
        <h2 className="mb-2 text-base font-semibold text-slate-900 dark:text-white">Downloaded for offline use</h2>
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : pinned.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
            Nothing downloaded yet. Tap “Download for offline use” on a quiz, note, or paper to keep it here.
          </p>
        ) : (
          Object.entries(grouped).map(([type, items]) => (
            <div key={type} className="mb-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {TYPE_LABELS[type] || type} ({items.length})
              </h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                {items.map((e) => (
                  <li key={e.key} className="flex items-center justify-between px-3 py-2">
                    <span className="truncate text-sm text-slate-700 dark:text-slate-200">{e.id}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs tabular-nums text-slate-400">{formatBytes(e.size)}</span>
                      <button
                        type="button"
                        onClick={() => remove(e)}
                        className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
