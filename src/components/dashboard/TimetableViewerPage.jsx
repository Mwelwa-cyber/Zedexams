/**
 * TimetableViewerPage — /timetable/pdf
 *
 * Inline viewer for the OFFICIAL ECZ timetable PDF, reached from the
 * "View Official ECZ Timetable (PDF)" button on the interactive
 * /timetable page (features/examTimetable/pages/ExamTimetablePage.jsx), which
 * replaced this as the default view — the A4 PDF forced pinch-zooming
 * on phones.
 *
 * The inline viewer itself stays because Android/Capacitor WebViews
 * cannot open a `<a href=".pdf" target="_blank">` link — the
 * external-browser intent is intercepted, and the user sees nothing.
 * Rendering the PDF inside the app avoids that entirely, and also
 * works on web.
 *
 * Uses the continuous PdfScrollViewer (not the page-by-page PdfJsViewer):
 * the timetable is only a few pages, so it should open like a native PDF
 * — full-bleed on a phone, scroll straight down through the pages.
 *
 * The PDF path is hardcoded to the bundled 2026 asset for now; when a
 * new year's PDF ships, either replace the asset or thread the active
 * timetable's `pdfUrl` (examTimetables doc) through a validated query
 * param.
 */

import { Link } from 'react-router-dom'
import SeoHelmet from '../seo/SeoHelmet'
import PdfScrollViewer from '../../shared/components/PdfScrollViewer'

const TIMETABLE_PDF_URL = '/timetables/grade-7-2026-exam-timetable.pdf'

export default function TimetableViewerPage() {
  return (
    <div className="theme-bg theme-text min-h-screen flex flex-col">
      <SeoHelmet title="2026 Exam Timetable (Official PDF)" path="/timetable/pdf" noIndex />

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
            to="/timetable"
            className="shrink-0 text-[11px] font-bold theme-text-muted hover:theme-text"
          >
            ← Timetable
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
