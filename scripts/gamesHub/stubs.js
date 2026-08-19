/**
 * The network, replaced by data — for the /games layout harness only.
 *
 * Every module stubbed here reaches Firebase, which cannot initialise in
 * the harness and would not be deterministic if it could. Nothing here
 * touches layout: each export returns the fixture the page was given on
 * `window.__gamesHubFixture` and the components lay themselves out.
 *
 * They are ES module bodies as strings because the bundler substitutes
 * them at resolve time (esbuild `onLoad`), which is what lets the REAL
 * `GamesHub.jsx` be bundled with its real import list unedited.
 */

const FIXTURE = "(typeof window !== 'undefined' && window.__gamesHubFixture) || {}"

export const STUBS = {
  // The auth value is built ONCE and returned by identity on every call.
  // A fresh object per render is what the real context never does, and it
  // put the hub in an endless load → setState → reload loop the first time
  // this harness ran (GamesHub's effect keys on \`currentUser\`). A stub
  // that changes the component's behaviour is not a stub.
  'src/contexts/AuthContext': `
    const f = ${FIXTURE}
    const VALUE = Object.freeze({
      currentUser: f.signedIn === false ? null : Object.freeze({ uid: 'harness-learner' }),
      userProfile: Object.freeze(f.profile || { role: 'learner', grade: 7 }),
      isLearner: true,
    })
    export const useAuth = () => VALUE
    export default { useAuth }
  `,
  'src/features/games/services/gamesService': `
    export const SUBJECTS = [
      { slug: 'mathematics', label: 'Mathematics' },
      { slug: 'english', label: 'English' },
      { slug: 'science', label: 'Science' },
      { slug: 'social', label: 'Social Studies' },
    ]
    export const GRADES = [1,2,3,4,5,6,7].map((value) => ({ value, label: 'Grade ' + value }))
    export const listGames = async () => (${FIXTURE}).games || []
    export const getMyHistory = async () => (${FIXTURE}).history || []
  `,
  'src/utils/dailyChallengeService': `
    export const getTodaysChallenge = async ({ grade = null } = {}) => {
      const f = ${FIXTURE}
      if (typeof window !== 'undefined') window.__gamesHubDailyGradeAsked = grade
      return { game: f.challenge || null, source: 'rotation', dateId: '2026-08-19', grade }
    }
    export const getMyStreak = async () => (${FIXTURE}).streak || { streak: 0, signedIn: true }
  `,
  // The permanently-deleted list. Unstubbed, this reaches
  // `src/firebase/config`, which reads `import.meta.env` — a Vite
  // construct esbuild leaves alone, so the bundle threw
  // "Cannot read properties of undefined (reading 'VITE_FIREBASE_API_KEY')"
  // before React committed and the harness timed out waiting for a page
  // that was never going to render. GamesHub grew this import in #2512,
  // months after the harness was written; `smoke:games-hub` is not a CI
  // job, so nothing said so. Empty by default: the fixture's games are the
  // catalogue under test, and a deletion list is a different rule with its
  // own tests (`test:games-seed-fallback`).
  'src/utils/gameTombstones': `
    export const loadDeletedGameIds = async () => new Set((${FIXTURE}).deletedGameIds || [])
    export const resetDeletedGameCache = () => {}
    export const isDeletedGame = (id, ids) => !!(id && ids && ids.has(id))
  `,
  'src/utils/gameBadgesService': `
    export const getMyGameBadges = async () => ({ byId: (${FIXTURE}).badges || {} })
  `,
  // LearnerShell lazy-loads this banner, and it reaches Firebase. Being
  // LAZY is what made it hard to see: the hub rendered correctly, then the
  // chunk resolved a tick later, threw inside a <Suspense> with no error
  // boundary above it, and React unmounted the whole tree — so the harness
  // measured a page that HAD been right, found nothing at all, and blamed
  // every rule at once. Same shape as the gameTombstones gap: an import
  // added long after the harness, in a file the harness does not name.
  'src/features/learnerHome/components/DeletionPendingBanner': `
    export default function DeletionPendingBanner() { return null }
  `,
  'src/shared/components/SeoHelmet': `
    export default function SeoHelmet() { return null }
  `,
  'src/shared/components/learnerTours': `
    export function GamesHubTour() { return null }
  `,
  // The offline indicator listens on window events and renders nothing
  // while online; stubbed so the harness never depends on navigator state.
  'src/hooks/useNetworkStatus': `
    export const useNetworkStatus = () => true
    export default useNetworkStatus
  `,
}
