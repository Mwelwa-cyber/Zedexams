import LegalLayout from './LegalLayout'

/*
 * NOTE TO MAINTAINERS
 * --------------------
 * Starter Terms & Conditions template for ZedExams. Have a Zambian
 * lawyer review before relying on these in a dispute. Particular care:
 * the AI-output disclaimer, the children/guardian language, the
 * limitation of liability, and the governing-law clause should reflect
 * how you actually want to be bound. Update "Last updated" when the
 * substance changes.
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

export default function Terms() {
  return (
    <LegalLayout title="Terms & Conditions" lastUpdated="29 April 2026">
      <P>
        Welcome to ZedExams. These Terms & Conditions ("Terms") govern your use of
        zedexams.com and any associated mobile or desktop apps (the "Service"). By creating
        an account or using the Service, you agree to these Terms.
      </P>

      <H2>1. Who can use ZedExams</H2>
      <UL>
        <li>You may use ZedExams if you are at least 18 years old, or if a parent, guardian, school, or teacher permits you to use it.</li>
        <li>If you are using ZedExams on behalf of a learner under 18, you confirm that you have the authority to do so.</li>
        <li>Schools and teachers may set their own additional rules for how learners use the Service.</li>
      </UL>

      <H2>2. Your account</H2>
      <UL>
        <li>You're responsible for the accuracy of the information you provide when you sign up.</li>
        <li>You're responsible for keeping your password safe and for activity on your account.</li>
        <li>One person, one account. Don't share accounts.</li>
        <li>If you suspect your account has been used without permission, contact us immediately.</li>
      </UL>

      <H2>3. Acceptable use</H2>
      <P>When you use ZedExams, you agree <strong>not</strong> to:</P>
      <UL>
        <li>Upload, post, or share content that is illegal, harassing, hateful, or that infringes someone else's rights.</li>
        <li>Attempt to break, probe, or bypass our security or rate limits.</li>
        <li>Scrape, copy, or redistribute large amounts of our content without permission.</li>
        <li>Use the Service to generate content that misleads learners (e.g. answers presented as official exam keys when they are not).</li>
        <li>Pretend to be someone you're not, or impersonate a school, teacher, or staff member.</li>
        <li>Use bots or automated tools to interact with the Service in ways that aren't allowed.</li>
      </UL>
      <P>
        We can suspend or close accounts that break these rules, with or without notice
        depending on how serious the breach is.
      </P>

      <H2>4. Teacher verification & content</H2>
      <UL>
        <li>To publish content visible to learners, teachers must complete the verification flow (school name, NRC, proof of teaching status).</li>
        <li>You're responsible for the accuracy of any lesson plans, worksheets, quizzes, or other content you publish through ZedExams.</li>
        <li>You retain ownership of original content you create, and grant ZedExams a non-exclusive licence to host and serve it as part of the Service.</li>
        <li>We may remove content that breaks these Terms or any law.</li>
      </UL>

      <H2>5. AI-generated content</H2>
      <P>
        ZedExams uses third-party AI models (e.g. Anthropic Claude, Google Gemini) to power
        Ask Zed and teacher generators. AI output can be inaccurate, biased, or out of date.
        Always review AI-generated lesson plans, worksheets, and answers before using them
        in a classroom or relying on them for important decisions. ZedExams is not
        responsible for harm caused by uncritical use of AI output.
      </P>

      <H2>6. Pricing & payment</H2>
      <UL>
        <li>Some features are free; some require an upgrade. We'll show the price clearly before you pay.</li>
        <li>Payments are processed by third parties (e.g. MTN MoMo). Their terms apply to the payment itself.</li>
        <li>We may change prices in future, but we'll give you reasonable notice before any change affects an active subscription.</li>
        <li>Unless required by law, we don't refund partially-used subscription periods. Get in touch if you think your situation is exceptional and we'll see what we can do.</li>
      </UL>

      <H2>7. Intellectual property</H2>
      <P>
        The ZedExams brand, the platform code, the curriculum knowledge base we maintain,
        and the design of the site are owned by us. Our official curriculum content
        ("CBC-aligned" lessons and exams) is provided for your personal or classroom use;
        you may not redistribute it commercially without our written permission.
      </P>

      <H2>8. Service availability</H2>
      <P>
        We work hard to keep ZedExams running, but we don't guarantee uninterrupted access.
        We may pause the Service for maintenance, updates, or to fix problems. If a major
        outage affects you, contact us via WhatsApp.
      </P>

      <H2>9. Termination</H2>
      <UL>
        <li>You can stop using ZedExams at any time, and can request account deletion via WhatsApp or the contact form.</li>
        <li>We can suspend or close your account if you break these Terms, if we're required to by law, or if your account has been inactive for a long period.</li>
        <li>On termination, the parts of these Terms that should naturally survive (IP, disclaimers, liability, governing law) continue to apply.</li>
      </UL>

      <H2>10. Disclaimers</H2>
      <P>
        ZedExams is provided "as is" and "as available". To the fullest extent permitted
        by law, we disclaim all warranties — express or implied — including warranties of
        merchantability, fitness for a particular purpose, and non-infringement. We do not
        guarantee any specific exam result or learning outcome.
      </P>

      <H2>11. Limitation of liability</H2>
      <P>
        To the maximum extent permitted by Zambian law, ZedExams will not be liable for
        any indirect, incidental, special, consequential, or punitive damages, or for any
        loss of profits, data, or goodwill, arising out of your use of the Service. Our
        total liability for direct damages is limited to the amount you have paid us in
        the twelve months before the event giving rise to the claim, or ZMW 0 if you have
        not paid us anything.
      </P>

      <H2>12. Changes to these Terms</H2>
      <P>
        We may update these Terms from time to time. If we make a material change, we'll
        update the "Last updated" date at the top and, where appropriate, notify you in
        the app or by email. Continuing to use ZedExams after a change means you accept
        the updated Terms.
      </P>

      <H2>13. Governing law</H2>
      <P>
        These Terms are governed by the laws of the Republic of Zambia. Any dispute that
        can't be resolved through friendly discussion will be settled by the competent
        courts of Zambia.
      </P>

      <H2>14. Contact</H2>
      <P>
        Questions about these Terms? Reach us by email at{' '}
        <a className="underline theme-accent-text" href={CONTACT_EMAIL_HREF}>
          {CONTACT_EMAIL}
        </a>
        , on WhatsApp at{' '}
        <a className="underline theme-accent-text" href={CONTACT_WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
          +260 977 740 465
        </a>
        , or via the contact form on our home page.
      </P>
    </LegalLayout>
  )
}
