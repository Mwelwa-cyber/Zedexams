# Worksheets Studio

Coming soon. This folder is reserved for the Worksheets Studio implementation — practice activities for pupils, generated from lesson plans.

## When you build it

Follow the structure used by `studios/lesson/` and `studios/syllabi/`:

- `worksheets.css` — studio-specific styles
- `worksheets.js` — studio-specific logic
- `README.md` — file map and design notes
- `assets/` (if needed)

## Wiring it up

The studio card on the Hub currently routes `data-go-view="worksheets"` to the Coming Soon view (defined in `shell/02-views-router.js`). When this studio is ready:

1. Create `<div id="view-worksheets" class="view">` markup in `index.html`
2. Add `'worksheets'` to the routing switch in `02-views-router.js` (around the `target =` ternary)
3. Trigger your render function: `if (name === 'worksheets') renderWorksheets Studio();`
4. Remove the entry from the `COMING_SOON` dictionary
5. Update the studio card label from "SOON" to "0 SAVED" (or "FREE", or whatever fits)
6. Add `<link>` and `<script>` tags for the new files in `index.html`

## Design notes

Worksheet types to support:
- Fill in the blanks
- Multiple choice
- Short answer
- Matching
- Diagrams to label
- Word problems (Math)
- Reading comprehension

Should pull topic + grade level from the linked lesson plan, then generate age-appropriate exercises.
