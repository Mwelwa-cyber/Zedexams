/**
 * ParentReportDetail — /family/child/:childUid/report. The week in three
 * paragraphs: what went well, where to focus, what Zed suggests.
 *
 * The words are the server's (parentAppCore.buildWeeklyReport) so the
 * screen and the Sunday email cannot say different things about the same
 * week. Everything in them is measured; a figure we do not hold is left
 * out of the sentence rather than filled in.
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getGuardianWeeklyReport } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { firstNameOf } from '../lib/parentAppView'
import { BackRow, ErrorRetry, ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function ParentReportDetail() {
  const { childUid } = useParams()
  const [state, setState] = useState({ loading: true, error: null, data: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await getGuardianWeeklyReport(childUid)
      setState({ loading: false, error: null, data })
    } catch (err) {
      reportClientError(err, 'parentApp.getGuardianWeeklyReport')
      setState({ loading: false, error: err?.message || 'We could not build that report.', data: null })
    }
  }, [childUid])

  useEffect(() => { load() }, [load])

  const { loading, error, data } = state
  const name = firstNameOf(data?.displayName) || 'Your child'
  const report = data?.report

  return (
    <>
      <SeoHelmet title={`${name}'s week · ZedExams`} noIndex />
      <BackRow title="Weekly report" to={`/family/child/${childUid}`} />

      {loading ? (
        <ListSkeleton rows={3} height={96} />
      ) : error ? (
        <ErrorRetry message={error} onRetry={load} />
      ) : (
        <>
          <section className="pax-rep-hero">
            <p className="pax-rep-hero-kicker">{name} · the last 7 days</p>
            <p className="pax-rep-hero-title">{report.headline}</p>
            <p className="pax-rep-hero-meta">
              {[
                data.quizzes ? `${data.quizzes} ${data.quizzes === 1 ? 'quiz' : 'quizzes'}` : null,
                data.notes ? `${data.notes} ${data.notes === 1 ? 'topic' : 'topics'} read` : null,
              ].filter(Boolean).join(' · ') || 'No activity this week'}
            </p>
          </section>

          <article className="lhx-card pax-rep-block">
            <h2>✅ What went well</h2>
            <p>{report.wentWell}</p>
          </article>

          <article className="lhx-card pax-rep-block">
            <h2>🎯 Where to focus</h2>
            <p>{report.focusOn}</p>
          </article>

          <article className="lhx-card pax-rep-block">
            <h2>💡 What to try next</h2>
            <p>{report.suggestion}</p>
          </article>

          <p className="pax-note">
            Built from {name}'s own quizzes, topics and past papers over the last
            seven days. We do not measure time spent in the app, so this report
            never claims a figure for it.
          </p>
        </>
      )}

      <div style={{ height: 20 }} />
    </>
  )
}
