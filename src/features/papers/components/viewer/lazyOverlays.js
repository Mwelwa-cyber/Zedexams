/**
 * The viewer's lazily-loaded heavy panels, declared ONCE.
 *
 * Each `lazy()` call creates its own wrapper with its own load state, so
 * declaring the same import in two files would give the reader two independent
 * Suspense boundaries over one chunk — and a second fallback flash when the
 * already-loaded component is "loaded" again. Sharing the wrappers is what
 * makes the page and the panels agree that it is one component.
 */
import { lazy } from 'react'

export const PdfPageStream = lazy(() => import('../../../../shared/components/PdfPageStream'))
export const ImageZoomOverlay = lazy(() => import('../ImageZoomOverlay'))
export const PaperReaderOverlay = lazy(() => import('../PaperReaderOverlay'))
