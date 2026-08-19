import Button from '../../../shared/components/Button'

/**
 * Pass the phone to your grown-up — the same-device route.
 *
 * Many Zambian learners share one phone with the adult who owns it, and that
 * adult is often in the room. Handing the phone over converts far better than
 * a message that may never be opened, so this is offered on the contact
 * screen itself rather than buried as a fallback.
 *
 * ── It is a shortcut past the MESSAGE, not past the CONSENT ──────────────
 *
 * "I'm the grown-up — continue" mints a consent token and opens the same
 * server-rendered page the emailed link opens. The adult reads the same
 * disclosure, ticks the same "I am this child's parent or guardian" box, and
 * the same transaction writes the same record with the same evidence. The one
 * field that differs is `via`, and it differs on purpose: a record that could
 * not tell a decision made on the child's phone from one made in a parent's
 * own inbox would be less useful to us and to a regulator, not more
 * trustworthy.
 *
 * The child is shown what the adult is about to be told, so handing over the
 * phone is not handing over a surprise.
 */
export default function GuardianHandoffStep({
  childName,
  busy,
  error,
  onContinue,
  onSendInstead,
}) {
  const name = childName || 'Your learner'

  return (
    <div className="space-y-3.5">
      <div>
        <h2 className="font-display font-black text-[18px] text-[#1A1F2E]">
          Pass the phone to your grown-up
        </h2>
        <p className="text-[13px] text-[#6B6560] mt-1 leading-[1.55]">
          They&apos;ll read what ZedExams does and say yes or no. Then it comes back
          to you.
        </p>
      </div>

      <div className="rounded-[12px] border border-[rgba(198,123,79,0.3)] bg-[#FFF5EC] px-3.5 py-3">
        <p className="text-[13px] font-black text-[#96552F] mb-1.5">
          <span aria-hidden="true">👋</span> Hello — this is for the grown-up
        </p>
        <p className="text-[12.5px] text-[#7A4A2A] leading-[1.65]">
          <strong>{name}</strong> would like to use ZedExams for their schoolwork.
          On the next screen you&apos;ll see exactly what they can do, what we keep
          about them, and how to say no. Nothing starts until you agree.
        </p>
      </div>

      {error && <p role="alert" className="text-red-600 text-[11.5px]">{error}</p>}

      <Button type="button" variant="primary" size="lg" fullWidth disabled={busy} onClick={onContinue}>
        {busy ? 'Opening…' : "I'm the grown-up — continue"}
      </Button>

      <button
        type="button"
        onClick={onSendInstead}
        disabled={busy}
        className="w-full rounded-[10px] border border-[#E3D9CC] bg-white text-[#C5613F] font-bold py-2.5 text-[13.5px] disabled:opacity-60"
      >
        They&apos;re not here — send a message instead
      </button>

      <p className="text-[11.5px] text-[#6B6560] text-center leading-[1.6]">
        Not sure? You can always do this later from Settings.
      </p>
    </div>
  )
}
