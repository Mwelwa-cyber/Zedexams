/**
 * ParentChildActivity — /family/child/:childUid/activity. The full
 * day-grouped feed, over a window the parent chooses.
 *
 * The window tops out at 30 days because that is how far back the
 * underlying reads go; offering "all time" would return a partial answer
 * that looks complete.
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getGuardianChildActivity } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { firstNameOf } from '../lib/parentAppView'
import ActivityTimeline from '../components/ActivityTimeline'
import { BackRow, Empty, ErrorRetry, ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]

export default function ParentChildActivity() {
  const { childUid } = useParams()
  const [days, setDays] = useState(7)
  const [state, setState] = useState({ loading: true, error: null, data: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await getGuardianChildActivity(childUid, { days })
      setState({ loading: false, error: null, data })
    } catch (err) {
      reportClientError(err, 'parentApp.getGuardianChildActivity')
      setState({ loading: false, error: err?.message || 'We could not load that.', data: null })
    }
  }, [childUid, days])

  useEffect(() => { load() }, [load])

  const { loading, error, data } = state
  const name = firstNameOf(data?.displayName) || 'Your child'

  return (
    <>
      <SeoHelmet title={`${name}'s activity · ZedExams`} noIndex />
      <BackRow title={`${name}'s activity`} to={`/family/child/${childUid}`} />

      <div className="lhx-terms" role="tablist" aria-label="How far back">
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            type="button"
            role="tab"
            aria-selected={days === w.days}
            className={`lhx-term-tab ${days === w.days ? 'is-active' : ''}`}
            onClick={() => setDays(w.days)}
          >
            {w.label}
          </button>
        ))}
      </div>

      {loading ? (
        <ListSkeleton rows={4} height={62} />
      ) : error ? (
        <ErrorRetry message={error} onRetry={load} />
      ) : !data?.activity?.length ? (
        <Empty icon="🕊️">
          Nothing in the last {days} days. Anything {name} does — a quiz, a
          topic, a past paper — shows up here.
        </Empty>
      ) : (
        <ActivityTimeline days={data.activity} />
      )}

      <p className="pax-note">
        Showing the last {days} days. Times are Zambian time.
      </p>
      <div style={{ height: 20 }} />
    </>
  )
}
