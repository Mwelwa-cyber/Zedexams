# ZedExams Teacher Tools — Strategy & Roadmap

**Prepared for:** Mwelwa Mahenga
**Date:** 18 April 2026
**Scope:** Adding an AI-powered teacher assistant suite (lesson plans, worksheets, flashcards, and related tools) to the existing zedexams.com platform, targeted at the Zambian CBC market.

---

## 1. What you already have, and why it's a strong launch pad

zedexams.com is a live, working exam-prep platform for Zambian students. Most of the heavy infrastructure is already in place: Firebase Auth, Firestore, Cloud Functions, Netlify hosting, a TipTap rich-text editor, PDF.js for parsing, KaTeX for maths, a full quiz system, a mobile-money service, and — critically — a dual AI layer already wired to both OpenAI (gpt-4o-mini) and Anthropic (Claude Sonnet 4.5). The `/functions/aiService.js` file is already set up to talk to Claude via the Messages API, and the `src/components/ai` folder already contains a floating assistant button and study-assistant component.

You are not starting from zero; you are extending a running product into a second, adjacent market. That fact reshapes the strategic calculation entirely — most of my advice below is about positioning, content, and go-to-market rather than tech, because the tech foundation is already sound.

## 2. The market opportunity

Zambia's Competence-Based Curriculum (CBC), rolled out via the 2013 Curriculum Framework, is administered by the Curriculum Development Centre (CDC) under the Ministry of Education and examined by the Examinations Council of Zambia (ECZ) across three national checkpoints: Grade 7 Composite, Grade 9 Junior Secondary Certificate, and Grade 12 School Certificate. Zambia has roughly 120,000 primary and 30,000 secondary teachers, concentrated most heavily in Lusaka, Copperbelt, Southern, and Central provinces. Government schools dominate by volume, but private, community, and church-run schools make up a faster-growing premium segment with real willingness to pay.

What teachers actually spend their evenings and Sundays on — and resent doing — is the paperwork around teaching: lesson plans (required by head teachers, reviewed regularly, often still written by hand in the Zambian CDC format with Specific Outcomes, Key Competencies, Values, Prerequisite Knowledge, Teaching/Learning Materials, Introduction/Development/Conclusion, Assessment, and Teacher Reflection); schemes of work for the week and term; worksheets, homework, tests, and end-of-term exam drafts; and teaching aids like flashcards and visual prompts.

Chalkie.ai validated this exact pain point in Kenya. Nothing equivalent exists for Zambia. The CDC's own sample lesson plans live as scattered PDFs on ministry sites. Teachers currently patch together resources from WhatsApp groups, Facebook teacher communities, Scribd, and the teacher's-guide sections of old textbooks. There is a clear first-mover opening for you.

## 3. The single biggest strategic decision — positioning

Before anything else, you need to decide: **is this a section of zedexams.com, a sub-brand (teach.zedexams.com), or a separate brand entirely?**

My recommendation is to launch it as a clearly-branded section of zedexams.com — something like "ZedExams Teacher Suite" or "ZedExams for Teachers" — living under the same domain and the same account system. The reasons: you inherit the SEO and brand trust already built; teachers can cross-sell student exam-prep subscriptions to their own pupils and parents (your highest-leverage distribution channel, and one Chalkie can't replicate because they only serve teachers); you run one codebase, one billing stack, one auth system; and you can always rebrand later once the teacher side has proven its own market.

The only scenario that justifies a separate brand today is if you plan to sell the teacher business independently to investors or acquirers, or if you're courting Ministry/donor partnerships that might be confused by the consumer exam-prep framing. Neither is likely to be your near-term situation.

## 4. Business model

The right monetisation for Zambia has to reckon with teacher economics. A primary-school teacher takes home roughly K3,500–K6,000 a month; a secondary teacher K5,000–K9,000. You cannot price the way Chalkie does in Nairobi, and you cannot expect monthly subscriptions to feel cheap. Three revenue streams in parallel:

The first is a **freemium tier for individual teachers**. Give a generous free allowance — for example 10 lesson plans, 5 worksheets, and 20 flashcards per month — that lets a real teacher feel the product over a full teaching week without hitting the wall. The paid plan should sit at around K69–K99/month or K599–K899/year (roughly US$3–5/month), unlocking unlimited generations, PDF and Word export, and grade 8–12 ECZ-aligned content.

The second is **school licences**. This is where the serious revenue lives. Flat-rate bulk pricing by teacher count — K5,000/year for up to 20 teachers, K15,000 for up to 60, custom pricing above that. Private schools in Lusaka, Kitwe, and Ndola will buy. Government schools require Ministry-level partnerships and a different sales cycle.

The third, reserved for Phase 3, is a **content marketplace** where teachers publish their own lesson plans and worksheets and you take a 20–30% cut. This takes real network effects to unlock but creates the long-term moat that a pure AI-generation tool cannot.

Avoid pay-per-use credits for the teacher product. Teachers are planning-oriented and want predictability. Credits work for one-off purchases (an exam pack, a revision bundle) but not for a tool someone opens five times a day.

## 5. Feature roadmap in four phases

**Phase 1 — MVP core, weeks 1 to 6.** The CBC Lesson Plan Generator in the proper Zambian format; a Worksheet Generator producing printable exercises with answer keys; a Flashcard Generator optimised for topic revision; exportable PDF and DOCX output; a teacher dashboard with a "My Library" of saved generations; and usage metering tied cleanly to the free/paid tier.

**Phase 2 — planner and assessment, weeks 7 to 14.** A scheme-of-work generator covering termly and weekly plans; a rubric generator aligned to CBC competencies and values; a quick-quiz generator (you already have the underlying quiz system — reuse it); a differentiation tool that re-works a generated artefact for a mixed-ability class or simplifies it for struggling readers; a homework pack generator; and a reflection-prompt helper for the "Teacher's Evaluation" section of the Zambian lesson plan.

**Phase 3 — community and content, weeks 15 to 24.** A shared content marketplace (free sharing first, then paid); teacher-to-teacher comments and ratings; a browsable CBC curriculum map (Grade → Subject → Term → Topic → Sub-topic); and an ECZ past-paper analyzer integrated with your existing paper-upload component.

**Phase 4 — school and student integration, quarter 2 onwards.** School admin dashboards, teacher team collaboration, parent communication templates, a student-facing companion that cross-links back to your exam-prep side, and a PWA/offline mode for teachers working in low-bandwidth areas.

## 6. Tech additions to your existing stack

You do not need to change stacks. Your current React + Vite + Firebase + Claude API + TipTap + Netlify choice is appropriate and correct for Zambia.

Specific additions you will want:

- A client-side **DOCX export** path using the `docx` npm package, and either `@react-pdf/renderer` or a Puppeteer call inside a Cloud Function for pixel-perfect PDF.
- A **versioned prompt-template system** — a `prompts/` directory with files like `lesson-plan.v1.md`, `worksheet.v2.md`, etc., with the active version ID stored alongside each generation in Firestore so you can A/B test prompts and reproduce outputs months later when a teacher asks "why did this change?"
- A **CBC knowledge base** — a curated JSON dataset of grade-by-subject-by-term topics, pulled from CDC syllabi, injected into every prompt as grounding context. This is the single most important quality lever you have; it is what stops Claude inventing Zambian-looking but wrong topic names.
- **Rate limiting** at the Cloud Functions layer using per-user Firestore counters that reset monthly. You almost certainly have the skeleton of this already in your subscription code.
- An **admin prompt playground** — an internal-only page where you can live-edit a prompt, run it against a fixed set of test cases, and diff the output against yesterday's version. Build this in Phase 1. It will save you weeks across the product's lifetime.

## 7. AI cost model

With Claude Sonnet 4.5 (your currently configured model), a typical Zambian CBC lesson plan runs about 2,000 input tokens and 3,000 output tokens, at roughly US$3/M input and $15/M output. That's about US$0.051 per lesson plan. A worksheet runs US$0.02–0.03. A flashcard set runs under a cent.

If a free user burns through 10 lesson plans, 5 worksheets, and 20 flashcard sets in a month, you're carrying roughly US$0.85 per free user in Claude cost. That's manageable if free-to-paid conversion is ≥4% at 30 days — keep the free-tier caps tight enough to pressure upgrades without strangling the demo experience.

The strongest cost lever is model routing: send flashcards, short explanations, and simple rewrites to **Claude Haiku 4.5** at roughly one-fifth the cost, and reserve Sonnet for full lesson plans, worksheets, and schemes of work. Your current `aiService.js` already has the abstraction in place to do this with a model-per-task config.

## 8. Go-to-market

Most Zambian edtech founders stumble on distribution, not product, so this deserves equal weight with everything above.

The dominant channel for Zambian teachers is **WhatsApp groups**. Before launch, you want three to five pilot teachers active in twenty to thirty groups, generating real lesson plans and posting them back in with a quiet "made with zedexams.com" footer on the PDF. Organic demand will follow inside a week. Facebook teacher communities — "Zambian Teachers", "CBC Zambia Teachers", "Lusaka Teachers Network" — are the secondary layer, each with 10,000+ members.

Teacher Training Colleges (Kitwe, Chipata, Mufulira, David Livingstone) are a high-leverage partnership: offer free school licences in exchange for student-teachers who promote the tool during their school placements. Private-school direct sales — a laptop, a 15-minute demo in the head-teacher's office — will close deals for you in Lusaka, Ndola, Kitwe, and Livingstone.

Content marketing matters: build a free library of human-reviewed sample CBC lesson plans at `zedexams.com/teachers/library`. It drives SEO, builds trust, and becomes the landing page for paid-search ads.

The long shot is a CDC or Ministry partnership. Do not chase it for revenue. Chase it for credibility. Start with a "for government teachers" free tier and invite CDC curriculum specialists to review and endorse the output.

## 9. Risks and mitigations

**AI hallucination on Zambian curriculum specifics.** Mitigate with the CBC knowledge base in section 6, and frame every output as a first draft that a teacher must review and edit. Never claim authority.

**Willingness to pay.** Validate with a pre-launch waitlist that captures intent and price-band preference. Sell annual upfront (K599–K899) rather than monthly — mobile-money billing churn on monthlies is painful across Airtel, MTN, and Zamtel networks.

**Mobile-money reliability.** Your `momoService.js` exists, but test Airtel Money, MTN MoMo, and Zamtel Kwacha payment flows independently. Each has different failure modes and different reconciliation windows.

**Internet availability.** Most teacher work happens at home in the evening on patchy mobile data. Build as a PWA early; cache recent generations offline.

**Curriculum change risk.** The Ministry occasionally updates the framework. Architect the prompt templates and CBC knowledge base so that a curriculum update is a data-file change, not a code deploy.

**Legal / compliance.** The Zambia Data Protection Act 2021 applies. Register the data-processing activity, publish a plain-English privacy policy, and build a "delete my account and data" flow before you take your first paid customer. PACRA registration as a limited company is non-negotiable before invoicing schools. ZRA tax registration — and VAT at 16% once you cross the threshold — follows.

## 10. Metrics to track from day one

Weekly active teachers. Lesson plans generated per active teacher per week. Free-to-paid conversion at 30 and 60 days (target ≥4%). Cost per generation broken out by tool. Free-tier exhaustion rate (if fewer than 30% of free users hit the cap, the tier is too generous; if over 70% do, it's too tight). Tool-to-export rate — if a teacher generates a lesson plan but never exports it to PDF or DOCX, the output wasn't good enough to use. NPS asked monthly via a single in-app prompt.

## 11. First 90 days — concrete sequence

**Weeks 1–2:** Finalise the Zambian CBC lesson-plan schema (I'll produce this in Step 3). Build v1 of the CBC knowledge base from CDC syllabi. Set up the prompt template system and the admin playground.

**Weeks 3–4:** Ship the Lesson Plan Generator MVP to 20 beta teachers recruited from 3–5 WhatsApp groups. Collect feedback daily. Iterate prompts every 48 hours.

**Weeks 5–6:** Add Worksheet and Flashcard generators. Open a public waitlist. Begin WhatsApp-group outreach at scale.

**Weeks 7–10:** Public launch. Freemium live. Start private-school direct sales in Lusaka. Begin Teacher Training College conversations.

**Weeks 11–13:** Iterate on the conversion funnel. Ship the first Phase 2 feature based on what beta teachers actually asked for in week 3–10, not what's on the roadmap in section 5.

---

## Summary of the key calls you need to make before Step 2

1. **Confirm the positioning** — section of zedexams.com (my recommendation), sub-brand, or separate brand.
2. **Confirm the pricing anchors** — K69–K99/month individual and K5,000/year school licence, or something different.
3. **Confirm the Phase 1 feature set** — Lesson Plan + Worksheet + Flashcard, or pick a narrower/wider slice.
4. **Decide who reviews AI output before teachers see polished samples** — you alone, or do you have a teacher collaborator?
5. **Decide your appetite for Ministry / CDC outreach** — active pursuit now, or after first 500 paying teachers.

Once you've reacted to this, I'll move to **Step 2 — Architecture and technical blueprint**: the exact Firestore schema, Cloud Function signatures, prompt-template structure, CBC knowledge-base format, rate-limit design, and export pipeline. Then Step 3 is the working MVP prototype.
