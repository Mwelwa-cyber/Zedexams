# 01 — System Overview

> Snapshot as of 2026-07-17 — verify before acting. Audited commit `0cd4c49`.

## What ZedExams is

ZedExams (live at **zedexams.com**, Firebase project **`examsprepzambia`**) is a **Zambian curriculum-aligned learning platform supporting CBC, OBC/2013 curriculum structures and transitional grade configurations** (evidenced by `public/syllabi/curriculum-data.json` + `curriculum-data-2013.json`, `teacherTaxonomy.CURRICULUM_GRADE_STRUCTURES` cbc/previous, and the 2013 curriculum reference pages), for learners, teachers, admins and parents. It is:

- A **Vite + React 19 SPA** served from **Firebase Hosting** (`dist/`).
- Backed by **Firebase**: Auth, Firestore, Storage, Cloud Functions v2 (Node 22), App Check.
- Wrapped for Android via **Capacitor** (appId `com.zedexams.android`).
- AI-powered on **three provider surfaces**: Anthropic Claude (generators + quiz verify), OpenAI (Zed chat + short-answer marking + embeddings), and Gemini / Firebase AI Logic (client helpers + an image path). Image generation runs on OpenAI `gpt-image-1`.
- Monetised via **Lenco** (MTN/Airtel/Zamtel mobile money + cards, ZMW) on web and **Google Play Billing** on Android.

## Region topology (critical)

| Component | Region | Why |
|---|---|---|
| Firestore `(default)` database | **africa-south1** | Zambian latency. |
| Firestore-triggered functions (`onDocument*`, agent dispatcher, storage-cleanup) | **africa-south1** | Avoid cross-region Eventarc hop per event. |
| HTTP/callable functions (`onCall`, `onRequest`) | **us-central1** | No regional trigger; `firebase.json` rewrites point here. |

When adding a new Firestore trigger, pin `region: "africa-south1"`. See [`13-cloud-functions-register.md`](./13-cloud-functions-register.md).

## Platform architecture diagram

```mermaid
flowchart TB
    subgraph Clients
        WEB["Web SPA<br/>React 19 + Vite<br/>src/main.jsx, src/App.jsx"]
        AND["Android app<br/>Capacitor WebView<br/>com.zedexams.android"]
    end

    subgraph FirebaseHosting["Firebase Hosting (dist/)"]
        HOST["Static bundle + CSP/headers<br/>firebase.json"]
        REW["/api/* rewrites<br/>→ us-central1 functions"]
    end

    subgraph FirebaseCore["Firebase (project examsprepzambia)"]
        AUTH["Authentication<br/>email/pw + google.com"]
        FS["Firestore (default)<br/>africa-south1"]
        ST["Storage<br/>gs://examsprepzambia.firebasestorage.app"]
        APPCHECK["App Check<br/>reCAPTCHA Enterprise (web)<br/>Play Integrity (android)"]
        FCM["Cloud Messaging (web push)"]
        subgraph Functions["Cloud Functions v2 (Node 22)"]
            CALL["onCall / onRequest<br/>us-central1<br/>functions/index.js"]
            TRIG["onDocument* / onSchedule<br/>africa-south1<br/>agents, storageCleanup, crons"]
        end
    end

    subgraph AI["AI providers (server-side)"]
        ANTH["Anthropic Claude<br/>Sonnet 4.5 / Haiku 4.5"]
        OAI["OpenAI<br/>gpt-4o-mini, gpt-image-1, embeddings"]
        GEM["Gemini / Firebase AI Logic"]
    end

    subgraph External["External services"]
        LENCO["Lenco payments<br/>api.lenco.co (ZMW)"]
        PLAY["Google Play Billing<br/>Play Developer API"]
        META["Meta WhatsApp<br/>Bonga webhook"]
        MAIL["Email (nodemailer/SMTP)"]
        POSTHOG["PostHog analytics"]
        SENTRY["Sentry error monitoring"]
        FX["FX rate source"]
    end

    WEB -->|HTTPS| HOST
    AND -->|bundled assets| HOST
    WEB & AND -->|Firebase SDK / WebChannel| AUTH
    WEB & AND -->|Firestore SDK (rules-enforced)| FS
    WEB & AND -->|Storage SDK (rules-enforced)| ST
    WEB -->|App Check token| APPCHECK
    AND -->|Play Integrity token| APPCHECK
    WEB -->|SSE / callable| REW --> CALL
    WEB & AND -->|httpsCallable| CALL
    APPCHECK -.enforced by.-> CALL
    FS -->|triggers| TRIG
    CALL & TRIG --> FS
    CALL & TRIG --> ST
    CALL -->|Anthropic API| ANTH
    CALL -->|OpenAI API| OAI
    CALL -->|Gemini API| GEM
    WEB -->|client Gemini helpers| GEM
    CALL <-->|initiate + webhook| LENCO
    CALL -->|verify purchase| PLAY
    CALL <-->|inbound/outbound| META
    TRIG --> MAIL
    WEB & AND -->|events| POSTHOG
    WEB --> SENTRY
    TRIG --> FX
```

## Communication contracts (verified from `firebase.json` + CSP)

| Path / channel | Method | Auth | Main files | Payload |
|---|---|---|---|---|
| `/api/ai/chat` → `apiAiChat` | HTTPS SSE | Firebase ID token (+App Check) | `functions/index.js`, `src/features/zedChat/pages/ZedChatPage.jsx` | Zed chat stream (OpenAI). |
| `/api/teacher/lesson-plan/stream` → `apiGenerateLessonPlan` | HTTPS SSE | ID token + App Check | `functions/index.js`, `src/components/teacher/generate/LessonPlanStudio.jsx` | Lesson-plan stream (Anthropic). |
| `/api/teacher/worksheet/stream` → `apiGenerateWorksheet` | HTTPS SSE | ID token + App Check | `functions/index.js`, `WorksheetGenerator` | Worksheet stream. |
| `/api/tts` → `apiTextToSpeech` | HTTPS | ID token | `functions/tts.js` | Text-to-speech audio. |
| `/api/payments/lenco/webhook` → `lencoWebhook` | HTTPS POST | HMAC signature (Lenco) | `functions/lencoService.js`, `lencoWebhookProcessor.js` | Payment status callback. |
| `/api/whatsapp/webhook` → `apiWhatsAppWebhook` | HTTPS GET/POST | `X-Hub-Signature-256` HMAC | `functions/metaWhatsApp*.js`, `agents/runners/bonga.js` | WhatsApp handshake + messages. |
| `/api/teacher/download` → `apiLibraryDownload` | HTTPS | ID token | `functions/libraryDownload.js` | Document download stream. |
| `/api/track/visit` → `apiTrackVisit` | HTTPS | best-effort/consent | `functions/visitorTracking*.js` | First-party page-view. |
| `/api/image-proxy` → `apiImageProxy` | HTTPS | — | `functions/imageProxy*.js` | Image proxy (CORS bytes). |
| `httpsCallable(...)` | Firebase callable | ID token + App Check | `functions/index.js` | All non-SSE function calls. |
| Firestore/Storage SDK | WebChannel/HTTPS | Rules + App Check | `firestore.rules`, `storage.rules` | Direct client reads/writes. |

CSP `connect-src` (`firebase.json`) whitelists the external hosts the SPA may contact: `*.googleapis.com`, `*.firebaseio.com`, `*.firebasestorage.app`, `*.cloudfunctions.net`, `*.run.app`, `api.lenco.co`, `*.posthog.com`, `*.sentry.io`. This is the authoritative **browser-side network allowlist** — it governs connections the browser makes. It is **not** the full backend egress list: server-side Cloud Functions reach additional external services (Lenco, the Google Play Developer API, Anthropic/OpenAI/Gemini, SMTP, GitHub) that never appear in the browser CSP. Treat browser-side allowlist and server-side outbound integrations as separate registers.

## The "AI company" (internal agents)

Beyond direct user features, a fleet of internal agents runs the content pipeline and ops. The content line flows through the `agentJobs` Firestore collection (Aria → Cala → Reva → approval → Pubo). Ops/growth agents run on schedules (`functions/agents/cron.js`). **Bonga** (WhatsApp) and the payments-recovery agent **Till** are the only agents that touch users/money directly. Full roster: [`ORG.md`](../../ORG.md) and `src/config/agents.js`; see also [`09-ai-architecture.md`](./09-ai-architecture.md) and [`13-cloud-functions-register.md`](./13-cloud-functions-register.md).

## Where to go next

- Repository layout → [`02-repository-map.md`](./02-repository-map.md)
- Every route → [`03-route-register.md`](./03-route-register.md)
- Data model → [`11-firestore-data-model.md`](./11-firestore-data-model.md)
- Security posture → [`18-security-review.md`](./18-security-review.md) and [`23-risk-register.md`](./23-risk-register.md)
- What to centralise first → [`24-recommended-target-architecture.md`](./24-recommended-target-architecture.md)
