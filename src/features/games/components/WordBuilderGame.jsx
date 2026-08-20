/**
 * Spelling — the connected system, not three games.
 *
 *   map → stage intro → round → (miss → coach) → results → next stage
 *
 * One learner record carries all of it: `spellingProgress/{uid}`, mirrored to
 * this device. The map's stars, the words a stage is composed from, the tricky
 * list, the coach's "this one comes back later" promise and the mastery a
 * results screen reports are all reads of that one record, which is what stops
 * the three screens being three games that happen to share a colour scheme.
 *
 * WHY THIS FILE IS STILL `word_builder`. The game registry, the seed importer,
 * the tombstones, the daily challenge and the duel question pool all key off
 * the game document's `type`, and Spelling is that document
 * (`english_word_builder_g7`, `wordPack: 'grade7-spelling'`). Registering a
 * second mechanic beside it would fork the catalogue and mean two rows for one
 * game. What changed is what a tap on that card OPENS: the ladder, rather than
 * a round of eight words with nothing above it.
 *
 * THE ROUND IS NO LONGER THE ENTRY POINT, and that is the substantive change
 * to this file. It used to mount straight into a round and write its progress
 * to `localStorage`. Progress is now the server's, the round is one node of a
 * ladder, and the stage a learner is handed is composed from their own history.
 *
 * WHAT IS DELIBERATELY UNCHANGED: the score/XP/badge/streak path. A finished
 * stage still flows through `useGameFinish` → `saveScore` → badges → daily
 * streak, with `reportGameStart` keeping the funnel, because that plumbing is
 * shared with every other game and spelling has no reason to have its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../gamesProto.css'
import './spelling.css'
import { useAuth } from '../../../contexts/AuthContext'
import { useGameFinish } from '../hooks/useGameFinish'
import { reportGameStart } from '../services/gamesService'
import { playWin, primeSounds } from '../lib/gameSounds'
import { BadgePop, buildSaveNote } from './protoGameChrome'
import { capture } from '../../../utils/analytics'
import { resolveLearnerGrade } from '../lib/gamesHubCore'
import { isKnownPack, loadWordPack, packForGrade } from '../lib/spellingPack'
import { listApprovedWords } from '../services/spellingContentService'
import { loadSpellingProgress, saveSpellingProgress } from '../services/spellingProgressService'
import {
  applyStageResult,
  normaliseProgress,
  resumeIsLive,
} from '../lib/spellingProgressCore'
import {
  buildStageMap,
  chapterForStage,
  chapterTableFor,
  recordStageStars,
  starsFor,
  wordsForStage,
  wordsForTrickyStage,
  TRICKY_STAGE,
} from '../lib/spellingMapCore'
import { stageSummary, STAGE_WORDS } from '../lib/spellingStagesCore'
import { playableWords, roundResult, wordQueue } from '../lib/wordBuilderCore'
import { stopSpeech } from '../lib/spellingSpeech'
import SpellingStageMap, { StageIntroSheet } from './SpellingStageMap'
import SpellingRound from './SpellingRound'
import SpellingResults from './SpellingResults'
import TrickyWordsPanel from './TrickyWordsPanel'

/** A run id for one attempt at one stage. The duplicate-award key. */
function mintRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `run-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export default function WordBuilderGame({ game }) {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const grade = Number(game?.grade) || resolveLearnerGrade(userProfile)

  const [screen, setScreen] = useState('loading')   // loading|map|intro|round|results|tricky
  const [progress, setProgress] = useState(() => normaliseProgress(null))
  const [synced, setSynced] = useState(true)
  const [questions, setQuestions] = useState(null)
  const [bandTable, setBandTable] = useState([])
  const [pending, setPending] = useState(null)      // the stage being introduced
  const [active, setActive] = useState(null)        // the stage being played
  const [results, setResults] = useState(null)

  const { saveResult, newBadges, streakResult, finish } = useGameFinish()
  const poolRef = useRef({})

  /* ── content ─────────────────────────────────────────────────────── */
  /**
   * Which words this game plays.
   *
   * The document's OWN `wordPack` wins outright. Failing that, a document that
   * carries no questions of its own falls back to its grade's pack, which is
   * what opens a new grade without editing every game document.
   *
   * A document that HAS its own questions keeps them, and that ordering is the
   * point: deriving the pack from the grade unconditionally would silently
   * ignore words an admin had deliberately authored on the document, and the
   * only symptom would be a learner being served different words from the ones
   * on the screen the admin was looking at.
   */
  const packId = game?.wordPack || (game?.questions?.length ? '' : packForGrade(grade))

  useEffect(() => {
    let cancelled = false
    async function load() {
      // The band table is the declared difficulty ladder and is imported
      // dynamically alongside the bank, so a learner opening a maths game
      // never downloads a spelling chapter list.
      const rows = isKnownPack(packId)
        ? await loadWordPack(packId, { fetchApproved: listApprovedWords })
        : []
      let bands = []
      if (isKnownPack(packId)) {
        try {
          const bank = await import('../../../data/spellingBank.js')
          bands = bank.SPELLING_BANDS
        } catch { bands = [] }
      }
      if (cancelled) return
      setQuestions(rows.length ? rows : (game?.questions || []))
      setBandTable(bands)
    }
    load().catch(() => { if (!cancelled) { setQuestions(game?.questions || []); setBandTable([]) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId])

  /* ── the learner's record ────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false
    loadSpellingProgress(game?.id).then(({ progress: loaded, synced: ok }) => {
      if (cancelled) return
      setProgress(loaded)
      poolRef.current = loaded.pool
      setSynced(ok)
    }).catch(() => { if (!cancelled) setSynced(false) })
    return () => { cancelled = true }
    // The signed-in user is a dependency: a learner who signs in mid-session
    // has to have their device record merged into their account record, and
    // that merge happens on the next load rather than being deferred.
  }, [game?.id, currentUser?.uid])

  useEffect(() => {
    primeSounds()
    reportGameStart(game)
    return () => stopSpeech()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items = useMemo(() => playableWords(questions || []), [questions])
  const { bands, counts } = useMemo(() => chapterTableFor(items, bandTable), [items, bandTable])

  const map = useMemo(
    () => buildStageMap({ bands, counts, stars: progress.stars, pool: progress.pool }),
    [bands, counts, progress.stars, progress.pool],
  )

  useEffect(() => {
    if (screen === 'loading' && questions !== null) setScreen('map')
  }, [screen, questions])

  const emit = useCallback((event, props = {}) => {
    // Learning events, not UI taps — and never the answer. A client analytics
    // payload carrying the correct spelling of every word served would be an
    // answer key anyone can read in the network tab.
    capture(`spelling_${event}`, { gameId: game?.id || null, grade, ...props })
  }, [game?.id, grade])

  /* ── opening a stage ─────────────────────────────────────────────── */
  const composeFor = useCallback((stage) => {
    if (stage === TRICKY_STAGE) {
      return { ...wordsForTrickyStage({ items, pool: progress.pool }), chapter: null }
    }
    const chapter = chapterForStage(map.chapters, stage)
    const composed = wordsForStage({
      items,
      pool: progress.pool,
      stage,
      band: chapter?.id || null,
      salt: game?.id || 'spelling',
      size: STAGE_WORDS,
    })
    // A pack too small to compose anything at all still plays — the plain
    // shuffled queue is what every game without a ladder did before this, and
    // a learner meeting an empty screen is worse than one meeting a repeat.
    if (!composed.words.length) {
      return { ...composed, words: wordQueue(questions).slice(0, STAGE_WORDS), chapter }
    }
    return { ...composed, chapter }
  }, [items, progress.pool, map.chapters, game?.id, questions])

  const openStage = (stage) => {
    const composed = composeFor(stage)
    const resume = resumeIsLive(progress.resume, { now: Date.now() })
      && String(progress.resume.stage) === String(stage)
      ? progress.resume
      : null
    setPending({ stage, ...composed, resume })
    setScreen('intro')
  }

  const beginStage = ({ stage, words, chapter, fromResume = null }) => {
    const runId = fromResume?.runId || mintRunId()
    const session = fromResume?.session || `s${Date.now()}`
    poolRef.current = progress.pool
    setActive({
      stage,
      chapter,
      band: chapter?.id || null,
      words: fromResume
        // A resume replays the SAME word list, looked up from the pack by
        // word. Recomposing would hand the learner a different stage and call
        // it a resume, because the pool has moved on since they left.
        ? fromResume.words.map((w) => items.find((it) => it.word === w)).filter(Boolean)
        : words,
      runId,
      session,
      startIndex: fromResume?.index || 0,
      firstTryCorrect: fromResume?.firstTryCorrect || 0,
      missedWords: fromResume?.missedWords || [],
      poolBefore: fromResume?.poolBefore && Object.keys(fromResume.poolBefore).length
        ? fromResume.poolBefore
        : progress.pool,
    })
    setScreen('round')
    emit(stage === TRICKY_STAGE ? 'tricky_stage_started' : 'stage_started', {
      stage, band: chapter?.id || null, replay: starsFor(progress.stars, stage) > 0,
    })
  }

  /**
   * Answer-by-answer pool changes are held in a REF and written to the device
   * only. Twenty Firestore writes per stage per learner is what writing each
   * answer would cost; the server is written when the stage settles and when
   * the learner leaves part-way, which are the two moments the record has to
   * survive.
   */
  const onPoolChange = useCallback((updater) => {
    poolRef.current = typeof updater === 'function' ? updater(poolRef.current) : updater
  }, [])

  const onPosition = useCallback(({ index, firstTryCorrect, missedWords }) => {
    if (!active) return
    setProgress((current) => {
      const next = {
        ...current,
        pool: poolRef.current,
        resume: {
          stage: active.stage,
          band: active.band,
          runId: active.runId,
          session: active.session,
          words: active.words.map((w) => w.word),
          index,
          firstTryCorrect,
          missedWords,
          poolBefore: active.poolBefore,
          startedAtMs: Date.now(),
        },
      }
      // Device only — the resume is what a refresh reads back, and it is
      // rewritten on every word.
      // Fire and forget: the device copy is already written inside
      // `saveSpellingProgress`, so a failed server sync loses nothing and must
      // not interrupt the round.
      saveSpellingProgress(game?.id, next).then(setSynced).catch(() => setSynced(false))
      return next
    })
  }, [active, game?.id])

  /* ── finishing a stage ───────────────────────────────────────────── */
  const finishStage = (outcome) => {
    const summary = stageSummary({
      before: active.poolBefore,
      after: poolRef.current,
      words: active.words,
      firstTryCorrect: outcome.firstTryCorrect,
      size: active.words.length,
    })
    const previousStars = starsFor(progress.stars, active.stage)

    setProgress((current) => {
      const next = applyStageResult(current, {
        stage: active.stage,
        stars: summary.stars,
        pool: poolRef.current,
        runId: active.runId,
      })
      // `applyStageResult` returns the record BY IDENTITY when the run is
      // already settled, so a stage that somehow finishes twice writes nothing
      // and awards nothing the second time.
      if (next !== current) saveSpellingProgress(game?.id, next).then(setSynced).catch(() => setSynced(false))
      return next
    })

    setResults({ stage: active.stage, chapter: active.chapter, summary, previousStars, bestStreak: outcome.bestStreak })
    playWin()
    setScreen('results')

    emit(active.stage === TRICKY_STAGE ? 'tricky_stage_completed' : 'stage_completed', {
      stage: active.stage,
      band: active.band,
      stars: summary.stars,
      firstTryCorrect: outcome.firstTryCorrect,
      words: active.words.length,
      mastered: summary.mastered.length,
      addedTricky: summary.addedTricky.length,
      replay: previousStars > 0,
    })
    if (summary.mastered.length) emit('tricky_word_mastered', { count: summary.mastered.length })
    if (summary.addedTricky.length) emit('tricky_word_added', { count: summary.addedTricky.length })

    // A chapter completes when the stage just cleared was its last AND every
    // stage in it now holds a star. Derived from the record rather than
    // counted as we go: a learner can clear a chapter's stages out of order
    // by replaying, and a running tally would miss that or double-count it.
    if (active.chapter && Number(active.stage) === active.chapter.lastStage) {
      const stars = recordStageStars(progress.stars, active.stage, summary.stars)
      const complete = Array.from(
        { length: active.chapter.stageCount },
        (_, i) => active.chapter.firstStage + i,
      ).every((stage) => starsFor(stars, stage) > 0)
      if (complete) {
        emit('chapter_completed', { chapter: active.chapter.id, index: active.chapter.index })
      }
    }

    // The shared end-of-round plumbing — score, XP, badges, daily streak. One
    // stage is one round, exactly as every other game reports one.
    finish(roundResult({
      game,
      score: summary.firstTryCorrect * 20,
      solved: outcome.solved,
      misses: outcome.missedWords.length,
      peakCombo: outcome.bestStreak,
      timeSpent: outcome.timeSpent,
    }))
  }

  /**
   * Leaving mid-stage. The resume has already been written on every word, so
   * this only has to put the pool changes somewhere durable and go back — a
   * learner who leaves after answering four words keeps those four answers.
   */
  const leaveRound = () => {
    setProgress((current) => {
      const next = { ...current, pool: poolRef.current }
      saveSpellingProgress(game?.id, next).then(setSynced).catch(() => setSynced(false))
      return next
    })
    stopSpeech()
    setActive(null)
    setScreen('map')
  }

  /* ── screens ─────────────────────────────────────────────────────── */
  if (screen === 'loading') {
    // `lhx-bare` here as well as on the main return: this engine is
    // bare-mounted by PlayGame, and without it the desktop sidebar gutter
    // learnerTheme.css reserves shoves the waiting line 250px right of centre
    // with nothing in the gap (#2556).
    return (
      <div className="lhx lhx-bare"><div className="lhx-page">
        <p className="lhx-sp-loading">Getting your words ready…</p>
      </div></div>
    )
  }

  return (
    <div className="lhx lhx-bare">
      <div className="lhx-page">
        {screen === 'map' && (
          <SpellingStageMap
            map={map}
            grade={grade}
            synced={synced}
            onExit={() => navigate('/games')}
            onPickStage={(stage) => openStage(stage)}
            onPickTricky={() => setScreen('tricky')}
          />
        )}

        {screen === 'tricky' && (
          <TrickyWordsPanel
            pool={progress.pool}
            onTakeOn={() => { setScreen('map'); openStage(TRICKY_STAGE) }}
            onBack={() => setScreen('map')}
          />
        )}

        {screen === 'intro' && pending && (
          <>
            <SpellingStageMap
              map={map}
              grade={grade}
              synced={synced}
              onExit={() => navigate('/games')}
              onPickStage={() => {}}
              onPickTricky={() => {}}
            />
            <StageIntroSheet
              stage={pending.stage}
              chapter={pending.chapter}
              words={pending.words}
              fromPool={pending.fromPool}
              resume={pending.resume}
              onClose={() => { setPending(null); setScreen('map') }}
              onStart={() => beginStage(pending)}
              onResume={pending.resume ? () => beginStage({ ...pending, fromResume: pending.resume }) : null}
              onReplayPrevious={
                Number(pending.stage) > 1 && starsFor(progress.stars, Number(pending.stage) - 1) > 0
                  ? () => openStage(Number(pending.stage) - 1)
                  : null
              }
            />
          </>
        )}

        {screen === 'round' && active && (
          <SpellingRound
            key={active.runId}
            words={active.words}
            stage={active.stage}
            band={active.band}
            chapterTitle={active.chapter?.title || ''}
            grade={grade}
            session={active.session}
            startIndex={active.startIndex}
            initialFirstTry={active.firstTryCorrect}
            initialMissed={active.missedWords}
            onPoolChange={onPoolChange}
            onPosition={onPosition}
            onExit={leaveRound}
            onFinish={finishStage}
            onEvent={emit}
          />
        )}

        {screen === 'results' && results && (
          <SpellingResults
            stage={results.stage}
            summary={results.summary}
            bestStreak={results.bestStreak}
            previousStars={results.previousStars}
            hasNextStage={Number(results.stage) < map.lastStage}
            saveNote={buildSaveNote({ signedIn: !!currentUser, saveResult, streakResult })}
            onMap={() => { setResults(null); setActive(null); setScreen('map') }}
            onNext={() => { setResults(null); setActive(null); openStage(Number(results.stage) + 1) }}
            onReplay={() => {
              emit('stage_replayed', { stage: results.stage })
              setResults(null)
              setActive(null)
              openStage(results.stage)
            }}
          />
        )}
      </div>
      <BadgePop badges={newBadges} />
    </div>
  )
}
