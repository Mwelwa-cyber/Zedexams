/**
 * TimetableViewerPage — /timetable
 *
 * Inline PDF viewer for the 2026 Grade-7 PSLE exam timetable.
 * Exists specifically because Android/Capacitor WebViews cannot open a
 * `<a href=".pdf" target="_blank">` link — the external-browser intent
 * is intercepted, and the user sees nothing.  Rendering the PDF inside
 * the app via PdfJsViewer avoids that entirely, and also works on web.
 *
 * TEMPORARY: remove this file, its route in App.jsx, and the bundled
 * PDF (/public/timetables/grade-7-2026-exam-timetable.pdf) once the
 * 2026 exams conclude.
 */

import { Link } from 'react-router-dom'
import Navbar from '../layout/Navbar'
import SeoHelmet from '../seo/SeoHelmet'
import PdfJsViewer from '../papers/PdfJsViewer'

const TIMETABLE_PDF_URL = '/timetables/grade-7-2026-exam-timetable.pdf'

export default function TimetableViewerPage() {
  return (
    <div className="theme-bg theme-text min-h-screen">
      <SeoHelmet title="2026 Exam Timetable" path="/timetable" noIndex />
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-rose-700">
              Grade 7 · ECZ 2026
            </p>
            <h1 className="mt-0.5 text-xl font-black text-slate-900">
              2026 Primary School Leaving Examination — Timetable
            </h1>
          </div>
          <Link to="/dashboard" className="text-[11px] font-bold text-slate-700 hover:text-slate-900 shrink-0">
            ← Dashboard
          </Link>
        </div>
        <PdfJsViewer
          url={TIMETABLE_PDF_URL}
          title="2026 PSLE Exam Timetable"
        />
      </div>
    </div>
  )
}
