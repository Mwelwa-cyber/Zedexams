import { useNavigate } from 'react-router-dom'

/**
 * ComingSoon — reusable empty-state / under-development card.
 *
 * Props:
 *   title       — override the heading (default: "Coming Soon")
 *   message     — override the body text
 *   icon        — emoji shown above the title (default: "🚀")
 *   showQuizBtn — show the "Start a Quiz" button (default: true)
 *   onClearFilters — if provided, shows a "Clear Filters" button instead of
 *                    the full Coming Soon UI (for filtered-empty states)
 */
export default function ComingSoon({
  title         = 'Coming Soon',
  message       = 'This section is under development.',
  icon          = '🚀',
  showQuizBtn   = true,
  onClearFilters,
}) {
  const navigate = useNavigate()

  // ── Filtered-empty variant (lighter treatment) ─────────────────────────
  if (onClearFilters) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 py-14 px-6 text-center animate-fade-in">
        <div className="text-5xl mb-3">🔍</div>
        <p className="font-black text-gray-700 text-base">No results found</p>
        <p className="text-gray-400 text-sm mt-1">Try adjusting or clearing your filters</p>
        <button
          onClick={onClearFilters}
          className="mt-4 text-green-600 font-bold text-sm border border-green-200 px-5 py-2 rounded-full hover:bg-green-50 transition-colors min-h-0"
        >
          Clear Filters
        </button>
      </div>
    )
  }

  // ── Full Coming Soon variant ────────────────────────────────────────────
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4 animate-fade-in">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm w-full max-w-sm p-8 text-center">

        {/* Animated icon */}
        <div className="text-6xl mb-4 animate-bounce-slow inline-block">{icon}</div>

        {/* Decorative dots */}
        <div className="flex justify-center gap-1.5 mb-5">
          {[0, 150, 300].map(d => (
            <div
              key={d}
              className="w-2 h-2 bg-green-400 rounded-full animate-bounce"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
        </div>

        {/* Title */}
        <h2 className="text-2xl font-black text-gray-800 mb-2">{title}</h2>

        {/* Message */}
        <p className="text-gray-500 text-sm leading-relaxed mb-6">{message}</p>

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          {showQuizBtn && (
            <button
              onClick={() => navigate('/quizzes')}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-black py-3 rounded-2xl transition-colors shadow-sm"
            >
              ✏️ Start a Quiz
            </button>
          )}
          <button
            onClick={() => navigate(-1)}
            className="w-full border-2 border-gray-200 hover:border-gray-300 text-gray-600 font-black py-3 rounded-2xl transition-colors min-h-0"
          >
            ← Go Back
          </button>
        </div>
      </div>
    </div>
  )
}
