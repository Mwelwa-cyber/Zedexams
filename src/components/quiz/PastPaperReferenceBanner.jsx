/**
 * PastPaperReferenceBanner — sits at the top of the quiz editor when a
 * quiz was auto-converted from a past paper (sourcePastPaperId is set).
 *
 * Shows two quick-access download links: the original paper PDF and
 * the mark scheme PDF (when one exists). The admin reviewing an
 * auto-converted quiz almost always needs to consult the mark scheme
 * to fill in correctAnswer fields — without this they'd have to leave
 * the editor, navigate to /admin/papers, find the paper, click Edit,
 * download the mark scheme, then come back.
 *
 * Renders nothing when the quiz wasn't from a past paper.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { resolvePaperUrl } from '../../utils/pastPapers'

export default function PastPaperReferenceBanner({ quiz }) {
  const [paperUrl, setPaperUrl] = useState(null)
  const [markSchemeUrl, setMarkSchemeUrl] = useState(null)

  const paperPath = quiz?.sourcePastPaperPdfPath
  const markSchemePath = quiz?.sourceMarkSchemePath
  const pastPaperId = quiz?.sourcePastPaperId

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (paperPath) {
        try {
          const url = await resolvePaperUrl(paperPath)
          if (!cancelled) setPaperUrl(url)
        } catch {
          // Storage 404 or permission issue — banner just hides the link.
        }
      }
      if (markSchemePath) {
        try {
          const url = await resolvePaperUrl(markSchemePath)
          if (!cancelled) setMarkSchemeUrl(url)
        } catch {
          // ignore — banner hides the link.
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [paperPath, markSchemePath])

  if (!pastPaperId) return null

  return (
    <section className="rounded-2xl border-2 border-violet-200 bg-violet-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wider text-violet-700">
            Auto-converted from past paper
          </p>
          <p className="mt-1 text-sm text-violet-900">
            Use the original PDF and (where present) the mark scheme to fill in <code>correctAnswer</code> fields below before publishing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {paperUrl && (
            <a
              href={paperUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-violet-600 px-3 py-1.5 font-black text-white no-underline hover:bg-violet-700"
            >
              📄 View paper PDF
            </a>
          )}
          {markSchemeUrl && (
            <a
              href={markSchemeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-black text-white no-underline hover:bg-emerald-700"
            >
              ✓ View mark scheme
            </a>
          )}
          {!markSchemeUrl && !markSchemePath && (
            <Link
              to={`/admin/papers/${pastPaperId}/edit`}
              className="rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-1.5 font-black text-amber-800 no-underline hover:bg-amber-100"
              title="No mark scheme attached on the source paper — upload one for faster review"
            >
              + Add mark scheme to paper
            </Link>
          )}
          <Link
            to={`/admin/papers/${pastPaperId}/edit`}
            className="rounded-lg border-2 border-violet-300 bg-white px-3 py-1.5 font-black text-violet-700 no-underline hover:bg-violet-50"
          >
            Source paper →
          </Link>
        </div>
      </div>
    </section>
  )
}
