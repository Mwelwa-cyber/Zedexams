# Changelog

All notable changes to ZedExams. Curated by Ledger (release-notes agent)
on every push to `main`. Newest entries at the top.

## Unreleased

## 2026-09-01

### Changed

- Route guardian-funded expiry reminders to the guardian, not the child (#2614)

_Dependencies: 7 automated bumps (#2612, #2611, #2610, #2609, #2608, #2607, #2606)._

## 2026-08-30

### Changed

- Android: upgrade to AGP 9.0.1 + enable optimized resource shrinking (#2603)
- Past-paper archive: gate the hub list load on App Check readiness (#2601)
- Let unpaid learners read past papers; keep the mark scheme + quiz paid (#2600)
- Past-paper PDF preview: gate + retry the Storage read, not just the doc read (#2599)
- Past-paper viewer: don't call a failed read "Paper not found" (#2598)
- Wire the free-set continuation lock into the live past-paper results screen (#2597)
- Gate Auth calls on genuine App Check attestation, not just readiness (#2596)
- Fix generic sign-in failures from a deferred-App-Check race (#2595)

## 2026-08-25

_Dependencies: 3 automated bumps (#2591, #2590, #2589)._

## 2026-08-21

### Changed

- Guard against retired Anthropic model IDs (Haiku 3.5 retirement) (#2586)
- Ship native debug symbols to Play, so a crash trace has names in it (#2585)

## 2026-08-21 — Android closed testing (v1.4.0)

Features bundled into the Android closed-testing App Bundle since v1.3.1 —
32 pull requests. Short tester-facing blurb lives in
`distribution/whatsnew/whatsnew-en-US`. Per-PR detail for 2026-08-20 is in
the dated entry below; 2026-08-21's work is rolled up here because Ledger
has not dated it yet.

### Added

- **Spelling Ride** — a three-lane road game over the existing spelling
  bank (#2565), with the road restored on a second ride (#2573).
- **One connected spelling system** — ladder, coach, tricky words and admin
  (#2558) — now speaking with pre-generated ElevenLabs pronunciation drawn
  off the learner's quota (#2564), fetched before the word is due rather
  than at the moment it is asked for (#2570).
- **Fractions became a learning path, not a quiz** — pictures, stages,
  working and mastery (#2559).
- **The past-paper quiz runs on the paper's own clock** (#2571), with exam
  mode, practice coaching and an explanation pipeline behind it (#2566).
- **A Google Play rail for the parent checkout** (#2577), beside a parent
  portal that states what a child's plan actually is and makes paying
  legible (#2580).
- **A weekly, grade-scoped leaderboard**, replacing the global all-time
  board (#2560).

### Fixed — the Android build

The cluster a closed tester meets first, and the reason this release
matters more on the phone than on the web:

- **App Check enforcement signed users out on every cold load** (#2553) —
  the second cold-load sign-out fixed in two releases, and a different
  cause from v1.3.1's.
- The App Check placeholder spun the Capacitor bridge (#2572).
- `color-mix()` had no fallback, so the teacher dock and drawer never
  painted (#2574).
- Download opened a share sheet instead of saving to the phone (#2576).
- Pinch-to-zoom on past papers works on the Android build (#2563).
- `@capacitor/status-bar` removed, clearing the Play Android 15
  edge-to-edge warning (#2554).

### Fixed — navigation and roles

- A teacher signs in to the teacher dashboard and never renders a learner
  screen (#2579).
- The learner tab bar no longer sends a teacher to a page that refuses
  them (#2575).
- The last two doors into the learner portal are closed (#2578).

### Fixed — theme and legibility

- "Light" is an answer the operating system cannot overrule (#2581).
- Teachers have back the control over the palette that paints their site
  (#2569).
- Learner legibility, one navigation, and a quiz header nobody could read
  in Night (#2562).
- Frosted glass thick enough to read over (#2561).

### Fixed — content, games and auth

- Answer options are dealt fresh, and the intestine labels are unswapped
  (#2557).
- The capitals map game no longer gives away its own answer, and the
  doubled play-page chrome is gone (#2556).
- The Conjunctions demo sits beside a real note, and the notes hub's
  spacing is unglued (#2555).
- A password may not start or end with a space (#2550).
- Past-paper quiz: the cascade is restored, two facts corrected, and the
  reader reflowed for desktop (#2583).

### Internal

- The functions deploy has a budget it can finish in, and no longer loses
  its log (#2567).
- `googlePlayRtdn` is held back until its Pub/Sub topic exists (#2582).

## 2026-08-20

### Added

- Replace the global leaderboard with a weekly, grade-scoped board (#2560)
- One connected spelling system — ladder, coach, tricky words, admin (#2558)

### Fixed

- Deal answer options fresh, and unswap the intestine labels (#2557)
- Drop the Conjunctions demo beside a real note, unglue the hub's spacing (#2555)
- Stop App Check enforcement signing users out on every cold load (#2553)
- Refuse a password that starts or ends with a space (#2550)

### Changed

- Fractions: a learning path, not a quiz — pictures, stages, working, mastery (#2559)
- Fix capitals map game giving away the answer, and the doubled play-page chrome (#2556)
- Remove @capacitor/status-bar to clear the Play Android 15 edge-to-edge warning (#2554)

## 2026-08-20 — Android closed testing (v1.3.1)

Features bundled into the Android closed-testing App Bundle since v1.3.0.
Short tester-facing blurb lives in `distribution/whatsnew/whatsnew-en-US`.
Per-PR detail for 2026-08-12 → 2026-08-19 is in the dated entries below;
2026-08-20's work is rolled up here because it has not been dated yet.

### Added

- **The Daily Quiz replaces the daily-exam rotation.** Five questions per
  grade per day, the same five for everyone so the leaderboard compares like
  with like, marked one question at a time by the server with a reason. The
  pick is seeded, so the nightly cron and a lazy self-heal cannot disagree;
  a thin question bank degrades to a labelled practice set rather than to
  "no quiz today". (#2519, #2429, #2496, #2501, #2529)
- **Family portal.** A guardian and a learner are joined by one link record
  carrying its own consent, permissions and audit trail — approval is a
  disjunction and restriction a conjunction, so one adult can approve and
  another can restrict. Includes the parent notifications inbox, the learner
  family-code panel and the guardian payment path. (#2481, #2482, #2487,
  #2455, #2458, #2499)
- **New games, on a rebuilt hub**: Know Zambia (geography + heritage, five
  map modes), Race Zed (live head-to-head), Fraction Ladder, and spelling
  practice backed by an 879-word Grade 7 bank. (#2508, #2509, #2511, #2531,
  #2538, #2539, #2534, #2544, #2545, #2465, #2466)
- **A neutral age screen at sign-up** — three numeric fields, the age echoed
  back for confirmation before Continue enables, and a route for a child who
  does not know their birthday. (#2492)
- **Tiered gating replaces the launch paywall.** No gate interrupts work in
  progress, feedback on work already done is never charged for, and an
  under-18 learner is never shown a price. (#2411, #2486, #2528)

### Changed

- **The learner app was rebuilt to the redesign** — Home, Subject, Notes
  (Learn / Revise), Papers, Profile, Settings, Guardian Zone, the first-run
  setup wizard, the weekly leaderboard and Help & Support. Screens
  the redesign does not have were removed rather than left adrift.
  (#2409, #2414, #2416, #2418, #2431, #2432, #2434, #2440, #2451, #2462,
  #2463, #2470, #2471, #2520, #2540)
- **Grade 7 only, deliberately.** Grades 4–6 are authored everywhere else in
  the product but are not offered to learners until they have content. An
  existing learner in a paused grade sees a waitlist screen and keeps their
  stored grade rather than being silently relabelled. (#2502)
- Real dark mode: a light reading palette vetoes the dark workspace seed,
  and a dark one imposes nothing. (#2541, #2524, #2535, #2433, #2536)
- Passkey (WebAuthn) sign-in removed; Google and email/password sign-in are
  untouched. (#2468)

### Removed

- **Ask Zed, the learner chat assistant.** The floating pill mounted
  globally and hid itself with a blocklist of routes, so it appeared on any
  screen nobody had added to that list — including the ones a learner passes
  through straight after creating an account. The decision was to remove the
  assistant rather than extend the blocklist. Gone with it: `/ask-zed`, the
  note reader's "Stuck? Ask Zed about this" pill, the AI Learning Assistant
  settings section, the `aiChat` callable and the `apiAiChat` SSE endpoint.
  Testers who used it will notice it is absent — that is intended, not a
  regression. (#2543)

### Fixed

- **A working session is no longer deleted on cold load.** Firebase Auth
  cleared the persisted user whenever its boot check failed for a transient
  reason — a project-wide rate limit, a 5xx, a failed App Check attestation
  — which read to the learner as a spurious sign-out. The session is now
  kept unless the server actually says the credential is dead. (#2500,
  #2480, #2510, #2523, #2522)
- **Every Grade 7 game was locked.** `PlayGame` gates on the demo-game list,
  and every id in it was a Grade 1–4 game — grades the app is not open to. A
  Grade 7 learner without a subscription opened the hub to ten games and ten
  padlocks. Four are free now, one per subject: Number Path, Punctuation Pro,
  Body Systems & Energy, Know Zambia. Every test around this asked whether
  the lock worked, and the lock worked, so nothing could catch it;
  `test:learner-grade-games` now fails if an open grade has no free game.
  The games seed is Grade 7 only, 55 packs down to 11. (#2549)
- The guardian checkout read the payment poll result wrong, so every payment
  reported failure. (#2507)
- Storage uploads were down product-wide for five days after an
  account-deletion gate put an unconditional cross-service read on every
  Storage rule evaluation. (#2399)
- Cloud text-to-speech works, is priced, and is no longer paid for twice;
  the admin's chosen voice reaches learners. (#2490, #2494, #2505, #2527)
- Subject progress is measured rather than inferred, and a term stays
  correct through a school holiday. (#2546, #2520)
- A notifications read in flight can no longer resolve into the account that
  replaced it. (#2530)

### Performance

- Cloud Functions cold start cut by 69%, and the eager frontend payload
  trimmed. (#2404)
- AuthContext actions and value memoised; the Vitest job sharded three ways.
  (#2407, #2503)

### Security

- All 61 open CodeQL alerts resolved, then the 17 and the 8 that followed —
  each with the defect family behind it. (#2318, #2526, #2513)
- Self-targeted role and status changes refused on the server. (#2406, #2403)
- Every processed webhook delivery is ledgered, so a redelivery cannot be
  paid twice. (#2378)
- Account deletion: the child asks, the guardian decides, and nobody is
  trapped. (#2498)

## 2026-08-19

### Added

- Pick learner voices from /admin/voice, and route /api/tts by provider (#2505)
- A voice &amp; speech control room, and provider-aware TTS pricing (#2494)

### Fixed

- The guardian checkout read the poll result wrong, so every payment reported failure (#2507)
- Make cloud text-to-speech actually work, price it, and stop paying twice (#2490)

### Changed

- Learner redesign: Zambia's physical features, playable (PROMPT 7f-3) (#2511)
- Close the 8 open CodeQL alerts, mostly by asking the question differently (#2513)
- Games importer: separate Clear selection from permanent deletion (#2512)
- Stop the two auth recoveries spending each other's only reload (#2510)
- Learner redesign: five more map modes for Know Zambia (PROMPT 7f-2) (#2509)
- Learner redesign: Know Zambia, the geography and heritage game (PROMPT 7f) (#2508)
- Grade-scope the games catalogue, and show the gap instead of hiding it (#2502)
- Remove the daily quiz's countdown, and calm the two clocks that stay (#2501)
- Tell a blocked parent the truth about their own account (#2499)
- Restore the public-repo security posture, and record the history scan (#2506)
- Add the four maths prototypes: game, notation, fraction levels, level 1 (#2504)
- Account deletion: the child asks, the guardian decides, nobody is trapped (#2498)
- Remove the countdown from the solo games, and add the three spelling prototypes (#2495)
- Stop Firebase deleting a working session on every cold load (#2500)
- Rebuild the learner Games hub to the mockup, and grade-scope the daily quiz (#2496)
- Age screen: numeric fields, an age echo, and a route for a child who doesn't know (#2492)
- Guardian contact step: WhatsApp first, confirm before sending, hand the phone over (0c-3) (#2493)
- Learner settings: real routes, the new avatars, and billing off a child's screen (#2491)
- Parent app: the two /family gaps #2481 left, on top of it (#2482)
- Join parent and learner accounts through one link record (#2487)
- Parent app: fix the live /family surface, and treat a family code as a credential (#2481)
- Stop three specs failing for the first three hours of every day (#2489)
- Never show a price to an under-18 learner on /pricing (#2486)
- Fix the auth wedge that logged a valid session out on a cold load (#2480)

### Internal

- Shard the Vitest job 3 ways to undo the private-repo core cut (#2503)

## 2026-08-18

### Changed

- Learner side: give the Firestore layer a boundary, and de-duplicate the exam clock (#2474)
- Note reader: stop Revise emptying a section, and keep the diagram (#2473)
- Record the two private-repo consequences CLAUDE.md still misses (#2472)
- Notes Studio: preview reader notes through the learner's own renderer (#2471)
- Notes: one content source, two views (Learn / Revise) (#2470)
- Match the games hub to the learner mockup (#2469)
- Remove passkey (WebAuthn) sign-in feature (#2468)

### Internal

- Bump the observability group across 1 directory with 2 updates (#2447)

## 2026-08-17

### Fixed

- Bind the learner reading theme to the account (#2433)

### Changed

- Live challenge (PROMPT 9) slice B: the race UI on the real server model (#2466)
- Live challenge (PROMPT 9) slice A: the server foundation (#2465)
- Daily-challenge intro: the Zed-hosted screen before today's play (#2464)
- Sticker Collection: the prototype's full-page grid over the real awards (#2463)
- Help & Support to the prototype: searchable FAQ, Childline 116, rate-us (8f) (#2462)
- Learner system states: back-online toast + in-chrome error card (PROMPT 10b) (#2461)
- Retire the practise course map (/practise/:grade/:subjectId) (#2459)
- Parent app (PROMPT 8g), and the guardian payment path it needed (PAY-001) (#2458)
- CodeQL: exclude the docs/learner design-pack prototypes from scanning (#2460)
- Go Premium: the prototype's plan picker, minus its two false claims (#2456)
- Explore is one three-up row at every width (#2457)
- Parent app: the notifications inbox, and something real to put in it (#2455)
- Remove per-session Practise / Past papers actions from /timetable (#2454)
- Claude/learner prototype redesign c7j9d1 (#2453)
- Learner redesign: the weekly leaderboard, to prototype v23 (#2452)
- Learner notes: the Digestive System, at the mockup's depth (#2451)
- Learner terms: divide every subject's sub-topics across Term 1, 2 and 3 (#2450)
- Learner redesign: Home and subject fixes, per prototype v13 (#2449)
- Learner redesign: the first-run setup wizard, and a real Grade 7 term plan (#2440)
- Guardian Zone: a second control, and the pill that ignored the first one (#2439)
- Learner redesign: the seven Grade 7 subjects, their sub-topics, and the odd settings/notes doors (#2437)
- Learner redesign step 11: Home, Settings and the Guardian Zone, to prototype v7 (#2436)
- Learner redesign step 11: the v6 Settings screen, with every switch wired to something real (#2435)
- Learner redesign: make Home and Subject match the mockup — remove what the mockup does not have (#2434)
- Learner redesign step 10: Profile and Notifications, exactly as the v6 mockup puts them (#2432)
- Learner redesign steps 8+9: the Notes revision hub, only the mockup's content, and Ask Zed (#2431)
- Learner redesign step 7: Race Zed! — the honest duel (#2430)
- Learner redesign step 6: the daily quiz plays in the learner shell (#2429)
- Storage audit: fix a destructive orphan rule, compress scanned pages (#2428)
- Learner redesign step 5: remove Learn + Practice (#2427)
- Fix the Android build: a buildscript classpath cannot read variables.gradle (#2425)
- Learner redesign step 4e: retire the four legacy game mechanics (#2426)

### Internal

- Bump the misc-minor-and-patch group across 1 directory with 4 updates (#2448)
- Bump the editor group with 17 updates (#2446)
- Bump github/codeql-action from 3 to 4 (#2445)
- Bump globals in the linting group (#2444)
- Bump the testing group with 2 updates (#2443)
- Bump @google-cloud/text-to-speech in /functions (#2442)
- Bump the functions-minor-and-patch group (#2441)

## 2026-08-16

### Changed

- Learner redesign step 4a: games hub reskin + the Number Path engine (#2419)
- Fill the Phase 1 scaffold, and record the three areas the layering blocks (#2415)
- Pre-launch hardening: settings allowlist, role-claim fast path, DAU/retention rollup (#2417)
- Learner redesign step 3: the note reader engine (#2418)
- Put every loading state on one tempo, one easing, one accent (#2413)
- Replace the launch paywall with a tiered gating system (#2411)
- Admin shell: one nav registry, a link guard, and a real command palette (#2408)
- Learner redesign step 2b: Papers reskin (hub + viewer) to the prototype palette (#2416)
- Papers: PDF papers scroll like image papers (#2410)
- Memoise the AuthContext actions and value (#2407)
- Learner redesign step 2: exam timetable + Home chip + Papers-tab row (#2414)
- Refuse a self-targeted role or status change on the server (#2406)
- Learner redesign step 1: prototype-v3 tokens + shell (#2409)
- Give early-childhood work a folder, and let teachers re-file (#2405)
- Cut Cloud Functions cold start by 69% and trim the eager frontend payload (#2404)
- Close the self-role-change hole in the payments panel; let grant-superadmin run on ADC (#2403)

## 2026-08-15

### Changed

- Restore Storage uploads: take the deletion gate off isVerified() (#2258) (#2399)
- Make each deploy a distinct Sentry release (#2397)
- Resolve the Storage role check from the ID token, not a cross-service read (#2398)
- Phase 6 — cleanup: delete the dead legacy files and clear the hygiene list (#2396)
- Detect the wedged auth session when it happens, and report it (#2395)
- Recover the session when Firebase Auth never initialises (#2394)
- Migrate the remaining legacy surfaces: teacher/, theme/ (§13 inventory) (#2393)
- Move the three residual assessment modules into the feature (#2392)
- Guard the code side of Firestore TTL, and fix the ledger it found unreaped (#2391)
- Repoint three dead EXEMPT rows in the colour audit (#2390)

### Documentation

- Strike `scan` from the Wave 4 order — it was resolved 2026-08-13 (#2389)
- Inventory components/teacher/ before anyone starts it (#2388)

## 2026-08-14

### Changed

- Add the Assessment Engine ramp runbook (#2383)
- Close the last three security-audit items (§4.4, §4.5, §4.6) (#2384)
- Move the diagram library into src/curriculum/diagrams (#2382)
- Revert "chore: add Context7 MCP server for up-to-date library docs" (#2385)
- Promote the UI primitives to src/shared/components (step 3 of 3) (#2376)
- Correct two claims the quizEditor migration made stale (#2380)
- Ledger every processed webhook delivery, so a redelivery cannot be paid twice (#2378)
- Migrate the quiz editor into src/features/quizEditor/ (#2379)
- Close four Codex P2s on the surface-map guard (#2377)
- Repoint the colour-audit surface map, and guard it against the next move (#2375)
- Migrate the learner-facing quiz runtime into src/features/quiz/ (#2374)
- App Check on apiTextToSpeech, the priciest per-call surface (#2373)
- Decide the §10.0 `selected` divergence: retain it through reveal (#2372)
- Phase 5 batch 3: the 11 payment/webhook + audit-surface bodies move (#2371)
- Migrate the games surface into src/features/games/ (#2370)
- Move the banners and the Play Billing sync into features (#2369)
- Refuse an object-shaped option on the past-paper engine path (#2368)
- Split parentShares along the seam its own docblock described (#2366)
- Guard timed_quiz double selection with a synchronous ref, and pin the legacy path (#2367)
- Delete GenerateFromTopicMenu, and correct what described it as live (#2365)
- Phase 3: cut the timed_quiz game over to the Assessment Engine (#2364)
- Move subscriptions into src/features/subscription (#2363)
- Migrate the last three admin clusters (Wave 4 slices 4–6) (#2362)
- Give features/notes a front door, and retire a boundary debt entry (#2360)
- Move shared account settings into src/features/accountSettings (#2358)
- Stop the App Check reCAPTCHA timeout paging as a production error (#2359)
- Move learner search into src/features/learnerSearch (#2357)
- Move authentication into src/features/auth (#2353)
- Name App Check as the cause when Storage refuses an upload (#2352)
- A password reset must not depend on one mail host (#2351)
- Move the classic learner dashboard into src/features/learnerDashboard (#2349)
- Move the UI audit into src/features/uiAudit (#2348)

### Internal

- Add Context7 MCP server for up-to-date library docs (#2381)
- Migrate the teacher paywall surface into src/features (#2361)
- Promote CharacterAvatar to src/shared/components (#2356)
- Migrate the notification bell and centre into src/features (#2355)
- Promote the draft chrome to src/shared/components (#2354)
- Migrate the slide-lesson player, editor and library into src/features (#2350)

## 2026-08-13

### Security

- Keep id fallbacks unique when there is no Web Crypto (#2319)
- Resolve all 61 open CodeQL code-scanning alerts (#2318)

### Added

- Cut learner quizzes over to the Assessment Engine (Phase 3, flip 2) (#2329)

### Fixed

- Let a rollback reach an attempt already on the engine (#2340)
- Close three post-merge P2s on the quiz cutover (#2336)
- Stop reporting every refused image upload as "too large" (#2317)
- Clear all five Dependabot alerts, and say how to report the sixth (#2313)
- Clear all five Dependabot alerts, and say how to report the sixth (#2312)

### Changed

- Put the nav registries back under the dashboard link scan (#2343)
- Move the marketing site into src/features/marketing (#2342)
- Claude/papers migration v0u62a (#2341)
- Move the official exam timetable into src/features/examTimetable (#2337)
- Move Zed chat into src/features/zedChat (#2334)
- Move the parent portal into src/features/parentPortal (#2333)
- Move admin TOTP enrolment into src/features/adminMfa (#2327)
- Move the teacher app shell into src/features/teacherShell (Wave 4, PR B) (#2331)
- Move the App Check dashboard into src/features/adminAppCheck (#2326)
- TeacherShell PR A: move the both-ways modules to the bottom layer (#2325)
- Claim `teacherShell` in §13 before a file moves (#2324)
- Close the region hole, and give the integrity guard a parser it owns (#2314)
- Move the demo-trials panel into src/features/adminTrials (#2311)
- Gate (b) to zero: the module-local factory's arguments, and the v1 chain (#2310)
- Enforce the trunk guard over the window Ledger actually walks (#2308)

### Documentation

- Correct the generate/ consumer counts Codex flagged on #2321 (#2323)
- Record that `teacher/generate/` is not a Wave 4 feature (#2321)
- Record that `teacher/views/` is not a Wave 4 item (#2316)

### Internal

- Move StudioHeader to src/shared/components (owner ruling) (#2339)
- Promote the shared studio chrome out of components/teacher (Wave 4) (#2335)
- Migrate the past-paper archive into src/features/ (Wave 4) (#2330)
- Migrate the Assessment Paper Studio into src/features/ (Wave 4) (#2328)
- Promote studioFields to src/shared/components/ (#2322)
- Migrate the Lesson Plan Studio into src/features/ (Wave 4) (#2320)
- Move shellNavGuardCore to src/shared/utils/ (#2315)

## 2026-08-12

### Security

- Record detectedObjects deletion date in AUDIT_LOG entry 4 (#2109)

### Added

- Restore "crop the picture from the paper page" in the quiz editor (#2192)
- Move paper identity out of free text into structured source fields (#2191)
- Add Special Paper 2 as a past-papers subject (#2189)

### Fixed

- Compare the deployed Storage rules with the repository (#2276) (#2305)
- Make the trunk guard trunk-aware, and unable to hold a deploy hostage (#2303)
- Retry a stalled render gate on a fresh page (#2304)
- Scope the merge-commit guard to Ledger's own window (#2302)
- Clear the five actionable ESLint warnings (#2299)
- Walk --first-parent, and run daily instead of per push (#2294)
- Stop hiding the past-paper archive behind source labelling (#2195)
- Refuse to publish an unlabelled past paper from /admin/content (#2193)
- Confirmed merges never left the review queue (#2188)

### Changed

- Prove the trunk bound on a fixture, not on our own history (#2306)
- Bound the release-notes trunk assertion to the range it actually walks (#2301)
- Sign-in must not land a teacher on a learner route (#2300)
- Gate (b) factories: read the builder inside the factory, not the words "guarded elsewhere" (#2290)
- Integrity guard: count brackets in code, and catch the truncation it was missing (#2289)
- Move the admin shell into src/features/adminShell (#2286)
- Move the admin feedback inbox into src/features/adminFeedback (#2284)
- Move the image-pipeline admin into features/visualStudio, retiring a debt line (#2283)
- Move the Central Question Bank admin into src/features/adminQuestionBank (#2281)
- Move admin content operations into src/features/adminContent (#2280)
- Move admin observability into src/features/adminAnalytics (#2279)
- Move the admin learner records into src/features/adminLearners (#2278)
- Move the payments console into src/features/adminPayments (#2277)
- Move curriculum versioning into src/features/adminCurriculum, and record why (#2275)
- Stop coupling "Crop from paper" to client-side rules evaluation (#2273)
- Move the AI-cost dashboard into src/features/adminAiCosts (#2274)
- Move the Platform Control Center into src/features/adminSettings (#2266)
- Pin the visual gate's renderer, because its version is the baseline's identity (#2265)
- Re-inventory the class register, and correct what §13 predicted about it (#2262)
- Orphan query: a field-scoped miss must not read as "no orphans" (#2264)
- Gate (b) mechanical: the follower reads 77 more exports, and stops reading empty (#2263)
- Reconcile gate (b): 73 + 58 = 131, and stop quoting numbers that move (#2261)
- A deletion that failed after the point of no return signs the user out (#2260)
- One post-purge cleanup routine, so the recovery path finishes the job too (#2259)
- ⚠️ DEPLOYS FUNCTIONS + RULES — a deletion in flight closes the write surface (#2258)
- Tell "no errors found" apart from "the watch never ran" (#2245)
- The profile repair decides next to its write, not a network round trip earlier (#2244)
- The dashboard link guard stopped reading half the dashboard (#2250)
- DashboardV2: the shell stays, the page moves (#2247)
- Main is red: a retired export left its baseline row behind (#2246)
- Main is red: Sift's baseline entry outlived Sift (#2249)
- The cleanup backup holds erased users' emails at 0644, in the repo root (#2243)
- Retire Sift — one log stream does not need two watchers (#2230) (#2242)
- Ratchet the blind spot by NAME — a count cannot see a swap (#2239)
- Record which deletion design shipped, and rescue the cleanup script before #2229 closes (#2238)
- The Teacher Library moves, and the mock guard earns its keep again (#2241)
- Nothing was watching the server, so wire the watcher (#2230) (#2237)
- ⚠️ DEPLOYS FUNCTIONS — a failed deletion stops being finished by the sweeper (#2236)
- Watch Cloud Functions for errors, because Sentry cannot (#2235)
- Pause Batch 2: two gates, not one (#2232)
- Make cleanup-classes depend on no Firestore index (#2234)
- The memory-floor guard could not see a whole SDK generation (#2233)
- ApiTrackVisit was provisioned below its own startup cost (#2231)
- Delete the session before the data, and stop reporting success over a resurrected profile (#2228)
- Remove the learner/teacher class bridge entirely (#2227)
- The curriculum browsers move, and a third path ledger stops losing coverage (#2226)
- The Record of Work closes session A's pair (#2225)
- FLAKE-001 was reproducible after all — name it and close it (#2224)
- The Mark Schedule moves, and Wave 4 gets an ownership table (#2223)
- Phase 5 batch 1b: four account callables, and setUserRole alone (#2202)
- The bundle record names the edge, not whichever chunk currently carries it (#2222)
- The Class Timetable moves, and five modules go below the engine (#2220)
- School-Based Assessment moves, and the guard fires on the front door itself (#2219)
- Record the Vitest failure that was seen once and never again (#2217)
- The Weekly Forecast closes the pair, and shared/utils gets its first residents (#2218)
- Wait for the listener the keypress needs, not just the DOM (#2216)
- The Scheme of Work moves, and its exporters reach the engine (#2215)
- The Class List moves, and the icons go below both features that draw them (#2214)
- Record the v1 auth-trigger testability gap as Phase 5 debt (#2212)
- One source for what figure a question has and where it goes (#2211)
- Two guards that reported green for a question they were not asking (#2213)
- The review sweep finds 578 kB on every page load (#2210)
- Record the library-diagram rendering gap the IMAGE POSITION fix uncovered (#2209)
- The agents console moves, and the mock guard earns its keep (Phase 4) (#2208)
- Admin Users moves, and no util goes with it (#2207)
- Company HQ takes the two utils that were already its own (Phase 4) (#2205)
- IMAGE POSITION stops un-setting itself, and the preview honours it (#2204)
- Finish what #2201 started on the rubric front door (#2203)
- Five front doors stop describing the exporters as parked (#2201)
- The exporters reach the home §12 always gave them (#2200)
- Phase 5 batch 1a: the seven passkey bodies move — and the guard hole that move opened (#2199)
- The teacher shell's lazy load gets 1500 ms, and nothing else changes (#2198)
- The guard follows a delegation into the module that builds it (#2197)
- Phase 5 PR-zero: the contract before the first handler moves (#2194)
- Record which eight PRs merged unreviewed, and the order to sweep them (#2196)
- Fix dark-theme (Night / Midnight) contrast leaks across teacher + learner surfaces (#2190)
- Glass tiles, part 2: transparent studio icons and the All Teacher Tools card grid (#2186)
- Visual Studio v2 foundation: Diagram Library asset model + AI auto-labelling (#2187)
- Vendor the ian-xiaohei-illustrations Claude skill (#2185)
- The Question Bank was a page you could search but not insert from (#qb-in-studio) (#2184)
- Retire Rubric Studio; withdraw Worksheet Studio behind a flag (#2183)
- Notes Studio: the notes a teacher hands out, not the ones they read from (#2182)
- A shift session is a constraint, not a scheduling mistake (#tt-fidelity) (#2181)
- The Lesson Plan Studio still looked like the old design above the fold (#2180) (#2180)
- Four migrations had been leaving a dead vi.mock behind (#2179)
- Worksheet is the first migration the guard held, not a hand-diff (#2178)
- The marketing page was downloading a Word runtime to draw a card (#2177)
- The light pages are checked by a script, because a person got it wrong (#2176)
- The header collapse waits for the cursor, and Escape closes the drawer (#2175)
- One answer to "whose name is on this paper", shared by all three surfaces (#2174)
- Homework follows the rule the rubric migration established (#2173)
- The stamp guard v3: shorthand steps, key-anchored stamps, alias chains, both headers (#2168)
- The rubric view moves; its exporters would have cost 382 kB (#2172)
- Assessment Studio: a title that says which paper is open, and one row of controls (#2167)
- The Template Bank's service was already private to it (Phase 4) (#2170)
- Make the teacher sidebar collapsible on desktop and tablet (#2166)
- The banner and the page that writes it are one feature (#2169)
- Wire the Class Timetable Studio into its setup wizard and grid workspace (#2165)
- Template Bank previews the plan through the studio's own renderer (#2164)
- The stamp guard reads each build STEP, not the file around it (#2163)
- Stop() begins in the sign-out's own task; only the flush rides the chain (#2162)
- Android shells stamp their build too, and an unstamped bundle builder fails CI (#2161)
- Every recorder transition rides ONE chain, and a stale re-arm is withdrawn by token (#2160)
- Telemetry says which shell it came from (#2159)
- The replay re-arm serialises behind the stop's final flush (#2158)
- Engine stability and source finality are two signals, not one (#2157)
- Session Replay is one instance per page load: stop and re-arm, never recreate (#2156)
- A percentage decision is only stable when the allow-list rules a late uid out (#2155)
- The hold commits over a stale truth, and telemetry waits for a final one (#2154)
- The hold protects only what identity can overturn, and telemetry can count it (#2153)
- The watchdog window holds its visit, and the route's loader is walkable (#2152)
- The canary refuses what it cannot score, and waits for its own decision (#2151)
- The sweep's first page must not send an empty cursor, and its caps must not lie (#2150)
- The past-paper canary: the flag selects the choice card, and only the card (#2149)
- The sweep must not under-report, in any of the three ways it could (#2148)
- Reattach the hollow-artifact doc to the function it describes (#2147)
- The sweep §7a documents is now one that runs (#2146)
- A paper baseline is its pages, not the directory they sit in (#2145)
- Visual baselines: first recording (#2144)
- Arrival means the described file is there, not that a tree exists (#2143)
- An artifact must bring the baselines it describes (#2142)
- The recordings must arrive, and a lost one must say so (#2140)
- The gate compares the OS it renders on, not the kernel it was patched to (#2141)
- Fix theme choice reverting to dark on every reload (#2139)
- Screen baselines are recorded where LibreOffice never was (#2138)
- The auth watchdog must not latch a returning learner as anonymous (#2136)
- The decision is final when it says it is, and does not move under a learner (#2135)
- A dead settings read no longer preserves an enabled rollout (#2134)
- The staff-pilot allow-list is reachable from /admin (#2133)
- An unwritable storage no longer mints a new visitor on every call (#2132)
- The screen bootstrap writes the review sheet its workflow demands (#2131)
- Flag plumbing: the rollback ships before anything depends on it (#2130)
- Screen visual gate: the render stage, the CI wiring, and cold-start semantics (#2129)
- Make school notation reach the learner: stacking travels with the renderer (#2128)
- Screen visual gate: the fixtures and the baseline identity (#2127)
- Renderers: the §4 choice layout, and two coverage ratchets (#2126)
- Persist/ + marking: diffJournals has its second journal (#2125)
- Session contract: both owner decisions applied, and the suite is green (#2124)
- Add the session contract as a reviewable spec; its harness is not yet green (#2123)
- Add the replay journal differ, the attempt fixtures, and the old path's baseline (#2122)
- Correct four statements in the Phase 3 plan that building it disproved (#2121)
- Add the Assessment Engine contract and normaliser (#2120)
- Narrow the agentJobs create grant to admins, and test both directions (#2119)
- Correct §10 on referralCodes and games; require a fetch before cutting a branch (#2118)
- Lay daily-exam answer options out in one vertical column (D3) (#2117)
- Derive every displayed MCQ option letter from one helper (D4) (#2116)
- Derive the rules-coverage universe from firestore.rules, not a typed list (#2115)
- Extract the quiz result payload from QuizRunnerV2 into a pure function (#2114)
- Amend architecture.md for Phase 3: factual corrections + settled scope (#2113)
- Plan Phase 3: one Assessment Engine to replace the four runners (#2112)
- Migrate the Flashcard generator into src/features/flashcards as the reference migration (#2111)
- Scaffold src/app, src/engines, src/shared and src/curriculum, and make the layering lint-enforced (#2110)
- Close the Phase 0B migration baseline: regenerate the route register, make emulator coverage a test, record the DR answers (#2107)
- Record the 2026-08-05 console sitting: keys deleted, probes repelled, AI Logic starved, detect-objects uninstalled (#2106)
- Untrack the Chromium QA profile: its os_crypt key was committed, its cookie jar was not (#2105)
- Close the Phase 0A secret gate: the committed env file holds no secrets, and CI now checks (#2104)
- Add binding target architecture doc and CLAUDE.md pointer (#2103)
- Teacher Studios UI/UX consistency pass — shared StudioHeader, chips, wizards, and six studio overhauls (#2094)
- Extend the intelligent-glass treatment to mobile and the upper dashboard (#2095)
- Fix the Android splash launch order: stack above boot UI, hide on auth settle (#2093)
- Give the Teacher Workspace tiles the intelligent-glass treatment (#2092)

### Documentation

- Fix two sentences that now contradict the code and the table (#2296)
- Record the `register` migration outcome, and mark it merged (#2292)
- Claim `register` for this session and withdraw the two-PR … (#2291)

### Internal

- Add CodeQL, and make Ledger deterministic — zero automatic AI spend (#2297)
- Make the scan label-triggered (#2295)
- Retire Rex's per-PR action, scan security once per PR (#2293)

_Dependencies: 23 automated bumps (#2288, #2287, #2285, #2282, #2272, #2270, #2269, #2268, #2267, #2257, #2256, #2254, #2253, #2252, #2251, #2206, #2108, #2102, #2100, #2099, #2098, #2097, #2096)._

### Changed
- **Sign-up is now a sequence of screens, and the age question comes before
  every sign-up method.** It used to sit inside the email form while "Sign up
  with Google" sat above it, so a learner who tapped Google created an account
  with no declared age at all — and an age screen one button avoids is, for
  Play's Families policy, not an age screen. Both methods now live on a screen
  that comes after it, and the guard is a rule (`signupFlowCore.resolveStep`)
  rather than a conditional in a component, so a deep link, a refresh and the
  back button all hit the same check. A learner's first age answer is held for
  24 hours per device: backing out and returning shows it pre-filled and
  read-only.
- **Teachers and parents are no longer asked their date of birth.** It fed no
  feature and no compliance requirement. They confirm they are 18 or older with
  a checkbox, stored as `ageConfirmed18Plus: true` — a boolean, never a date.
  Firestore rules now refuse a `dob` on a teacher or parent document, so a
  stale client cannot reintroduce the field. **Existing teacher and parent
  documents are not migrated**: any `dob` already stored on one stays there
  until an account-data cleanup is run separately. Privacy Policy updated to
  say date of birth is collected from learners only.
- **The guardian hand-off moved to after account creation.** A learner under 18
  now gets an account immediately, usable in limited mode, and is then asked
  for a guardian's email — so nothing on that screen can cost them the account
  and skipping it leaves a working one behind. The consent plumbing (hashed
  single-use token, POST-only approve/decline, TTL, once-a-day resend) is
  unchanged; this is a new entry point into it.

### Fixed
- **Parent sign-up could never write its own user document.** The Firestore
  create rule's role allow-list was `['learner', 'teacher']` while the sign-up
  page has offered a Parent role since the parent portal shipped.
- **`isMinor` is now derived server-side.** A new `learnerAgeOnUserCreated`
  trigger (africa-south1, alongside the database) re-derives it from the
  declared date of birth using the shared consent core, so the flag the
  guardian gate reads is never the one the client wrote. Rules additionally
  refuse to create a learner document with no date of birth — without that, a
  crafted signup produced a learner whose consent status read as `unknown`,
  the permissive migration state, and therefore full capabilities.

## 2026-08-01 — Android closed testing (v1.3.0)

Shipped to the closed (alpha) track on 2026-08-01. No per-PR entry was
recorded at the time: Ledger was a silent no-op until it was fixed in
2026-08, so the 2026-07-08 → 2026-08-12 window has no dated entries to roll
up. Recorded here so the release line reads 1.2.8 → 1.3.0 → 1.3.1 rather
than skipping a version that testers actually received.

## 2026-07-08 — Android closed testing (v1.2.8)

Features bundled into the Android closed-testing App Bundle since v1.2.7.
Short tester-facing blurb lives in `distribution/whatsnew/whatsnew-en-US`.

### Added
- **Global learner search** across quizzes, notes, past papers, and games
  from a single search bar. (#1642)
- **Real offline reading for learner notes** — downloaded notes stay readable
  without a connection. (#1640)
- **Family portal**: parent↔child linking backend plus the parent portal UI
  and learner family-code panel. (#1634, #1635)
- **Real dark-mode toggle** and Midnight theme coverage across the learner
  app — notes reader + library, sticker surfaces, settings badges and
  toasts. (#1628, #1636, #1637, #1639)
- **Learner Settings redesigned** as a premium AI dashboard, with Settings
  surfaced directly in the account menu. (#1616, #1623)
- **Schemes of Work studio upgrade**: spec term shape, quality checklist,
  default revision weeks. (#1619)

### Fixed
- Spurious logout on reload and the blank-white auth loading screen. (#1617)
- Scanned quiz/paper import cutting off mid-upload. (#1614)
- Overlapping bottom bars in the assessment/exam-paper studio, and sideways
  scrolling on learner pages when the subscription banner shows. (#1638, #1641)
- Android edge-to-edge: bottom nav bar cleared on the learner dashboard. (#1612)
- `noteProgress` permission error on first note open. (#1622)
- Syllabus term division dumping the whole syllabus into Term 1. (#1626)
- Play Billing purchase-verification config failures are now diagnosed and
  alerted instead of failing silently. (#1627)

### Performance
- GradeHub memoization and capped unbounded teacher/admin list
  queries. (#1630, #1632, #1633)

## 2026-07-05 — Android closed testing (v1.2.5)

Features bundled into the Android closed-testing App Bundle. Short
tester-facing blurb lives in `distribution/whatsnew/whatsnew-en-US`.

### Added
- **Central Question Bank + Qix AI reviewer.** Every question a teacher
  creates or imports lands in the bank and is reviewed in the background by
  Qix — deterministic exact/near-text dedup plus embedding-based semantic
  duplicate detection, then an AI quality + grade-fit review. Clean passes
  flow into the shared Master Bank. (#1375, #1386)
- **Smart generation reuses the Master Bank first.** Quiz, assessment, and
  exam-paper generation now source vetted questions from the Master Bank
  before calling the model, and auto-capture newly generated questions back
  into the bank. (#1377, #1379, #1382, #1383, #1384, #1388)
- **AI Lesson Plan Studio.** Generate, then manually or AI-edit plans, save
  them to the teacher library, reuse them as templates via the Template Bank,
  preview output formats, and ground plans on the teacher's own past plans.
  Auto-fills teacher name and school. (#1369, #1370, #1374, #1385)
- **Redesigned teacher dashboard** as an intelligent AI workspace. (#1394)
- **Admin question import** into the Question Bank, with one-click
  "Import existing questions" and "Approve all into the Master Bank", plus
  backfill tooling that regrades existing quiz + exam questions by syllabus.
  (#1389, #1395, #1400, #1402)
- **Test Paper Import improvements**: rebuild a scanned table as an editable
  typed table, keep and render every detected figure on multi-figure
  questions, and per-item status chips (Ready / Needs review / Failed) with a
  confidence score. (#1372, #1390, #1393)
- **Play Store release notes** wired into the closed-testing AAB workflow via
  `distribution/whatsnew/`.

### Fixed
- Re-grade imported quiz and exam-paper questions to their true grade, fixing
  mixed-grade imports. (#1404, #1408)
- Numerous Lesson Plan Studio fixes: curriculum coverage, mobile layout,
  downloads/print, class picker (ECE Nursery & Reception), and empty-output
  schema alignment. (#1373, #1378, #1401, #1403, #1405, #1406)
- Bound diagram image-generation network calls so a hung provider can't hang
  the function. (#1387)
- Scanned-paper diagram cleaning hardened against CORS canvas taint, with a
  same-origin image-proxy fallback. (#1376, #1380)

## 2026-06-13

### Added
- Admin interface now shows actionable agent alignment status and controls. (#583)

### Fixed
- Cala agent alignment system now properly tracks and enforces behavioral constraints. (#583)

## 2026-05-24

### Added
- Admin interface for managing AI agents with actionable controls. (#583)

### Fixed
- CALA-CBC alignment issues to ensure proper integration. (#583)

### Added
- AI agents Phase 5: completes the operating model.
  - Admin pause toggle on `/admin/agents/:agentId` flips
    `agentControl/{agentId}.paused`. Dispatcher already honors this;
    no Firestore-console writes needed.
  - Weekly Cala audit (`weeklyCbcAlignmentAudit`, Sunday 03:00
    Africa/Lusaka). Samples up to 20 recent `aiGenerations` and
    re-runs Cala on each. Summary `agentJobs` doc lands in
    `awaiting_approval` if drift is detected, otherwise `done`.
- AI agents Phase 4b: Aria now drives all six teacher tools (lesson
  plan, worksheet, flashcards, rubric, scheme of work, lesson notes).
  Refactored each generator to expose a `run*` helper alongside the
  existing HTTPS callable factory; the dispatcher invokes those helpers
  directly. Teacher brief form expanded to all six artifacts.
- AI agents Phase 4: teacher-facing brief form. Teachers can submit a
  CBC lesson plan or worksheet brief at `/teacher/agents/new`; the
  job runs Aria → Cala → Reva and lands in `awaiting_approval` for
  admin review. A live status page (`/teacher/agents/:jobId`) shows
  pipeline phase, output from each agent, and the final published
  artifact. `agentJobs` create rule tightened to teachers and admins.
- AI agents Phase 3: nightly Quill QA smoke (Cloud Function cron,
  Africa/Lusaka 02:00) walks Firestore for stuck jobs, recent
  failures, and KB freshness — writes a summary `agentJobs` doc.
  GitHub Actions: Rex reviews every PR (open/sync) and posts a single
  comment; Ledger drafts a CHANGELOG PR on every push to `main`.
- AI agents Phase 2: Cloud Function dispatcher wires the Content
  pipeline end-to-end. Aria → Cala → Reva run on `agentJobs` create
  (Aria currently supports `lesson_plan` and `worksheet`); after Reva
  the job sits in `awaiting_approval`. Admin clicks Approve in
  `/admin/agents`; Pubo flips the reserved `aiGenerations` doc from
  private to public. Per-agent circuit breaker via
  `agentControl/{agentId}.paused`.
- AI agent operating model (Phase 1 skeleton): `ORG.md`, runbook in
  `docs/AGENTS.md`, seven Claude Code subagent definitions in
  `.claude/agents/`, `/admin/agents` dashboard, `agentJobs` Firestore
  collection with rules + composite index.
