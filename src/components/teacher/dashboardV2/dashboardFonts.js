/**
 * Loads the Dashboard V2 web fonts (Inter + Playfair Display) as a runtime
 * <link>, NOT a CSS @import inside dashboardV2.css. A failed @import makes
 * Chromium treat the whole chunk stylesheet as errored, Vite's CSS preload
 * rejects, and React.lazy crashes the /teacher route to the ErrorBoundary —
 * so on any network where fonts.googleapis.com is unreachable the dashboard
 * died entirely. A <link> injected here fails soft: the design-system
 * font stacks fall back to Segoe UI / system-ui and the page still renders.
 *
 * Idempotent — call from every surface that imports dashboardV2.css.
 */
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap'

let injected = false

export default function ensureDashboardFonts() {
  if (injected || typeof document === 'undefined') return
  injected = true
  if (document.querySelector('link[data-tdv2-fonts]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = FONT_HREF
  link.setAttribute('data-tdv2-fonts', '')
  document.head.appendChild(link)
}
