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
  'src/utils/gameBadgesService': `
    export const getMyGameBadges = async () => ({ byId: (${FIXTURE}).badges || {} })
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
