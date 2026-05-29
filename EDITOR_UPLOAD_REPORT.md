# Uploaded Quiz Editor — Feasibility Report

> **⚠️ STATUS — re-verified 2026-05-29:** This was a one-time feasibility report (≈2026-04-19) on a 14-file editor upload. **Both blocking problems are fixed and the report is now historical:**
>
> - §2 `QuizPreview.jsx` double-`export default` — fixed; `AnswerOptions` is its own file (`src/editor/components/AnswerOptions.jsx`).
> - §3 `sanitize.js` dropping `sanitizeQuizRichHTML` — never regressed; the export is present in `src/editor/utils/sanitize.js`.
> - §1 the two "missing" files (`QuizEditor.jsx`, `QuizViewer.jsx`) were added — then removed again on 2026-05-29 as unused dead code (see [BUG_REPORT.md](BUG_REPORT.md) P3-1; recoverable from git).
> - §4c the MathModal / EditorToolbar "polish loss" was undone by a 2026-04-22 rewrite (categorized math modal + icon toolbar).
>
> **The only thread still open is §5's structural rewrite** — it was never started. The `QuizEditor.jsx` / `QuizViewer.jsx` scaffolding has been deleted as unused, quiz surfaces still render via `RichContent`, and storage is still HTML strings, not Tiptap JSON. The "will these 14 files build?" framing is moot. Don't action §1–§4 or the A/B/C options below; if the Tiptap switch is revived, recover the scaffolding from git and scope it fresh.

**Question asked:** will these 14 files run without breaking anything?
**Short answer:** **No — not as-is.** Two files have real problems that will break the build or crash the app. The other twelve are upgraded versions of files you already have and will drop in cleanly once the two are fixed.

There's also a bigger structural question behind the upload that's not about "will it compile" — **swapping to this editor means rewiring CreateQuizV2 / EditQuizV2 / QuizSectionsEditor and changing the shape of data you store in Firestore.** Details at the end.

---

## 1. What you already have vs what's uploaded

This is the most important fact: your project already has a `src/editor/` tree with almost the same file layout as the upload. That infrastructure has been there for a while; it was never fully wired into the main quiz creation flow.

| Path | Status |
|---|---|
| `src/editor/editor.css` | exists — upload replaces (+473 bytes, mostly comments) |
| `src/editor/extensions/buildExtensions.js` | exists — upload replaces (+1 KB, slight reorg) |
| `src/editor/extensions/MathInline.js` | exists — upload replaces (+3.6 KB, significantly richer comments + keyboard shortcuts for Backspace/Delete around math atoms) |
| `src/editor/utils/migration.js` | exists — upload replaces (+5 KB, much more legacy-format handling) |
| `src/editor/utils/safeRender.js` | exists — upload replaces (+1.9 KB, adds `hydrateKatex`) |
| `src/editor/utils/sanitize.js` | exists — **upload is SMALLER and missing an export** (see §3) |
| `src/editor/components/RichEditor.jsx` | exists — upload replaces (+4.4 KB, better multi-editor lifecycle handling) |
| `src/editor/components/EditorToolbar.jsx` | exists — upload replaces (+1.2 KB, contextual table strip) |
| `src/editor/components/QuizPreview.jsx` | exists — **upload has a SYNTAX ERROR** (see §2) |
| `src/editor/components/AnswerOptions.jsx` | exists — **not in upload** (needed by QuizEditor.jsx) |
| `src/editor/components/modals/MathModal.jsx` | exists — upload replaces (+700 bytes, click-to-edit via `editState.pos`) |
| `src/editor/components/modals/TableModal.jsx` | exists — upload replaces (basically identical) |
| `src/editor/QuizEditor.jsx` | **missing** — upload provides it |
| `src/editor/QuizViewer.jsx` | **missing** — upload provides it |
| `src/editor/RichContent.jsx` | exists — not in upload; currently used by `QuizRunnerV2` |

---

## 2. The first real problem: QuizPreview.jsx has a syntax error

The uploaded `QuizPreview.jsx` is actually **two components stuffed into one file** with two `export default` declarations. That's a parse error — ES modules allow only one default export per file. Vite/Rollup will refuse to build.

```jsx
// line 9 — first default export
export default function AnswerOptions({ options, correct, ... }) { ... }

// line 180 — second default export (INVALID — module-level parse error)
export default QuizPreview
```

The author clearly meant the top half (`AnswerOptions`) to live in `AnswerOptions.jsx` (which is why `QuizEditor.jsx` imports `./components/AnswerOptions.jsx`) but pasted both into one file.

**Verdict:** does not build as-is.

---

## 3. The second real problem: sanitize.js would regress active code

Your current `src/editor/utils/sanitize.js` exports three functions:
- `sanitizeHTML` — for the Tiptap editor
- `sanitizePastedHTML` — for paste events
- **`sanitizeQuizRichHTML`** — for the legacy `QuizRichText` component that's still in active use

The uploaded `sanitize.js` is 1.3 KB smaller because it **drops `sanitizeQuizRichHTML`**. That function is imported by `src/utils/quizRichText.js`, which is imported by:
- `components/quiz/QuizRichText.jsx` (the actual quiz editor used by teachers today)
- `components/quiz/QuizResultsV2.jsx`
- `components/quiz/QuizRunnerV2.jsx`
- `components/quiz/QuizSectionsEditor.jsx`
- `components/quiz/QuizEditorPreviewPanel.jsx`

Overwriting with the upload means every quiz rendering path crashes at module load with `sanitizeQuizRichHTML is not exported`.

**Verdict:** does not crash the build, but crashes the app at runtime on any quiz page.

---

## 4. Non-breaking but worth flagging

### 4a. editor.css defines its own design system

The CSS ships its own palette (`--vi`, `--sl1–6`, violet/teal/lilac), its own font stack (`Plus Jakarta Sans`, `Lora`), its own shadows and radii — all completely unrelated to the Phase 0 design tokens I put in `src/index.css`. It won't *break* anything (the CSS variables don't collide), but if you wire QuizEditor into admin/teacher flows it will look like a separate app pasted into your site. Shadows won't match, typography won't match, the hover/focus rings won't match, the dark-mode (midnight theme) behaviour won't apply. This is cosmetic, fixable, but worth knowing upfront.

### 4b. Dependencies are all already installed

All 15 Tiptap packages the INTEGRATION.md asks you to install are already in your `package.json` at `@tiptap/*` v3.22.3, plus `katex` and `dompurify`. **Nothing to `npm install`.**

### 4c. MS-Word-style editor polish would be lost

The quiz editor currently in use (`components/quiz/QuizRichText.jsx`) is what we just modernized — categorized math modal with 77 symbols in 5 tabs, 59 templates in 6 tabs, Recent-symbols tracking in localStorage, MS-Word grid, click-to-edit math nodes, floating table toolbar, Lucide toolbar icons, shadow-elev tokens. None of that is in the upload.

The uploaded `MathModal.jsx` has 24 symbols and 12 templates in flat lists. The uploaded `EditorToolbar.jsx` uses typographic characters (`↩ ↪ B I U`, `⬅≡`, `🖌`) instead of icons. Swapping down to these loses the last two sessions of polish work.

---

## 5. The bigger structural question (not about these files)

Even if you fix QuizPreview.jsx and preserve `sanitizeQuizRichHTML` in sanitize.js, **the upload is only 30% of the work**. The other 70% is rewiring the quiz creation / editing flow — and that work isn't in the upload.

Your current quiz system stores rich text as **HTML strings** in Firestore. The new QuizEditor produces **Tiptap JSON objects**. The migration utility handles the *read* direction (old HTML renders correctly in the new editor), but:

- Every time a teacher opens an old question and saves, it converts to Tiptap JSON and writes back. Over time, your Firestore collection ends up with mixed-format documents.
- `QuizResultsV2`, `QuizSectionsEditor`, `QuizEditorPreviewPanel`, `documentQuizImporter` all need to be audited for whether they can read both formats.
- `QuizRunnerV2` already reads both (via `RichContent.jsx`'s `parseTiptapValue`), so that's OK.

**Biggest ask:** `CreateQuizV2.jsx` (978 lines) and `EditQuizV2.jsx` (755 lines) hold the entire quiz-creation flow — grade/subject/term metadata, passage sections, quiz-wide settings, AI generation, document import, publish/approve flow. To use `QuizEditor`, you'd either rewrite both files to embed it per question, or accept that the new `QuizEditor` operates as a drop-in for just the per-question rich-text fields and everything else stays the same. The INTEGRATION.md assumes the first path; in practice the second is far smaller.

**Passage sections** are a specific mismatch. Your current `QuizSectionsEditor` lets a teacher write one passage and link multiple questions to it. The new `QuizEditor` treats each question as standalone with its own `passage` field. Migrating sectioned quizzes loses the grouping unless you preserve the section structure at the parent level and only swap the rich-text fields.

---

## 6. What I recommend

Three options, pick one:

**A. Minimal — take only the upgrades, don't switch to Tiptap-based editor yet.**
Keep the currently-shipped `QuizRichText` (the one we just modernized with the MS-Word grid). Copy the 10 upgraded files from the upload into `src/editor/` (they won't break anything because today only `QuizRunnerV2` uses that tree, via `RichContent`). Skip `QuizPreview.jsx` (syntax error), skip `sanitize.js` (regression), skip `QuizEditor.jsx` and `QuizViewer.jsx` (nothing uses them, and hooking them up is the big rewrite). **Effort: 20 min. Risk: near-zero. Visible change: none.**

**B. Fix-the-two-problems and land the upload.**
Fix the syntax error in `QuizPreview.jsx` (split the `AnswerOptions` half out — or just overwrite only the bottom half). Merge `sanitizeQuizRichHTML` back into the uploaded `sanitize.js`. Ship all 12 upgraded files plus `QuizEditor.jsx` + `QuizViewer.jsx`. Don't wire them anywhere yet — they sit alongside the current flow. **Effort: ~1 hr. Risk: low. Visible change: none unless you add a route to QuizEditor.**

**C. Full switch.**
Do B, then rewrite `CreateQuizV2` / `EditQuizV2` / `QuizSectionsEditor` to use `QuizEditor` per question. Update `QuizResultsV2` and `QuizEditorPreviewPanel` to render Tiptap JSON via `QuizViewer` or `RichContent`. Decide the fate of passage sections. Decide whether the uploaded editor.css cascades globally (fast but visually inconsistent) or gets rewritten to use your theme tokens (slower but matches the rest of the app). Adopt the data-shape migration path from INTEGRATION.md §6. **Effort: 1–2 full sessions. Risk: medium — lots of surface area. Reward: a proper Tiptap editor with undo/redo, real paste sanitization, proper atom nodes for math.**

---

## 7. The bottom line

- **Will it break anything?** Yes, two files as-uploaded will (§2 syntax error, §3 regression).
- **Is the rest safe to take?** Yes — the other 10 editor sub-files are improvements over what you have, with zero runtime wiring changes as long as you don't also swap CreateQuizV2/EditQuizV2.
- **Is switching to `QuizEditor` a good idea?** Technically — yes, Tiptap is a better foundation than the custom contentEditable we have now. Pragmatically — it's a meaningful rewrite of the quiz authoring flow, not a drop-in swap, and you just spent a session polishing the current editor with an MS-Word-style symbol modal and click-to-edit math. Decide based on whether you want to keep iterating on the current editor or commit to Tiptap.

Tell me which option (A / B / C) you want and I'll execute.
