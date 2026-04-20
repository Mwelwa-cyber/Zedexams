import { Link } from 'react-router-dom'

/**
 * Shared chrome for every /games page. Provides the light-themed layout,
 * a sticky nav, and a breadcrumb strip.
 *
 * `crumbs` is an array of { label, to? } — the last one is unlinked.
 */
export default function GamesShell({ crumbs = [], children, maxW = 'max-w-5xl' }) {
  return (
    <div className="force-light-theme min-h-screen bg-slate-50 text-slate-900">
      <nav className="border-b border-slate-200 bg-white/95 backdrop-blur sticky top-0 z-20">
        <div className={`${maxW} mx-auto px-4 sm:px-6 py-3 flex items-center justify-between`}>
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden="true">📘</span>
            <span className="font-black text-lg">ZedExams</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-amber-100 text-amber-800">
              Games
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/teachers" className="hidden sm:block text-sm font-bold text-slate-700 hover:text-slate-900">For Teachers</Link>
            <Link to="/login" className="hidden sm:block text-sm font-bold text-slate-700 hover:text-slate-900">Sign in</Link>
            <Link
              to="/register"
              className="px-3 py-2 sm:px-4 rounded-xl text-xs sm:text-sm font-black text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
            >
              Save scores
            </Link>
          </div>
        </div>
      </nav>

      {crumbs.length > 0 && (
        <div className="bg-white border-b border-slate-200">
          <div className={`${maxW} mx-auto px-4 sm:px-6 py-3 flex items-center flex-wrap gap-1 text-sm`}>
            <Link to="/games" className="font-bold text-slate-600 hover:text-slate-900">Games</Link>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-slate-400">/</span>
                {c.to ? (
                  <Link to={c.to} className="font-bold text-slate-600 hover:text-slate-900">{c.label}</Link>
                ) : (
                  <span className="font-black text-slate-900">{c.label}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <main className={`${maxW} mx-auto px-4 sm:px-6 py-8 sm:py-10`}>
        {children}
      </main>
    </div>
  )
}
