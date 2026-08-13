import Card from '../../../../components/ui/Card'
import Icon from '../../../../components/ui/Icon'
import Button from '../../../../components/ui/Button'
import { BookOpen, FileText, TrendingUp } from '../../../../components/ui/icons'
import { Block, Section, Specimen } from '../auditKit.jsx'
import { ForceHover } from '../forcedStates.jsx'

/**
 * Section 4 — cards.
 *
 * Every variant of the Card primitive, plus the two card SHAPES the app draws
 * without one: the dashboard panel (`.tdv2-card`) and the document row
 * (`.tdv2-doc-row`, Recent Documents / My Library). Those two are rendered
 * through their real classes rather than rebuilt, and their absence from the
 * primitive is recorded in Gaps found.
 *
 * EVERY SPECIMEN CARRIES TEXT AT EVERY LEVEL, and that is the requirement
 * rather than decoration. An invisible-text bug is invisible in a card with a
 * title and nothing else: the failure is always a SECONDARY level — muted
 * body, a timestamp, a badge label — resolving to something near its own
 * background. A card has to have all four levels before the audit can see it.
 */
export default function CardsSection() {
  return (
    <Section
      id="cards"
      title="4 · Cards"
      note={
        'Card variants from src/components/ui/Card.jsx, then the two card shapes the app draws without the primitive (dashboard panel, document row) through their own classes. Every specimen carries title, body, secondary text, an icon and a badge — an invisible-text bug lives at the secondary level and cannot show up in a card that only has a title.'
      }
    >
      <Block title="Card variant × size">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {['flat', 'elevated', 'hero'].map((variant) =>
            ['sm', 'md', 'lg'].map((size) => (
              <Specimen key={`${variant}-${size}`} label={`variant="${variant}" size="${size}"`}>
                <Card variant={variant} size={size} className="w-full">
                  <CardBody hero={variant === 'hero'} />
                </Card>
              </Specimen>
            )),
          )}
        </div>
      </Block>

      <Block
        title="Interactive cards"
        note="`interactive` adds the lift and the pointer cursor. The hovered copy is pinned open from the primitive's own hover utilities."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Specimen label="interactive (rest)">
            <Card interactive className="w-full">
              <CardBody />
            </Card>
          </Specimen>
          <Specimen label="interactive (hover pinned)">
            <ForceHover>
              <Card interactive className="w-full">
                <CardBody />
              </Card>
            </ForceHover>
          </Specimen>
          <Specimen label='interactive as="button"'>
            {/* No action button inside this one: `as="button"` makes the card
                itself a <button>, and a button inside a button is invalid HTML
                that React warns about and browsers reflow unpredictably. The
                real call sites that use `as="button"` are whole-card click
                targets with no inner control, which is what this mirrors. */}
            <Card interactive as="button" className="w-full text-left">
              <CardBody action={false} />
            </Card>
          </Specimen>
        </div>
      </Block>

      <Block
        title="Dashboard panel (.tdv2-card)"
        note="The dashboard's own card. Not a Card variant — the tdv2 design system draws its own, from the same --zt-* tokens through its private variable layer."
      >
        <div className="tdv2">
          <div className="tdv2-card" style={{ maxWidth: '28rem' }}>
            <div className="tdv2-card-head">
              <div>
                <p className="tdv2-eyebrow">This term</p>
                <h3 className="tdv2-card-sub">Checklist completion</h3>
              </div>
              <span className="tdv2-badge-ready">Ready</span>
            </div>
            <p className="tdv2-check-label">
              Six of nine schemes of work uploaded for Term 2.
            </p>
          </div>
        </div>
      </Block>

      <Block
        title="Document row (.tdv2-doc-row)"
        note="Recent Documents / My Library. A row rather than a card, but it is the surface a teacher meets most and it has text at four levels."
      >
        <div className="tdv2">
          <div className="tdv2-doc-list" style={{ maxWidth: '32rem' }}>
            {[
              ['Grade 7 Mathematics — Mid-term test', 'Assessment paper · 20 questions', '2 days ago', 'Ready'],
              ['Fractions and decimals', 'Lesson plan · Week 4', 'Last week', 'Draft'],
            ].map(([title, meta, when, state]) => (
              <div key={title} className="tdv2-doc-row">
                <span className="tdv2-doc-icon" aria-hidden="true">
                  <Icon as={FileText} size="sm" />
                </span>
                <span className="tdv2-doc-side" style={{ minWidth: 0, flex: 1 }}>
                  <span className="tdv2-doc-title">{title}</span>
                  <span className="tdv2-doc-meta">{meta}</span>
                </span>
                <span className={state === 'Ready' ? 'tdv2-badge-ready' : 'tdv2-badge-draft'}>
                  {state}
                </span>
                <span className="tdv2-doc-date">{when}</span>
              </div>
            ))}
          </div>
        </div>
      </Block>

      <Block
        title="Stat tile (.tdv2-tile)"
        note="The dashboard's figure tile — a number, a label and a trend, which is three different text weights on one surface."
      >
        <div className="tdv2">
          <div className="tdv2-tile-grid">
            {[
              [BookOpen, '18', 'Papers generated', '+4 this week'],
              [TrendingUp, '92%', 'Average class score', 'Up from 87%'],
            ].map(([IconCmp, figure, label, trend]) => (
              <div key={label} className="tdv2-tile">
                <span className="tdv2-tile-icon" aria-hidden="true">
                  <Icon as={IconCmp} size="sm" />
                </span>
                <span className="tdv2-tile-title">
                  {figure} · {label}
                </span>
                <span className="tdv2-tile-desc">{trend}</span>
              </div>
            ))}
          </div>
        </div>
      </Block>

      <Block
        title="Raw surface classes"
        note="`.card`, `.section-card`, `.content-card` from index.css. Three near-identical panels that predate the Card primitive and are still used across admin — see Gaps found."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {['card', 'section-card', 'content-card'].map((cls) => (
            <Specimen key={cls} label={`.${cls}`}>
              <div className={`${cls} w-full p-4`}>
                <CardBody />
              </div>
            </Specimen>
          ))}
        </div>
      </Block>
    </Section>
  )
}

/**
 * Realistic content, at every hierarchy level, from the domain the app is
 * actually about. Lorem would render the same and prove nothing — a Zambian
 * CBC paper title is the length real titles are, which is what makes a
 * truncation or a wrap bug visible.
 */
function CardBody({ hero = false, action = true }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon as={BookOpen} size="sm" className={hero ? '' : 'theme-accent-text'} />
        <span className={`badge ${hero ? 'theme-card theme-text' : 'theme-accent-bg theme-accent-text'}`}>
          Grade 7
        </span>
      </div>
      <h3 className={`text-display-md ${hero ? '' : 'theme-text'}`}>
        Fractions and decimals
      </h3>
      <p className={`text-body-sm mt-1 ${hero ? 'theme-hero-muted' : 'theme-text-muted'}`}>
        Convert between fractions and decimals, and express an answer in its
        lowest terms.
      </p>
      <p className={`text-body-sm mt-2 ${hero ? 'theme-hero-muted' : 'theme-text-muted'}`}>
        Mathematics · Mid-term test · 20 marks
      </p>
      {action ? (
        <div className="mt-3">
          <Button variant={hero ? 'secondary' : 'primary'} size="sm">
            Open paper
          </Button>
        </div>
      ) : (
        <p className={`text-body-sm mt-3 font-bold ${hero ? '' : 'theme-accent-text'}`}>
          Open paper →
        </p>
      )}
    </div>
  )
}
