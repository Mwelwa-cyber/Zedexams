/**
 * TodaysQuizCard — the prototype's slim `.daily-slim` card on Home: Zed's
 * face, "Today's Quiz", what is left, and a coral Play pill.
 *
 * ── This card is the reason the whole feature exists ─────────────────
 *
 * It used to read the Daily Exam — a whole 50+ question paper that a cron
 * pinned each morning — and when the picker found nothing to pin it said
 * "No quiz today — see the ones you've done" with nothing behind it. That
 * was honest about the data and useless to a child.
 *
 * Now it calls `getTodaysQuiz`, the ONE read path, which cannot return
 * nothing: the server builds the day's quiz on the spot if the cron missed,
 * and a bank too thin to fill five comes back as a labelled practice set.
 * So the card's states are Play, Practise, Review, or an honest "we couldn't
 * load it" — and every one of them goes somewhere real.
 *
 * IT IS ALWAYS RENDERED. A fixed part of the furniture that silently
 * disappears reads as a broken page, which is how this card came to be
 * missing from a real learner's home while sitting in every mockup.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTodaysQuiz, buildDailyCard, DAILY_CARD_STATE } from '../../dailyQuiz'
import { capture } from '../../../utils/analytics'

export default function TodaysQuizCard() {
  const navigate = useNavigate()
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getTodaysQuiz()
        if (!cancelled) setPayload(data)
      } catch (err) {
        // Never rendered as "no quiz today" — a failed read is not evidence
        // that there is nothing to play.
        console.warn('today’s quiz card: load failed', err)
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const card = buildDailyCard(payload, { loading, error })

  const go = () => {
    if (card.state === DAILY_CARD_STATE.DONE && payload?.result?.ranked) {
      capture('daily_quiz_leaderboard_opened', { from: 'home_daily' })
      navigate('/daily/leaderboard')
      return
    }
    capture('daily_quiz_opened', { from: 'home_daily', state: card.state })
    navigate('/daily')
  }

  return (
    <button
      type="button"
      className="lhx-card lhx-daily-slim lhx-press"
      onClick={go}
      disabled={card.state === DAILY_CARD_STATE.LOADING}
    >
      <span className="lhx-ds-icon" aria-hidden="true">
        <img
          src="/images/characters/poses/zed-waving.webp"
          alt=""
          width="40"
          height="40"
          loading="lazy"
        />
      </span>
      <span className="lhx-ds-body">
        <span className="lhx-ds-title">{card.title}</span>
        <span className="lhx-ds-sub">{card.sub}</span>
      </span>
      {card.cta && (
        <span className="lhx-play-pill lhx-play-pill-sm" aria-hidden="true">{card.cta}</span>
      )}
    </button>
  )
}
