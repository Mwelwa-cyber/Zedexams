// Compact trust strip at the foot of the auth card. The "Private" wording is
// deliberate: passkeys DO store a public key + credential metadata server-side,
// but biometric data (fingerprint/face) never leaves the user's device — so the
// claim is "we never store your biometrics", nothing broader.
import { ShieldCheck, LockKeyhole, BadgeCheck } from 'lucide-react'

const ITEMS = [
  { icon: ShieldCheck, color: 'var(--info-fg)', title: 'Secure', text: 'Your data is protected' },
  { icon: LockKeyhole, color: 'var(--danger-fg)', title: 'Private', text: 'We never store your biometrics' },
  { icon: BadgeCheck, color: '#16A34A', title: 'Trusted', text: 'Built for teachers and learners' },
]

export default function SecurityReassurance() {
  return (
    <div className="border-t border-[#F3F4F6] mt-7 pt-5">
      <ul className="grid grid-cols-3 max-[380px]:grid-cols-1 gap-x-2 gap-y-3 list-none p-0 m-0">
        {ITEMS.map(({ icon: IconComponent, color, title, text }) => (
          <li key={title} className="flex flex-col max-[380px]:flex-row items-center max-[380px]:items-start gap-1.5 max-[380px]:gap-2.5 text-center max-[380px]:text-left">
            <IconComponent size={20} color={color} strokeWidth={1.9} aria-hidden="true" className="shrink-0 mt-px" />
            <div>
              <p className="text-[13px] font-semibold text-[color:var(--text)] leading-tight">{title}</p>
              <p className="text-[12px] text-[color:var(--text-muted)] leading-snug mt-0.5">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
