import { useEffect, useState } from 'react'

// Wraps an <img> with a click-to-zoom lightbox. Used for question and passage
// illustrations where students need to read fine details (maps, diagrams).
//
// Props:
//   src        — image URL
//   alt        — accessible label
//   className  — applied to the inline (non-zoomed) image
//   wrapperClassName — applied to the inline button wrapper
export default function ZoomableImage({ src, alt, className = '', wrapperClassName = '' }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!src) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${alt || 'image'} full size`}
        className={`group block w-full cursor-zoom-in border-0 bg-transparent p-0 text-left ${wrapperClassName}`}
      >
        <img src={src} alt={alt} className={className} loading="lazy" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt || 'Image preview'}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={event => {
              event.stopPropagation()
              setOpen(false)
            }}
            aria-label="Close image preview"
            className="absolute right-4 top-4 z-10 rounded-full bg-white/90 px-3 py-1.5 text-sm font-bold text-slate-900 shadow hover:bg-white"
          >
            Close ✕
          </button>
          <img
            src={src}
            alt={alt}
            onClick={event => event.stopPropagation()}
            className="max-h-[92vh] max-w-[92vw] cursor-zoom-out object-contain"
          />
        </div>
      )}
    </>
  )
}
