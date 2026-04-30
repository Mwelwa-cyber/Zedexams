# Schemes of Work

Coming soon. This folder is reserved for the Schemes of Work implementation — highest-level planning — covers a full term (~13 weeks).

## When you build it

Follow the structure used by `studios/lesson/` and `studios/syllabi/`:

- `schemes.css` — studio-specific styles
- `schemes.js` — studio-specific logic
- `README.md` — file map and design notes
- `assets/` (if needed)

## Wiring it up

The studio card on the Hub currently routes `data-go-view="schemes"` to the Coming Soon view (defined in `shell/02-views-router.js`). When this studio is ready:

1. Create `<div id="view-schemes" class="view">` markup in `index.html`
2. Add `'schemes'` to the routing switch in `02-views-router.js` (around the `target =` ternary)
3. Trigger your render function: `if (name === 'schemes') renderSchemes of Work();`
4. Remove the entry from the `COMING_SOON` dictionary
5. Update the studio card label from "SOON" to "0 SAVED" (or "FREE", or whatever fits)
6. Add `<link>` and `<script>` tags for the new files in `index.html`

## Design notes

Structure to generate:
- Term, year, subject, class, teacher
- Week-by-week table: Week | Topic | Sub-topic | Specific Outcomes | T/L Activities | Materials | Assessment
- Optional integration column for cross-subject links

Lesson plans then drill down into individual weeks. Future enhancement: select a scheme, click a week → "Generate Lesson Plan for this week" pre-fills the lesson plan studio.
