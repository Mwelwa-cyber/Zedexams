// GuardianLinkPanel — the CHILD's view of who is looking after them.
//
// Mounted in learner Settings › Guardian. It is not an admin screen with
// the labels softened; it exists because of a rule the rest of the feature
// is built around: a child who is being monitored should know it.
//
// Four things it must always do, and each is here because the alternative
// is a child who cannot tell what is happening to their own account:
//
//   1. NAME the adults who are linked. "A parent account" — which is what
//      this panel used to say — is not an answer to "who can see this?".
//      It is also the real defence against a family code reaching the
//      wrong adult: the child sees exactly who ended up linked.
//   2. Say what they can see AND what they cannot, in the child's own
//      words. The copy is GUARDIAN_VISIBILITY from the shared package, so
//      this screen, /child-safety and the guardian's confirmation email
//      make one promise rather than three.
//   3. Let the child ANSWER a pending link before it grants anything.
//   4. Never silently do nothing. "This isn't my grown-up" removes an
//      unconfirmed link outright and flags a confirmed one for review;
//      "ask to remove" files a request and says plainly that nobody has
//      been removed yet. Childline Zambia 116 is one tap away throughout,
//      and it is the route that needs no guardian's permission — which is
//      what pays for the child not being able to unlink alone.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  GUARDIAN_CONTROL_COPY,
  GUARDIAN_VISIBILITY,
  LINK_CONSENT,
  describeConsentState,
  describeLinkMethod,
  normalizeLink,
  readLinkPermissions,
  readLinkState,
} from '../../../utils/guardianLink'
import {
  listMyLinkedParents,
  reportGuardianLink,
  requestGuardianUnlink,
} from '../services/familyPortal'
import { reportClientError } from '../../../utils/clientErrorReporting'

const CHILDLINE = '116'

/** The adult's name, or an honest placeholder — never a fabricated one. */
function guardianName(link) {
  const name = String(link?.parentDisplayName || '').trim()
  if (name) return name
  const email = String(link?.parentEmail || '').trim()
  if (email) return email
  // A link whose owner we genuinely cannot name. Saying so is better than
  // "A parent account", which reads as a category rather than a person and
  // gives the child nothing to recognise or reject.
  return 'Someone we could not name'
}

/** The permissions THIS guardian has set, as sentences a child can read. */
function statedControls(link) {
  const perms = readLinkPermissions(link)
  return Object.entries(perms)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => ({
      key,
      label: GUARDIAN_CONTROL_COPY[key] || key,
      value: key === 'dailyMinutes' ? `${value} minutes a day` : (value ? 'On' : 'Off'),
      restrictive: value === false || key === 'dailyMinutes',
    }))
}

export default function GuardianLinkPanel() {
  const { currentUser } = useAuth()
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!currentUser?.uid) return
    try {
      setLinks(await listMyLinkedParents(currentUser.uid))
    } catch (err) {
      reportClientError(err, 'guardianLinkPanel.load')
    } finally {
      setLoading(false)
    }
  }, [currentUser?.uid])

  useEffect(() => { load() }, [load])

  // Every link except the ones still waiting on this child's answer —
  // those are FamilyCodePanel's to ask about, and showing them here too
  // would put the same question on the screen twice.
  const active = useMemo(
    () => links
      .map((raw) => ({ raw, link: normalizeLink(raw), state: readLinkState(raw) }))
      .filter((r) => r.state !== LINK_CONSENT.PENDING),
    [links],
  )

  async function run(key, fn, fallback) {
    if (busy) return
    setBusy(key)
    setError('')
    setNotice('')
    try {
      const result = await fn()
      if (result?.message) setNotice(result.message)
      await load()
    } catch (err) {
      setError(err?.message || fallback)
    } finally {
      setBusy('')
    }
  }

  const childlineRow = (
    <a
      href={`tel:${CHILDLINE}`}
      className="mt-3 flex items-center gap-2 rounded-xl border theme-border px-3 py-2 text-xs font-bold theme-text"
    >
      <span aria-hidden="true">☎️</span>
      <span>
        Need to talk to someone? Childline Zambia · {CHILDLINE} — free, and
        your grown-up is not told.
      </span>
    </a>
  )

  return (
    <section className="theme-card rounded-2xl border theme-border p-4">
      <h2 className="text-sm font-black theme-text">Your grown-ups</h2>
      <p className="mt-0.5 text-xs theme-text-muted">
        These are the people linked to your account. You can see exactly what
        they can see.
      </p>

      {loading ? (
        <p className="mt-3 text-xs theme-text-muted">Loading…</p>
      ) : (
        <>
          {/* The pending "X wants to be your guardian" ask, and its
              accept/decline buttons, deliberately do NOT live here — they
              are in FamilyCodePanel, which owns the family-code flow and
              the `status` flag it writes. Both panels sit on this same
              settings screen, so rendering the ask twice would have the
              child answering the same question in two places. What is
              here is the half that flow has no opinion about: who ended
              up linked, exactly what they can see, and how to get help. */}

          {/* ── Who is linked ───────────────────────────────────────── */}
          {active.length === 0 ? (
            <p className="mt-3 rounded-xl theme-bg-subtle px-3 py-3 text-xs theme-text-muted">
              Nobody is linked to your account yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {active.map(({ raw, link, state }) => {
                const controls = statedControls(raw)
                const withdrawn = state === LINK_CONSENT.WITHDRAWN
                return (
                  <li key={raw.id} className="rounded-xl theme-bg-subtle px-3 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-black theme-text">{guardianName(raw)}</span>
                      <span className="text-[11px] font-bold uppercase tracking-wider theme-text-muted">
                        {withdrawn ? describeConsentState(state) : describeLinkMethod(link.method)}
                      </span>
                    </div>

                    {withdrawn ? (
                      <p className="mt-1 text-xs theme-text-muted">
                        They ended this link, so they can no longer see anything
                        about you. Your lessons and past papers still work.
                      </p>
                    ) : (
                      <>
                        {controls.length > 0 && (
                          <ul className="mt-2 space-y-0.5">
                            {controls.map((c) => (
                              <li key={c.key} className="text-xs theme-text-muted">
                                {c.label}: <strong className="theme-text">{c.value}</strong>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-2 flex flex-wrap gap-3">
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => run(
                              `report:${raw.id}`,
                              () => reportGuardianLink(link.parentUid),
                              'Could not send that. Please try again.',
                            )}
                            className="text-xs font-black text-rose-700 underline decoration-dotted disabled:opacity-50"
                          >
                            This isn&apos;t my grown-up
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => run(
                              `unlink:${raw.id}`,
                              () => requestGuardianUnlink(link.parentUid),
                              'Could not send that. Please try again.',
                            )}
                            className="text-xs font-bold theme-text-muted underline decoration-dotted disabled:opacity-50"
                          >
                            Ask to remove them
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {/* ── What they can and cannot see ────────────────────────── */}
          <div className="mt-4 rounded-xl border theme-border p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider theme-text-muted">
              What your grown-ups can see
            </p>
            <ul className="mt-1 space-y-0.5">
              {GUARDIAN_VISIBILITY.can.map((line) => (
                <li key={line} className="text-xs theme-text">✅ {line}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-wider theme-text-muted">
              What they cannot see
            </p>
            <ul className="mt-1 space-y-0.5">
              {GUARDIAN_VISIBILITY.cannot.map((line) => (
                <li key={line} className="text-xs theme-text">🚫 {line}</li>
              ))}
            </ul>
          </div>

          {childlineRow}

          {notice && (
            <p className="mt-2 rounded-lg border theme-border theme-bg-subtle px-3 py-2 text-xs font-bold theme-text">
              {notice}
            </p>
          )}
          {error && (
            <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
              ⚠️ {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}
