# Syllabi Studio (free tier)

Read-only PDF library of all official Zambian CDC syllabi. No subscription.

## Files

| File | Purpose |
|------|---------|
| `syllabi.css`            | Toggle, filter chips, syllabus cards, full-screen PDF viewer modal |
| `syllabi.js`             | `SYLLABI_CATALOG` (69 entries), filtering, `openPdfViewer`, no-download UX |
| `assets/pdfs/*.pdf`      | 4 sample syllabi for the demo |
| `assets/pdfs/index.json` | key → file path map |

## Catalog structure

```js
SYLLABI_CATALOG = {
  new: [{ k: 'new-sec-math', t: 'Mathematics', g: 'Forms 1-4', l: 'O-Level (Secondary)', s: 524288, e: false }, ...],
  old: [{ k: 'old-math-g5-7', t: 'Mathematics', g: 'Grades 1-7', l: 'Upper Primary G5-7', s: 524288, e: true }, ...]
}
```

- `k` — key (also the PDF filename without `.pdf`)
- `t` — title (subject name)
- `g` — grade range string
- `l` — level category (used for filter chips)
- `s` — file size in bytes
- `e` — embedded? (only true for the 4 demo PDFs in this preview)

## Wiring up the rest of the PDFs

Currently `SYLLABI_AVAILABLE` only contains the 4 demo keys. To enable all 69:

```js
// In syllabi.js, replace SYLLABI_AVAILABLE with:
const SYLLABI_AVAILABLE = new Set(SYLLABI_CATALOG.new.concat(SYLLABI_CATALOG.old).map(s => s.k));
```

Then upload all 69 PDFs to either `./assets/pdfs/` (local) or your Firebase Storage bucket (production), keyed by `{key}.pdf`.

For Firebase, change `PDF_BASE_URL` in `syllabi.js`:

```js
const PDF_BASE_URL = `https://firebasestorage.googleapis.com/v0/b/YOUR_BUCKET/o/syllabi`;
function getPdfUrl(key) { return `${PDF_BASE_URL}%2F${key}.pdf?alt=media`; }
```

## No-download protections

The viewer uses several UX nudges (not bulletproof — savvy users can always extract):

- iframe `#toolbar=0&navpanes=0` URL fragment hides Chrome's PDF toolbar
- `oncontextmenu="return false"` blocks right-click → Save As
- `sandbox="allow-same-origin allow-scripts"` prevents top-level navigation
- `@media print` hides the modal entirely
- "VIEW ONLY" badge in the title bar makes the policy explicit
