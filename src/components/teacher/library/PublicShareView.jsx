import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import LessonPlanView from '../views/LessonPlanView'
import WorksheetView from '../views/WorksheetView'
import FlashcardsView from '../views/FlashcardsView'
import SchemeOfWorkView from '../views/SchemeOfWorkView'
import RubricView from '../views/RubricView'
import Logo from '../../ui/Logo'
import SeoHelmet from '../../seo/SeoHelmet'

const TOOL_LABEL = {
  lesson_plan:    'Lesson plan',
  worksheet:      'Worksheet',
  flashcards:     'Flashcards',
  scheme_of_work: 'Scheme of work',
  rubric:         'Rubric',
}

/**
 * PublicShareView — public, read-only viewer for a teacher-published plan.
 *
 * Route: /share/:token   (no auth required)
 * Reads /shares/{token}. If revokedAt is set, shows a revoked message
 * rather than leaking stale content. Otherwise renders the frozen snapshot
 * of the plan the teacher shared at publish-time.
 *
 * Intentionally light chrome — no nav, no toolbar — so the page prints
 * nicely and reads as a focused document, not an app screen.
 */
export default function PublicShareView() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading')  // loading | ready | revoked | notfound | error
  const [share, setShare] = useState(null)

  useEffect(() => {
    if (!token) { setStatus('notfound'); return }
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'shares', token))
        if (cancelled) return
        if (!snap.exists()) { setStatus('notfound'); return }
        const data = snap.data()
        if (data.revokedAt) { setStatus('revoked'); return }
        setShare({ id: snap.id, ...data })
        setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          console.error('share load error', err)
          setStatus('error')
        }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const seoReady = status === 'ready' && share
  const seoTitle = seoReady ? share.title : 'Shared teacher resource'
  const seoDescription = seoReady
    ? `${TOOL_LABEL[share.tool] || 'Teacher resource'} shared from ZedExams. Open the link to view the full plan.`
    : 'A teacher resource shared from ZedExams.'

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <SeoHelmet
        title={seoTitle}
        description={seoDescription}
        path={`/share/${token || ''}`}
        type="article"
        noIndex={!seoReady}
      />
      {/* Minimal header — logo + "view on ZedExams" link */}
      <header className="bg-white border-b theme-border print:hidden">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Logo />
            <span className="hidden sm:inline text-xs font-bold text-slate-500">Shared teacher resource</span>
          </Link>
          <Link to="/" className="text-xs font-black text-orange-600 hover:underline">
            About ZedExams →
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 print:py-0 print:px-0">
        {status === 'loading' && (
          <div className="py-20 text-center text-slate-500 text-sm">Loading…</div>
        )}
        {status === 'notfound' && (
          <div className="py-20 text-center">
            <h1 className="text-2xl font-black text-slate-800 mb-2">Share link not found</h1>
            <p className="text-sm text-slate-500">This link may have been mistyped, or the teacher may have revoked it.</p>
          </div>
        )}
        {status === 'revoked' && (
          <div className="py-20 text-center">
            <h1 className="text-2xl font-black text-slate-800 mb-2">This share has been revoked</h1>
            <p className="text-sm text-slate-500">The teacher turned off public access to this plan.</p>
          </div>
        )}
        {status === 'error' && (
          <div className="py-20 text-center">
            <h1 className="text-2xl font-black text-slate-800 mb-2">Couldn't load this share</h1>
            <p className="text-sm text-slate-500">Please try again in a moment.</p>
          </div>
        )}
        {status === 'ready' && share && (
          <article className="bg-white rounded-2xl border theme-border shadow-sm p-6 sm:p-8 print:rounded-none print:border-0 print:shadow-none print:p-0">
            <header className="mb-6 pb-4 border-b theme-border print:hidden">
              <p className="text-xs font-black uppercase tracking-wider text-orange-600">{share.tool?.replace(/_/g, ' ') || 'Teacher resource'}</p>
              <h1 className="text-2xl font-black text-slate-800 mt-1">{share.title}</h1>
            </header>
            <RenderPlanByTool tool={share.tool} plan={share.plan} />
            <footer className="mt-8 pt-4 border-t theme-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 print:hidden">
              <span>
                Generated with the <Link to="/" className="font-bold text-orange-600 hover:underline">ZedExams Teacher Suite</Link>.
              </span>
              {/* WhatsApp forward — lets a teacher who received this share
                  link push it onward to a colleague with one tap. The link
                  itself stays the same (signed token, no auth needed). */}
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${share.title || 'Teacher resource'} — ${typeof window !== 'undefined' ? window.location.href : 'https://zedexams.com'}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-green-500 hover:bg-green-600 px-3 py-1.5 text-xs font-bold text-white transition-colors"
              >
                <span aria-hidden="true">💬</span> Forward on WhatsApp
              </a>
            </footer>
          </article>
        )}
      </main>
    </div>
  )
}

function RenderPlanByTool({ tool, plan }) {
  if (!plan) return <p className="text-sm text-slate-500 italic">Empty plan.</p>
  switch (tool) {
    case 'lesson_plan':    return <LessonPlanView plan={plan} />
    case 'worksheet':      return <WorksheetView output={plan} showAnswers={false} />
    case 'flashcards':     return <FlashcardsView output={plan} />
    case 'scheme_of_work': return <SchemeOfWorkView output={plan} />
    case 'rubric':         return <RubricView output={plan} />
    default:
      return <pre className="text-xs whitespace-pre-wrap bg-slate-50 p-3 rounded-lg">{JSON.stringify(plan, null, 2)}</pre>
  }
}
