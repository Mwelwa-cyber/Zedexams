/**
 * TimetableViewerPage — /timetable
 *
 * Inline PDF viewer for the 2026 Grade-7 PSLE exam timetable.
 * Exists specifically because Android/Capacitor WebViews cannot open a
 * `<a href=".pdf" target="_blank">` link — the external-browser intent
 * is intercepted, and the user sees nothing.  Rendering the PDF inside
 * the app avoids that entirely, and also works on web.
 *
 * Uses the continuous PdfScrollViewer (not the page-by-page PdfJsViewer):
 * the timetable is only a few pages, so it should open like a native PDF
 * — full-bleed on a phone, scroll straight down through the pages.
 *
 * TEMPORARY: remove this file, its route in App.jsx, the PdfScrollViewer
 * if unused elsewhere, and the bundled PDF
 * (/public/timetables/grade-7-2026-exam-timetable.pdf) once the 2026
 * exams conclude.
 */

import { Link } from 'react-router-dom'
import SeoHelmet from '../seo/SeoHelmet'
import PdfScrollViewer from '../papers/PdfScrollViewer'

const TIMETABLE_PDF_URL = '/timetables/grade-7-2026-exam-timetable.pdf'

export default function TimetableViewerPage() {
  return (
    <div className="theme-bg theme-text min-h-screen flex flex-col">
      <SeoHelmet title="2026 Exam Timetable" path="/timetable" noIndex />

      {/* Compact sticky header so the timetable itself gets the screen.
          Back link stays reachable while scrolling through the pages. */}
      <header className="sticky top-0 z-10 theme-bg border-b theme-border">
        <div className="mx-auto max-w-3xl px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">
              Grade 7 · ECZ 2026
            </p>
            <h1 className="truncate text-sm font-black theme-text">
              2026 PSLE Exam Timetable
            </h1>
          </div>
          <Link
            to="/dashboard"
            className="shrink-0 text-[11px] font-bold theme-text-muted hover:theme-text"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      {/* Full-bleed on phones (edge-to-edge), centred with a readable max
          width on larger screens. The pages stack and the page scrolls. */}
      <main className="flex-1 w-full">
        <div className="mx-auto max-w-3xl px-0 sm:px-4 py-3 sm:py-4">
          <PdfScrollViewer
            url={TIMETABLE_PDF_URL}
            title="2026 PSLE Exam Timetable"
          />
        </div>
      </main>
    </div>
  )
}
