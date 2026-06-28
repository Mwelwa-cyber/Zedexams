/**
 * ExtraQuestionImages — render a question's ADDITIONAL figures (the `images[]`
 * array) stacked vertically below the primary `imageUrl`.
 *
 * A question carries one primary image (`imageUrl`, rendered by each surface as
 * before) plus, for multi-figure scanned questions, zero or more extra figures
 * in `question.images = [{ url, alt, width }]`. This component renders just the
 * extras, so every runner/preview can drop it in right after its existing
 * primary-image block without touching that code. Renders nothing when there
 * are no extras, so single-image questions are completely unaffected.
 */

import ZoomableImage from './ZoomableImage'

/** Normalised extra images for a question (drops empty/invalid entries). */
export function getExtraQuestionImages(question) {
  const list = Array.isArray(question?.images) ? question.images : []
  return list
    .filter((img) => img && typeof img.url === 'string' && img.url)
    .map((img) => ({ url: img.url, alt: img.alt || '', width: img.width || 'full' }))
}

export default function ExtraQuestionImages({ question, zoomable = true, className = '' }) {
  const extras = getExtraQuestionImages(question)
  if (!extras.length) return null
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {extras.map((img, i) =>
        zoomable ? (
          <div
            key={img.url || i}
            className="overflow-hidden rounded-2xl border-2 border-slate-900 bg-slate-50 p-3"
          >
            <ZoomableImage
              src={img.url}
              alt={img.alt || 'Additional figure'}
              className="mx-auto max-h-[80vh] w-full rounded-xl object-contain"
            />
          </div>
        ) : (
          <div
            key={img.url || i}
            className="theme-border theme-bg-subtle overflow-hidden rounded-2xl border p-3"
          >
            <img
              src={img.url}
              alt={img.alt || 'Additional figure'}
              className="mx-auto max-h-72 w-full rounded-xl object-contain"
              loading="lazy"
            />
          </div>
        ),
      )}
    </div>
  )
}
