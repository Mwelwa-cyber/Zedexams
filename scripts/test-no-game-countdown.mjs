/**
 * The solo learning games have NO COUNTDOWN, and this is what keeps it that
 * way (PROMPT 7b).
 *
 * ## Why a text scan rather than a behaviour test
 *
 * Every engine already has a behaviour spec that advances ten minutes of fake
 * time and asserts the round is still running. Those prove the clock is gone
 * from the path they drive; they cannot prove it is gone from a path they
 * don't — a second mechanic, a new screen, a "hurry up" nudge on a timer, a
 * per-question limit added beside the round. This scan reads the source and
 * fails on the CONSTRUCTS a countdown is built from, so the clock cannot
 * return through a door no spec happens to be standing at.
 *
 * That is the same argument `test:bank-insert-writes` makes for scanning
 * rather than asserting: a behaviour test cannot tell "no clock" from "a clock
 * this test never reached".
 *
 * ## What is banned, and what is not
 *
 * BANNED: repeating timers (`setInterval`), any state or helper that counts
 * DOWN, and the countdown's chrome (`role="timer"`, the urgent-flash class).
 *
 * ALLOWED, deliberately: `setTimeout`. Every engine uses it for reveal beats
 * and board-deal pauses — 320ms to 700ms of animation, which end nothing and
 * take nothing away. And `timeSpent` / `startedAtRef`: elapsed time is still
 * RECORDED on the `scores` document (My Progress and the guardian's weekly
 * report read it). Recording how long something took is not a clock; counting
 * down to a moment when the round is taken away is.
 *
 * ## Scope
 *
 * Solo learning games only. The daily exam (`DailyExamRunner`), the opt-in
 * quiz Exam mode and opt-in timed past-paper practice legitimately keep their
 * clocks — the learner chooses those, and PROMPT 7a's rule is that a timed
 * mode may exist as long as it is never the default and never the only option.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Every file a solo game round is played out of. */
const GUARDED = [
  'src/features/games/components/TimedQuizGame.jsx',
  'src/features/games/components/MeaningMatchGame.jsx',
  'src/features/games/components/NumberTargetGame.jsx',
  'src/features/games/components/PunctuationProGame.jsx',
  'src/features/games/components/WordBuilderGame.jsx',
  'src/features/games/components/protoGameChrome.jsx',
  'src/features/games/lib/timedQuizCore.js',
  'src/features/games/lib/meaningMatchCore.js',
  'src/features/games/lib/numberPathCore.js',
  'src/features/games/lib/punctuationCore.js',
  'src/features/games/lib/wordBuilderCore.js',
]

/**
 * Each rule is [pattern, what it would mean]. The message is the point: a
 * failure has to tell the next person WHY the thing they just added is
 * refused, or they will read the guard as noise and delete it.
 */
const BANNED = [
  [/\bsetInterval\s*\(/, 'a repeating timer — the shape every deleted countdown had'],
  [/\bROUND_SECONDS\b/, 'a round measured in seconds; a round is a fixed set of items'],
  [/\blevelTimeMax\b/, 'a per-level time limit — difficulty climbs through the content, never the clock'],
  [/\btimerPct\b/, 'a draining timer bar; the bar FILLS with progress through the set'],
  [/\bisTimerDanger\b/, 'a countdown danger state — there is nothing to be in danger of'],
  [/\b(timeLeft|secondsLeft|timeRemaining|remainingSeconds)\b/, 'remaining-time state, which only a countdown needs'],
  [/role\s*=\s*["'{]?\s*["']timer["']/, 'the timer ARIA role; a progress bar is role="progressbar"'],
  [/animate-timer-urgent/, 'the urgent timer flash — PROMPT 7b bans red flashing on a learner'],
]

/** Strip comments so this file's OWN prose about the ban never trips it. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const failures = []
for (const relative of GUARDED) {
  const source = code(readFileSync(join(root, relative), 'utf8'))
  for (const [pattern, why] of BANNED) {
    if (pattern.test(source)) failures.push(`${relative}: ${pattern} — ${why}`)
  }
}

// The guard has to be able to FAIL, or it is decoration. Run the same rules
// over a sample carrying a real countdown and check every one of them fires.
const SAMPLE = `
  const [timeLeft, setTimeLeft] = useState(60)
  useEffect(() => {
    const iv = setInterval(() => setTimeLeft((t) => t - 1), 1000)
    return () => clearInterval(iv)
  }, [])
  const pct = timerPct(timeLeft, ROUND_SECONDS)
  const max = levelTimeMax(level)
  const danger = isTimerDanger(timeLeft)
  return <div role="timer" className="animate-timer-urgent" style={{ width: pct }} />
`
const missed = BANNED.filter(([pattern]) => !pattern.test(code(SAMPLE)))
if (missed.length) {
  console.error('FAIL: the guard does not catch a real countdown:')
  for (const [pattern, why] of missed) console.error(`  ${pattern} — ${why}`)
  process.exit(1)
}

// And it must not fire on what the engines legitimately still do.
const ALLOWED_SAMPLE = `
  const startedAtRef = useRef(Date.now())
  const later = (fn, ms) => { timeouts.current.push(setTimeout(fn, ms)) }
  later(nextBoard, 500)
  onEnd({ timeSpent: Math.round((Date.now() - startedAtRef.current) / 1000) })
  <div role="progressbar" aria-valuenow={done} aria-valuemax={total} />
`
const overreach = BANNED.filter(([pattern]) => pattern.test(code(ALLOWED_SAMPLE)))
if (overreach.length) {
  console.error('FAIL: the guard refuses something the engines legitimately do:')
  for (const [pattern, why] of overreach) console.error(`  ${pattern} — ${why}`)
  process.exit(1)
}

if (failures.length) {
  console.error('FAIL: a countdown has come back to the solo learning games.\n')
  for (const line of failures) console.error(`  ${line}`)
  console.error(`
Speed is not the skill these games teach, and a clock filters out the slower
readers who need the practice most. A round ends when its fixed set is done.
If a timed mode is genuinely wanted it is a SEPARATE mode the learner opts
into (see QuizRunnerV2's Practice/Exam picker) — never the default, never the
only option, and never in these files.`)
  process.exit(1)
}

console.log(`test-no-game-countdown: ${GUARDED.length} game files clear of ${BANNED.length} countdown constructs ✓`)
