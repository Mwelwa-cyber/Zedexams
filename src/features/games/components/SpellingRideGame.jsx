/**
 * Spelling Ride — the screen.
 *
 * The learner cycles down a three-lane road; rows of letters come towards
 * them, each row filling all three lanes, and they steer into the letter that
 * comes next in the word. Right answers build the ride, wrong ones break the
 * bike and are spoken back.
 *
 * ── What this file is, and what it is not ───────────────────────────────
 *
 * It is the SURFACE: the canvas element, the animation frame, the HUD, the
 * five screens and the wiring to everything already in the product. Every
 * decision the game makes is in `lib/spellingRideCore.js`; every question of
 * where a thing is drawn is in `lib/spellingRideRoad.js` and
 * `lib/spellingRideRender.js`. That split is what lets `test:spelling-ride`
 * play a full nine-town ride under plain node and measure the pacing.
 *
 * ── Four things it deliberately reuses rather than rebuilds ─────────────
 *
 *   THE WORDS ARE THE SPELLING BANK'S. `loadWordPack` folds approved
 *   Firestore words over the bundled 879-word Grade 7 bank, so Mwelwa fixes a
 *   word once and both spelling games get it, and a learner with no network
 *   still rides. A second word list for this game would be a second Grade 7
 *   spelling curriculum with its own admin screen and its own idea of which
 *   words are hard.
 *
 *   THE MASTERY RECORD IS THE LADDER'S. `spellingProgress/{uid}` is one
 *   learner's spelling, not one game's: a word missed on the ride comes back
 *   on the ladder and vice versa, which is the whole of §3.5's third leg and
 *   costs nothing because the pool already exists.
 *
 *   THE REWARDS ARE THE PLATFORM'S. `useGameFinish` → `saveScore` → badges →
 *   daily streak, exactly as every other engine reports a round. **NOTE, and
 *   it is written here because it is easy to assume otherwise:** that path
 *   writes the score straight from the client — there is no Cloud Function
 *   recomputing it. This game did not introduce that and does not make it
 *   worse, but a leaderboard built on it is forgeable by anyone who opens
 *   devtools, and Spelling Ride is not the place to fix it for eight games.
 *
 *   THE VOICE IS THE SPELLING SYSTEM'S. `lib/spellingSpeech.js`, extended
 *   here with the accent order and the word-then-letters correction.
 *
 * ── The one thing that is genuinely its own: the frame ──────────────────
 *
 * React renders the HUD, never the road. The ride is a mutable object in a
 * ref, advanced once per animation frame, and the component re-renders only
 * when the ride EMITS something — a row resolved, a part mended, a town
 * reached. That is about one render every two and a half seconds instead of
 * sixty a second, and it is what keeps the frame budget on a cheap handset.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../gamesProto.css'
import './spellingRide.css'
import { useAuth } from '../../../contexts/AuthContext'
import { useGameFinish } from '../hooks/useGameFinish'
import { reportGameStart } from '../services/gamesService'
import { haptic, isMuted, playCorrect, playWin, playWrong, primeSounds, toggleMute } from '../lib/gameSounds'
import { BadgePop, buildSaveNote } from './protoGameChrome'
import { capture } from '../../../utils/analytics'
import { resolveLearnerGrade } from '../lib/gamesHubCore'
import { isKnownPack, loadWordPack, packForGrade } from '../lib/spellingPack'
import { listApprovedWords } from '../services/spellingContentService'
import { listApprovedSentences } from '../services/spellingSentenceService'
import { loadSpellingProgress, saveSpellingProgress } from '../services/spellingProgressService'
import { normaliseProgress, recordRideBest, rideBest } from '../lib/spellingProgressCore'
import { SPELLING_CHOICE_BANK, mergeChoiceItems } from '../../../data/spellingChoiceBank'
import { playableWords } from '../lib/wordBuilderCore'
import {
  MAX_HEARTS,
  RIDE_DIFFICULTIES,
  RIDE_DIFFICULTY_IDS,
  RIDE_MODES,
  RIDE_TOWNS,
  advance,
  createRide,
  departTown,
  finishRide,
  reportCsv,
  rideAccuracy,
  rideResult,
  settleRide,
  steer,
  townAt,
  troubleWords,
  wordsForTown,
} from '../lib/spellingRideCore'
import { createRideRenderer } from '../lib/spellingRideRender'
import { laneFromX } from '../lib/spellingRideRoad'
import {
  primeSpeech,
  speakSentence,
  speakWord,
  speakWordThenLetters,
  speechAvailable,
  stopSpeech,
  warmWord,
  warmWords,
} from '../lib/spellingSpeech'
import { readJson, writeJson } from '../../../shared/utils/safeStorage'

/** Where the ride's own settings live between visits. Preferences, not progress. */
const PREFS_KEY = 'zedexams:spelling-ride:prefs'

/** How long a correction stays on screen. Matches the ride core's freeze. */
const FLASH_MS = 1150

function mintRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `ride-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

/**
 * Is the app in its dark reading theme?
 *
 * BOTH SELECTORS, because the app has two ways of saying dark and the games
 * stylesheet already keys off both: `html[data-theme='night']` is the reading
 * palette and `body.theme-midnight` is the workspace one. Reading only the
 * first would leave the canvas painting a bright blue sky inside a dark page
 * for every learner on Midnight.
 */
function isNightTheme() {
  if (typeof document === 'undefined') return false
  return document.documentElement?.dataset?.theme === 'night'
    || document.body?.classList?.contains('theme-midnight')
}

function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  } catch { return false }
}

/** Accuracy, never speed — the same rule the rest of the spelling system holds. */
function starsForRide(accuracy, wordsDone) {
  if (!wordsDone) return 0
  if (accuracy >= 95) return 3
  if (accuracy >= 80) return 2
  return 1
}

export default function SpellingRideGame({ game }) {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const grade = Number(game?.grade) || resolveLearnerGrade(userProfile)

  const [screen, setScreen] = useState('loading')
  const [items, setItems] = useState(null)
  const [choiceItems, setChoiceItems] = useState(SPELLING_CHOICE_BANK)
  const [progress, setProgress] = useState(() => normaliseProgress(null))
  const [synced, setSynced] = useState(true)

  const stored = useMemo(() => readJson(PREFS_KEY, null) || {}, [])
  const [mode, setMode] = useState(() => (
    RIDE_MODES.some((m) => m.id === stored.mode) ? stored.mode : 'spell'
  ))
  const [difficulty, setDifficulty] = useState(() => (
    RIDE_DIFFICULTY_IDS.includes(stored.difficulty) ? stored.difficulty : 'medium'
  ))
  // Voice defaults ON. A spelling game that never says the word is a visual
  // matching puzzle — so the classroom case (thirty handsets, no headphones)
  // is a choice a teacher makes, not the state a learner finds it in.
  const [voiceOn, setVoiceOn] = useState(() => stored.voiceOn !== false)
  const [muted, setMuted] = useState(() => isMuted())

  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const rideRef = useRef(null)
  const rendererRef = useRef(null)
  const rafRef = useRef(0)
  const lastTimeRef = useRef(0)
  const viewRef = useRef({ x: 0, targetX: 0, wobble: 0 })
  const runIdRef = useRef('')
  const sessionRef = useRef('')
  const voiceRef = useRef(voiceOn)
  const reducedRef = useRef(false)
  const flashTimerRef = useRef(0)
  const revealTimerRef = useRef(0)
  /** The word the ride is about to reach, once it has been warmed. */
  const warmedRef = useRef('')

  const [hud, setHud] = useState({
    hearts: MAX_HEARTS, score: 0, streak: 0, town: 0, wordsDone: 0, revealing: false,
  })
  const [flash, setFlash] = useState(null)
  const [townCard, setTownCard] = useState(null)
  const [summary, setSummary] = useState(null)

  const { saveResult, newBadges, streakResult, finish, reset } = useGameFinish()

  useEffect(() => { voiceRef.current = voiceOn }, [voiceOn])

  useEffect(() => {
    writeJson(PREFS_KEY, { mode, difficulty, voiceOn })
  }, [mode, difficulty, voiceOn])

  /* ── content ─────────────────────────────────────────────────────── */
  /**
   * The document's own `wordPack` wins; failing that, a document carrying no
   * questions of its own falls back to its grade's pack. Same order Word
   * Builder uses, and for the same reason: deriving the pack from the grade
   * unconditionally would silently ignore words an admin authored on the
   * document.
   */
  const packId = game?.wordPack || (game?.questions?.length ? '' : packForGrade(grade))

  useEffect(() => {
    let cancelled = false
    async function load() {
      const rows = isKnownPack(packId)
        ? await loadWordPack(packId, { fetchApproved: listApprovedWords })
        : []
      if (cancelled) return
      setItems(playableWords(rows.length ? rows : (game?.questions || [])))

      // The sentences are a SECOND, independent read, and a failure of it is
      // never allowed to hold up the words: `listApprovedSentences` returns []
      // on any error and the bundled bank stands.
      try {
        const approved = await listApprovedSentences(grade)
        if (!cancelled && approved.length) {
          setChoiceItems(mergeChoiceItems(SPELLING_CHOICE_BANK, approved))
        }
      } catch { /* the bundled bank stands */ }
    }
    load().catch(() => { if (!cancelled) setItems(playableWords(game?.questions || [])) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId, grade])

  /* ── the learner's record ────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false
    loadSpellingProgress(game?.id).then(({ progress: loaded, synced: ok }) => {
      if (cancelled) return
      setProgress(loaded)
      setSynced(ok)
    }).catch(() => { if (!cancelled) setSynced(false) })
    return () => { cancelled = true }
  }, [game?.id, currentUser?.uid])

  useEffect(() => {
    if (screen === 'loading' && items !== null) setScreen('menu')
  }, [screen, items])

  useEffect(() => {
    primeSounds()
    reportGameStart(game)
    reducedRef.current = prefersReducedMotion()
    return () => {
      stopSpeech()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      clearTimeout(flashTimerRef.current)
      clearTimeout(revealTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = useCallback((event, props = {}) => {
    // Learning events, never the answer. A payload carrying the correct
    // spelling of every word served would be an answer key in the network tab.
    capture(`spelling_ride_${event}`, { gameId: game?.id || null, grade, ...props })
  }, [game?.id, grade])

  /* ── speaking ────────────────────────────────────────────────────── */

  /**
   * Fetch a town's words before the road reaches them.
   *
   * The ride is the surface where a late voice is not an annoyance but a
   * broken exercise: a word is announced as its first letter-row spawns, and
   * that row reaches the rider about a second later. A word that took two
   * seconds to fetch was therefore announced AFTER the learner had already
   * answered its first letter — they were being asked to spell something they
   * had not yet heard.
   *
   * `cloud: false` is the whole reason this can warm a town on spec: it fetches
   * only words an admin has already voiced, which are static objects that cost
   * nothing to pull. The four words a town actually serves are drawn at random
   * from this pool, so warming the pool is how the draw is covered without
   * knowing the draw. Words with no pre-generated file are left to the
   * lookahead in `frame`, which only spends a synthesis call on the one word
   * that is certain to be asked next.
   */
  const warmTown = useCallback((townIndex, carried = []) => {
    if (!voiceRef.current) return
    const pool = wordsForTown(items || [], townIndex)
    warmWords([...carried, ...pool], { cloud: false })
  }, [items])

  // Choosing a mode and a difficulty takes a few seconds, and those seconds are
  // free bandwidth. The first town's pre-generated words are pulled over them,
  // so the ride's opening word — the one with no previous word to hide its
  // latency behind — is already on the device when the road starts moving.
  useEffect(() => {
    if (screen !== 'menu' || !items?.length) return
    warmTown(0)
  }, [screen, items, warmTown])

  const say = useCallback((challenge) => {
    if (!voiceRef.current || !challenge) return false
    if (challenge.kind === 'choice') return speakSentence(challenge.prompt)
    // `speakWord` is async (the pre-generated → cloud → browser ladder), so it
    // cannot report success in time to decide whether Dictation must also SHOW
    // the word. `speechAvailable()` is the honest synchronous answer to the
    // question actually being asked — can this device play audio at all — and
    // the ladder's own three tiers cover everything below that.
    if (!speechAvailable()) return false
    speakWord(challenge.word, { audioUrl: challenge.audio })
    return true
  }, [])

  /**
   * Present a challenge: say it, and decide whether it is also SHOWN.
   *
   * Dictation shows nothing — that is the mode. But with the voice off it
   * would show and say nothing at all, which is not a harder mode, it is an
   * unplayable one. So voice-off Dictation flashes the word briefly: the mode
   * still works and is still harder than Spell It, which shows it for twice
   * as long.
   */
  const present = useCallback((challenge) => {
    if (!challenge) return
    clearTimeout(revealTimerRef.current)
    const spoke = say(challenge)
    const reveal = challenge.kind === 'spell' ? 2200 : (challenge.kind === 'dictation' && !spoke ? 1400 : 0)
    if (reveal) {
      setHud((h) => ({ ...h, revealing: true }))
      revealTimerRef.current = setTimeout(() => setHud((h) => ({ ...h, revealing: false })), reveal)
    } else {
      setHud((h) => ({ ...h, revealing: false }))
    }
  }, [say])

  const showFlash = useCallback((payload) => {
    setFlash(payload)
    clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlash(null), FLASH_MS)
  }, [])

  /* ── ending a ride ───────────────────────────────────────────────── */
  const settle = useCallback((ride) => {
    const accuracy = rideAccuracy(ride)
    const stars = starsForRide(accuracy, ride.wordsDone)
    const best = rideBest(progress, ride.mode, ride.difficulty)
    const beatBest = ride.score > best

    setProgress((current) => {
      // Two independent bankings, both idempotent: the pool (mastery and
      // spacing, keyed by runId) and the high score (a max). Either can be a
      // no-op, and when BOTH are the write is skipped entirely.
      const settled = settleRide(current, { pool: ride.pool, runId: runIdRef.current })
      const next = recordRideBest(settled, {
        mode: ride.mode, difficulty: ride.difficulty, score: ride.score,
      })
      if (next !== current) {
        saveSpellingProgress(game?.id, next).then(setSynced).catch(() => setSynced(false))
      }
      return next
    })

    setSummary({
      outcome: ride.outcome,
      score: ride.score,
      accuracy,
      stars,
      wordsDone: ride.wordsDone,
      bestStreak: ride.bestStreak,
      distanceKm: (ride.distance / 1000).toFixed(1),
      town: townAt(ride.townIndex).name,
      previousBest: best,
      beatBest,
      trouble: troubleWords(ride.stats),
      stats: ride.stats,
      mode: ride.mode,
      difficulty: ride.difficulty,
    })

    emit('finished', {
      mode: ride.mode,
      difficulty: ride.difficulty,
      outcome: ride.outcome,
      words: ride.wordsDone,
      accuracy,
      town: ride.townIndex,
    })

    playWin()
    setScreen('over')
    finish(rideResult({ game, ride }))
  }, [emit, finish, game, progress])

  /* ── the frame ───────────────────────────────────────────────────── */
  const drainEvents = useCallback((ride, events) => {
    if (!events.length) return
    let changed = false
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i]
      if (event.type === 'present') {
        present(event.challenge)
        changed = true
      } else if (event.type === 'right') {
        playCorrect()
        haptic(8)
        const geom = rendererRef.current?.geometry
        if (geom && !reducedRef.current) {
          rendererRef.current.burst(viewRef.current.x, geom.riderY - 10, rendererRef.current.LANE_SPARK.good, 10)
        }
        changed = true
      } else if (event.type === 'repair') {
        const geom = rendererRef.current?.geometry
        if (geom && !reducedRef.current) {
          rendererRef.current.burst(viewRef.current.x, geom.riderY - 30, rendererRef.current.LANE_SPARK.gold, 12)
        }
        showFlash({ tone: 'good', big: 'Bike mended!', sub: 'Six in a row. That part is back.' })
      } else if (event.type === 'wrong') {
        playWrong()
        haptic(28)
        const geom = rendererRef.current?.geometry
        if (geom && !reducedRef.current) {
          rendererRef.current.burst(viewRef.current.x, geom.riderY - 10, rendererRef.current.LANE_SPARK.bad, 14)
        }
        showFlash({
          tone: 'bad',
          big: event.challenge.wordy ? `✗ ${event.chosen}` : `✗ ${String(event.chosen).toUpperCase()}`,
          sub: event.challenge.wordy ? 'The sentence needs' : 'It should be',
          answer: event.right,
        })
        // The correction is the lesson, so it is SAID as well as shown: the
        // whole word and then its letters, slowly.
        if (voiceRef.current) {
          const audioUrl = event.challenge?.audio || ''
          if (event.spellOut) speakWordThenLetters(event.spoken, { audioUrl })
          else speakWord(event.spoken, { audioUrl })
        }
        changed = true
      } else if (event.type === 'wordDone') {
        changed = true
      } else if (event.type === 'town') {
        setTownCard({
          index: event.index,
          town: event.town,
          wordsDone: ride.wordsDone,
          accuracy: rideAccuracy(ride),
          bestStreak: ride.bestStreak,
          last: event.index >= RIDE_TOWNS.length - 1,
        })
        emit('town_reached', { town: event.index, mode: ride.mode })
        if (!ride.over) setScreen('town')
      } else if (event.type === 'over') {
        settle(ride)
        return
      }
    }
    if (changed) {
      setHud((h) => ({
        ...h,
        hearts: ride.hearts,
        score: ride.score,
        streak: ride.streak,
        town: ride.townIndex,
        wordsDone: ride.wordsDone,
      }))
    }
  }, [emit, present, settle, showFlash])

  const frame = useCallback((now) => {
    const ride = rideRef.current
    const renderer = rendererRef.current
    if (!ride || !renderer) return
    const dt = Math.min(0.05, (now - lastTimeRef.current) / 1000)
    lastTimeRef.current = now

    if (ride.running && !ride.over) {
      // `advance` returns everything since the last call, INCLUDING what was
      // raised between frames — the first challenge of the ride and the first
      // after each town are announced by `createRide` and `departTown`, not by
      // a frame. Nothing here re-enters `advance`, so the reused buffer is
      // safe to iterate in place.
      const events = advance(ride, dt)
      if (events.length) drainEvents(ride, events)

      // `ride.spawning` is the challenge whose rows are being laid down — the
      // NEXT word, known while the current one is still being answered. It is
      // certain to be presented, so this is the one place the ride is allowed
      // to spend a synthesis call ahead of time. Guarded by the word itself
      // rather than a timer: a string compare per frame is nothing, and the
      // warm behind it is deduplicated anyway.
      const ahead = ride.spawning
      if (voiceRef.current && ahead && ahead.kind !== 'choice' && ahead.word && ahead.word !== warmedRef.current) {
        warmedRef.current = ahead.word
        warmWord(ahead.word, { audioUrl: ahead.audio, cloud: true })
      }
    }

    // The bike slides between lanes rather than snapping, and pedals while it
    // moves. Presentation only, which is why it lives here and not in the core.
    const geom = renderer.geometry
    const view = viewRef.current
    const laneCentre = geom.width / 2 + (ride.lane - 1) * ((2 * geom.width * 0.46 * ((geom.riderY - geom.vanishY) / (geom.height - geom.vanishY))) / 3)
    view.targetX = laneCentre
    view.x += (view.targetX - view.x) * Math.min(1, dt * 11)
    if (Math.abs(view.targetX - view.x) < 1) view.x = view.targetX
    view.wobble += dt * (6 + (MAX_HEARTS - ride.hearts) * 1.6)

    if (!reducedRef.current) renderer.stepParticles(dt)
    renderer.draw(ride, { ...view, reducedMotion: reducedRef.current })

    rafRef.current = requestAnimationFrame(frame)
  }, [drainEvents])

  /* ── canvas plumbing ─────────────────────────────────────────────── */
  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const width = Math.max(240, Math.round(rect.width))
    const height = Math.max(360, Math.round(rect.height))
    if (!rendererRef.current) rendererRef.current = createRideRenderer(canvas)
    rendererRef.current.resize(width, height, window.devicePixelRatio || 1)
    rendererRef.current.setNight(isNightTheme())
    // The rider's line moves with the viewport, so a ride already running is
    // told — a rotated phone would otherwise resolve rows above or below the
    // bike it is drawn under.
    if (rideRef.current) rideRef.current.resolveAt = rendererRef.current.geometry.resolveY
    viewRef.current.x = width / 2
    viewRef.current.targetX = width / 2
  }, [])

  useEffect(() => {
    if (screen !== 'ride') return undefined
    sizeCanvas()
    const onResize = () => sizeCanvas()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)

    // The reading theme can be changed from another tab or another screen
    // while a ride is paused behind it; the canvas has no CSS to inherit, so
    // it is told.
    const observer = new MutationObserver(() => rendererRef.current?.setNight(isNightTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })

    lastTimeRef.current = performance.now()
    rafRef.current = requestAnimationFrame(frame)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      observer.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [screen, sizeCanvas, frame])

  /* ── steering ────────────────────────────────────────────────────── */
  const onPointerDown = useCallback((event) => {
    const ride = rideRef.current
    const canvas = canvasRef.current
    if (!ride || !canvas) return
    const rect = canvas.getBoundingClientRect()
    steer(ride, laneFromX(event.clientX - rect.left, rect.width))
  }, [])

  useEffect(() => {
    if (screen !== 'ride') return undefined
    const onKey = (event) => {
      const ride = rideRef.current
      if (!ride) return
      if (event.key === 'ArrowLeft') { steer(ride, ride.lane - 1); event.preventDefault() }
      if (event.key === 'ArrowRight') { steer(ride, ride.lane + 1); event.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen])

  /* ── starting and leaving ────────────────────────────────────────── */
  const startRide = useCallback(() => {
    // Priming MUST happen inside the tap. iOS and several Android WebViews
    // refuse to speak at all otherwise, silently.
    primeSounds()
    if (voiceRef.current) primeSpeech()

    runIdRef.current = mintRunId()
    sessionRef.current = `ride-${Date.now()}`
    reducedRef.current = prefersReducedMotion()
    reset()
    setFlash(null)
    setTownCard(null)
    setSummary(null)

    rideRef.current = createRide({
      mode,
      difficulty,
      items: items || [],
      choiceItems,
      pool: progress.pool,
      stage: progress.stagesPlayed,
      session: sessionRef.current,
      resolveAt: rendererRef.current?.geometry?.resolveY
        || ((wrapRef.current?.getBoundingClientRect()?.height || 780) * 0.8 - 10),
    })
    // The carried-forward words are the ride's actual opening — the learner's
    // own unfinished business is drawn before the town's pool — so they are
    // what gets warmed first.
    warmedRef.current = ''
    warmTown(0, rideRef.current.carried)

    setHud({ hearts: MAX_HEARTS, score: 0, streak: 0, town: 0, wordsDone: 0, revealing: false })
    setScreen('ride')
    emit('started', { mode, difficulty, grade })
    // The first challenge is already queued as an event by `createRide`; the
    // first frame delivers it. Announcing it here as well would say it twice.
  }, [choiceItems, difficulty, emit, grade, items, mode, progress.pool, progress.stagesPlayed, reset, warmTown])

  const keepRiding = useCallback(() => {
    const ride = rideRef.current
    if (!ride) return
    setTownCard(null)
    departTown(ride)
    // The town card is the next quiet moment the ride gets; the new town's
    // words are pulled over it, exactly as the menu covers the first.
    warmTown(ride.townIndex)
    setScreen('ride')
    // Same as `startRide`: the new leg's first challenge is on the queue and
    // the next frame delivers it.
  }, [warmTown])

  const endRide = useCallback(() => {
    const ride = rideRef.current
    if (!ride) return
    stopSpeech()
    if (ride.over) return
    finishRide(ride, 'ended')
    settle(ride)
  }, [settle])

  const leaveGame = useCallback(() => {
    stopSpeech()
    navigate('/games')
  }, [navigate])

  const repeatWord = useCallback(() => {
    const ride = rideRef.current
    if (!ride?.active) return
    primeSpeech()
    if (!voiceRef.current) setVoiceOn(true)
    if (ride.active.kind === 'choice') speakSentence(ride.active.prompt)
    else speakWord(ride.active.word, { audioUrl: ride.active.audio })
  }, [])

  const downloadCsv = useCallback(() => {
    if (!summary) return
    const csv = reportCsv(summary.stats, { mode: summary.mode, difficulty: summary.difficulty })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `spelling-ride-${summary.mode}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    emit('report_exported', { mode: summary.mode, words: summary.trouble.length })
  }, [emit, summary])

  /* ── screens ─────────────────────────────────────────────────────── */
  if (screen === 'loading') {
    return (
      <div className="lhx lhx-bare"><div className="lhx-page">
        <p className="lhx-sp-loading">Getting the road ready…</p>
      </div></div>
    )
  }

  const active = rideRef.current?.active || null

  return (
    <div className="lhx lhx-bare lhx-sr">
      {screen === 'menu' && (
        <div className="lhx-page">
          <div className="lhx-back-row">
            <button type="button" className="lhx-back-btn" aria-label="Back to games" onClick={leaveGame}>‹</button>
            <div>
              <div className="lhx-back-title">🚲 Spelling Ride</div>
              <div className="lhx-back-sub">Grade {grade} English · ECZ spelling practice</div>
            </div>
          </div>

          <p className="lhx-sr-tagline">
            Ride the T1 from Lusaka to Livingstone. Every row of letters blocks all three
            lanes, so there is always a choice to make. Steer into the letter that comes next.
          </p>

          <h2 className="lhx-sr-h2">Pick a mode</h2>
          <div className="lhx-sr-modes">
            {RIDE_MODES.map((m) => {
              const best = rideBest(progress, m.id, difficulty)
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`lhx-sr-mode ${mode === m.id ? 'is-on' : ''}`}
                  aria-pressed={mode === m.id}
                  onClick={() => setMode(m.id)}
                >
                  <span className="lhx-sr-mode-name">{m.name}</span>
                  {best > 0 && <span className="lhx-sr-best">Best {best}</span>}
                  <span className="lhx-sr-mode-blurb">{m.blurb}</span>
                </button>
              )
            })}
          </div>

          <h2 className="lhx-sr-h2">Speed</h2>
          <div className="lhx-sr-diffs">
            {RIDE_DIFFICULTY_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={`lhx-sr-diff ${difficulty === id ? 'is-on' : ''}`}
                aria-pressed={difficulty === id}
                onClick={() => setDifficulty(id)}
              >
                {RIDE_DIFFICULTIES[id].name}
                <small>{RIDE_DIFFICULTIES[id].blurb}</small>
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`lhx-sr-toggle ${voiceOn ? 'is-on' : ''}`}
            aria-pressed={voiceOn}
            onClick={() => {
              const next = !voiceOn
              setVoiceOn(next)
              if (next) primeSpeech()
              else stopSpeech()
            }}
          >
            <span aria-hidden="true">{voiceOn ? '🔊' : '🔇'}</span>
            {voiceOn ? 'Voice on' : 'Voice off'}
            <small>
              {voiceOn
                ? 'Every word is read aloud. Tap the speaker in the game to hear it again.'
                : 'Silent — for a classroom without headphones. Dictation still shows each word briefly.'}
            </small>
          </button>
          {!speechAvailable() && (
            <p className="lhx-sr-note">
              This device has no speaking voice installed, so Dictation will flash each word instead.
            </p>
          )}

          <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block lhx-sr-go" onClick={startRide}>
            START RIDING ▸
          </button>
          <p className="lhx-sr-note">
            Tap the lane you want, or use ← → on a keyboard. Five wrong letters and the bike is
            finished; six right in a row mends a part.
          </p>
          {!synced && (
            <p className="lhx-sr-note">Your progress is saved on this device and will sync when you are back online.</p>
          )}
        </div>
      )}

      {screen === 'ride' && (
        <div className="lhx-sr-stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="lhx-sr-canvas"
            onPointerDown={onPointerDown}
            aria-label="Spelling road. Tap the left, middle or right of the screen to choose a lane."
          />
          <div className="lhx-sr-hud">
            <div className="lhx-sr-top">
              <button type="button" className="lhx-sr-x" aria-label="End the ride" onClick={endRide}>✕</button>
              <div className="lhx-sr-hearts" aria-label={`${hud.hearts} of ${MAX_HEARTS} bike parts left`}>
                {Array.from({ length: MAX_HEARTS }, (_, i) => (
                  <i key={i} className={`lhx-sr-pip ${i < hud.hearts ? '' : 'is-off'}`} aria-hidden="true" />
                ))}
              </div>
              <div className="lhx-sr-chip">{townAt(hud.town).name}</div>
              <div className="lhx-sr-chip lhx-sr-score">⭐ {hud.score}</div>
              <button
                type="button"
                className="lhx-sr-x lhx-sr-mute"
                aria-label={muted ? 'Unmute game sounds' : 'Mute game sounds'}
                onClick={() => setMuted(toggleMute())}
              >
                <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
              </button>
            </div>

            <div className="lhx-sr-wordbar">
              <p className="lhx-sr-prompt">
                {/* A word bar with nothing in it reads as broken. There IS a
                    gap — a blank row of road runs between two words, so for
                    one row's worth of seconds no challenge is being asked —
                    and it is named rather than left empty. */}
                {!active
                  ? 'Get ready…'
                  : active.kind === 'choice'
                    ? active.prompt
                    : hud.revealing
                      ? 'Remember this word'
                      : active.kind === 'dictation'
                        ? 'Listen and spell it'
                        : 'Spell it'}
              </p>
              <div className="lhx-sr-slots">
                {!active && <span className="lhx-sr-slot" aria-hidden="true"> </span>}
                {(active?.steps || []).map((step, index) => {
                  const filled = active.filled?.[index]
                  const wordy = active.wordy
                  const text = filled ? filled.text : (hud.revealing ? step.correct : ' ')
                  return (
                    <span
                      key={index}
                      className={`lhx-sr-slot ${wordy ? 'is-wordy' : ''} ${filled ? (filled.ok ? 'is-ok' : 'is-bad') : ''}`}
                    >
                      {text}
                    </span>
                  )
                })}
              </div>
              {active?.kind !== 'choice' && active?.clue && !hud.revealing && (
                <p className="lhx-sr-clue">{active.clue}</p>
              )}
            </div>
          </div>

          {flash && (
            <div className={`lhx-sr-flash ${flash.tone === 'bad' ? 'is-bad' : 'is-good'}`} role="status">
              <strong>{flash.big}</strong>
              <span>
                {flash.sub}
                {flash.answer && <b className="lhx-sr-answer"> {flash.answer}</b>}
              </span>
            </div>
          )}

          <button type="button" className="lhx-sr-speaker" onClick={repeatWord} aria-label="Hear it again">
            <span aria-hidden="true">🔊</span>
          </button>
        </div>
      )}

      {screen === 'town' && townCard && (
        <div className="lhx-page">
          <div className="lhx-sr-town">
            <p className="lhx-sr-eyebrow">Welcome to</p>
            <h2 className="lhx-sr-town-name">{townCard.town.name}</h2>
            <p className="lhx-sr-town-set">{townCard.town.set} — cleared.</p>
            <div className="lhx-sr-route">
              {RIDE_TOWNS.map((town, i) => (
                <span
                  key={town.name}
                  className={`lhx-sr-stop ${i < townCard.index ? 'is-done' : ''} ${i === townCard.index ? 'is-now' : ''}`}
                >
                  {town.name}
                </span>
              ))}
            </div>
            <dl className="lhx-sr-stats">
              <div><dt>Words completed</dt><dd>{townCard.wordsDone}</dd></div>
              <div><dt>Letter accuracy</dt><dd>{townCard.accuracy}%</dd></div>
              <div><dt>Best streak</dt><dd>{townCard.bestStreak}</dd></div>
            </dl>
            <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={keepRiding}>
              KEEP RIDING ▸
            </button>
            <button type="button" className="lhx-btn lhx-btn-block lhx-sr-ghost" onClick={endRide}>
              End the ride and see the report
            </button>
          </div>
        </div>
      )}

      {screen === 'over' && summary && (
        <div className="lhx-page">
          <div className="lhx-sr-over">
            <div className="lhx-sr-stars" aria-label={`${summary.stars} of 3 stars`}>
              {'⭐'.repeat(summary.stars)}{'☆'.repeat(3 - summary.stars)}
            </div>
            <h2 className="lhx-sr-over-title">
              {summary.beatBest
                ? 'New best score!'
                : summary.outcome === 'wrecked'
                  ? 'The bike gave up'
                  : summary.outcome === 'arrived'
                    ? 'You reached Livingstone!'
                    : 'Ride finished'}
            </h2>
            <p className="lhx-sr-over-sub">
              {summary.outcome === 'wrecked'
                ? 'Five wrong letters and the bike is finished. The words below are the ones costing you — they will come back.'
                : 'Good ride. The words below are the ones to work on, and they will come back.'}
            </p>
            <dl className="lhx-sr-stats">
              <div><dt>Score</dt><dd>{summary.score}</dd></div>
              <div><dt>Your best</dt><dd>{Math.max(summary.previousBest, summary.score)}</dd></div>
              <div><dt>Words completed</dt><dd>{summary.wordsDone}</dd></div>
              <div><dt>Letter accuracy</dt><dd>{summary.accuracy}%</dd></div>
              <div><dt>Best streak</dt><dd>{summary.bestStreak}</dd></div>
              <div><dt>Distance</dt><dd>{summary.distanceKm} km</dd></div>
            </dl>
            {buildSaveNote({ signedIn: !!currentUser, saveResult, streakResult }) && (
              <p className="lhx-sr-note">{buildSaveNote({ signedIn: !!currentUser, saveResult, streakResult })}</p>
            )}
            <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={startRide}>
              RIDE AGAIN ▸
            </button>
            <button type="button" className="lhx-btn lhx-btn-block lhx-sr-ghost" onClick={() => setScreen('report')}>
              See the word report
            </button>
            <button type="button" className="lhx-btn lhx-btn-block lhx-sr-ghost" onClick={() => setScreen('menu')}>
              Back to the menu
            </button>
          </div>
        </div>
      )}

      {screen === 'report' && summary && (
        <div className="lhx-page">
          <div className="lhx-back-row">
            <button type="button" className="lhx-back-btn" aria-label="Back to the results" onClick={() => setScreen('over')}>‹</button>
            <div>
              <div className="lhx-back-title">Word report</div>
              <div className="lhx-back-sub">This ride only · ranked by trouble</div>
            </div>
          </div>
          <dl className="lhx-sr-stats">
            <div><dt>Words attempted</dt><dd>{Object.keys(summary.stats.byWord).length}</dd></div>
            <div><dt>Letters attempted</dt><dd>{summary.stats.letters}</dd></div>
            <div><dt>Letter accuracy</dt><dd>{summary.accuracy}%</dd></div>
          </dl>
          <h2 className="lhx-sr-h2">Needs work</h2>
          {summary.trouble.length === 0 ? (
            <p className="lhx-sr-clean">Nothing missed on this ride. Every letter was right.</p>
          ) : (
            <ul className="lhx-sr-misses">
              {summary.trouble.slice(0, 25).map((row) => (
                <li key={row.word}>
                  <span className="lhx-sr-miss-word">{row.word}</span>
                  <span className="lhx-sr-miss-count">{row.wrong} wrong of {row.attempts}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="lhx-btn lhx-btn-block lhx-sr-ghost" onClick={downloadCsv}>
            Download this report (CSV)
          </button>
          <p className="lhx-sr-note">
            These words are saved to your spelling record, so they come back in a later ride and in
            the Spelling ladder until you have them.
          </p>
        </div>
      )}

      <BadgePop badges={newBadges} />
    </div>
  )
}
