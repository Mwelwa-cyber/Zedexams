import { BookOpen, Moon, Sun, Sunset } from 'lucide-react'
import CopperButton from './CopperButton'
import { LAST_OPENED } from './mockData'
// Same 3D study-desk illustration the live dashboard hero uses — brand teal,
// so it blends into this hero's gradient too.
import heroDesk from '../../../assets/teacher/hero-desk.webp'

const PART_ICON = { morning: Sun, afternoon: Sun, evening: Moon }

export default function GreetingHero({ greeting, ctaState = 'default', onContinue }) {
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
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="tdv2-hero-inset-label">Last opened</span>
          <br />
          <span className="tdv2-hero-inset-title">{LAST_OPENED.subject}</span>
          <br />
          <span className="tdv2-hero-inset-meta">
            {LAST_OPENED.grade} · {LAST_OPENED.ago}
          </span>
        </span>
        <CopperButton state={ctaState} onClick={onContinue}>
          Continue plan
        </CopperButton>
      </div>
    </section>
  )
}
