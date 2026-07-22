import { BookOpen, Moon, Sun, Sunset } from 'lucide-react'
import CopperButton from './CopperButton'
// Same 3D study-desk illustration the legacy hero used — brand teal, so it
// blends straight into this hero's gradient.
import heroDesk from '../../../assets/teacher/hero-desk.webp'

const PART_ICON = { morning: Sun, afternoon: Sun, evening: Moon }

/**
 * lastOpened: { subject, grade, ago, to } | null — null renders a
 * start-your-first-document inset instead of LAST OPENED.
 */
export default function GreetingHero({ greeting, lastOpened, ctaState = 'default', onContinue }) {
  const PartIcon = PART_ICON[greeting.part] || Sunset

  return (
    <section className="tdv2-hero" aria-label="Greeting">
      <img className="tdv2-hero-art" src={heroDesk} alt="" aria-hidden="true" />
      <div>
        <span className="tdv2-hero-eyebrow">
          <PartIcon size={17} strokeWidth={2} aria-hidden="true" />
          {greeting.label},
        </span>
        <h1>{greeting.name}</h1>
        <p className="tdv2-hero-sub">Here’s what’s happening with your teaching.</p>
      </div>

      <div className="tdv2-hero-inset">
        <span className="tdv2-hero-inset-icon" aria-hidden="true">
          <BookOpen size={22} strokeWidth={1.75} />
        </span>
        {lastOpened ? (
          <>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="tdv2-hero-inset-label">Last opened</span>
              <br />
              <span className="tdv2-hero-inset-title">{lastOpened.subject}</span>
              <br />
              <span className="tdv2-hero-inset-meta">
                {[lastOpened.grade, lastOpened.ago].filter(Boolean).join(' · ')}
              </span>
            </span>
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
