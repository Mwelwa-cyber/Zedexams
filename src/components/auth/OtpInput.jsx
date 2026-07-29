import { forwardRef } from 'react'

/**
 * OtpInput — a single, accessible 6-digit authenticator-code field shared by
 * the MFA setup page and the login challenge.
 *
 * Requirements it satisfies:
 *   - accepts digits only (non-digits stripped on every input, incl. paste)
 *   - limits to 6 digits
 *   - paste works (the browser fires onChange with the pasted value; we sanitise)
 *   - mobile numeric keyboard (inputMode="numeric") + OS one-time-code autofill
 *     (autoComplete="one-time-code")
 *   - validation feedback via aria-invalid + aria-describedby
 *   - optional onComplete for auto-submit once 6 digits are present (the parent
 *     still guards against duplicate submissions)
 */
const OtpInput = forwardRef(function OtpInput(
  {
    value,
    onChange,
    onComplete,
    disabled = false,
    invalid = false,
    autoFocus = false,
    id = 'mfa-code',
    describedBy,
    label = 'Six-digit verification code',
  },
  ref,
) {
  function handleChange(e) {
    const digits = String(e.target.value || '').replace(/\D/g, '').slice(0, 6)
    onChange(digits)
    if (digits.length === 6 && typeof onComplete === 'function') onComplete(digits)
  }

  return (
    <input
      ref={ref}
      id={id}
      name="mfaCode"
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      onChange={handleChange}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      spellCheck={false}
      autoCapitalize="off"
      placeholder="000000"
      className={
        'w-full h-14 rounded-xl border-[1.5px] bg-white text-[#1A1F2E] ' +
        'text-center text-2xl font-semibold tracking-[0.55em] px-3 outline-none ' +
        'transition-colors placeholder:text-[#C9C7D2] placeholder:tracking-[0.55em] ' +
        'focus:ring-[3px] focus:ring-black/5 disabled:opacity-60 ' +
        (invalid
          ? 'border-[var(--danger-fg,#b91c1c)] focus:border-[var(--danger-fg,#b91c1c)]'
          : 'border-[#2A2A3C] focus:border-[var(--accent,#C5613F)]')
      }
    />
  )
})

export default OtpInput
