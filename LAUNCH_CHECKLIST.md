# Launch Checklist — ZedExams Teacher Suite

> **⚠️ STATUS — re-verified 2026-05-29: SUPERSEDED historical snapshot. Do not use as a live checklist.** This was a one-time launch runbook for a "Teacher Suite" funnel that was never built, and the stack has moved on:
>
> - **The public funnel it tests doesn't exist** — there are no `/teachers`, `/teachers/samples`, or `/admin/waitlist` routes, and no waitlist component anywhere in `src/`. Most of §1–§2 checks a product shape that was never shipped.
> - **Hosting:** Netlify → **Firebase Hosting** via GitHub Actions. The `app.netlify.com/…` links (§7) and the "Publish deploy" rollback (§8) are dead — rollback is `git revert` + push.
> - **Analytics:** the Plausible/GA4 instructions (§3) are obsolete — the app uses **PostHog** (`src/utils/analytics.js`, gated on `VITE_POSTHOG_KEY` + consent).
> - **Error monitoring:** Sentry is **already installed and wired** (`src/utils/sentry.js`, `src/main.jsx`); only `VITE_SENTRY_DSN` remains unset. §4's "npm install @sentry/react" is done.
> - **§6 `MARKETING_KIT.md` does not exist** in the repo.
>
> Only the personal credential-backup list (§5, minus the Netlify line) and the secrets-leak rotation steps (§8) are still useful. If a teacher-marketing launch is still planned, write a fresh checklist against the current Firebase + PostHog + Sentry stack.

Walk this top-to-bottom **once** before posting your first WhatsApp message or email. Each item is ~2 minutes. Allow an hour total.

---

## 1. End-to-end smoke test (20 minutes)

Open an incognito/private window. Do this as a brand-new user.

- [ ] Visit **zedexams.com** — redirects to a sensible landing
- [ ] Visit **zedexams.com/teachers** — landing loads, hero looks right, pricing visible, waitlist form present
- [ ] Submit the waitlist form with a test email — confirmation screen appears
- [ ] Visit **zedexams.com/teachers/samples** — three sample cards display
- [ ] Click the Grade 5 Mathematics sample — full plan renders, fractions look correct (not faint, + in the right place)
- [ ] Click **Download this lesson plan (.docx)** — Word file downloads, opens correctly
- [ ] Go to **/register** — sign up a test teacher account (use a real email you control)
- [ ] After signup, submit teacher verification (or pre-approve in Firestore console for testing)
- [ ] Sign in — teacher dashboard shows the three AI tool cards + My Library tile
- [ ] Click Lesson Plan — pick Grade 5 / Mathematics / type "Fractions" / Generate
- [ ] Watch the spinner — plan appears in ≤30s
- [ ] Check the plan renders correctly — fractions, headings, phase blocks
- [ ] Download as DOCX — opens correctly in Word
- [ ] Go to My Library — the plan is listed
- [ ] Click it — detail view renders, re-export works
- [ ] Delete it — succeeds
- [ ] Sign out
- [ ] Sign in as admin
- [ ] Visit **/admin/waitlist** — your test signup is listed
- [ ] Click "mark contacted" — persists
- [ ] Export CSV — file contains the test row
- [ ] Visit **/admin/generations** — your test lesson-plan generation is listed
- [ ] Visit **/admin/cbc-kb** — page loads (may be empty, that's fine)

If any step fails, fix it before launching. If everything passes, you're functional.

---

## 2. SEO verification (10 minutes)

- [ ] `curl -I https://zedexams.com/teachers` returns `200 OK`
- [ ] `curl https://zedexams.com/robots.txt` shows the robots file
- [ ] `curl https://zedexams.com/sitemap.xml` shows all sample URLs
- [ ] Google "site:zedexams.com" — if you already have some pages indexed, good; if not, submit the sitemap at <https://search.google.com/search-console>
- [ ] Paste `https://zedexams.com/teachers` into <https://cards-dev.twitter.com/validator> and <https://developers.facebook.com/tools/debug/> — a proper preview card with title, description, and image should render
- [ ] Run <https://pagespeed.web.dev> on `/teachers` and `/teachers/samples/grade-5-mathematics-fractions`
  - Performance ≥80, Accessibility ≥90, Best Practices ≥90, SEO ≥95 (the static landing should score in the 90s; the sample pages can dip on Performance due to the rendered lesson plan content — still OK as long as SEO is high)

---

## 3. Analytics (15 minutes)

Pick ONE and uncomment the matching block in `index.html`:

**Recommended: Plausible** ($9/month, privacy-friendly, no cookies, no GDPR paperwork)
1. Sign up at <https://plausible.io/register?plan=growth>
2. Add `zedexams.com` as a site
3. Uncomment the Plausible `<script>` line in `index.html`
4. Commit + push
5. Visit zedexams.com yourself — Plausible dashboard shows 1 visitor in real time

**Free alternative: Google Analytics 4**
1. Sign up at <https://analytics.google.com>
2. Create a GA4 property for zedexams.com
3. Copy the Measurement ID (format `G-XXXXXXXXXX`)
4. Uncomment the GA4 block in `index.html` and replace `G-XXXXXXXXXX` with your ID
5. Commit + push
6. Visit zedexams.com and confirm real-time view in GA4

---

## 4. Error monitoring (optional, 10 minutes)

Catch production JS errors that would otherwise go unnoticed.

- [ ] Sign up at <https://sentry.io/welcome> (free for small projects)
- [ ] Create a React project, copy the DSN
- [ ] `npm install @sentry/react`
- [ ] Initialise in `src/main.jsx`:
  ```js
  import * as Sentry from '@sentry/react'
  Sentry.init({ dsn: 'YOUR_DSN', tracesSampleRate: 0.1 })
  ```
- [ ] Commit + push

Once in place, you'll get an email any time a teacher hits a real error.

---

## 5. Backup credentials (5 minutes)

Write these down somewhere you can access from another device:

- [ ] Anthropic API key (so you can rotate it)
- [ ] Firebase project owner access (email + recovery method)
- [ ] Netlify account email + recovery method
- [ ] GitHub account email + 2FA recovery codes
- [ ] MTN Mobile Money API credentials
- [ ] Domain registrar account for zedexams.com

Put these in a password manager (1Password, Bitwarden). If you lose access to all of them, your business is offline.

---

## 6. First-day outreach plan (reference)

Open `MARKETING_KIT.md` — it has:
- 3 WhatsApp message templates
- 3 Facebook group posts (rotate across groups)
- A 10-tweet launch thread
- TTC + head-teacher email templates
- A day-by-day Week 1 schedule

Don't post to 10 places on Day 1. Start with ONE WhatsApp group you already know, so you can iterate the pitch based on real teacher reactions before casting wider.

---

## 7. What to watch in the first 72 hours

Open these three tabs and refresh hourly:

- <https://app.netlify.com/sites/zedexams/deploys> — catches any broken deploy
- <https://zedexams.com/admin/waitlist> — see signups as they happen
- <https://zedexams.com/admin/generations> — see what teachers are generating, spot bad outputs immediately

If you see a generation that looks wrong, flag it (amber button) and dig into the prompt. That feedback loop matters more than anything else in week 1.

---

## 8. Rollback plan

If a bad deploy breaks production:

**Frontend:** <https://app.netlify.com/sites/zedexams/deploys> → find last green deploy → `...` menu → **Publish deploy**. Takes 5 seconds.

**Backend:** `git revert <bad-commit>` then `git push`. The auto-deploy workflow handles the rest.

**Secrets leaked:** revoke the Anthropic key immediately at <https://console.anthropic.com/settings/keys>, generate a new one, re-set it with `npx firebase-tools functions:secrets:set ANTHROPIC_API_KEY`, redeploy functions.

---

## Post-launch: what success looks like by end of Week 1

- 50+ waitlist signups
- 10+ teachers who actually generated a lesson plan
- Free-to-paid conversion feedback from at least 5 teachers
- 2-3 TTC or head-teacher replies to outreach emails
- Zero unhandled production errors on the error-monitoring dashboard

If you hit those numbers the foundation is working and you can start thinking about Phase 2 (teacher library enhancements, scheme-of-work generator, localisation). If you don't, the bottleneck is either the pitch or the channel — iterate before building more features.
