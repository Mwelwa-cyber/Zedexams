import Button from '../../../shared/components/Button'

/**
 * Check this is right — the screen between typing a contact and sending to it.
 *
 * It exists because a mistyped digit is invisible to EVERYONE. The child
 * waits, the guardian never received anything, the account stays limited, and
 * support cannot see why: the send succeeded, the number was simply not the
 * one the child meant. One tap of confirmation removes most of those cases.
 *
 * Two things are on the screen and both are load-bearing:
 *
 *   • The contact, echoed back and GROUPED (+260 977 123 456), because a
 *     wrong digit in a run of twelve is hard to see and easy to see in
 *     threes.
 *
 *   • The real outbound message. Not a summary of it, not a paraphrase — the
 *     server builds this with the same function that builds the send (see
 *     buildConsentPreview), so what the child reads here is what the adult
 *     receives, minus the token that does not exist yet.
 *
 * Presentational. The parent owns the send; this screen owns the check.
 */
export default function GuardianContactConfirm({
  channel,
  contactDisplay,
  preview,
  busy,
  error,
  onSend,
  onChange,
  onNoContact,
}) {
  const isWhatsApp = channel === 'whatsapp'

  return (
    <div className="space-y-3.5">
      <div>
        <h2 className="font-display font-black text-[18px] text-[#1A1F2E]">
          Check this is right
        </h2>
        <p className="text-[13px] text-[#6B6560] mt-1 leading-[1.55]">
          If one number is wrong, your grown-up won&apos;t get the message and your
          account stays locked.
        </p>
      </div>

      <div className="rounded-[12px] bg-[#EAF7F0] border border-[#B9E3CE] px-3.5 py-3">
        <p className="text-[12px] font-bold text-[#12734A]">
          {isWhatsApp ? "We'll message" : "We'll email"}
        </p>
        <p className="text-[15px] font-black text-[#12734A] mt-0.5 break-all">
          {contactDisplay}
        </p>
      </div>

      <div className="rounded-[12px] border border-[#E3D9CC] bg-white px-3.5 py-3">
        <p className="text-[13px] font-black text-[#1A1F2E] mb-2">They&apos;ll get this</p>
        {preview?.subject && (
          <p className="text-[12px] font-bold text-[#1A1F2E] mb-1.5 break-words">
            {preview.subject}
          </p>
        )}
        {/* The real message, scrollable rather than trimmed: a preview that
            hides the part where the grown-up is told they can say no is not
            the message we send. */}
        <pre
          data-testid="guardian-message-preview"
          className="text-[11.5px] text-[#4B5270] leading-[1.6] whitespace-pre-wrap font-body max-h-[210px] overflow-y-auto m-0"
        >
          {preview?.body}
        </pre>
        <p className="text-[11px] text-[#6B6560] mt-2">
          The links are added when you send it.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-red-600 text-[11.5px]">{error}</p>
      )}

      <Button type="button" variant="primary" size="lg" fullWidth disabled={busy} onClick={onSend}>
        {busy ? 'Sending…' : isWhatsApp ? 'Yes, send it' : 'Yes, send it'}
      </Button>

      <button
        type="button"
        onClick={onChange}
        disabled={busy}
        className="w-full rounded-[10px] border border-[#E3D9CC] bg-white text-[#C5613F] font-bold py-2.5 text-[13.5px] disabled:opacity-60"
      >
        ← Change the {isWhatsApp ? 'number' : 'address'}
      </button>

      {/* Never a dead end: a child with no grown-up to name reaches a person,
          not a locked screen. */}
      <p className="text-[11.5px] text-[#6B6560] text-center leading-[1.7]">
        Don&apos;t have a grown-up&apos;s {isWhatsApp ? 'number' : 'address'}?{' '}
        <button
          type="button"
          onClick={onNoContact}
          className="text-[#C5613F] font-bold underline bg-transparent shadow-none p-0"
        >
          Tell us and we&apos;ll help
        </button>
      </p>
    </div>
  )
}
