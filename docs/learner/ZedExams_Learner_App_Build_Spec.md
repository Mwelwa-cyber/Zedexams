# ZedExams — Learner-Side App Build Spec

**Scope.** Everything needed to build the learner experience prototyped over this project: the simplified home, term-split subjects, the block-based note reader (Learn/Revise, checks, remediation, word bubbles, label diagrams, tap-to-explore), the quiz engine (daily, topic, past-paper), games with rewards, the live challenge, the full-screen paper viewer, offline, and Play-Families compliance. Stack: **React + Vite + Tailwind + Firebase (Firestore, Auth, Storage, Cloud Functions v2)**, delivered as web + Android TWA.

Companion docs: content comes from the *AI generation spec*, shaped by the *intake template*, exemplified by the *Grade 7 English reference*. This spec is how the app **renders and runs** that content.

---

## 1. Design system (shared)

- **Palette (CSS tokens):** lavender bg `#edeffd`, card `#fff`, ink `#2b2d51`, indigo `#5158d0/#7c8bf5`, coral CTA `#ff5c39/#ff9057`, yellow `#ffc542`, green `#2ec06a`, red `#ef5a5f`. **All surface colours are variables**; **Night mode** overrides them in one place (never hardcode a colour — that's why dark mode kept "missing" spots).
- **Type:** Nunito (700–900). **Radius** 16–24px. **Shadow** soft indigo.
- **Chrome:** glassy translucent top bar + bottom nav that **auto-hide on scroll down, reappear on scroll up**. Nav: Home · Papers · Notes · Games. The app is its own scroll container (`#app` scrolls, not the document) so it works inside the Android TWA/webview.
- **Mascot:** **Zed** (poses: wave, celebrate, think, oops, let's-go + a celebration video). Hosts daily quiz, tips, and celebration screens.
- **Motion:** short (≤300ms); celebration = confetti + Zed; badges pop over the win screen.

---

## 2. Screens & navigation

```
Home (grade·term chip, Continue card, Today's Quiz, Explore[Papers/Notes/Games], My Subjects[7])
├─ Subject (Term 1/2/3 switcher → topic list with ✓/▶/○)
│    └─ Note reader (Learn ⇄ Revise) → Topic quiz
├─ Papers → Paper viewer (full-screen) → Quiz setup (timed/relaxed) → Quiz → Results review
├─ Notes (revision hub: search + topic list, "download term") → Note reader (Revise)
└─ Games (Today's Quiz, Live Challenge, XP/Level bar, Achievements shelf, game cards)
     ├─ Game level path → mini-game → win (stars/XP) → rewards
     ├─ Daily quiz → result → weekly Grade leaderboard
     └─ Live challenge → matchmaking → VS → race → result (rematch)
```
Home shows **only** the current term; a child can switch to Term 1/3 to revise/read ahead. No curriculum label on the learner UI (Grade 7 isn't CBC yet). Grade is on the profile, so games/notes/papers are auto-filtered to the learner's grade — no grade browsing on the child UI.

---

## 3. Data model (Firestore)

```
subjects/{subjectId}                     # english, integrated-science, ...
grades/{grade}                           # from src/config/educationLevels.js (single source)
topics/{topicId}          {subject,grade,term,title,strand,syllabusRefs,examParts,order,status,noteId,quizId}
notes/{noteId}            {topicId,title,readMins,sources,blocks[]}          # block JSON (see gen spec §3)
quizzes/{quizId}          {topicId,examPart,questions[]}                     # topic-tagged MCQs
wordbank/{subject}/cards/{word}   {meaning,how,examples}                     # authored once, reused
papers/{paperId}          {grade,year,subject,title,pageImages[]|pdf,quizId?,minutes,status}
games/{gameId}            {subject,mechanic,gradeBands|grades,title,levels}  # mechanic: number-target|word-builder|meaning-match|punctuation|...
                                                                             # grade-AWARE (pulls its bank from learner grade) vs grade-specific
learners/{uid}            {grade,term,displayName,avatar,guardianState,createdBy}
learners/{uid}/progress/{topicId}   {done,score,updatedAt}
learners/{uid}/gameState/{gameId}   {levelsDone,best,updatedAt}
learners/{uid}/rewards    {xp,level,badges[],streak,lastActiveDay}
learners/{uid}/paperRuns/{paperId}  {saved,qIndex,score,answers,timed,timeLeft}   # resume
dailyQuiz/{grade}/{date}  {questions[]}                                      # SAME for everyone in grade
leaderboards/{grade}/weeks/{weekId}/entries/{uid}  {name,avatar,points}
matches/{matchId}         {players[2],questions[],state,scores,winner}        # live challenge (authoritative doc)
```

**Rules of thumb**
- Notes/quizzes are content (read-only to learners). Progress/rewards/paperRuns are per-learner, learner-writable under rules.
- **Scoring that ranks or awards is server-side** (Cloud Functions): daily-quiz points, leaderboard writes, live-match results, game XP (with daily cap). Never trust a client-sent score.
- Grade taxonomy derives from the existing `src/config/educationLevels.js` — no second registry.
- Watch the known **Firestore race condition** (stale-tab read-modify-write): use transactions/`increment` for counters (XP, streak, best), never read-modify-write.

---

## 4. Note reader engine

The core component. Input: a `notes/{id}` block array. Renders through **one reader, two modes**.

- **Block renderer:** a component per block type (`heading, para, tip, example, reveal, tryit, sectionCheck, keypoints, tapExplore, labelDiagram, topicQuiz`). `para` text is parsed for `**bold**` and `[[kw:word]]` → tappable keyword → **word-bubble sheet** from `wordbank`.
- **Learn mode (paced reveal):** show one section at a time; a **"Continue ▾"** button + progress dots reveal the next `heading`-delimited step; auto-scroll it into view. Reading-progress bar at top.
- **Revise mode:** all blocks shown; `tryit`/`sectionCheck`/`reveal` hidden; `keypoints` shown. Toggle at top of note; entry point decides default (Subjects→Learn, Notes tab→Revise).
- **sectionCheck remediation:** wrong answer expands an inline panel (Zed re-explains + 2 examples + a *different* retry); a recovered retry earns +XP and praise. Never a dead-end "wrong".
- **labelDiagram:** unlabelled image + absolutely-positioned drop zones (from `boxes` %); drag (pointer events) **or** tap-to-place; Check marks green/red.
- **tapExplore:** grid of items; tap opens a bottom sheet with image + role text.
- **TTS:** device `speechSynthesis` (en-GB) for "hear the word" / read-aloud (accessibility + the audio spelling game).
- **Completion:** "Mark topic done" → `progress/{topicId}.done=true`, +XP, updates subject term progress.

---

## 5. Quiz engine (shared)

One engine serves **daily, topic, past-paper, and game-quiz** modes. Renders one question per screen, **options vertical with A–D letter badges** (ECZ style), slide-up feedback with Zed, progress chip.

| Mode | Source | Scoring | Ends in |
|------|--------|---------|---------|
| daily | `dailyQuiz/{grade}/{today}` (same for all) | server-validated points → weekly board | result → leaderboard |
| topic | `quizzes/{topicId}` | practice (local) | celebration → note |
| paper | paper's `quizId` (up to 60 Q) | practice; **resume** saved to `paperRuns` | **results review** |
| challenge | match `questions[]` | server-validated | VS result / rematch |

- **Paper quiz** adds: a **timed/relaxed** chooser (timer = paper minutes), a countdown chip that turns red near 0 (auto-submit at 0), **progress chip** (e.g. 12/60), **resume** (X saves `{qIndex,score,answers,timed,timeLeft}` per paper; button flips to "Resume · 12/60"), and a **results review** listing each wrong answer (given vs correct) grouped into **topics to improve** with a Notes link. Requires each question `topic`-tagged.
- Feedback is instant and reasoned, never just a mark.

---

## 6. Games engine + rewards

- **Mechanics** (each a component, shared shell): `number-target` (Maths — combine tiles to a target; Grade-7 scale, ramps by level), `word-builder` (English spelling — tap letters; clue **and** "tap what you hear" audio modes), `meaning-match` (English — tap word↔meaning), `punctuation` (English — pick correctly punctuated sentence). Roadmap: `map-quest` (Social Studies), and turning **label-diagram** into a cross-topic "Label It!" game.
- **Difficulty is Grade-tied:** a game pulls its numbers/words from the grade's bank, and ramps with the level path (bigger numbers, tighter timer). Not babyish.
- **Level path:** node map (done ⭐ / current glowing / locked 🔒). Finishing a level → win (stars, XP) → advances path.
- **Rewards, NOT a leaderboard** (games): personal **best** per game, a **learner XP/Level** bar (games + quizzes feed it; **soft daily cap** — full XP for first ~2 plays/day, then ~20% — rewards consistency not grinding), **badges** (First Win, Combo Master, Number Ninja, Daily Player…) that pop over the celebration and live on an **Achievements shelf**. Extensions: unlockables (next game/theme/Zed sticker), streak tie-in.
- **Daily quiz DOES have a leaderboard** (fair: same quiz for everyone in the grade, weekly reset, per grade, own row pinned).

---

## 7. Live challenge

- **No communication** between learners (Play-Families): no chat, typing or voice — compete only. Avatars + first name/nickname only.
- **Matchmaking:** random opponent **within the grade** (default); friend-code for classmates (see & challenge friends only). No browsable "who's online" roster.
- **Flow:** find opponent → VS countdown → **same questions both players**, race with the opponent's **progress bar** (not their answers) → result (win/lose/draw, rematch). Loser still earns a little XP.
- **Fairness/tech:** invites expire ~60s, decline is silent, one pending + cooldown, block remembered. Match is a **single authoritative Firestore doc**; a Cloud Function validates answers and writes the winner (never client-trusted). **Async fallback:** if no opponent online, race the recording of a friend's last run ("ghost").
- Limited-mode learners (guardian unconfirmed) get random matchmaking only; friends/challenges unlock after guardian approval.

---

## 8. Paper viewer

- **Full-screen, edge-to-edge** pages on a dark canvas (max 430px column). Renders **PDF pages** (in-browser) or uploaded page images, scrolling.
- **Auto-hiding chrome:** top (back, title, live page counter) and bottom (**Save offline**, **Start/Resume Quiz**) slide away on scroll, return on tap/scroll-up.
- **Pinch-zoom + pan** via transform on the rendered page (fixes the current broken pinch/pan); double-tap to 2×.
- **Download → offline:** on Android, "Save offline" stores the paper for offline viewing (view offline on the learner side); **the download button is hidden on the PC website**.

---

## 9. Offline (Android TWA)

- **Learner side works fully offline:** home, subjects, opened notes, downloaded papers, games, daily-quiz-if-cached. Cache content docs + assets (service worker / local store); queue progress writes and flush on reconnect.
- **AI features stay online-only** (Ask Zed, generation). Teacher studios (if bundled) are view-only offline — no offline editing/write-queueing.
- Rewards/progress computed locally then **reconciled server-side** on reconnect (server is source of truth for ranked/awarded values).

---

## 10. Compliance & safety (Play Families)

- **Age gate + guardian email verification**; learners in **limited mode** until a guardian confirms (limited mode = random matchmaking only, no friends/challenges; core learning available).
- **No child-to-child communication** anywhere (enforced by design — challenge-only).
- **Ask Zed** child-safe: child-safe prompt, report/flag button, **deterministic distress detection before any AI call** surfacing **Childline Zambia 116**; false-positive tests so educational content isn't flagged.
- Guardian consent core is **fail-closed**, shared by React + Cloud Functions; hashed single-use consent tokens; Firestore TTL on consent/age-gate collections.
- Privacy: no learner PII on leaderboards (name/avatar only); target **API 36**; deletion page + purge functions.

---

## 11. Build order (suggested)

1. **Design system + shells** (tokens, Night mode, glassy auto-hide nav, `#app` scroll container, Zed assets).
2. **Data model + rules + educationLevels source** (topics/notes/quizzes/wordbank; learner progress/rewards; server scoring functions).
3. **Note reader engine** (block renderer, Learn/Revise, section-check remediation, word bubbles, TTS) — highest value; unblocks all content.
4. **Quiz engine** (A–D vertical; daily/topic/paper modes; results review + resume).
5. **Home + Subjects + Notes tab** wired to content.
6. **Paper viewer** (full-screen, pinch/pan, offline save).
7. **Games engine + rewards** (number-target first, then word-builder/meaning-match/punctuation; XP/badges/best; daily cap).
8. **Daily quiz + weekly leaderboard** (server-validated).
9. **Live challenge** (authoritative match doc, matchmaking, ghost fallback).
10. **Offline** (service worker, write queue, reconciliation).
11. **Compliance** threaded throughout; verify before Play submission.

**Cross-cutting rules:** every colour a token; every ranked/awarded score server-side; every counter via transaction/`increment`; content is grade-filtered by profile; nothing child-to-child; nothing auto-publishes.

---

*This completes the four deliverables: (1) Grade 7 English reference, (2) AI generation spec, (3) content intake template, (4) this build spec. Together they take a subject from raw syllabus → generated, reviewed content → an app that renders and runs it.*
