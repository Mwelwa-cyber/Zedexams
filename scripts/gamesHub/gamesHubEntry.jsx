/**
 * What Chromium actually mounts for the /games layout harness.
 *
 * Bundled by `scripts/test-games-hub-layout.mjs` and injected into a page.
 * It mounts the REAL `GamesHub` inside the REAL `LearnerShell` (so the real
 * tab bar is on screen) with the REAL `ZedChatLauncher` markup, under the
 * REAL stylesheets. Nothing here paraphrases the page:
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
import '../../src/features/zedChat/askZed.css'
import LearnerShell from '../../src/features/learnerHome/components/LearnerShell.jsx'
import GamesHub from '../../src/features/games/pages/GamesHub.jsx'

/**
 * The Ask Zed pill, inlined rather than imported.
 *
 * `ZedChatLauncher` is a wall of authorisation (`shouldHideFabForRole`,
 * guardian controls, the route allow-list) around ONE element, and every
 * one of those gates reaches the auth context. Stubbing the gates to make
 * the element appear would be stubbing the component under measurement.
 * What the harness needs from it is its BOX — class, size and docking
 * offset — all of which come from `.lhx-zed-fab` in askZed.css, which is
 * the shipped file imported above. `test-games-hub-layout.mjs` asserts
 * this markup still matches the component's.
 */
function AskZedPill() {
  return (
    <button type="button" className="lhx-zed-fab" aria-label="Ask Zed, your study helper">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="" aria-hidden="true" />
      <span>Ask&nbsp;Zed</span>
    </button>
  )
}

const root = document.getElementById('root')
createRoot(root).render(
  <MemoryRouter initialEntries={['/games']}>
    <LearnerShell>
      <GamesHub />
    </LearnerShell>
    <AskZedPill />
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
