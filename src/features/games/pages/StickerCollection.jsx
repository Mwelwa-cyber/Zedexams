/**
 * StickerCollection — the prototype's view-stickers: the full-page sticker
 * grid behind the games hub's Achievements shelf.
 *
 * The chrome is the mockup's; the stickers are the REAL award system —
 * the GAME_BADGES registry, earned state from badges/{uid}.gameBadges,
 * awarded at round end by evaluateAndAwardGameBadges. No new award
 * machinery and no invented criteria: the prototype's "reach #1 this
 * week" and "win a live challenge" stickers name awards this build does
 * not grant, so they do not appear — every locked sticker's "how" line
 * is the registry's own hint, something the learner can actually do.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { GAME_BADGES } from '../../../data/gameBadges'
import { getMyGameBadges } from '../../../utils/gameBadgesService'
import { SectionSkeleton } from '../../learnerHome'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function StickerCollection() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [state, setState] = useState({ loading: true, byId: {} })

  useEffect(() => {
    let cancelled = false
    getMyGameBadges()
      .then((res) => { if (!cancelled) setState({ loading: false, byId: res?.byId || {} }) })
      .catch(() => { if (!cancelled) setState({ loading: false, byId: {} }) })
    return () => { cancelled = true }
  }, [currentUser])

  const earnedIds = new Set(Object.keys(state.byId))
  const earnedCount = GAME_BADGES.filter((b) => earnedIds.has(b.id)).length

  return (
    <div>
      <SeoHelmet title="Sticker Collection" path="/games/stickers" noIndex />
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Games" onClick={() => navigate('/games')}>‹</button>
        <div>
          <div className="lhx-back-title">Sticker Collection</div>
          <div className="lhx-back-sub">Earn stickers by playing &amp; learning</div>
        </div>
      </div>

      {state.loading ? (
        <div className="lhx-card"><SectionSkeleton lines={4} height={62} /></div>
      ) : (
        <>
          <div className="lhx-stk-note">
            {currentUser
              ? `🎁 ${earnedCount} of ${GAME_BADGES.length} collected — play games to unlock the rest!`
              : '🎁 Sign in to start collecting — every game you finish can earn a sticker.'}
          </div>
          <ul className="lhx-stk-grid">
            {GAME_BADGES.map((badge) => {
              const earned = earnedIds.has(badge.id)
              return (
                <li key={badge.id} className={`lhx-stk ${earned ? 'is-earned' : 'is-locked'}`}>
                  <div className="lhx-stk-art" aria-hidden="true">{earned ? badge.icon : '🔒'}</div>
                  <div className="lhx-stk-nm">{badge.name}</div>
                  <div className="lhx-stk-how">{earned ? badge.description : badge.hint}</div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
