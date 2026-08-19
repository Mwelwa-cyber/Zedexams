import { lazy, Suspense, useState } from 'react'
import Button from '../../../shared/components/Button'

// Lazy, and mounted only once it is opened. The dialog reaches Firestore
// through the marketing front door, so a static import would put that whole
// edge — and Firebase with it — in the sign-up chunk for a screen most
// learners never see.
const ContactDialog = lazy(() => import('../../marketing').then((m) => ({ default: m.ContactDialog })))

/**
 * "Don't have a grown-up's number?" — the route that must not be a wall.
 *
 * Some children genuinely cannot name a guardian's phone or inbox: they live
 * with a grandparent who has no phone of their own, they are in a boarding
 * house, they share one handset among four siblings. A step whose only exits
 * are "give us a contact" and "give up" turns those children away, and they
 * are the ones the product is most for.
 *
 * So every exit here reaches a person or reaches lessons:
 *
 *   • a real support ticket (the shared ContactDialog → contactMessages,
 *     which Echo triages — the same intake the rest of the app uses, so this
 *     is not a form that writes somewhere nobody reads);
 *   • WhatsApp and email straight to support, because a child who could not
 *     name an adult's inbox may not be able to fill in a form either;
 *   • and "Keep learning for now", which returns them to lessons and past
 *     papers in limited mode with the account they already have.
 *
 * Nothing on this screen can cost the account.
 */

const SUPPORT_EMAIL = 'support@zedexams.com'
const SUPPORT_WHATSAPP_HREF = 'https://wa.me/260977740465'

export default function GuardianNoContactHelp({ onBack, onKeepLearning }) {
  const [contactOpen, setContactOpen] = useState(false)

  return (
    <div className="space-y-3.5">
      <div>
        <h2 className="font-display font-black text-[18px] text-[#1A1F2E]">
          We&apos;ll help you sort this out
        </h2>
        <p className="text-[13px] text-[#6B6560] mt-1 leading-[1.55]">
          Tell us what&apos;s happening and a real person will get back to you. Your
          account stays exactly as it is while we do.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setContactOpen(true)}
        className="w-full text-left rounded-[12px] border border-[#E3D9CC] bg-white px-3.5 py-3"
      >
        <span className="block text-[13.5px] font-black text-[#1A1F2E]">Send us a message</span>
        <span className="block text-[11.5px] text-[#6B6560] mt-0.5">
          We reply by email, usually within a day
        </span>
      </button>

      <a
        href={SUPPORT_WHATSAPP_HREF}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-[12px] border border-[#E3D9CC] bg-white px-3.5 py-3 no-underline"
      >
        <span className="block text-[13.5px] font-black text-[#1A1F2E]">WhatsApp us</span>
        <span className="block text-[11.5px] text-[#6B6560] mt-0.5">+260 977 740 465</span>
      </a>

      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="block rounded-[12px] border border-[#E3D9CC] bg-white px-3.5 py-3 no-underline"
      >
        <span className="block text-[13.5px] font-black text-[#1A1F2E]">Email us</span>
        <span className="block text-[11.5px] text-[#6B6560] mt-0.5">{SUPPORT_EMAIL}</span>
      </a>

      <Button type="button" variant="primary" size="lg" fullWidth onClick={onKeepLearning}>
        Keep learning for now
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="w-full text-[13px] text-[#6B6560] underline bg-transparent shadow-none py-1"
      >
        ← Back
      </button>

      {contactOpen && (
        <Suspense fallback={null}>
          <ContactDialog
            open
            onClose={() => setContactOpen(false)}
            source="learner-guardian-contact"
          />
        </Suspense>
      )}
    </div>
  )
}
