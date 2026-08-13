import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { listMyChildren, redeemFamilyInviteCode } from '../services/familyPortal'
import { reportClientError } from '../../../utils/clientErrorReporting'
import Button from '../../../components/ui/Button'
import Skeleton from '../../../components/ui/Skeleton'
import SeoHelmet from '../../../components/seo/SeoHelmet'

/**
 * FamilyHome — /family. Lists the parent's linked children and lets them add
 * another by entering the family code the learner generated. Each child card
 * links to that child's progress page.
 */
export default function FamilyHome() {
  const { currentUser } = useAuth()
  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState('')
  const [justLinked, setJustLinked] = useState('')

  const load = useCallback(async () => {
    if (!currentUser?.uid) return
    try {
      const rows = await listMyChildren(currentUser.uid)
      setChildren(rows)
    } catch (err) {
      reportClientError(err, 'family.listMyChildren')
    } finally {
      setLoading(false)
    }
  }, [currentUser?.uid])

  useEffect(() => { load() }, [load])

  async function handleLink(e) {
    e.preventDefault()
    const trimmed = code.trim()
    if (!trimmed || linking) return
    setLinking(true)
    setError('')
    setJustLinked('')
    try {
      const child = await redeemFamilyInviteCode(trimmed)
      setJustLinked(child.learnerDisplayName || 'your child')
      setCode('')
      await load()
    } catch (err) {
      setError(err?.message || 'Could not link that code. Please check it and try again.')
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="space-y-6">
      <SeoHelmet title="My family" noIndex />

      <div>
        <h1 className="text-xl font-black theme-text">My children</h1>
        <p className="mt-0.5 text-sm theme-text-muted">
          Follow each child&apos;s quiz scores, streaks and subjects.
        </p>
      </div>

      {/* Children list */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2].map((i) => <Skeleton key={i} height={84} className="!rounded-2xl" />)}
        </div>
      ) : children.length === 0 ? (
        <div className="theme-card rounded-2xl border theme-border p-6 text-center">
          <div className="mb-2 text-4xl">👪</div>
          <h2 className="text-base font-black theme-text">No children linked yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm theme-text-muted">
            Ask your child to open <strong>Settings → Family</strong> on their
            ZedExams account and read you their family code, then enter it below.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {children.map((child) => (
            <Link
              key={child.id}
              to={`/family/child/${child.learnerUid}`}
              className="zx-card theme-card group flex items-center gap-3 rounded-2xl border theme-border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl theme-accent-bg text-lg font-black theme-on-accent">
                {(child.learnerDisplayName || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black theme-text">
                  {child.learnerDisplayName || 'Your child'}
                </p>
                <p className="text-xs font-bold theme-text-muted">
                  {child.learnerGrade ? `Grade ${String(child.learnerGrade).replace(/^G/i, '')}` : 'ZedExams learner'}
                </p>
              </div>
              <span className="theme-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}

      {/* Add a child */}
      <section className="theme-card rounded-2xl border theme-border p-4">
        <h2 className="text-sm font-black theme-text">Add a child</h2>
        <p className="mt-0.5 text-xs theme-text-muted">
          Enter the 8-character family code from your child&apos;s account.
        </p>
        <form onSubmit={handleLink} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. AB7K MN2P"
            aria-label="Family code"
            autoCapitalize="characters"
            autoComplete="off"
            className="theme-input min-w-[180px] flex-1 rounded-xl border-2 px-3 py-2.5 text-sm font-mono uppercase tracking-widest outline-none focus:border-[var(--accent)]"
          />
          <Button type="submit" variant="primary" disabled={linking || !code.trim()}>
            {linking ? 'Linking…' : 'Link child'}
          </Button>
        </form>
        {error && (
          <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
            ⚠️ {error}
          </p>
        )}
        {justLinked && (
          <p className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
            ✓ Linked {justLinked} to your family.
          </p>
        )}
      </section>
    </div>
  )
}
