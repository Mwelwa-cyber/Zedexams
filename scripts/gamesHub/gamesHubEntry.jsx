/**
 * What Chromium actually mounts for the /games layout harness.
 *
 * Bundled by `scripts/test-games-hub-layout.mjs` and injected into a page.
 * It mounts the REAL `GamesHub` inside the REAL `LearnerShell` (so the real
 * tab bar is on screen), under the REAL stylesheets. Nothing here
 * paraphrases the page:
 *
 *   • The layout rules being measured live entirely in CSS, and this
 *     imports the shipped files rather than a copy of them.
 *   • The DOM is the component's own output, not a hand-written mirror of
 *     it — a hand-written one keeps passing after the component changes,
 *     which is a guard that measures a page nobody ships.
 *
 * What IS substituted is the network: `AuthContext`, `gamesService`,
 * `dailyChallengeService` and `gameBadgesService` all reach Firebase,
 * which cannot initialise here and would not be deterministic if it could.
 * The stubs are wired in by the bundler (see `stubPlugin`), return the
 * fixture data on `window.__gamesHubFixture`, and touch no layout.
 *
 * `window.__gamesHubReady` is set once React has committed and a frame has
 * painted. The harness waits on that rather than on a sleep: a sleep long
 * enough to be safe on a slow runner is wasted on every fast one, and a
 * short one measures a half-drawn page.
 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../../src/shared/styles/learnerTheme.css'
import LearnerShell from '../../src/features/learnerHome/components/LearnerShell.jsx'
import GamesHub from '../../src/features/games/pages/GamesHub.jsx'

const root = document.getElementById('root')
createRoot(root).render(
  <MemoryRouter initialEntries={['/games']}>
    <LearnerShell>
      <GamesHub />
    </LearnerShell>
  </MemoryRouter>,
  {
    onUncaughtError: (error) => {
      window.__gamesHubError = String(error?.message ?? error)
    },
  },
)

requestAnimationFrame(() => {
  // One more turn of the loop: GamesHub loads its data from promises that
  // resolve on the microtask queue, so the first frame is the skeleton.
  setTimeout(() => {
    requestAnimationFrame(() => { window.__gamesHubReady = true })
  }, 0)
})
