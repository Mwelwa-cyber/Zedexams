import LegalLayout from './LegalLayout'

/*
 * NOTE TO MAINTAINERS
 * --------------------
 * This is a starter Privacy Policy template tailored to what ZedExams
 * actually does today (Firebase Auth + Firestore, AI providers, WhatsApp
 * support). Before going live, have a Zambian lawyer review it,
 * especially the children's-data section — the Zambia Data Protection
 * Act (2021) imposes specific requirements when processing data of
 * minors. Update the "Last updated" date when content changes.
 */

const CONTACT_WHATSAPP_HREF = 'https://wa.me/260977740465'
const CONTACT_EMAIL = 'support@zedexams.com'
const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`

function H2({ children }) {
  return (
    <h2 className="font-display font-black text-xl sm:text-2xl mt-10 mb-3">{children}</h2>
  )
}

function P({ children }) {
  return <p className="leading-relaxed theme-text-muted">{children}</p>
}

function UL({ children }) {
  return <ul className="list-disc pl-6 space-y-2 theme-text-muted leading-relaxed">{children}</ul>
}

export default function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="29 April 2026">
      <P>
        ZedExams ("we", "us", "our") provides an online learning platform for Zambian
        Grade 4–6 learners, their teachers, and schools. This Privacy Policy explains what
        information we collect, how we use it, who we share it with, and the choices you
        have. It applies to <strong>zedexams.com</strong> and any associated mobile or
        desktop apps.
      </P>

      <H2>1. Who we are</H2>
      <P>
        ZedExams is operated from Zambia. If you have any questions about this policy or
        about your data, you can reach us by email at{' '}
        <a className="underline theme-accent-text" href={CONTACT_EMAIL_HREF}>
          {CONTACT_EMAIL}
        </a>
        , on WhatsApp at{' '}
        <a className="underline theme-accent-text" href={CONTACT_WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
          +260 977 740 465
        </a>
        , or via the contact form on our home page.
      </P>

      <H2>2. Information we collect</H2>
      <P>We collect only what we need to run the service:</P>
      <UL>
        <li>
          <strong>Account information</strong> — your name, email address, role
          (learner / teacher / admin), grade (for learners), and school name (for teachers).
        </li>
        <li>
          <strong>Authentication data</strong> — your password is handled by Firebase
          Authentication; we never see or store it directly.
        </li>
        <li>
          <strong>Usage data</strong> — quiz and exam attempts, scores, lesson views,
          generation history, badges, and similar activity needed to show your progress.
        </li>
        <li>
          <strong>Teacher verification documents</strong> — if you apply to be a verified
          teacher, the proof file you upload (e.g. a teaching certificate) and metadata
          such as filename and size.
        </li>
        <li>
          <strong>Ask Zed conversations</strong> — the messages you send to our AI study
          assistant, so it can answer follow-ups and so we can debug abuse.
        </li>
        <li>
          <strong>Device & technical data</strong> — basic browser / device information,
          IP address (for abuse prevention), and crash logs.
        </li>
      </UL>
      <P>
        We do <strong>not</strong> ask for your physical address, ID number, or financial
        information unless you choose to use a paid feature (in which case payment data is
        handled by the relevant mobile-money or card processor, not stored by us).
      </P>

      <H2>3. How we use your information</H2>
      <UL>
        <li>To create and secure your account, and to keep you signed in.</li>
        <li>To provide the learning content and AI tools you request.</li>
        <li>To show your progress, badges, leaderboards, and history.</li>
        <li>To verify teacher applications and prevent platform abuse.</li>
        <li>To answer your questions when you contact us.</li>
        <li>To improve the platform — fix bugs, monitor performance, and decide what to build next.</li>
      </UL>
      <P>
        We do <strong>not</strong> sell your personal information, and we do <strong>not</strong>{' '}
        use it to send unsolicited advertising.
      </P>

      <H2>4. Children's privacy</H2>
      <P>
        ZedExams is designed for Zambian Grade 4–6 learners (typically aged 9–12). If you
        are a learner under 18, please use ZedExams with the awareness of your parent,
        guardian, or teacher. We rely on schools and parents/guardians to confirm that a
        learner is permitted to create an account.
      </P>
      <P>
        If you are a parent, guardian, or school administrator and you would like to review,
        correct, or delete a learner's data, contact us using the WhatsApp number above and
        we will action your request promptly.
      </P>

      <H2>5. Service providers we share data with</H2>
      <P>
        We use a small set of trusted third-party services to run ZedExams. They process
        your data on our behalf, under contracts that require them to keep it confidential:
      </P>
      <UL>
        <li>
          <strong>Google Firebase</strong> — Authentication, Firestore database, Cloud
          Storage, Cloud Functions, and Hosting. Data is stored in Google data centres.
        </li>
        <li>
          <strong>AI providers</strong> — when you use Ask Zed or teacher AI generators,
          your prompts are sent to the AI model provider (currently Anthropic Claude and/or
          Google Gemini) so they can generate a response. They process the prompts as a
          processor only and do not use them to train their models for other customers.
        </li>
        <li>
          <strong>Payment processors</strong> — if you make a payment, we share only the
          transaction data needed to take that payment (e.g. with MTN MoMo).
        </li>
      </UL>
      <P>
        We may also disclose information if required by Zambian law, by a court order, or
        to protect the safety of our users.
      </P>

      <H2>6. How long we keep your data</H2>
      <UL>
        <li>Account data is kept while your account is active.</li>
        <li>Quiz/exam attempts and progress are kept while your account is active so you can see your history.</li>
        <li>Ask Zed and AI generation logs are kept for a limited period for debugging and abuse prevention.</li>
        <li>If you delete your account, we delete or anonymise your personal data within a reasonable period, unless we are required to keep something for legal or accounting reasons.</li>
      </UL>

      <H2>7. Your rights</H2>
      <P>You can:</P>
      <UL>
        <li>Access and update most of your information from your profile page.</li>
        <li>Request a copy of your data.</li>
        <li>Ask us to correct information that's wrong.</li>
        <li>Ask us to delete your account and personal data.</li>
        <li>Object to certain uses of your data.</li>
      </UL>
      <P>
        To exercise any of these rights, contact us by email at{' '}
        <a className="underline theme-accent-text" href={CONTACT_EMAIL_HREF}>
          {CONTACT_EMAIL}
        </a>
        , on WhatsApp at{' '}
        <a className="underline theme-accent-text" href={CONTACT_WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
          +260 977 740 465
        </a>
        , or via the contact form. We may need to verify your identity before we act on a request.
      </P>

      <H2>8. Security</H2>
      <P>
        We use industry-standard security measures: TLS in transit, Firebase security
        rules to enforce access controls, hashed passwords (handled by Firebase), and
        regular reviews of who can access production data. No system is perfectly secure
        — please choose a strong password and don't share it.
      </P>

      <H2>9. Cookies & local storage</H2>
      <P>
        We use cookies and your browser's local storage for essentials only — keeping you
        signed in, remembering your theme preference, and storing draft work so you don't
        lose it on a refresh. We don't use third-party advertising trackers.
      </P>

      <H2>10. Changes to this policy</H2>
      <P>
        If we make a meaningful change to this policy, we'll update the "Last updated" date
        at the top and, where appropriate, notify you in the app or by email.
      </P>
    </LegalLayout>
  )
}
