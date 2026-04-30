# ZedExams Lesson Plan Studio — Modular Source

Each studio lives in its own folder. Drop them into your teacher panel project as a unit.

## Folder structure

```
zedexams-studio/
├── index.html                   ← entry point
├── README.md                    ← this file
│
├── shell/                       ← shared by every studio
│   ├── shell.css                  Hub + Library + Coming Soon styles
│   ├── 01-helpers.js              $, esc, toast utilities
│   ├── 02-views-router.js         showView, navigation, logo loader
│   ├── 03-library.js              localStorage data layer
│   ├── 04-hub-render.js           Home Hub + Library page rendering
│   ├── 05-init.js                 boot — calls renderHub() + applyLogos()
│   └── assets/
│       ├── logo-sm.png            ZedExams round mark, 96×96
│       └── logo-lg.png            ZedExams round mark, 320×320 (unused — fox is on hero)
│
└── studios/
    ├── lesson/                  ← Lesson Plan Studio (LIVE)
    │   ├── lesson.css             Studio chrome + interior retheme
    │   ├── 01-ui-setup.js         tabs, mobile menu, format/style cards
    │   ├── 02-syllabus-new.js     2023 ZECF syllabus topics
    │   ├── 03-syllabus-old.js     2013 CDC syllabus topics
    │   ├── 04-syllabus-router.js  active-version router
    │   ├── 05-system-prompts.js   3 Claude system prompts
    │   ├── 06-generate.js         API call + generate handler
    │   ├── 07-renderers.js        Modern / Classic / Classic 2
    │   ├── 08-edit-mode.js        edit mode toggle, table tools
    │   ├── 09-symbols.js          math symbols modal
    │   ├── 10-export.js           PDF / HTML / .docx
    │   └── 11-diagrams.js         diagram catalog (~40) + modal
    │
    ├── syllabi/                 ← Syllabi Studio (FREE, LIVE)
    │   ├── syllabi.css            cards, toggle, PDF viewer modal
    │   ├── syllabi.js             catalog (69 entries) + viewer
    │   └── assets/pdfs/           4 sample PDFs + index.json
    │
    ├── schemes/                 ← Schemes of Work (Coming Soon)
    │   └── README.md              build notes
    ├── notes/                   ← Notes Studio (Coming Soon)
    │   └── README.md
    ├── worksheets/              ← Worksheets Studio (Coming Soon)
    │   └── README.md
    └── tests/                   ← Tests Studio (Coming Soon)
        └── README.md
```

## How to run locally

These files use relative paths and ES5 — no build step required. But because of `<iframe src="./...pdf">` and CORS rules around `file://` URLs, you need a static server, not file-open:

```bash
cd zedexams-studio
npx serve              # or: python -m http.server 8000
```

Open `http://localhost:3000` (or whichever port) and you're running.

## Load order (inside `index.html`)

The script tags are ordered by dependency. Don't shuffle without checking:

1. **shell/01-helpers.js** — defines `$`, `$$`, `esc`, `toast` (used everywhere below)
2. **shell/02-views-router.js** — defines `showView`, `applyLogos`, `VIEWS`
3. **shell/03-library.js** — defines `loadLib`, `saveToLibrary`
4. **shell/04-hub-render.js** — needs 03 (`saveToLibrary`)
5. **studios/lesson/* (01–11)** — independent of shell except for `$`, `esc`, `toast`
6. **studios/syllabi/syllabi.js** — needs 01 only
7. **shell/05-init.js** — last, calls `renderHub()` and `applyLogos()`

## Adding a new studio (Schemes / Notes / Worksheets / Tests)

When you build out the placeholder studios, follow this pattern:

1. Create `studios/{name}/{name}.css` and `studios/{name}/{name}.js`
2. Add the view markup to `index.html` (use `<div id="view-{name}" class="view">`)
3. Add `{name}` to the `VIEWS` array in `shell/02-views-router.js`
4. Update the `showView()` switch to route to your view
5. Add the studio card in `index.html` (currently routing to Coming Soon — change `data-go-view="schemes"` etc.)
6. Add a `<link>` and `<script>` for your new files in `index.html`

## Firebase migration checklist

When you're ready to deploy:

- **API key** — `studios/lesson/06-generate.js` calls Anthropic directly with `x-api-key`. Move that behind a Firebase Function. The browser must NEVER see the key.
- **Storage** — replace `localStorage` calls in `shell/03-library.js` with Firestore CRUD. The schema (id-keyed records, ISO timestamps) maps directly to Firestore.
- **PDFs** — in `studios/syllabi/syllabi.js` set `PDF_BASE_URL` to your Firebase Storage URL prefix, then upload all 69 syllabi there. The `SYLLABI_AVAILABLE` set should be expanded to include all 69 keys (or removed entirely if all are available in production).
- **Auth gate** — wrap `showView()` in an auth check. Syllabi remains free-tier; everything else requires sign-in.
