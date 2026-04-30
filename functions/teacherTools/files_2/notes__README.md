# Notes Studio

Coming soon. This folder is reserved for the Notes Studio implementation — teacher delivery notes built FROM lesson plans.

## When you build it

Follow the structure used by `studios/lesson/` and `studios/syllabi/`:

- `notes.css` — studio-specific styles
- `notes.js` — studio-specific logic
- `README.md` — file map and design notes
- `assets/` (if needed)

## Wiring it up

The studio card on the Hub currently routes `data-go-view="notes"` to the Coming Soon view (defined in `shell/02-views-router.js`). When this studio is ready:

1. Create `<div id="view-notes" class="view">` markup in `index.html`
2. Add `'notes'` to the routing switch in `02-views-router.js` (around the `target =` ternary)
3. Trigger your render function: `if (name === 'notes') renderNotes Studio();`
4. Remove the entry from the `COMING_SOON` dictionary
5. Update the studio card label from "SOON" to "0 SAVED" (or "FREE", or whatever fits)
6. Add `<link>` and `<script>` tags for the new files in `index.html`

## Design notes

**Depends on Lesson Plans.** The intended flow:

1. Teacher generates a lesson plan (saved to library)
2. From that plan's actions menu, "Generate Notes" passes the plan data to the Notes Studio
3. Notes Studio uses the plan as context for the system prompt — generates teacher-facing delivery notes (not student handouts):
   - Topic introduction and "why it matters" hook
   - Key concepts in plain teacher voice
   - Worked examples step-by-step
   - Common student questions + best answers
   - Misconceptions to watch for
   - Discussion prompts and quick verbal checks
   - Glossary of key terms

Storage: extend `loadLib()` to read/write a `notes` collection. The notes schema should include `lessonPlanId` to link back.
