/**
 * slideToSpeechText — flatten a lesson slide into a single plain-text string
 * for read-aloud (SpeechSynthesis).
 *
 * SlideRenderer surfaces text from a handful of fields depending on the slide
 * type (title / subtitle / body / bullets / prompt / example / explanation).
 * We read them in the order a learner sees them so the narration matches the
 * slide, join with sentence breaks, and collapse the empty gaps so the
 * synthesizer doesn't pause awkwardly on blank fields.
 */
export function slideToSpeechText(slide) {
  if (!slide || typeof slide !== 'object') return ''

  const parts = []
  const push = (value) => {
    if (typeof value === 'string' && value.trim()) parts.push(value.trim())
  }

  // Title/subtitle first (the heading a learner reads), then the body.
  push(slide.title)
  push(slide.subtitle)
  push(slide.body)
  // Bullets are plain strings in SlideRenderer; read each in order.
  if (Array.isArray(slide.bullets)) slide.bullets.forEach(push)
  // Remaining per-type text fields.
  push(slide.prompt)
  push(slide.example)
  push(slide.explanation)

  return parts
    // End each fragment with a sentence break so the voice pauses between
    // them, but don't double up when a fragment already ends in punctuation.
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ')
    .trim()
}

export default slideToSpeechText
