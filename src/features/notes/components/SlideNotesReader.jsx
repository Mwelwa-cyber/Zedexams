// src/features/notes/components/SlideNotesReader.jsx
//
// Presentational renderer for an AI-generated visual slide-notes deck
// (noteFormat === 'visual_slides'). Used by both the learner reader
// (LearnerNoteRead) and the admin generator preview.
//
// A deck is { schemaVersion, header, theme, slides[] } where each slide is one
// of the card types produced by functions/teacherTools/slideNotesSchema.js:
//   hero | objectives | concept | vocab | diagram | process
//
// Pure + read-only: no Firestore, no callables. It renders whatever deck it's
// given, with images shown only when an imageUrl has been filled in by the
// backend enrichment pass (so a text-only fallback still looks intentional).

import { LESSON_THEME_MAP } from '../../../components/lessons/lessonConstants'

function theme(themeId) {
  return LESSON_THEME_MAP[themeId] || LESSON_THEME_MAP.fresh
}

// A framed illustration. Renders nothing when there's no image URL yet, so a
// slide whose image failed/over-quota degrades to a clean text-only card.
function SlideImage({ url, alt, className = '' }) {
  if (!url) return null
  return (
    <div className={`rounded-2xl overflow-hidden bg-white border border-neutral-200 ${className}`}>
      <img
        src={url}
        alt={alt || ''}
        loading="lazy"
        className="w-full h-full object-contain"
      />
    </div>
  )
}

function HeroSlide({ slide, t }) {
  return (
    <section className={`rounded-3xl border ${t.border} bg-gradient-to-br ${t.bg} p-6 sm:p-10 text-center`}>
      <SlideImage url={slide.imageUrl} alt={slide.imageAlt || slide.title} className="max-w-md mx-auto mb-6" />
      <h2 className={`font-display text-3xl sm:text-5xl leading-[1.05] ${t.text}`}>{slide.title}</h2>
      {slide.subtitle && (
        <p className="mt-3 text-lg text-neutral-700 max-w-xl mx-auto">{slide.subtitle}</p>
      )}
    </section>
  )
}

function ObjectivesSlide({ slide, t }) {
  return (
    <section className={`rounded-3xl border ${t.border} bg-white p-6 sm:p-8`}>
      <h3 className={`font-display text-2xl sm:text-3xl mb-4 ${t.text}`}>{slide.title}</h3>
      <div className="grid sm:grid-cols-[1fr_auto] gap-6 items-center">
        <ul className="space-y-3">
          {slide.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3 text-neutral-800">
              <span className={`mt-1 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold shrink-0 ${t.chip}`}>
                {i + 1}
              </span>
              <span className="text-base leading-relaxed">{b}</span>
            </li>
          ))}
        </ul>
        <SlideImage url={slide.imageUrl} alt={slide.imageAlt || slide.title} className="w-40 sm:w-48 mx-auto" />
      </div>
    </section>
  )
}

function ConceptSlide({ slide, t }) {
  const hasImage = Boolean(slide.imageUrl)
  return (
    <section className={`rounded-3xl border ${t.border} bg-white p-6 sm:p-8`}>
      <h3 className={`font-display text-2xl sm:text-3xl mb-4 ${t.text}`}>{slide.title}</h3>
      <div className={hasImage ? 'grid sm:grid-cols-2 gap-6 items-center' : ''}>
        <p className="text-lg text-neutral-800 leading-relaxed">{slide.body}</p>
        {hasImage && (
          <SlideImage url={slide.imageUrl} alt={slide.imageAlt || slide.title} className="max-w-sm mx-auto" />
        )}
      </div>
    </section>
  )
}

function VocabSlide({ slide, t }) {
  return (
    <section className={`rounded-3xl border ${t.border} bg-gradient-to-br ${t.bg} p-6 sm:p-8`}>
      <h3 className={`font-display text-2xl sm:text-3xl mb-5 ${t.text}`}>{slide.title}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {slide.cards.map((c, i) => (
          <div key={i} className="rounded-2xl bg-white border border-neutral-200 p-4 text-center flex flex-col items-center">
            <SlideImage url={c.imageUrl} alt={c.term} className="w-24 h-24 mb-3" />
            <div className="font-semibold text-neutral-900">{c.term}</div>
            <div className="text-sm text-neutral-600 mt-1 leading-snug">{c.definition}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function DiagramSlide({ slide, t }) {
  return (
    <section className={`rounded-3xl border ${t.border} bg-white p-6 sm:p-8`}>
      <h3 className={`font-display text-2xl sm:text-3xl mb-4 ${t.text}`}>{slide.title}</h3>
      <SlideImage url={slide.imageUrl} alt={slide.imageAlt || slide.title} className="max-w-lg mx-auto mb-4" />
      {slide.caption && (
        <p className="text-base text-neutral-700 text-center mb-4">{slide.caption}</p>
      )}
      {slide.labels?.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {slide.labels.map((label, i) => (
            <span key={i} className={`inline-flex items-center text-sm font-medium rounded-full px-3 py-1 ${t.chip}`}>
              {label}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function ProcessSlide({ slide, t }) {
  return (
    <section className={`rounded-3xl border ${t.border} bg-white p-6 sm:p-8`}>
      <h3 className={`font-display text-2xl sm:text-3xl mb-2 ${t.text}`}>{slide.title}</h3>
      {slide.intro && <p className="text-base text-neutral-700 mb-5">{slide.intro}</p>}
      <ol className="grid gap-4 sm:grid-cols-3">
        {slide.steps.map((s, i) => (
          <li key={i} className="rounded-2xl bg-gradient-to-br border border-neutral-200 p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold shrink-0 ${t.chip}`}>
                {i + 1}
              </span>
              <span className="font-semibold text-neutral-900">{s.label}</span>
            </div>
            <SlideImage url={s.imageUrl} alt={s.label} className="w-full h-28 mb-2" />
            <p className="text-sm text-neutral-700 leading-snug">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Slide({ slide, t }) {
  switch (slide.type) {
    case 'hero':       return <HeroSlide slide={slide} t={t} />
    case 'objectives': return <ObjectivesSlide slide={slide} t={t} />
    case 'concept':    return <ConceptSlide slide={slide} t={t} />
    case 'vocab':      return <VocabSlide slide={slide} t={t} />
    case 'diagram':    return <DiagramSlide slide={slide} t={t} />
    case 'process':    return <ProcessSlide slide={slide} t={t} />
    default:           return null
  }
}

export function SlideNotesReader({ deck }) {
  if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
    return (
      <p className="text-sm text-neutral-500">This visual note has no slides yet.</p>
    )
  }
  const t = theme(deck.theme)
  return (
    <div className="space-y-5">
      {deck.slides.map((slide, i) => (
        <Slide key={i} slide={slide} t={t} />
      ))}
    </div>
  )
}

export default SlideNotesReader
