import { useNavigate } from 'react-router-dom'
import { PencilLine, ArrowLeft, Search, Sparkles } from './icons'
import Button from './Button'
import Icon from './Icon'

/**
 * ComingSoon — reusable empty-state / under-development card.
 *
 * Props:
 *   title       — override the heading (default: "Coming Soon")
 *   message     — override the body text
 *   icon        — Heroicons component shown above the title
 *   showQuizBtn — show the "Start a Quiz" button (default: true)
 *   onClearFilters — if provided, shows a "Clear Filters" button instead of
 *                    the full Coming Soon UI (for filtered-empty states)
 */
export default function ComingSoon({
  title         = 'Coming Soon',
  message       = 'This section is under development.',
  icon          = Sparkles,
  showQuizBtn   = true,
  onClearFilters,
}) {
  const navigate = useNavigate()

  // ── Filtered-empty variant (lighter treatment) ─────────────────────────
  if (onClearFilters) {
    return (
      <div className="theme-card border theme-border rounded-2xl py-14 px-6 text-center animate-fade-in">
        <Icon as={Search} size="xl" className="mx-auto mb-3 theme-text-muted" />
        <p className="font-black theme-text text-base">No results found</p>
        <p className="theme-text-muted text-sm mt-1">Try adjusting or clearing your filters</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={onClearFilters}
          className="mt-4"
        >
          Clear Filters
        </Button>
      </div>
    )
  }

  // ── Full Coming Soon variant ────────────────────────────────────────────
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4 animate-fade-in">
      <div className="theme-card border theme-border rounded-3xl shadow-elev-sm w-full max-w-sm p-8 text-center">

        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl theme-accent-bg theme-accent-text animate-bounce-slow">
          {typeof icon === 'string' || !icon
            ? icon
            : <Icon as={icon} size="xl" strokeWidth={2.1} />}
        </div>

        {/* Decorative dots */}
        <div className="flex justify-center gap-1.5 mb-5" aria-hidden="true">
          {[0, 150, 300].map(d => (
            <div
              key={d}
              className="w-2 h-2 theme-accent-fill rounded-full animate-bounce"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
        </div>

        <h2 className="text-display-md theme-text mb-2">{title}</h2>
        <p className="theme-text-muted text-body-sm mb-6">{message}</p>

        <div className="flex flex-col gap-3">
          {showQuizBtn && (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              leadingIcon={<Icon as={PencilLine} size="sm" />}
              onClick={() => navigate('/quizzes')}
            >
              Start a Quiz
            </Button>
          )}
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            leadingIcon={<Icon as={ArrowLeft} size="sm" />}
            onClick={() => navigate(-1)}
          >
            Go Back
          </Button>
        </div>
      </div>
    </div>
  )
}
