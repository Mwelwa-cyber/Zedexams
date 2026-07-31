import { useState } from 'react'
import Button from '../../../ui/Button'
import ConfirmDialog from '../../../ui/ConfirmDialog'
import EmptyState from '../../../ui/EmptyState'
import ErrorState from '../../../ui/ErrorState'
import ResponsiveModal from '../../../ui/ResponsiveModal'
import Skeleton, { SkeletonCard, SkeletonText } from '../../../ui/Skeleton'
import StatusBadge from '../../../ui/StatusBadge'
import { useToast } from '../../../ui/Toast'
import Icon from '../../../ui/Icon'
import { BookOpen } from '../../../ui/icons'
import { Block, Section, Specimen, SpecimenGrid } from '../auditKit.jsx'

/**
 * Section 6 — feedback.
 *
 * THE MODAL AND THE TOAST ARE THE POINT OF THIS SECTION.
 * Both buttons below open the REAL components, and the real Toast renders
 * through `createPortal(…, document.body)` — outside every scope on this page.
 * A portal is the classic way a themed surface loses its theme: the component
 * is written correctly in tokens, but it resolves them against <body>, which
 * carries the LEARNER reading palette rather than the workspace one. Nothing
 * about the component looks wrong, and nothing about the page looks wrong; the
 * toast is simply the wrong colour.
 *
 * So: open the toast in each of the four themes and check whether it followed
 * you. If Terracotta / Miombo / Copperbelt all produce the same toast, the
 * portal escaped the scope — which is a finding about the app, not about this
 * page. (Night is the one that will look right regardless, because index.css
 * carries a body-level bridge for it.)
 *
 * ConfirmDialog and ResponsiveModal render in place rather than through a
 * portal, so they stay inside the scope. Worth confirming rather than
 * assuming — that difference between three dialogs is exactly the kind of
 * thing that is true until someone "tidies" one of them into a portal.
 */

const ALERTS = [
  ['info', 'bg-info-subtle', 'text-info', 'Papers published before this term have no quiz attached yet.'],
  ['success', 'bg-success-subtle', 'text-success', 'All twenty questions are complete and the marks reconcile.'],
  ['warning', 'bg-warning-subtle', 'text-warning', 'Two figures could not be drawn — the paper will export without them.'],
  ['error', 'bg-danger-subtle', 'text-danger', 'Question 3 is not finished. Fix it before exporting.'],
]

export default function FeedbackSection() {
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <Section
      id="feedback"
      title="6 · Feedback"
      note={
        'Alerts, badges, progress, skeletons, empty and error states, and the three dialog surfaces. The toast buttons fire the real Toast, which portals to document.body — outside this page\'s theme scope. Fire one in each theme: if three of the four produce an identical toast, the portal escaped the scope.'
      }
    >
      <Block
        title="Alerts / banners"
        note="Built from the semantic utilities (bg-*-subtle / text-*). There is no Alert primitive — see Gaps found."
      >
        <div className="space-y-2">
          {ALERTS.map(([tone, bg, fg, message]) => (
            <div
              key={tone}
              role={tone === 'error' ? 'alert' : 'status'}
              className={`rounded-xl border theme-border p-3 ${bg}`}
            >
              <p className={`text-body-sm font-bold ${fg}`}>
                {tone[0].toUpperCase() + tone.slice(1)}
              </p>
              <p className="theme-text text-body-sm">{message}</p>
            </div>
          ))}
        </div>
      </Block>

      <Block
        title="Toasts (real component, portaled)"
        note="Fires through useToast(). Watch the colour, not the copy."
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => toast.info('Paper plan ready to confirm.')}>
            info
          </Button>
          <Button size="sm" variant="secondary" onClick={() => toast.success('Paper saved to your library.')}>
            success
          </Button>
          <Button size="sm" variant="secondary" onClick={() => toast.error('Could not reach the server. Try again.')}>
            error
          </Button>
        </div>
      </Block>

      <Block
        title="Badges and chips"
        note="StatusBadge is the shared primitive, and it paints with fixed Tailwind greys/greens rather than tokens — compare it against the token-driven chips beside it in Night."
      >
        <div className="flex flex-wrap items-center gap-2">
          {['draft', 'pending', 'published', 'rejected', 'unknown'].map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="badge theme-accent-bg theme-accent-text">Accent</span>
          <span className="badge bg-success-subtle text-success">Success</span>
          <span className="badge bg-warning-subtle text-warning">Warning</span>
          <span className="badge bg-danger-subtle text-danger">Danger</span>
          <span className="badge bg-info-subtle text-info">Info</span>
          <span className="badge theme-bg-subtle theme-text-muted">Neutral</span>
        </div>
        <div className="tdv2 mt-3 flex flex-wrap items-center gap-2">
          <span className="tdv2-badge-ready">Ready</span>
          <span className="tdv2-badge-draft">Draft</span>
          <span className="tdv2-chip">Term 2</span>
        </div>
      </Block>

      <Block title="Progress and spinner">
        <div className="max-w-sm space-y-3">
          <div>
            <div
              className="h-2 w-full overflow-hidden rounded-full theme-bg-subtle"
              role="progressbar"
              aria-valuenow={62}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Checklist completion"
            >
              <div className="h-full theme-accent-fill" style={{ width: '62%' }} />
            </div>
            <p className="theme-text-muted mt-1 text-body-sm">62% complete</p>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" loading>
              Generating
            </Button>
            <span className="theme-text-muted text-body-sm">
              Button&rsquo;s own spinner — the app has no standalone one.
            </span>
          </div>
        </div>
      </Block>

      <Block title="Skeletons">
        <div className="grid gap-3 sm:grid-cols-2">
          <Specimen label="<SkeletonText lines={4} />">
            <div className="w-full">
              <SkeletonText lines={4} />
            </div>
          </Specimen>
          <Specimen label="<SkeletonCard />">
            <div className="w-full">
              <SkeletonCard />
            </div>
          </Specimen>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Skeleton width={160} height={16} />
          <Skeleton shape="circle" size={40} />
        </div>
      </Block>

      <Block title="Empty state (real primitive)">
        <SpecimenGrid min="18rem">
          {['default', 'error', 'success'].map((variant) => (
            <Specimen key={variant} label={`variant="${variant}"`}>
              <div className="w-full rounded-xl border theme-border theme-card">
                <EmptyState
                  icon={(props) => <Icon as={BookOpen} {...props} />}
                  variant={variant}
                  title="No papers yet"
                  description="Papers you generate will appear here, with the newest first."
                  action={<Button size="sm">Create a paper</Button>}
                />
              </div>
            </Specimen>
          ))}
        </SpecimenGrid>
      </Block>

      <Block
        title="Error state (real primitive)"
        note="Rendered from a real Error through friendlyErrors, so the copy and the actions are the ones a user would get."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Specimen label="inline={false}">
            <div className="w-full rounded-xl border theme-border theme-card p-1">
              <ErrorState error={new Error('Failed to fetch')} />
            </div>
          </Specimen>
          <Specimen label="inline">
            <div className="w-full">
              <ErrorState error={new Error('permission-denied')} inline />
            </div>
          </Specimen>
        </div>
      </Block>

      <Block
        title="Dialogs (real components)"
        note="ConfirmDialog and ResponsiveModal render in place, so they stay inside this page's theme scope; the toast above does not. Open each in Night."
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
            Open ConfirmDialog
          </Button>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            Open ResponsiveModal
          </Button>
        </div>

        <ConfirmDialog
          open={confirmOpen}
          title="Delete this paper?"
          message="Grade 7 Mathematics — Mid-term test will be removed from your library. This cannot be undone."
          confirmLabel="Delete paper"
          onConfirm={() => setConfirmOpen(false)}
          onCancel={() => setConfirmOpen(false)}
        />

        {modalOpen ? (
          <ResponsiveModal
            onClose={() => setModalOpen(false)}
            labelledBy="ui-audit-modal-title"
            footer={
              <Button fullWidth onClick={() => setModalOpen(false)}>
                Close
              </Button>
            }
          >
            <h3 id="ui-audit-modal-title" className="text-display-md theme-text">
              Confirm your paper plan
            </h3>
            <p className="theme-text-muted mt-2 text-body-sm">
              Twenty questions across fractions, decimals and place value. Marks
              reconcile with the header by construction, so the total below is
              the total on the page.
            </p>
            <ul className="theme-text mt-3 space-y-1 text-body-sm">
              <li>Section A — 10 multiple choice · 10 marks</li>
              <li>Section B — 6 structured · 24 marks</li>
              <li>Section C — 4 extended · 16 marks</li>
            </ul>
          </ResponsiveModal>
        ) : null}
      </Block>
    </Section>
  )
}
