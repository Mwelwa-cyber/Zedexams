import { Link } from 'react-router-dom'
import LegalLayout from '../components/LegalLayout'
import SeoHelmet from '../../../shared/components/SeoHelmet'

const CONTACT_EMAIL = 'support@zedexams.com'
const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`
const CONTACT_WHATSAPP_HREF = 'https://wa.me/260977740465'

function H2({ children, id }) {
  return (
    <h2 id={id} className="font-display font-black text-xl sm:text-2xl mt-10 mb-3 scroll-mt-24">{children}</h2>
  )
}

function P({ children }) {
  return <p className="leading-relaxed theme-text-muted">{children}</p>
}

function UL({ children }) {
  return <ul className="list-disc pl-6 space-y-2 theme-text-muted leading-relaxed">{children}</ul>
}

/**
 * Child safety standards (the CSAE declaration page).
 *
 * Google Play requires apps with social surfaces used by children to publish
 * child-safety standards, provide an in-app reporting path, and name a point
 * of contact — and to link that published page from the Play Console
 * declaration. This is that page.
 *
 * It is written to be true rather than impressive. Every control it claims is
 * one that exists in the codebase: the guardian consent flow, the in-app
 * reporting path in Settings → Help & support, and the analytics minimisation
 * for learner accounts. A standards page that
 * promises moderation nobody performs is worse than none, because it is the
 * document a regulator will read back to you.
 */
export default function ChildSafety() {
  return (
    <>
      <SeoHelmet
        title="Child safety standards"
        description="ZedExams' standards against child sexual abuse and exploitation, how to report a concern, and how we protect learner data."
        path="/child-safety"
      />
      <LegalLayout title="Child safety standards" lastUpdated="29 July 2026">
        <P>
          ZedExams is a learning platform used by Zambian children, most of them
          between about 9 and 13 years old. This page sets out our standards for
          keeping them safe, how to report a concern, and who to contact. It applies
          to zedexams.com and our Android app.
        </P>

        <H2 id="zero-tolerance">1. Zero tolerance for child sexual abuse and exploitation</H2>
        <P>
          We prohibit child sexual abuse and exploitation (CSAE) on ZedExams
          absolutely. This includes any content that sexualises a child, any attempt
          to groom, solicit or arrange contact with a child, and any use of the
          platform to distribute or seek such material.
        </P>
        <P>
          Any account found engaging in this is removed permanently and without
          notice, and we report to the Zambia Police Service and to the relevant
          child-protection authorities. We cooperate fully with lawful requests in
          such investigations.
        </P>

        <H2 id="reporting">2. How to report a concern</H2>
        <UL>
          <li>
            <strong>In the app</strong> — open <strong>Settings → Help &amp;
            support</strong> and tap <strong>Report a problem</strong>. Choose a
            reason and a person reviews it. A child does not need to explain why.
          </li>
          <li>
            <strong>By email</strong> — write to{' '}
            <a className="underline theme-accent-text" href={CONTACT_EMAIL_HREF}>{CONTACT_EMAIL}</a>{' '}
            with "Child safety" in the subject line.
          </li>
          <li>
            <strong>On WhatsApp</strong> —{' '}
            <a className="underline theme-accent-text" href={CONTACT_WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
              +260 977 740 465
            </a>.
          </li>
        </UL>
        <P>
          Reports that indicate a child may be at risk are prioritised and reviewed
          the same day. Anyone may report — a learner, a parent, a teacher, or someone
          who does not use ZedExams at all.
        </P>
        <P>
          If a child is in immediate danger, contact the police, or call{' '}
          <strong>Childline Zambia on 116</strong> (free from any network).
        </P>

        <H2 id="contact">3. Our point of contact</H2>
        <P>
          Child-safety matters are handled by the ZedExams support team, reachable at{' '}
          <a className="underline theme-accent-text" href={CONTACT_EMAIL_HREF}>{CONTACT_EMAIL}</a>.
          This is the designated contact for law enforcement, child-protection
          organisations, and platform partners.
        </P>

        <H2 id="controls">4. What we do to prevent harm</H2>
        <UL>
          <li>
            <strong>A parent or guardian must approve a learner account.</strong> When
            someone under 18 signs up we ask for a parent or guardian's contact and
            send them a link. Until they approve, the account can only read lessons
            and past papers — it cannot appear on a leaderboard or buy anything.
          </li>
          <li>
            <strong>A guardian sees what a child is working on, not what they
            typed.</strong> A linked parent or guardian sees subject progress, a
            streak, a weekly report and the topics their child finds hard. They do
            not see the child's password. If a learner says something suggesting
            they are being hurt, that message is not forwarded to a guardian — it
            is answered with the helpline below and reviewed by a person, because
            the adult a child is disclosing may be the adult who is linked.
          </li>
          <li>
            <strong>The child can see who is linked to them, and say no.</strong>{' '}
            Linking is never silent. A guardian who enters a family code is not
            connected until the learner confirms them by name on their own device,
            and the learner's Guardian screen always lists who is linked, exactly
            what they can see, and a way to report an adult they do not recognise.
            Childline Zambia is one tap away from that screen and needs no
            guardian's permission.
          </li>
          <li>
            <strong>There is no open messaging between users.</strong> ZedExams has no
            direct messaging, no friend requests, no public profiles, and no way for
            one learner to contact another privately.
          </li>
          <li>
            <strong>There is no chatbot a child can talk to.</strong> ZedExams removed
            its learner-facing AI assistant. The AI features that remain are teacher
            tools and automatic marking — neither is a conversation a child can enter,
            and neither takes free-form messages from a learner.
          </li>
          <li>
            <strong>Learner data is minimised.</strong> We never record a learner's
            screen, never estimate their location, never show them advertising, and
            never share their data for marketing. See our{' '}
            <Link className="underline theme-accent-text" to="/privacy">Privacy Policy</Link>,
            section 4.
          </li>
          <li>
            <strong>Shared questions are reviewed before they reach learners.</strong>{' '}
            Every question a teacher creates or imports into our shared question bank
            is checked automatically for quality and age-appropriateness, and is held
            for a human decision if anything is unclear. We remove any content that
            breaks these standards or the law.
          </li>
        </UL>

        <H2 id="parents">5. For parents, guardians and schools</H2>
        <P>
          You can ask us at any time to show you, correct, or delete everything we
          hold about a child in your care — by email, on WhatsApp, or at{' '}
          <Link className="underline theme-accent-text" to="/delete-account">zedexams.com/delete-account</Link>.
          You do not need an account to make that request.
        </P>
        <P>
          If you received an approval request from us that you did not expect, the
          link in it lets you deactivate the account immediately.
        </P>

        <H2 id="review">6. Keeping this current</H2>
        <P>
          We review these standards at least once a year, and whenever we add a
          feature that changes how children use the platform. Meaningful changes
          update the date at the top of this page.
        </P>
      </LegalLayout>
    </>
  )
}
