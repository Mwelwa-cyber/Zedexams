import { useMemo } from 'react'
import { renderDiagramSvg } from './diagramCatalog.js'

/**
 * Render a library diagram as inline SVG.
 *
 * Props:
 *   - libraryKey: string  — entry key in the catalog (e.g. 'cylinder')
 *   - params:     object  — per-entry parameters; merged on top of defaults
 *   - color:      string  — accent stroke/fill color (defaults to brand color)
 *   - className:  string  — applied to the wrapping <div>
 *   - alt:        string  — accessible description for screen readers
 *
 * The render function in the catalog returns an SVG STRING. We inject it via
 * dangerouslySetInnerHTML — safe because the catalog content is hard-coded in
 * the source tree (no user-supplied SVG), and the only param values that flow
 * into it are escaped by the catalog's `esc()` helper.
 */
export default function DiagramSvg({ libraryKey, params, color, className = '', alt }) {
  const svg = useMemo(() => renderDiagramSvg(libraryKey, params, color), [libraryKey, params, color])

  if (!svg) {
    return (
      <div
        role="img"
        aria-label={alt || `Unknown diagram: ${libraryKey}`}
        className={`rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 ${className}`}
      >
        Diagram &ldquo;{libraryKey}&rdquo; is unavailable.
      </div>
    )
  }

  return (
    <div
      role="img"
      aria-label={alt || undefined}
      className={`zx-diagram-svg ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
