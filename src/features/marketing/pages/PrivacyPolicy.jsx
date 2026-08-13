import { Link } from 'react-router-dom'
import LegalLayout from '../components/LegalLayout'
import SeoHelmet from '../../../components/seo/SeoHelmet'

const CONTACT_WHATSAPP_HREF = 'https://wa.me/260977740465'
const CONTACT_EMAIL = 'support@zedexams.com'
const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`

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

export default function PrivacyPolicy() {
  return (
    <>
      <SeoHelmet
        title="Privacy Policy"
        description="How ZedExams collects, uses and protects learner, teacher and school data, including children's-data handling under the Zambia Data Protection Act."
        path="/privacy"
      />
      <LegalLayout title="Privacy Policy" lastUpdated="29 July 2026">
      <P>
        ZedExams ("we", "us", "our") provides an online learning platform for Zambian
        Grade 4–7 learners, their teachers, and schools. This Privacy Policy explains what
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
          teacher, we collect your school name and the proof file you upload (for example a
          teaching certificate or a Teaching Council of Zambia registration document),
          together with file metadata such as filename and size.{' '}
          <strong>We do not ask for or collect your NRC or any other government ID number.</strong>
        </li>
        <li>
          <strong>Guardian contact and consent records</strong> — for learners under 18,
          a parent or guardian's email address or WhatsApp number so they can approve the
          account, plus a record of that approval (when the link was used, and the device
          it was used from). We use this contact <strong>only</strong> to ask for and
          record that approval, plus account safety and the parental rights described in
          section 4 — never for marketing, and we send the guardian nothing else.
        </li>
        <li>
          <strong>Date of birth — learner accounts only.</strong> Asked once at sign-up,
          so we can set up an age-appropriate experience and know whether an account needs
          a guardian&apos;s approval. We store the date, not a photograph or a document.
          {' '}
          <strong>Teacher and parent accounts are not asked for a date of birth at all</strong>
          {' '}— they simply confirm that they are 18 or older, and we record that
          confirmation as a yes/no answer rather than as a date.
        </li>
        <li>
          <strong>Ask Zed conversations</strong> — the messages you send to our AI study
          assistant, so it can answer follow-ups and so we can debug abuse. Contact details
          (phone numbers, email addresses, links) are removed before a learner&apos;s message
          is written to our logs.
        </li>
        <li>
          <strong>Device & technical data</strong> — basic browser / device information,
          IP address (for abuse prevention), and crash and error reports describing what
          went wrong so we can fix bugs.
        </li>
        <li>
          <strong>Product analytics — optional, and off until you opt in.</strong> If you
          turn analytics on (at{' '}
          <Link className="underline theme-accent-text" to="/preferences">zedexams.com/preferences</Link>),
          we use <strong>PostHog</strong> to collect usage events — which pages and
          features are used — along with device and browser information and an{' '}
          <strong>approximate, city-level location estimated from your IP address</strong>.
          Analytics profiles are identified by a random account identifier and your role,
          never by your name or email. For teacher and admin accounts, PostHog may also
          record a <strong>replay of how you interact with our screens</strong> so we can
          find and fix usability problems; anything typed into a form is masked out of
          those recordings, and they are deleted after 30 days. Learner accounts are
          treated differently — see section 4.
        </li>
      </UL>
      <P>
        We do <strong>not</strong> ask for your physical address, NRC or other government ID
        number, or financial information. If you use a paid feature, payment is handled by
        the payment provider (see section 5) and we only receive confirmation of the
        transaction — never your full payment details.
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
        ZedExams is designed for Zambian Grade 4–7 learners (typically aged 9–12). If you
        are a learner under 18, please use ZedExams with the awareness of your parent,
        guardian, or teacher. We rely on schools and parents/guardians to confirm that a
        learner is permitted to create an account.
      </P>
      <P>
        When someone under 18 signs up, we ask for a parent or guardian&apos;s contact
        details and send them a link to approve the account. Until they approve it, the
        account runs in a limited mode: the learner can read lessons and past papers, but
        cannot use the Ask Zed assistant, join a class, appear on a leaderboard, or buy
        anything. The guardian&apos;s link also lets them refuse and have the account
        removed.
      </P>
      <P>
        We collect only what the service needs, and we hold learner data to a stricter
        standard than the rest of the platform:
      </P>
      <UL>
        <li>
          Learner accounts are <strong>excluded from session replay</strong>. We never
          record a learner's screen — not for product analytics, and not as part of an
          error report.
        </li>
        <li>
          Learner accounts are <strong>never identified to our analytics provider</strong>{' '}
          and their location is not estimated from their IP address. What remains is
          anonymous usage counts that cannot be traced back to an individual learner.
        </li>
        <li>
          We never show advertising to learners, and we never share learner data for
          marketing.
        </li>
        <li>
          The same protections apply to parent and guardian accounts, because the parent
          portal shows a learner's progress.
        </li>
        <li>
          Our AI assistant is restricted to schoolwork for learners: it never asks for
          personal information, never claims to be a person or to keep secrets, and
          declines romantic, sexual or self-harm topics. If a learner writes something
          suggesting they are being hurt or want to hurt themselves, it stops and points
          them to a trusted adult and to Childline Zambia (116).
        </li>
        <li>
          Every AI response carries a <strong>Report</strong> control, and reports about a
          child&apos;s safety are reviewed the same day. See our{' '}
          <Link className="underline theme-accent-text" to="/child-safety">child safety standards</Link>.
        </li>
      </UL>
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
          <strong>PostHog, Inc.</strong> — optional product analytics, session replay, and
          error tracking, and only if you opt in. Data is processed on PostHog's servers.
        </li>
        <li>
          <strong>Sentry</strong> — crash and error reporting (technical details of the
          error, plus device information) so we can diagnose faults. For teacher and admin
          accounts only, an error report may include a masked replay of the moments before
          the fault; learner and parent sessions are reported without any recording.
        </li>
        <li>
          <strong>Payment providers</strong> — when you pay for a subscription or top-up we
          share the details needed to complete the transaction with the provider you choose:
          MTN MoMo, Airtel Money, Zamtel Money, Lenco (mobile money and cards), or Google
          Play Billing for purchases made through the Android app. They handle your payment
          credentials; we never see or store them.
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
        <li>If you opted in to analytics, events are retained by PostHog according to our project settings, and any session replay is automatically deleted after 30 days.</li>
        <li>If you delete your account, we delete or anonymise your personal data within a reasonable period, unless we are required to keep something for legal or accounting reasons.</li>
      </UL>

      <H2 id="delete-account">7. Deleting your account and data</H2>
      <P>
        You can permanently delete your ZedExams account and personal data at any time.
        There are three ways to do this:
      </P>
      <UL>
        <li>
          <strong>In the app or on the web</strong> — sign in, go to{' '}
          <strong>Settings → Account → Delete account</strong>, type <strong>DELETE</strong> to
          confirm, and choose <strong>Permanently delete</strong>. Your account and data are
          removed immediately and you are signed out.
        </li>
        <li>
          <strong>On the web, without signing in</strong> — visit{' '}
          <Link className="underline theme-accent-text" to="/delete-account">zedexams.com/delete-account</Link>{' '}
          and submit a deletion request. We verify your identity and action the request
          within 7 days.
        </li>
        <li>
          <strong>By message</strong> — email us at{' '}
          <a className="underline theme-accent-text" href={CONTACT_EMAIL_HREF}>{CONTACT_EMAIL}</a>{' '}
          or message us on WhatsApp and we will delete your account for you after verifying
          your identity.
        </li>
      </UL>
      <P>
        Deleting your account removes your profile (name, email, phone), quiz and exam results
        and history, saved and generated content, class memberships, notifications, referral
        records, and subscription records. If you opted in to analytics, we also delete your
        PostHog profile and its associated events. We may retain a limited amount of data
        where the law or our accounting obligations require it (for example, payment/invoice
        records kept for the statutory period); any such data is no longer linked to your
        profile. This action cannot be undone.
      </P>

      <H2>8. Your rights</H2>
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

      <H2>9. Security</H2>
      <P>
        We use industry-standard security measures: TLS in transit, Firebase security
        rules to enforce access controls, hashed passwords (handled by Firebase), and
        regular reviews of who can access production data. No system is perfectly secure
        — please choose a strong password and don't share it.
      </P>

      <H2>10. Cookies & local storage</H2>
      <P>
        We use cookies and your browser's local storage for essentials — keeping you
        signed in, remembering your theme preference, and storing draft work so you don't
        lose it on a refresh. We don't use third-party advertising trackers.
      </P>
      <P>
        Separately, we ask for your consent to use a product-analytics tool (PostHog) that
        helps us see which lessons and features help most — see section 2 for exactly what
        it collects. It is <strong>off until you opt in</strong>, we never use it for
        advertising, and you can turn it on or off at any time — without signing in — on our{' '}
        <Link className="underline theme-accent-text" to="/preferences">privacy preferences</Link>{' '}
        page. We use no third-party advertising trackers.
      </P>

      <H2>11. Changes to this policy</H2>
      <P>
        If we make a meaningful change to this policy, we'll update the "Last updated" date
        at the top and, where appropriate, notify you in the app or by email.
      </P>
    </LegalLayout>
    </>
  )
}
