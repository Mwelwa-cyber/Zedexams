/**
 * protoGameChrome — the pieces every rebuilt prototype-v3 game engine
 * shares (learner redesign step 4): the indigo head's top row (✕ /
 * progress bar / score), the stars-and-cards win screen with confetti,
 * the one-at-a-time badge celebration pop, and the save-note line that
 * reports the kept backend's outcome (signed-out, failed save, daily
 * streak). Extracted from NumberTargetGame when Word Builder became the
 * second engine to need all four.
 *
 * The top row's bar used to be a COUNTDOWN — every solo engine ran a
 * 60-ish-second clock and the round ended when it hit zero. It doesn't
 * any more (PROMPT 7b): speed is not the skill these games teach, and a
 * clock filters out the slower readers who need the practice most. The
 * bar now fills as the learner works through a fixed set, so the same
 * shape carries the same "how far in am I" reading without punishing
 * anyone for thinking. `role="timer"` went with the clock; a progress
 * bar is a `progressbar`.
 *
 * Styles live in ../gamesProto.css; each engine imports its own copy of
 * that stylesheet and renders inside its own `.lhx` root.
 */
import { useEffect, useMemo, useState } from 'react'
import { isMuted, toggleMute } from '../lib/gameSounds'

const CONFETTI_BITS = ['🎉', '⭐', '✨', '🎊', '🧡', '💜']

/**
 * The nt-top row: exit control, round-progress bar, mute, live score.
 *
 * `done` / `total` are ITEMS of the round's fixed set — pairs matched,
 * words spelt, sentences picked, targets hit. Never seconds.
 *
 * The mute control lives HERE because the engines that render this row
 * mount bare, without GamesShell — and the shell's nav used to hold the
 * only mute toggle, so a full-screen game could not be silenced (or its
 * haptics stopped; the one preference governs both) mid-round.
 */
export function GameTopBar({ onExit, done, total, score }) {
  const steps = Math.max(1, Math.floor(Number(total) || 0))
  const at = Math.min(steps, Math.max(0, Math.floor(Number(done) || 0)))
  const [muted, setMuted] = useState(() => isMuted())
  return (
    <div className="lhx-nt-top">
      <button type="button" className="lhx-nt-x" aria-label="Leave the round" onClick={onExit}>✕</button>
      <div
        className="lhx-nt-progressbar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps}
        aria-valuenow={at}
        aria-label={`${at} of ${steps} done`}
      >
        <i style={{ width: `${(at / steps) * 100}%` }} />
      </div>
      <button
        type="button"
        className="lhx-nt-x lhx-nt-mute"
        aria-label={muted ? 'Unmute game sounds' : 'Mute game sounds'}
        onClick={() => setMuted(toggleMute())}
      >
        <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
      </button>
      <div className="lhx-nt-score">⭐ {score}</div>
    </div>
  )
}

/**
 * What the win screen says about the round's persistence — the learner
 * either isn't signed in, the save failed, or the daily streak moved.
 */
export function buildSaveNote({ signedIn, saveResult, streakResult }) {
  if (!signedIn) return 'Sign in to save your score, earn badges and climb the leaderboard.'
  if (saveResult && !saveResult.ok) return 'Score not saved — check your connection and play again.'
  if (streakResult?.isDaily) return `🔥 Daily challenge done — ${streakResult.streak}-day streak!`
  return null
}

/**
 * The prototype win view: confetti, stars, title/sub, XP + SCORE cards.
 *
 * `children` render UNDER the continue button, for a second action an engine
 * needs on this screen — the Fraction Ladder's "Practise this stage again",
 * which has to sit beside Continue rather than replace it, because replaying a
 * stage and moving on are both ordinary things to want.
 */
export function WinScreen({ stars, title, sub, score, saveNote = null, continueLabel = 'CONTINUE ▸', onContinue, children = null }) {
  const confetti = useMemo(
    () =>
      Array.from({ length: 20 }, (_, i) => ({
        bit: CONFETTI_BITS[i % CONFETTI_BITS.length],
        left: `${(i * 17 + 5) % 95}%`,
        duration: `${2.5 + ((i * 7) % 20) / 10}s`,
        delay: `${((i * 13) % 12) / 10}s`,
      })),
    [],
  )

  return (
    <div className="lhx-win">
      {confetti.map((c, i) => (
        <span
          key={i}
          className="lhx-confetti"
          style={{ left: c.left, animationDuration: c.duration, animationDelay: c.delay }}
          aria-hidden="true"
        >
          {c.bit}
        </span>
      ))}
      <div className="lhx-win-middle">
        <div className="lhx-win-stars" aria-label={`${stars} of 3 stars`}>
          {'⭐'.repeat(stars)}{'☆'.repeat(3 - stars)}
        </div>
        <h2 className="lhx-win-title">{title}</h2>
        <p className="lhx-win-sub">{sub}</p>
        <div className="lhx-win-cards">
          <div className="lhx-win-stat ws-xp">
            <div className="lhx-win-stat-label">XP EARNED</div>
            <div className="lhx-win-stat-body">+{score}</div>
          </div>
          <div className="lhx-win-stat ws-score">
            <div className="lhx-win-stat-label">SCORE</div>
            <div className="lhx-win-stat-body">{score}</div>
          </div>
        </div>
        {saveNote && <p className="lhx-win-note">{saveNote}</p>}
      </div>
      <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={onContinue}>
        {continueLabel}
      </button>
      {children}
    </div>
  )
}

/** One-at-a-time celebration pop for badges earned this round. */
export function BadgePop({ badges }) {
  const [index, setIndex] = useState(-1)
  useEffect(() => {
    if (!badges.length) return undefined
    setIndex(0)
    const timers = []
    for (let i = 1; i <= badges.length; i += 1) {
      timers.push(setTimeout(() => setIndex(i < badges.length ? i : -1), i * 2200))
    }
    return () => timers.forEach(clearTimeout)
  }, [badges])
  const badge = index >= 0 ? badges[index] : null
  return (
    <div className={`lhx-bpop ${badge ? 'is-show' : ''}`} role="status" aria-live="polite">
      {badge && (
        <>
          <div className="lhx-bpop-ic">{badge.icon}</div>
          <div className="lhx-bpop-lab">NEW BADGE!</div>
          <div className="lhx-bpop-nm">{badge.name}</div>
          <div className="lhx-bpop-desc">{badge.description}</div>
        </>
      )}
    </div>
  )
}
