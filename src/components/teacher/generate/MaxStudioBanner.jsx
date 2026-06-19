import { paywall } from '../../../utils/paywall'
import { resolveTeacherPlan } from '../../../utils/teacherPlans'
import { useAuth } from '../../../contexts/AuthContext'

/**
 * Banner shown at the top of a Max-only studio (Assessment, Exam Paper) for
 * teachers who are NOT on Max. It frames the studio as a premium surface:
 * shows a few example templates ("here's what you can make"), explains the
 * single monthly taster, and routes to the "Upgrade to Max" paywall.
 *
 * Max teachers (and super-admins, who resolve to 'max') see nothing — they
 * have unlimited access, so the banner would just be noise.
 *
 * The server is the real gate (functions/teacherTools/usageMeter.js): this is
 * purely the upsell framing. Generating the one free taster still works; the
 * 2nd attempt fails with reason 'max-only' and the studio opens the same
 * paywall this banner's button does.
 *
 * Props:
 *   feature   — human label, e.g. "Assessment" / "Exam paper"
 *   templates — [{ title, meta, tag }] sample cards to preview
 */
export default function MaxStudioBanner({ feature = 'Assessment', templates = [] }) {
  const { userProfile } = useAuth()
  const plan = resolveTeacherPlan(userProfile)

  // Max (and super-admins, who resolve to 'max') get unlimited access — no upsell.
  if (plan === 'max') return null

  function openMaxPaywall() {
    paywall.show('max-feature', { feature: `${feature}s` })
  }

  return (
    <div
      className="rounded-2xl p-5 mb-6"
      style={{
        background: 'linear-gradient(135deg,#0e2a32 0%,#143a44 100%)',
        color: '#fff',
        boxShadow: '0 10px 30px rgba(14,42,50,.25)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-full"
          style={{ background: '#ff7a2e', color: '#fff' }}
        >
          🦅 Max studio
        </span>
        <span className="text-xs" style={{ color: '#a9c4c9' }}>
          1 free {feature.toLowerCase()} this month
        </span>
      </div>

      <h3 className="font-display font-black" style={{ fontSize: 20, margin: '0 0 4px' }}>
        Build a complete {feature.toLowerCase()} — with the marking scheme.
      </h3>
      <p className="text-sm" style={{ color: '#cfe0e3', margin: 0, maxWidth: 560 }}>
        {feature}s are our most powerful generation. You get <strong>one free this
        month</strong> to try it — to create them whenever you want, join{' '}
        <strong>Max</strong>.
      </p>

      {templates.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {templates.map((t) => (
            <button
              key={t.title}
              type="button"
              onClick={openMaxPaywall}
              className="text-left rounded-xl p-3 transition"
              style={{
                background: 'rgba(255,255,255,.06)',
                border: '1px solid rgba(255,255,255,.12)',
                cursor: 'pointer',
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span
                  className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(255,122,46,.18)', color: '#ffb088' }}
                >
                  {t.tag}
                </span>
                <span aria-hidden="true" style={{ color: '#7fa0a6' }}>🔒</span>
              </div>
              <p className="text-sm font-bold" style={{ margin: '0 0 2px' }}>{t.title}</p>
              <p className="text-xs" style={{ color: '#a9c4c9', margin: 0 }}>{t.meta}</p>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={openMaxPaywall}
        className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition"
        style={{ background: '#ff7a2e', color: '#fff' }}
      >
        Upgrade to Max · K199/mo →
      </button>
    </div>
  )
}
