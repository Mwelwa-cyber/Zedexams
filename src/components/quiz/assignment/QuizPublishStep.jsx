/**
 * Step 4 — review-and-publish panel. Surfaces the quiz status, a
 * one-tap publish/unpublish action gated behind a confirmation
 * dialog, and a "what changes when you publish" rundown.
 */

import { useState } from 'react'
import ConfirmDialog from '../../ui/ConfirmDialog'
import QuizStatusBadge from './QuizStatusBadge'

export default function QuizPublishStep({
  status,
  dirty,
  saving,
  uploading,
  questionCount,
  totalMarks,
  isAdmin,
  onSaveDraft,
  onSubmitForReview,
  onPublish,
  onUnpublish,
  activeAssignmentCount = 0,
}) {
  const [confirm, setConfirm] = useState(null)
  const isPublished = status === 'published' || status === 'active'

  const canPublish = isAdmin && !dirty && !saving && !uploading && questionCount > 0
  const canSubmit = !isAdmin && !dirty && !saving && !uploading && questionCount > 0

  function openConfirm(kind) {
    if (kind === 'publish') {
      setConfirm({
        kind,
        title: 'Publish this quiz?',
        message: (
          <>
            Once published, the quiz appears in the learner library and
            anyone you assigned it to will receive it. You can unpublish
            from this screen at any time.
          </>
        ),
        confirmLabel: 'Publish quiz',
        variant: 'primary',
        action: onPublish,
      })
    } else if (kind === 'unpublish') {
      setConfirm({
        kind,
        title: 'Unpublish this quiz?',
        message: (
          <>
            Learners will no longer see this quiz. Active assignments
            stay on file but learners can&apos;t start attempts until
            it&apos;s republished.
          </>
        ),
        confirmLabel: 'Unpublish',
        variant: 'danger',
        action: onUnpublish,
      })
    } else if (kind === 'submit') {
      setConfirm({
        kind,
        title: 'Submit for review?',
        message: 'An admin will check the quiz and publish it. You can keep editing while it waits.',
        confirmLabel: 'Submit',
        variant: 'primary',
        action: onSubmitForReview,
      })
    }
  }

  async function runConfirm() {
    const action = confirm?.action
    if (!action) return
    await action()
    setConfirm(null)
  }

  return (
    <div className="space-y-4">
      <section className="surface space-y-4 p-4 sm:p-5">
        <header>
          <p className="text-eyebrow">Step 4 of 4</p>
          <h2 className="theme-text text-display-md mt-1 flex items-center gap-2">
            <span aria-hidden="true">🚀</span> Publish quiz
          </h2>
          <p className="theme-text-muted text-body-sm mt-1 max-w-prose">
            Final check before learners see this quiz. Make sure the
            details below match what you expect, then publish or submit
            for review.
          </p>
        </header>

        <div className="grid gap-2 sm:grid-cols-2">
          <Row label="Status" value={<QuizStatusBadge status={status} />} />
          <Row label="Questions" value={questionCount} />
          <Row label="Total marks" value={totalMarks} />
          <Row label="Active assignments" value={activeAssignmentCount} />
        </div>

        {dirty && (
          <p className="rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-900">
            ⚠️ You have unsaved changes. Save them before publishing.
          </p>
        )}
        {questionCount === 0 && (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
            ⚠️ This quiz has no questions yet. Add at least one in Step 1.
          </p>
        )}
      </section>

      <section className="surface space-y-3 p-4 sm:p-5">
        <h3 className="theme-text text-base font-black">Actions</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={saving || uploading}
            className="btn-secondary min-h-[48px] justify-center font-black disabled:opacity-50"
          >
            <span aria-hidden="true">💾</span>
            <span>{saving ? 'Saving…' : 'Save draft'}</span>
          </button>
          {!isAdmin && (
            <button
              type="button"
              onClick={() => openConfirm('submit')}
              disabled={!canSubmit}
              className="btn-primary min-h-[48px] justify-center font-black disabled:opacity-50"
            >
              <span aria-hidden="true">📤</span>
              <span>Submit for review</span>
            </button>
          )}
          {isAdmin && !isPublished && (
            <button
              type="button"
              onClick={() => openConfirm('publish')}
              disabled={!canPublish}
              className="btn-primary min-h-[48px] justify-center font-black disabled:opacity-50"
            >
              <span aria-hidden="true">🚀</span>
              <span>Publish quiz</span>
            </button>
          )}
          {isAdmin && isPublished && (
            <button
              type="button"
              onClick={() => openConfirm('unpublish')}
              disabled={saving || uploading}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-yellow-400 text-yellow-700 font-black hover:bg-yellow-50 disabled:opacity-50"
            >
              <span aria-hidden="true">📦</span>
              <span>Unpublish</span>
            </button>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel || 'Confirm'}
        variant={confirm?.variant || 'primary'}
        loading={saving}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="theme-card theme-border rounded-2xl border p-3 flex items-center justify-between gap-3">
      <span className="text-xs font-black uppercase tracking-widest theme-text-muted">{label}</span>
      <span className="theme-text text-sm font-bold">{value}</span>
    </div>
  )
}
