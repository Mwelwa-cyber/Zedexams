import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getChildProgress } from '../services/familyPortal'
import { reportClientError } from '../../../utils/clientErrorReporting'
import ChildProgressSections from '../components/ChildProgressSections'
import Skeleton from '../../../shared/components/Skeleton'
import SeoHelmet from '../../../shared/components/SeoHelmet'

/**
 * ChildProgressPage — /family/child/:childUid. Loads the authenticated
 * per-child progress payload (link-gated on the server) and renders it with
 * the shared ChildProgressSections. Shows a friendly not-linked / error state
 * rather than a raw exception.
 */
export default function ChildProgressPage() {
  const { childUid } = useParams()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!childUid) return undefined
    let cancelled = false
    setStatus('loading')
    getChildProgress(childUid)
      .then((row) => {
        if (cancelled) return
        setData(row)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        reportClientError(err, 'family.getChildProgress')
        const msg = err?.message || ''
        setErrorMsg(
          /not linked|permission/i.test(msg)
            ? 'You are not linked to this child. Ask them for their family code and add them from your family home.'
            : 'We could not load this child\'s progress right now. Please try again.',
        )
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [childUid])

  const name = data?.learnerDisplayName || 'Your child'

  return (
    <div className="space-y-5">
      <SeoHelmet title={status === 'ready' ? `${name}'s progress` : 'Child progress'} noIndex />

      <Link to="/family" className="inline-flex items-center gap-1 text-sm font-bold theme-accent-text hover:opacity-80">
        ← My children
      </Link>

      {status === 'loading' && (
        <div className="space-y-4">
          <Skeleton height={96} className="!rounded-2xl" />
          <Skeleton height={140} className="!rounded-2xl" />
        </div>
      )}

      {status === 'error' && (
        <div className="theme-card rounded-2xl border theme-border p-6 text-center">
          <div className="mb-2 text-4xl">🔒</div>
          <h1 className="text-base font-black theme-text">Can&apos;t show this yet</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm theme-text-muted">{errorMsg}</p>
        </div>
      )}

      {status === 'ready' && data && (
        <>
          <div>
            <h1 className="text-xl font-black theme-text">{name}</h1>
            <p className="mt-0.5 text-sm theme-text-muted">
              Last {data.summary?.windowDays ?? 30} days
              {data.learnerGrade ? ` · Grade ${String(data.learnerGrade).replace(/^G/i, '')}` : ''}
              {data.learnerSchool ? ` · ${data.learnerSchool}` : ''}
            </p>
          </div>
          <ChildProgressSections data={data} />
        </>
      )}
    </div>
  )
}
