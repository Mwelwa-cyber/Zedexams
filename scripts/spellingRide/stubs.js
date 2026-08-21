/**
 * The network, replaced by data — for the Spelling Ride canvas harness only.
 *
 * Every module stubbed here reaches Firebase, which cannot initialise in the
 * harness. Nothing here touches the canvas, the geometry or the CSS: the
 * words arrive, and the shipped code lays out and draws them.
 *
 * ES module bodies as strings, substituted by esbuild at resolve time, so the
 * REAL `SpellingRideGame.jsx` is bundled with its real import list unedited.
 */
export const STUBS = {
  'src/contexts/AuthContext': `
    const VALUE = Object.freeze({
      currentUser: Object.freeze({ uid: 'harness-learner' }),
      userProfile: Object.freeze({ role: 'learner', grade: 7 }),
      isLearner: true,
    })
    export const useAuth = () => VALUE
    export default { useAuth }
  `,
  'src/features/games/services/gamesService': `
    export const reportGameStart = () => {}
    export const saveScore = async () => ({ ok: true, id: 'harness' })
    export const readRoundBaseline = async () => null
    export const readRoundOutcome = async () => ({})
  `,
  'src/features/games/services/spellingContentService': `
    export const listApprovedWords = async () => []
  `,
  'src/features/games/services/spellingSentenceService': `
    export const listApprovedSentences = async () => []
  `,
  // Returns the REAL record shape, built by the real normaliser. A stub that
  // hands back `null` here would crash the surface on a path production never
  // takes — `loadSpellingProgress` always resolves a normalised object — and
  // the harness would be reporting its own bug.
  'src/features/games/services/spellingProgressService': `
    import { normaliseProgress } from './src/features/games/lib/spellingProgressCore.js'
    export const loadSpellingProgress = async () => ({ progress: normaliseProgress(null), synced: true })
    export const saveSpellingProgress = async () => true
  `,
  'src/features/games/hooks/useGameFinish': `
    export function useGameFinish() {
      return {
        phase: 'playing', saveResult: null, newBadges: [], streakResult: null,
        levelChange: null, personalBest: null,
        finish: () => {}, reset: () => {}, setPhase: () => {},
      }
    }
  `,
  'src/utils/analytics': `
    export const capture = () => {}
    export const captureAnalytics = () => {}
  `,
  // Speech reaches /api/tts, which needs an ID token. Silent here; the canvas
  // is what this harness measures.
  'src/utils/tts': `
    export const fetchSpeechUrl = async () => ''
    export const speak = async () => {}
    export const stopSpeaking = () => {}
    export const isSpeaking = () => false
  `,
}
