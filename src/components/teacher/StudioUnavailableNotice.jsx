/**
 * The quiet notice a teacher gets after opening a studio that is no longer
 * offered — from a saved bookmark, a link in a WhatsApp group, or the
 * browser's own autocomplete. The route redirects to the studios list and the
 * reason travels with it in `?unavailable=<tool>`; this renders it there.
 *
 * A notice rather than a page of its own, because the teacher asked for a tool
 * and the useful answer is the tool list with one line of explanation — not an
 * interstitial they have to click through to reach it.
 *
 * The parameter is consumed on dismiss, so it never reappears on a
 * back-button return to the dashboard.
 */
import { useSearchParams } from 'react-router-dom'
import { RETIRED_NOTICE_PARAM, noticeForTool } from '../../config/studioAvailability'

export default function StudioUnavailableNotice() {
  const [params, setParams] = useSearchParams()
  const tool = params.get(RETIRED_NOTICE_PARAM)
  const notice = noticeForTool(tool)
  if (!notice) return null

  const dismiss = () => {
    const next = new URLSearchParams(params)
    next.delete(RETIRED_NOTICE_PARAM)
    setParams(next, { replace: true })
  }

  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-4xl items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3"
    >
      <p className="min-w-0 flex-1 text-sm text-slate-700">{notice}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notice"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
      >
        ✕
      </button>
    </div>
  )
}
