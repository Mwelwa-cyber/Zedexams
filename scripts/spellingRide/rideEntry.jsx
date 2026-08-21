/**
 * What Chromium actually mounts for the Spelling Ride canvas harness.
 *
 * The REAL `SpellingRideGame`, under the REAL stylesheets, with only the
 * Firebase-touching modules substituted (see ./stubs.js). Nothing here
 * paraphrases the game: the canvas is the component's own, sized by the
 * shipped CSS, drawn by the shipped renderer.
 *
 * `window.__rideReady` is set once React has committed and a frame has
 * painted, so the harness waits on the page rather than on a sleep.
 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../../src/shared/styles/learnerTheme.css'
import SpellingRideGame from '../../src/features/games/components/SpellingRideGame.jsx'

const GAME = {
  id: 'english_spelling_ride_g7',
  title: 'Spelling Ride',
  subject: 'english',
  grade: 7,
  type: 'spelling_ride',
  wordPack: 'grade7-spelling',
}

window.__rideErrors = []
window.addEventListener('error', (e) => window.__rideErrors.push(String(e.message)))
window.addEventListener('unhandledrejection', (e) => window.__rideErrors.push(String(e.reason)))

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/games/play/english_spelling_ride_g7']}>
    <SpellingRideGame game={GAME} />
  </MemoryRouter>,
  { onUncaughtError: (error) => window.__rideErrors.push(String(error?.message ?? error)) },
)

requestAnimationFrame(() => {
  setTimeout(() => { requestAnimationFrame(() => { window.__rideReady = true }) }, 0)
})
