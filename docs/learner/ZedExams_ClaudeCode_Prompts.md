# ZedExams — Claude Code Build Playbook (Learner-Side Upgrade)

> Snapshot as of 2026-08-17 — verify before acting. This is the owner's build
> playbook, kept verbatim. It describes the *intended* learner side, not the
> current one: prompts 0–8f and 9–13 were written before the redesign began and
> parts of them have already shipped (see `git log --oneline --grep "Learner
> redesign"`). Read the matching code before treating a prompt as outstanding.

**What this is.** A ready-to-paste sequence of prompts for **Claude Code**, working in your repo `github.com/Mwelwa-cyber/Zedexams`. Paste them **in order**, one at a time. Each prompt is self-contained: it tells Claude Code what to read, what to build, the rules that must hold, and how to prove it's done before moving on.

**This is an UPGRADE, not a new app.** The learner side already exists (notes, past papers, home, games). We are replacing most of the learner experience with the design we prototyped. So every prompt starts by making Claude Code **read the existing code first** and reuse what's there (routes, Firebase setup, `educationLevels.js`, auth, existing paper/notes data) rather than rebuilding from zero.

---

## 0. Do this once before you start

**A. Put the design docs in the repo** so Claude Code can read them. Create a folder `docs/learner/` and drop in the four files from the build pack plus the prototype:

```
docs/learner/ZedExams_Learner_App_Build_Spec.md
docs/learner/ZedExams_AI_Generation_Spec.md
docs/learner/ZedExams_Content_Intake_Template.md
docs/learner/ZedExams_Grade7_English_Reference.md
docs/learner/zedexams-learner-prototype.html      ← the working reference (learner side)
docs/learner/zedexams-parent-prototype.html       ← the parent-app reference
```

Commit them: `git add docs/learner && git commit -m "docs: learner-side design pack"`.

**B. Work on a branch.** In Claude Code:
> `Create and switch to a branch called learner-upgrade. We'll do all the learner-side upgrade work here.`

**C. The per-prompt loop.** For every prompt below, Claude Code should: (1) read the referenced spec section + the matching part of the prototype, (2) explore the existing code it will touch, (3) propose a short plan, (4) implement in small commits, (5) run `npm run build`/lint/tests and fix errors, (6) tell you exactly what to click to verify. If any prompt is too big for one go, tell it: *"Do it in smaller commits and pause after each for me to check."*

**D. Golden rules that apply to EVERY prompt** (they're repeated inside the prompts too, but keep them in mind):
- **Night mode only, all colours are design tokens** — never hardcode a colour. Dark mode kept "missing" because colours were hardcoded; fix that at the root.
- **Every ranked or awarded score is server-side** (Cloud Functions). Never trust a client score.
- **Every counter uses a Firestore transaction / `increment`** — never read-modify-write (that caused the zero-question wipe bug).
- **Grade taxonomy comes only from `src/config/educationLevels.js`** — no second registry.
- **Content is auto-filtered to the learner's grade** from their profile — no grade browsing on the child UI.
- **No child-to-child communication anywhere.**
- **Nothing auto-publishes** — teacher approval gates all content.
- **The app is its own scroll container** (`#app` scrolls, not the document) so it works inside the Android TWA.

---

## PROMPT 0 — Prime Claude Code (no code yet)

> You're helping me upgrade the **learner side** of ZedExams (React + Vite + Tailwind + Firebase). This is an existing, live app — we're replacing most of the learner experience with a new design, not starting fresh.
>
> First, **read these before writing any code**:
> - `docs/learner/ZedExams_Learner_App_Build_Spec.md` (how the app should render and run)
> - `docs/learner/zedexams-learner-prototype.html` (the working visual + interaction reference — open it and study the screens, the note reader, the quiz, the games, the paper viewer)
> - `src/config/educationLevels.js` (the single source of truth for grades)
>
> Then **explore the current codebase** and produce a written report (no code changes yet):
> 1. The current learner-side routes, screens, and components, and where they live.
> 2. How Firebase is initialised; what Firestore collections already exist for notes, past papers, quizzes, learners, progress.
> 3. Which existing pieces we can reuse vs. replace for the new design.
> 4. A proposed folder structure for the new learner modules (feature-based).
> 5. Any risks (the known Firestore stale-tab race condition; hardcoded colours blocking Night mode; auth/guardian-consent touchpoints).
>
> Save the report as `docs/learner/UPGRADE_PLAN.md`. Do not change any app code in this step.

---

## PROMPT 0c — Onboarding & auth (first run)

> Build the **first-run onboarding + auth** flow (see the screens in `docs/learner/zedexams-learner-prototype.html`: Welcome → Sign in / Sign up → age gate → guardian email → grade & subject pick → Meet Zed → notifications ask). This is the front door to the learner app and feeds the compliance/consent work (do PROMPT 11 in tandem).
>
> - **Welcome** (Zed + "Practise smart.") → Get started / I already have an account.
> - **Sign in / Sign up:** Google + email-password, forgot-password. Use Firebase Auth.
> - **Neutral age gate (DOB)** on the learner path, **before** both sign-up methods so it can't be bypassed; **under-18 → guardian email step** (creates the account in **limited mode** and kicks off the consent email from PROMPT 8d); **18+ skips it**. Teachers/parents get an 18+ confirmation instead of DOB.
> - **Setup wizard** with a progress bar: **pick grade** (drives all grade-filtering; from `educationLevels.js`) → **pick subjects** → **Meet Zed** (mascot intro) → **notification-permission priming** (friendly ask before the OS prompt; respects the choice).
> - Land on **Home**; under-18 shows the "waiting for guardian" limited-mode banner. Persist grade/subjects/settings to `learners/{uid}`. Pre-login screens hide the app chrome (nav/FAB).
>
> Build it, wire real Firebase Auth (Google + email), verify the age-gate branch (under-18 → limited + guardian email; 18+ → straight through), that grade/subject choices actually filter the app, and that returning users skip onboarding. Report.

**Account model (important):** sign-in is **shared** across learner/teacher/parent (role decides the dashboard), but **parent and learner are separate, linked accounts — never one merged login** (a distinct verified adult identity is required for child-safety/consent; parents may have several children; billing sits on the adult account). The **role picker** (Learner / Parent / Teacher) chooses the path. The **"Parent" signup** and the child's **guardian-email approval must converge on ONE guardian account** — two doors, same room: *child-first* (learner names a guardian email → the approval link creates or links the parent account) and *parent-first* (parent signs up → invites/links a child). The Guardian Zone (PROMPT 8c) is that parent account's own dashboard, and the in-child gated version reads the same data. Also support **parent-managed child profiles** for younger learners with no email: a **name + 4-digit PIN** profile the parent creates and manages, with a **pick-your-face + PIN** sign-in for the child (distinct from standalone username-only accounts). Model it as `guardians/{gid}` ↔ `learners/{uid}` links; a child profile is a learner account owned/managed by a guardian. Build the role picker, parent signup + "add/link child" (both paths), the younger-child profile creator, and the PIN sign-in; verify both link paths land on the same guardian↔child relationship. 

---

## PROMPT 1 — Design system + app shells

> Read §1, §2 and §10b of `docs/learner/ZedExams_Learner_App_Build_Spec.md` and match the look/behaviour in `docs/learner/zedexams-learner-prototype.html`.
>
> Build the shared learner shell:
> - A **CSS design-token system** (palette, radius, shadow, Nunito type). Every surface colour is a variable. Add **Night mode** as a single override layer. Audit the existing learner components and replace hardcoded colours with tokens so Night mode has no "missing" spots.
> - The **glassy translucent top bar + bottom nav** (Home · Papers · Notes · Games) that **auto-hide on scroll down and reappear on scroll up**. The app is its **own scroll container** (`#app` scrolls, not the document) — this must work inside the Android TWA/webview.
> - **Desktop reflow (≥1000px):** bottom nav becomes a fixed ~250px **left sidebar** (brand on top, icon+label rows, active highlighted, auto-hide disabled); content sits in a **centred ~780px column** (~820px at ≥1400px); Explore tiles 3-up, subjects 2-up, game cards 2-up. Immersive views (quiz/games) stay ~560px centred. One media query, no separate desktop codebase.
> - Wire in the **Zed** mascot assets (poses: wave, celebrate, think, oops, let's-go + the celebration video) as reusable components.
>
> Keep everything token-based and responsive. Run the build, fix errors, and tell me which screens to open on phone width and desktop width to verify Night mode + auto-hiding nav + sidebar reflow.

---

## PROMPT 2 — Data model, security rules, server scoring

> Read §3 of the build spec. Set up the Firestore data model and rules for the learner side, reusing existing collections where they already exist (check first — don't duplicate).
>
> Collections (create/adjust as needed): `subjects`, `topics`, `notes`, `quizzes`, `wordbank/{subject}/cards`, `papers`, `learners/{uid}` with subcollections `progress`, `gameState`, `rewards`, `paperRuns`; plus `dailyQuiz/{grade}/{date}`, `leaderboards/{grade}/weeks/{weekId}/entries`, and `matches/{matchId}`. Use the exact field shapes in the spec.
>
> Rules & functions:
> - Notes/quizzes/papers are **read-only to learners**. Progress/rewards/paperRuns are per-learner writable under security rules (owner only).
> - **All ranked/awarded scoring is server-side Cloud Functions** (daily-quiz points, leaderboard writes, live-match results, game XP with the daily cap). Add stubs now with correct signatures.
> - **All counters** (XP, streak, best) use **transactions / `increment`** — never read-modify-write. Guard against the known stale-tab race condition.
> - Grade values come only from `src/config/educationLevels.js`.
>
> Write Firestore security rules and add emulator-based tests for the critical ones (owner-only writes, no client score writes to leaderboards). Run them and show me the results.

---

## PROMPT 3 — Note reader engine (highest value)

> Read §4 of the build spec, §3 (block schema) of `docs/learner/ZedExams_AI_Generation_Spec.md`, and the note reader in the prototype (the Conjunctions and Digestive System notes). Build the **note reader engine** — one reader, two modes.
>
> - **Block renderer:** one component per block type: `heading, para, tip, example, reveal, tryit, sectionCheck, keypoints, tapExplore, labelDiagram, topicQuiz`. Parse `para` text for `**bold**` and `[[kw:word]]` → tappable keyword that opens a **word-bubble bottom sheet** from `wordbank/{subject}/cards/{word}`.
> - **Learn mode (paced reveal):** show one `heading`-delimited section at a time with a **"Continue ▾"** button + progress dots; auto-scroll the new section into view; reading-progress bar on top.
> - **Revise mode:** all blocks shown, but `tryit`/`sectionCheck`/`reveal` hidden and `keypoints` shown. Toggle at the top; default depends on entry point (Subjects → Learn, Notes tab → Revise).
> - **sectionCheck remediation:** a wrong answer expands an inline panel (Zed re-explains + 2 examples + a *different* retry). A recovered retry earns +XP and praise. Never a dead-end.
> - **labelDiagram:** unlabelled image + absolutely-positioned drop zones from `boxes` (%); support **drag (pointer events) or tap-to-place**; Check marks green/red.
> - **tapExplore:** grid; tap opens a bottom sheet with image + role text.
> - **TTS:** device `speechSynthesis` (en-GB) for "hear the word" / read-aloud.
> - **Completion:** "Mark topic done" → `progress/{topicId}.done=true`, +XP (server), update subject term progress.
>
> Load the Conjunctions block JSON from the Grade 7 English reference as a fixture and render it end-to-end. Build, fix errors, and tell me how to open the note in both modes to verify.

---

## PROMPT 4 — Quiz engine (shared)

> Read §5 of the build spec and the quiz screens in the prototype. Build **one quiz engine** serving four modes: **daily, topic, past-paper, game-quiz**.
>
> - One question per screen; **options vertical with A–D letter badges (ECZ past-paper style)**; slide-up feedback with Zed; progress chip. Feedback is instant and reasoned, never just a mark.
> - **daily** → source `dailyQuiz/{grade}/{today}` (same for everyone in the grade); **server-validated** points → weekly leaderboard.
> - **topic** → source `quizzes/{topicId}`; local practice scoring; ends in celebration → back to note.
> - **paper** → source the paper's `quizId` (up to 60 Q); adds a **timed/relaxed chooser** (timer = paper `minutes`), a countdown chip that turns red near 0 with **auto-submit at 0**, a **progress chip** (e.g. 12/60), **resume** (save `{qIndex,score,answers,timed,timeLeft}` to `paperRuns/{paperId}`; button flips to "Resume · 12/60"), and a **results review** listing each wrong answer (given vs correct) grouped into **topics to improve** with a link into Notes. Requires each question `topic`-tagged.
> - **challenge** → match `questions[]`, server-validated (used later by live challenge).
>
> Build with the Conjunctions quiz as a fixture. Verify daily/topic/paper flows, resume, and the results-review grouping. Run the build and report.

---

## PROMPT 5 — Home, Subjects, Notes tab (wire to content)

> Read §2 of the build spec and the Home/Subjects/Notes screens in the prototype. Wire the content screens to Firestore.
>
> - **Home:** grade·term chip, Continue card (last topic), Today's Quiz entry, Explore (Papers/Notes/Games), My Subjects (the 7 Grade-7 subjects: Integrated Science, Mathematics, Technology Studies, Expressive Art, Home Economics, Social Studies, English). **Explore on top, My Subjects below.** No curriculum label. Show **only the current term**, with a switcher to Term 1/3.
> - **Subject screen:** Term 1/2/3 switcher → topic list with ✓ done / ▶ current / ○ locked, from `topics` filtered by subject + grade + term. Tapping a topic opens the note reader in **Learn** mode.
> - **Notes tab (revision hub):** search + topic list + "download term for offline"; opens the reader in **Revise** mode.
> - Everything **auto-filtered to the learner's grade** from their profile. Handle empty states (subject not yet published) gracefully — show "coming soon", never a broken screen.
>
> Build, verify each screen with real Firestore data (seed a couple of topics if needed), and report.

---

## PROMPT 5b — Exam timetable + Home countdown

> Add an **exam timetable** to the learner side (see the countdown card + timetable screen in `docs/learner/zedexams-learner-prototype.html` — Home shows a coral countdown card and a fourth Explore tile; both open a full timetable screen).
>
> **Admin/teacher side (data entry):** add a small **Exam Timetable manager** where an admin sets exams per grade + term. New Firestore collection `exams/{examId}` (or `timetables/{grade}/{term}`) with `{grade, term, subject, date, time, venue?, paper}`. Read-only to learners; admin-writable under rules. Reuse the existing admin/papers area and the grade source `src/config/educationLevels.js`.
>
> **Learner side (display):**
> - A **Home countdown card** directly under the grade·term chip: "Term 2 End of Term Exams · First paper: [date] · [subject] [paper]" with a **days-to-go** counter computed from the next exam date vs today. Tapping opens the timetable.
> - A **fourth Explore tile** "Timetable · Exam dates" (Explore becomes Papers · Notes · Games · Timetable — 2×2 on phone, 4-up on desktop).
> - A **Timetable screen:** a countdown hero, a "showing your grade only" chip, exams **grouped by week/day**, each row = date badge · subject (colour dot) · time/venue · paper tag. **Auto-filtered to the learner's grade** from their profile. **Save offline** like the rest of the learner side; recompute the countdown against today's date.
> - It's a top-level browsable screen (bottom nav stays visible) — not inside a subject or the paper viewer.
> - All colours are tokens (Night mode must be clean); handle the empty state ("timetable not published yet").
>
> Build, seed a Grade 7 Term 2 timetable, verify the countdown maths, grade-filtering, phone + desktop layout, and Night mode. Report.

---

## PROMPT 6 — Paper viewer (full-screen + desktop two-pane + auto-marking)

> Read §8 and §10b of the build spec and the paper viewer in the prototype (including the **desktop two-pane** with the thumbnail rail). This upgrades the EXISTING past-paper viewer and **infuses the existing papers** into the new experience — keep the current paper files/data, improve the container and the outcome.
>
> - **Full-screen, edge-to-edge** pages on a dark canvas (phone: single ~430px column). Render existing **PDF pages** in-browser or uploaded page images, scrolling.
> - **Auto-hiding chrome:** top (back, title, live page counter) and bottom (**Save offline**, **Start/Resume Quiz**) slide away on scroll, return on tap/scroll-up.
> - **Pinch-zoom + pan** via transform on the page (fix the current broken pinch/pan); double-tap to 2×.
> - **Desktop (≥1000px): two-pane** — a **thumbnail rail** of clickable page minis on the left (active page highlighted, synced to scroll) + a **larger centred page column**. Collapses to the single-column full-screen viewer on phone. (The prototype shows exactly this.)
> - **Save offline → Android only**; **hide the download button on the PC website**.
> - **Auto-marking:** most existing papers have a **marking scheme / answer key**. Wire the paper's `quizId` so the past-paper quiz **auto-marks against the key**, then the **results review** turns wrong answers into named **weak topics** feeding the games. Papers **without** a key fall back to the existing **"Quiz coming soon"** status in the viewer.
>
> Build, verify on phone width (single column, pinch/pan) and desktop width (two-pane rail), and confirm a keyed paper auto-marks end-to-end. Report.

---

## PROMPT 7 — Games engine + rewards (rewards, NOT a games leaderboard)

> Read §6 of the build spec and the games in the prototype (Number Target, Word Builder incl. "tap what you hear", Meaning Match, Punctuation Pro). Build the **games engine** as a shared shell with per-mechanic components.
>
> - Mechanics: `number-target` (Maths — combine tiles to a target), `word-builder` (English spelling — tap letters; **clue mode AND "tap what you hear" audio mode** via `speechSynthesis` en-GB), `meaning-match` (English — tap word↔meaning), `punctuation` (English — pick the correctly punctuated sentence). Leave `map-quest` (Social Studies) and a cross-topic "Label It!" as stubs.
> - **Difficulty is Grade-7-tied and ramps with the level path** (bigger numbers, tighter timer) — pulled from the grade's bank. Not babyish, and specifically **not too easy** for 12–13 year olds.
> - **Level path:** node map (done ⭐ / current glowing / locked 🔒); finishing a level → win (stars, XP) → advances the path.
> - **Rewards, NOT a leaderboard for games:** personal **best per game**, a **learner XP/Level bar** (games + quizzes feed it; **soft daily cap** — full XP for first ~2 plays/day, then ~20%), and **badges** (First Win, Combo Master, Number Ninja, Daily Player…) that pop over the celebration and live on an **Achievements shelf**. XP and the daily cap are computed **server-side**; best/streak via `increment`/transaction.
>
> Build number-target first, verify the level path + XP + a badge unlock + the daily cap, then the three English games. Report.

---

## PROMPT 8 — Daily quiz + weekly leaderboard (server-validated)

> Read §5 (daily) and §6 (leaderboard) of the build spec and the daily-quiz + leaderboard screens in `docs/learner/zedexams-learner-prototype.html`. Build the **daily quiz** hosted by Zed and its **weekly, per-grade leaderboard**.
>
> - **Intro screen** (before the questions): Zed-hosted card with today's date, "5 questions", and the fairness/streak/once-a-day facts, plus **Play** and **See leaderboard**. After playing, the entry point flips to "Ranks" and re-opening goes straight to the board.
> - One daily quiz per grade: `dailyQuiz/{grade}/{date}` — the **same questions for everyone in the grade** (fair). Played **once per day**.
> - A **Cloud Function validates answers and writes points** to `leaderboards/{grade}/weeks/{weekId}/entries/{uid}` — never a client-sent score. **No learner PII** on the board — name/avatar only.
> - **Result screen** with Zed celebration, stars, streak (+1 via `increment`/transaction) and points earned → button into the leaderboard.
> - **Leaderboard screen:** your rank/points/streak header; a **top-3 podium** (gold/silver/bronze); a **weekly-reset countdown** ("resets Monday · N days") and **last week's champion**; the full ranked list; and a **pinned "you" row** stuck at the bottom whenever your rank is outside the podium. Weekly reset, per grade, own row always visible.
>
> Build, verify the same-quiz-for-all behaviour, the once-a-day lock, the podium + pinned-you behaviour at different ranks, and that a tampered client score is rejected server-side. Report.

---

## PROMPT 8b — Profile, Settings & Notifications

> Add the learner **Profile**, **Settings**, and **Notifications** (see these screens in `docs/learner/zedexams-learner-prototype.html`: the avatar opens Profile, a bell in the top bar opens the notification centre, Profile → Settings).
>
> **Profile** (read from `learners/{uid}` + `rewards`): avatar + display name + grade·term, **guardian-verified** chip, stat tiles (level, streak, badges), the XP-to-next-level bar, the **Achievements** shelf (earned + locked badges), a "this week" summary (quizzes/games/topics), and buttons for Settings and Sign out. First-name/nickname + avatar only — **no child PII**.
>
> **Settings** grouped into cards: **Appearance** (Night mode — reuse the one theme toggle so it stays in sync everywhere; sound/effects), **Notifications** (see below), **Learning** (Ask Zed on/off, daily goal), **Account** (name & avatar, guardian status, downloads & storage), **Privacy & safety** (report a problem, "Get help — Childline Zambia 116", delete account → **guardian approval required**), and an about/version footer. Use real toggle switches; persist each preference to `learners/{uid}/settings`.
>
> **Notifications — two parts:**
> 1. **In-app notification centre:** a bell in the top bar with an unread dot; a grouped (Today/Earlier) list of notification cards, each with an icon, title, body, time, unread accent, and a **tap target that deep-links** to the right screen (exam countdown → Timetable, quiz ready → daily quiz, badge → Games, challenge → live challenge, leaderboard → board, guardian approved → account). "Mark all read" clears the dot. Store as `learners/{uid}/notifications/{id}` `{type,title,body,link,read,createdAt}`.
> 2. **Push (Android/web):** integrate **Firebase Cloud Messaging**; store the device token on the learner; send via Cloud Functions. Notification **types**: daily study reminder (scheduled, learner's chosen time), streak reminder, daily-quiz-ready, exam countdown (driven by the timetable dates), badge/level-up, challenge invite, leaderboard result, guardian-approval status. Each type maps to a Settings toggle; respect **quiet hours**; no marketing pushes to children.
>
> **Compliance:** honour **limited mode** (guardian-unconfirmed) — challenge-invite pushes off until approved; guardian can manage/disable notifications; nothing that enables child-to-child messaging. Do PROMPT 11 (compliance) first if guardian-consent infra isn't in place yet.
>
> Build the three screens wired to Firestore, the FCM token flow + one working server-sent push (e.g. daily-quiz-ready) behind the type toggles and quiet hours, and verify: Night-mode toggle stays in sync with the top bar; a tapped notification deep-links correctly; disabling a type stops that push; limited mode suppresses challenge pushes. Report.

---

## PROMPT 8c — Guardian Zone (parent view + controls)

> Add the **Guardian Zone** — a parent/guardian area reached from learner Settings → Guardian (see the gate + dashboard in `docs/learner/zedexams-learner-prototype.html`). Depends on the guardian-consent infra from PROMPT 11.
>
> **Parental gate:** before entering, show an adult check (a simple sum like "7 × 8", or year-of-birth). This is a friction gate, not real auth — the authoritative guardian identity is the **verified guardian account/email** from the consent system; treat the in-app zone as a convenience surface bound to that verified guardian.
>
> **Dashboard (read-only over the child's data + writable controls):**
> - **Child snapshot:** avatar, name, grade·term, verified badge; streak, time-this-week, level. (Support more than one child if the guardian has several — a child switcher.)
> - **Subject progress** bars (from `progress`), **"needs a little help"** weak-topic chips (from wrong-answer topic tags across quizzes/papers), and a **recent activity** feed.
> - **Child permission controls** (write to the child's settings, enforced server-side): Ask Zed on/off, Live challenges & friends on/off, daily time limit. These override the child's own toggles.
> - **Guardian alerts** (what the *guardian* receives, via their email/push): weekly progress email, exam reminders, **safety alerts** (distress-detection hits).
> - **Safety & account:** consent status (active), "Get help — Childline Zambia 116", subscription/billing (Lenco), and **delete child account**.
> - A clear "back to the child's app" exit; the child bottom-nav/FAB are hidden inside the zone so it reads as a separate space.
>
> **Rules:** the zone is **read + control**, never a second learner UI; guardian-set permissions are enforced by **security rules / Cloud Functions**, not just the client; nothing here enables child-to-child messaging; a guardian can revoke consent → child returns to limited mode. Data: reuse `learners/{uid}` (+ `guardianState`), the child's `settings`, and a `guardians/{gid}` ↔ children link.
>
> Build the gate + dashboard wired to Firestore, make one permission toggle actually gate a child feature server-side (e.g. turning off Ask Zed disables it in the child app), and verify the parental gate, the child switcher (if built), and that a guardian control really restricts the child. Report.

---

## PROMPT 8d — Guardian onboarding & consent (limited → full)

> Build the **guardian consent journey** that unlocks a child account (see the limited-mode Home banner + the guardian approval page in `docs/learner/zedexams-learner-prototype.html`). This is the UI on top of the fail-closed `guardianConsentCore` from PROMPT 11 — do that first.
>
> **Child side (signup → limited):** during signup the age gate captures DOB; **under-18 → ask for a guardian email** and create the account in **limited mode**. Limited mode = core learning/games/quiz available, but **no live challenges / friends**. Show a persistent **"Waiting for your guardian" banner** on Home explaining what's locked, with **Resend link** and "see their approval page".
>
> **Guardian side (email → approve):** email the guardian a **hashed, single-use, expiring consent link** (POST-only approve/decline, per the consent-token design). The link opens a **branded approval page** (works on any device, logged-out): the child's name/age/grade, **what they're approving** (learning, games, Ask Zed, live challenges — compete only), **how the child is kept safe** (no child-to-child chat, distress detection → Childline Zambia 116, no ads/'no data selling', guardian controls + delete anytime), a confirm-you're-the-guardian step, and **Approve / Decline**.
>
> **On approve:** flip `guardianState` to confirmed via a **Cloud Function** (never client-trusted), unlock full mode (challenges/friends on), and notify the child ("fully unlocked"). **Decline / expiry:** stay limited; allow re-send. Withdrawing consent later returns the child to limited mode (ties to the Guardian Zone, PROMPT 8c).
>
> **Rules:** fail-closed (unknown/expired token → no unlock); consent + age-gate collections carry a **Firestore TTL**; no child PII beyond what's needed; the whole flow works offline-degraded (approval itself is online). Build both surfaces, wire one real approve that flips state server-side and unlocks challenges in the child app, and verify: under-18 lands in limited mode with the banner; a valid link approves and unlocks; an expired/re-used link is rejected; decline keeps limited. Report.

---

## PROMPT 8e — Paywall (child asks guardian · guardian pays)

> Build the **learner-side paywall** (see the child unlock sheet + guardian plans screen in `docs/learner/zedexams-learner-prototype.html`). Core principle from the monetization plan: **under-18 learners never see a price** — they ask a guardian; the price and payment live on the **guardian** side.
>
> - **Inline padlocks** on premium surfaces (locked past-paper years "🔒 Premium", a "🔊 Listen PRO" read-aloud button in the note reader, timed exam mode, offline save). **Gate features, don't truncate content** mid-way; keep a painless papers-per-week volume limit.
> - **Child unlock sheet** (no price): tapping a locked item opens a bottom sheet titled by the feature + its benefit, one CTA **"Ask my guardian to unlock"** (sends the guardian a request **carrying the child's progress report**) + "Maybe later". For 18+ learners, the same sheet can link straight to plans.
> - **Guardian plans + checkout** (this is where price appears): reached from Guardian Zone → Subscription. Weekly **K15** / Monthly **K50** toggle; feature list incl. **"Notes read aloud — Monthly only"**; **K5 day pass** + **K120 term pass** (+ Sept–Nov exam pass, school licences later). **Lenco** mobile-money checkout — MTN MoMo / Airtel Money selector + number → "request sent to your phone" → activate. Server confirms payment via Lenco webhook; never trust the client.
> - **Notification/expiry behaviour:** the bell owns billing messages; expiry is a **3-day grace ribbon** then a quiet downgrade that **never removes streak/XP/badges**. Read-aloud audio is pre-generated & cached at publish (playback cost ~0), so the gate is a pure upsell lever.
>
> Build the padlocks, the child ask-guardian sheet (no price, sends progress), and the guardian plans + Lenco checkout; verify a child never sees a price, the guardian request delivers, and a confirmed payment unlocks Premium server-side. Report.

---

## PROMPT 8f — My Progress · Study Plan · Help · Accessibility

> Add the learner growth/support layer (see `docs/learner/zedexams-learner-prototype.html`: My Progress, Study Plan, Help, and the Accessibility settings).
>
> - **My Progress** (from Profile): exam-readiness %, streak + time-this-week, a **weekly activity chart**, **subject-mastery** bars, and **topics-to-improve** — all from the learner's real `progress`/`rewards`/wrong-answer data. CTA into the study plan.
> - **Study Plan / practise-weak-topics** (from My Progress + the exam countdown/timetable): a countdown, **"focus on these first"** cards built from the learner's weak-topic tags, each with a **Practise** button that **deep-links into a targeted quiz or game** for that topic, plus a short daily checklist. This closes the loop results → weak topics → practice.
> - **Help & support** (from Settings): searchable **FAQ**, contact/**message support**, **Childline Zambia 116**, and a store **rate-us** prompt.
> - **Accessibility & language** (Settings): a UI **language** toggle (English/Bemba/Nyanja) — *chrome only; lesson content stays in the ECZ exam language* — a working **text-size** control (accessible scaling, not just zoom), and **reduce-motion**. Persist to `learners/{uid}/settings`.
>
> Build these wired to real data, verify the study-plan Practise buttons launch the right targeted practice, the FAQ works, and text-size/language changes persist and apply app-wide. Report.

---

## PROMPT 8g — Parent app (parent's own logged-in experience)

> Build the **parent-side app** — the guardian's own logged-in experience on their own device (see `docs/learner/zedexams-parent-prototype.html`). It's a **separate surface** from the parental-gated Guardian Zone inside the child app, but **both read/write the same data** (`guardians/{gid}` ↔ `learners/{uid}` links, the child's `progress`/`rewards`/`settings`, approval requests, subscription). Depends on the account model (PROMPT 0c), Guardian Zone (8c), consent (8d) and paywall (8e).
>
> - **Auth & role:** the parent signs in through the **shared** login; role = parent routes here. One parent → many children.
> - **Home dashboard:** greeting, a **"Needs your approval"** feed (Premium-unlock requests — each showing the child's progress before deciding; friend/challenge requests; guardian-consent items) with approve/decline that write server-side; a **children overview** (per-child status: on-track / needs-a-nudge from real progress); a weekly-report teaser; plan status → upgrade.
> - **Children → child detail:** snapshot (streak, time, exam-readiness), subject-mastery, weak topics, recent activity + a **full activity timeline** (day-grouped feed of quizzes, games, notes, papers, badges, streak milestones, challenge wins — from the child's event log), and **permission controls that override the child's settings** (Ask Zed, live challenges/friends, daily time limit) — enforced by **security rules / Cloud Functions**, not the client. Plus add/link a child (own-login invite **or** younger-child name+PIN profile).
> - **Family sharing (co-guardians):** a child/account can have more than one guardian — an **owner** (manages billing, can delete) and invited **co-guardians** (view progress & reports, approve requests, change child permissions — but not billing/delete). Invite by email → accept links them; model as multiple `guardians/{gid}` linked to the child with a `role` field, enforced server-side.
> - **Reports:** the weekly progress report (what went well / where to focus / suggestion), a "send encouragement" nudge, and the **Sunday email** (same content) — this is the renewal engine.
> - **Account:** parent profile, **plan & billing** (Weekly K15 / Monthly K50, passes, Lenco MTN/Airtel — covers all children; payment confirmed server-side via webhook), the **alerts the guardian receives** (weekly email, exam reminders, safety/distress alerts, approval requests), manage/add children, guardian-consent status, Childline 116, help, sign out.
>
> **Rules:** it's a read + **control** surface, never a second learner UI; every guardian-set permission is enforced server-side; approving a Premium request carries the child's progress; revoking consent returns that child to limited mode. Reuse the design system, Night mode and responsive sidebar.
>
> Build the parent app wired to Firestore, make one approval and one permission toggle actually take effect in the child's app server-side, and verify multi-child support, the approval feed, and that billing covers every linked child. Report.

---

## PROMPT 9 — Live challenge (no communication)

> Read §7 and §10 of the build spec and the challenge flow in the prototype. Build the **live quiz challenge**. **Strictly no communication** between learners — no chat, typing, or voice. Compete only. Avatars + first name/nickname only.
>
> - **Matchmaking:** random opponent **within the grade** by default; friend-code for classmates (see & challenge friends only). **No browsable "who's online" roster.**
> - **Flow:** find opponent → VS countdown → **same questions for both**, race showing the opponent's **progress bar only** (never their answers) → result (win/lose/draw + rematch). Loser still earns a little XP.
> - **Fairness/tech:** invites expire ~60s; silent decline; one pending + cooldown; block remembered. The match is a **single authoritative Firestore doc**; a **Cloud Function validates answers and writes the winner** (never client-trusted). **Async "ghost" fallback:** if no opponent is online, race the recording of a friend's last run.
> - **Limited-mode learners** (guardian unconfirmed) get **random matchmaking only**; friends/challenges unlock after guardian approval.
>
> Build, verify a two-player match (two browser sessions), the ghost fallback, and that scoring is server-authoritative. Report.

---

## PROMPT 10 — Offline (Android TWA)

> Read §9 of the build spec. Make the **learner side work fully offline** in the Android TWA.
>
> - Cache content docs + assets (service worker / local store) so **home, subjects, opened notes, downloaded papers, games, and cached daily quiz** work offline.
> - **Queue progress/reward writes and flush on reconnect;** rewards/progress computed locally then **reconciled server-side** (server is source of truth for ranked/awarded values).
> - **AI features stay online-only** (Ask Zed, generation). If teacher studios are bundled, they're **view-only offline** — no offline editing/write-queueing.
>
> Build, verify offline load + a queued progress write flushing on reconnect, and report.

---

## PROMPT 10b — System states (offline · loading · error)

> Add the **system states** across the learner app (see them in `docs/learner/zedexams-learner-prototype.html`: offline banner, loading skeletons, error/retry). These make the app feel robust and are a Play-review expectation.
>
> - **Offline banner:** a global bar ("📴 You're offline — showing your saved lessons & papers") driven by real connectivity (`navigator.onLine` + online/offline events, and failed fetches). Ties into the offline cache (PROMPT 10): show what's cached, greys out online-only features (Ask Zed, generation, live challenge, payment), and clears with a "Back online" toast that flushes the queued writes.
> - **Loading skeletons:** shimmer placeholders on **every async load** (home, subjects, notes, papers, leaderboard) instead of spinners/blank screens — match the real layout so content doesn't jump.
> - **Error + retry:** a generic error boundary (Zed + "something went wrong… your progress is safe" + **Try again**), plus targeted handling for **network loss mid-quiz/paper** (don't lose answers — hold locally and resume) and failed submits (retry, never a dead end).
>
> Build the offline banner wired to real connectivity, skeletons for each list/screen, and the error boundary + mid-quiz recovery; verify going offline shows the banner and cached content, a slow load shows skeletons not blanks, and a failed action offers retry without losing state. Report.

---

## PROMPT 11 — Compliance & safety (Play Families) — verify before submission

> Read §10 of the build spec. Thread **Play-Families compliance** through the learner side and verify it end-to-end.
>
> - **Age gate + guardian email verification;** learners in **limited mode** until a guardian confirms (limited = random matchmaking only, no friends/challenges; core learning available).
> - **No child-to-child communication** anywhere — confirm by design across challenge, leaderboard, profile.
> - **Ask Zed** child-safe: child-safe prompt, report/flag button, **deterministic distress detection before any AI call** surfacing **Childline Zambia 116**; false-positive tests so educational content isn't flagged.
> - Guardian consent core is **fail-closed**, shared by React + Cloud Functions; hashed single-use consent tokens; Firestore TTL on consent/age-gate collections.
> - Privacy: no learner PII on leaderboards; target **API 36**; deletion page + purge functions.
>
> Produce a short compliance checklist in `docs/learner/COMPLIANCE_CHECK.md` with pass/fail for each item and fix any fails. Report.

---

## PROMPT 11b — Ask Zed (contextual study helper, safeguarded)

> Re-add **Ask Zed** from the old learner side, but as a **contextual study helper**, not an open chatbot (see the Ask Zed sheet + floating button in `docs/learner/zedexams-learner-prototype.html`, and the safety rules in §10 of the build spec). It must reuse the guardian-consent + distress-detection infrastructure built in PROMPT 11 — do that prompt first.
>
> **Entry points (context-anchored):**
> - A **floating "Ask Zed" button** on content screens (Home, Subjects, Notes, Timetable, Games hub); hidden during timed activities (quiz, games, live challenge, paper viewer).
> - A **"Stuck? Ask Zed"** action inside the note reader that passes the current topic as context.
> - On the **quiz/paper results screen**, an **"Ask Zed to explain what I got wrong"** action that seeds the conversation with the missed questions/topics.
>
> **The helper sheet:** a friendly Zed header (avatar, "your study helper · online", **report/flag** button), an intro, tappable **suggested questions**, chat bubbles (child + Zed), an input bar, and a "school-safe · online only" footer.
>
> **Safeguards (non-negotiable):**
> - **Deterministic distress detection runs BEFORE every AI call**; on a hit, surface **Childline Zambia 116** and do not send to the model. Keep the false-positive tests so normal educational content (e.g. "the heart pumps blood") is never flagged.
> - **Child-safe system prompt**, scoped to the learner's grade/topics; **textbook-faithful** (answer from the same content notes are built from — it teaches, it doesn't free-associate). Refuse off-topic/unsafe requests gently.
> - A visible **report/flag** button on every response; flags route to review.
> - **Online-only** (greyed out with an explanation in offline mode); **rate-limited** and gated to the paid tier or a daily allowance (AI cost).
> - **Limited-mode** learners (guardian unconfirmed): restricted or disabled until approval.
> - No child PII sent to the model; log conversations for safety review per your privacy policy.
>
> Build the entry points + sheet, wire a real (rate-limited, server-side) AI call behind the distress gate, and verify: the gate blocks a distress phrase and shows Childline 116; an educational phrase is NOT blocked; offline disables it; limited-mode restricts it. Report.

---

## PROMPT 12 — Retire old notes, author fresh (the content pipeline)

> We are **deleting the old notes and authoring fresh** through the generation pipeline — NOT migrating/restyling the old flat notes. Read `docs/learner/ZedExams_AI_Generation_Spec.md`, `docs/learner/ZedExams_Content_Intake_Template.md`, and the Grade 7 English reference.
>
> Build/confirm the **content pipeline plumbing** on the admin/teacher side so I can produce and publish new notes:
> - An **intake → generate → teacher-approve → publish** flow that writes `notes`, `quizzes`, and `wordbank` in the exact block schema, tagging each `topics` doc with `noteId`/`quizId` and a `status`.
> - **Nothing auto-publishes** — a teacher approves every note; store the source textbook page refs on the note (`sources`) for auditability.
> - **Retire old notes subject-by-subject:** add a safe switch so a subject's OLD notes stay live until its FRESH notes are approved, then swap — a learner must never open a subject and find it empty mid-upgrade. Don't bulk-delete anything up front.
>
> Then verify the pipeline by taking **one topic** (Grade 7 English → Conjunctions) from the reference doc all the way to a published, learner-visible note. Report the exact steps I follow to run the next topic myself.

**Reusable per-topic generation prompt** (paste once per topic, filling the blanks — this is the exact contract from the AI generation spec):

> You are a ZedExams content author creating a Grade **7** **[subject]** note for Zambian learners, **strictly from the supplied prescribed textbook**. Output only the JSON object `{ note, quiz, words, meta }` defined in `docs/learner/ZedExams_AI_Generation_Spec.md` §2–§6. Follow every rule:
> 1. Facts and vocabulary come **only** from `TEXTBOOK`; if your knowledge disagrees, **the textbook wins**; never invent facts — flag `needs-source` if `TEXTBOOK` is empty. (This is why "small intestine = 2 parts" when the Zambian book says so.)
> 2. Cover every Specific Outcome in `SYLLABUS`; flag any not in the textbook.
> 3. Structure: one `heading` per sub-concept; each section = `keypoints` → 1–2 `para` (mark key terms `[[kw:]]`) → `example` (Zambian names) → optional `reveal`/`tryit` → a `sectionCheck` with full `remediation` (explain + 2 examples + a *different* retry).
> 4. Open with a definition `para` + a `tip:trick`; near the end add a `tip:alert` naming the exam part **[examParts]**.
> 5. Build a 5–8 question quiz matching the style of `PASTPAPERS` for **[examParts]**, options vertical A–D, one correct, `topic`-tagged.
> 6. Author a Word Bank card for every `[[kw:]]`.
> 7. End the note with a `topicQuiz`.
> 8. Child-level language, British/Zambian spelling, encouraging Zed voice.
> 9. Validate against the §7 checklist; set `meta.flags` and `meta.confidence`.
>
> **TOPIC:** `[paste topic JSON]`
> **SYLLABUS:** `[paste verbatim outcomes]`
> **TEXTBOOK:** `[paste verbatim prescribed pages]`
> **PASTPAPERS:** `[paste 2–5 tagged past-paper questions]`
>
> Return the JSON object only. I will review and approve before it publishes.

---

## PROMPT 13 — Full verification pass (definition of done)

> Do a **final learner-side verification pass** on the `learner-upgrade` branch. For each area, run it and report pass/fail with evidence:
> 1. **Night mode:** open every learner screen in Night mode — no white patches, no invisible text, no stray glyphs on dropdowns.
> 2. **Responsive:** phone (<1000px) and desktop (≥1000px) — sidebar reflow, centred column, two-pane paper viewer, immersive views stay centred.
> 3. **Note reader:** Learn paced reveal, Revise mode, keyword bubbles, sectionCheck remediation, labelDiagram drag + tap, TTS.
> 4. **Quiz:** A–D vertical badges; daily/topic/paper; timer + auto-submit; resume; results review → topics to improve.
> 5. **Paper viewer:** pinch/pan, offline save (Android), download hidden on PC, keyed paper auto-marks.
> 6. **Games + rewards:** Grade-7 difficulty, level path, XP with daily cap, best, badge unlock; **no games leaderboard**; daily-quiz leaderboard fair + server-validated.
> 7. **Live challenge:** two-player, ghost fallback, **no communication**, server-authoritative winner.
> 8. **Offline:** loads offline; progress writes queue and flush.
> 9. **Compliance:** age gate, limited mode, distress detection → Childline 116, no child-to-child comms.
> 10. **Cross-cutting:** every colour a token; every ranked/awarded score server-side; every counter via `increment`/transaction; content grade-filtered; nothing auto-publishes.
>
> Fix anything that fails. When all pass, summarise what changed and open a PR from `learner-upgrade` with a checklist body.

---

## Suggested pasting order (quick reference)

`0 Prime → 0c Onboarding/auth → 1 Design system → 2 Data model → 3 Note reader → 4 Quiz engine → 5 Home/Subjects/Notes → 5b Exam timetable → 6 Paper viewer → 7 Games+rewards → 8 Daily quiz+leaderboard → 8b Profile/Settings/Notifications → 8c Guardian Zone → 8d Guardian onboarding/consent → 8e Paywall → 8f Progress/StudyPlan/Help/A11y → 8g Parent app → 9 Live challenge → 10 Offline → 10b System states → 11 Compliance → 11b Ask Zed → 12 Notes pipeline + retire/fresh → 13 Full verification.`

You can stop at any prompt, verify on your PC, and resume later — each one ends with a working, committed slice. If Claude Code drifts from the spec, paste: *"Re-read the relevant section of `docs/learner/ZedExams_Learner_App_Build_Spec.md` and the matching screen in the prototype, then align."*
