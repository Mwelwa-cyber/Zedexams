import { ChartNoAxesColumnIncreasing, Moon, Sun, Sunset } from 'lucide-react'
import CopperButton from './CopperButton'
import useGlassTile from '../../../hooks/useGlassTile'
import '../../../components/teacher/dashboardV2/glassSurface.css'
// Same 3D study-desk illustration the legacy hero used — brand teal, so it
// blends straight into this hero's gradient.
import heroDesk from '../../../assets/teacher/hero-desk.webp'

const PART_ICON = { morning: Sun, afternoon: Sun, evening: Moon }

/* Context-aware subline, matching the legacy hero: name the last-opened
   subject and how stale it is, falling back to the generic line. */
function sublineFor(lastOpened) {
  if (!lastOpened?.subject) return 'Here’s what’s happening with your teaching.'
  const days = lastOpened.agoDays
  if (!Number.isFinite(days)) return 'Here’s what’s happening with your teaching.'
  if (days <= 0) return `You worked on ${lastOpened.subject} today. Keep it up!`
  return `${lastOpened.subject} hasn’t been updated for ${days} day${days === 1 ? '' : 's'}.`
}

/**
 * lastOpened: { subject, grade, ago, agoDays?, to } | null — null renders a
 * start-your-first-document inset instead of LAST OPENED.
 */
export default function GreetingHero({ greeting, lastOpened, ctaState = 'default', onContinue }) {
  const PartIcon = PART_ICON[greeting.part] || Sunset
  // Dark-glass press feedback for the inset; specular/sheen stay off — the
  // hero supports the workspace tiles, it doesn't compete with them.
  const insetRef = useGlassTile({ specular: false, sheen: false })

  // The whole row acts as a convenience tap target for the same action as
  // its CTA. The CopperButton remains the accessible control; clicks that
  // originate on it are left alone so the action never fires twice.
  const onInsetClick = (e) => {
    if (e.target.closest('button')) return
    onContinue?.()
  }

  return (
    <section className="tdv2-hero" aria-label="Greeting" data-tour="hero">
      <img className="tdv2-hero-art" src={heroDesk} alt="" aria-hidden="true" />
      <div>
        <span className="tdv2-hero-eyebrow">
          <span className="tdv2-hero-sun" aria-hidden="true">
            <PartIcon size={17} strokeWidth={2} />
          </span>
          {greeting.label},
        </span>
        <h1>
          {greeting.name}
          <span className="tdv2-hero-wave" aria-hidden="true">👋</span>
        </h1>
        <p className="tdv2-hero-sub">{sublineFor(lastOpened)}</p>
      </div>

      <div className="tdv2-hero-inset glass-dark-inset" ref={insetRef} onClick={onInsetClick}>
        <span className="tdv2-hero-inset-icon" aria-hidden="true">
          <ChartNoAxesColumnIncreasing size={22} strokeWidth={2} />
        </span>
        {lastOpened ? (
          <>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="tdv2-hero-inset-label">Last opened</span>
              <br />
              <span className="tdv2-hero-inset-title">{lastOpened.subject}</span>
              <br />
              <span className="tdv2-hero-inset-meta">{lastOpened.grade}</span>
            </span>
            <span className="tdv2-hero-inset-ago">{lastOpened.ago}</span>
            <CopperButton state={ctaState} onClick={onContinue}>
              Continue plan
            </CopperButton>
          </>
        ) : (
          <>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="tdv2-hero-inset-label">Get started</span>
              <br />
              <span className="tdv2-hero-inset-title">Create your first document</span>
              <br />
              <span className="tdv2-hero-inset-meta">Plan a lesson in a few minutes</span>
            </span>
            <CopperButton state={ctaState} onClick={onContinue}>
              Start planning
            </CopperButton>
          </>
        )}
      </div>
    </section>
  )
}
