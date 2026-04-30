# Tests Studio

Coming soon. This folder is reserved for the Tests Studio implementation — five types of assessments — topic / weekly / monthly / mid-term / end-of-term.

## When you build it

Follow the structure used by `studios/lesson/` and `studios/syllabi/`:

- `tests.css` — studio-specific styles
- `tests.js` — studio-specific logic
- `README.md` — file map and design notes
- `assets/` (if needed)

## Wiring it up

The studio card on the Hub currently routes `data-go-view="tests"` to the Coming Soon view (defined in `shell/02-views-router.js`). When this studio is ready:

1. Create `<div id="view-tests" class="view">` markup in `index.html`
2. Add `'tests'` to the routing switch in `02-views-router.js` (around the `target =` ternary)
3. Trigger your render function: `if (name === 'tests') renderTests Studio();`
4. Remove the entry from the `COMING_SOON` dictionary
5. Update the studio card label from "SOON" to "0 SAVED" (or "FREE", or whatever fits)
6. Add `<link>` and `<script>` tags for the new files in `index.html`

## Design notes

| Type | Scope | Length |
|------|-------|--------|
| Topic test | One topic | 10-15 questions |
| Weekly test | One week's coverage | 15-20 questions |
| Monthly test | A month's topics | 25-30 questions |
| Mid-term test | Half a term | 40-50 questions, sectioned |
| End-of-term test | Whole term | 60-80 questions, full structure |

Format for end-of-term:
- Section A: Objectives (multiple choice, 1 mark each)
- Section B: Short answer (2-3 marks each)
- Section C: Structured / essay (8-15 marks each)
- Optional answer key (separate document)

Generation strategy: pull topics from the active syllabus + completed lesson plans (Library) + scheme of work coverage. Mix question types appropriately for the test scope.
