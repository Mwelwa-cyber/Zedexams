# Lesson Plan Studio

The flagship studio. Generates CBC-aligned lesson plans via Claude API.

## Files

| File | Purpose |
|------|---------|
| `lesson.css`              | Sidebar, topbar, form inputs, doc paper, modals — all studio chrome |
| `01-ui-setup.js`          | Tabs (Generate/Style), mobile menu, format/style card bindings |
| `02-syllabus-new.js`      | 2023 ZECF — ECE/LP/UP/Forms 1-4/Form 5 topics by subject by grade |
| `03-syllabus-old.js`      | 2013 CDC — G5-7 (7 subjects) and G10-12 (14 subjects) topics |
| `04-syllabus-router.js`   | `activeSyllabus()`, `getTopicsForClass()`, `populateClasses()` |
| `05-system-prompts.js`    | `cbcPrinciples` shared block + `sysModern`, `sysClassic`, `sysClassic2` |
| `06-generate.js`          | `callClaude()`, `gatherInput()`, `#btn-generate` click handler |
| `07-renderers.js`         | `renderModern`, `renderClassic`, `renderClassic2`, `renderHeader`, `renderMeta`, `formatProse` |
| `08-edit-mode.js`         | Edit toggle, contentEditable on doc, table column drag-resize, table insert/delete |
| `09-symbols.js`           | Math symbols modal (`symbolGroups`), fraction builder, `insertSymbol`, `insertFraction` |
| `10-export.js`            | `exportPDF`, `exportHTML`, `exportWord` (lazy-loads html-docx-js) |
| `11-diagrams.js`          | Diagram catalog (~40 across Shapes 2D, Shapes 3D, Number Line, Geometry, Arrows) + modal UI |

## API key

`06-generate.js` reads from `localStorage['anthropic_api_key']`. In production:

1. Remove the key reading
2. Replace the `fetch('https://api.anthropic.com/v1/messages', ...)` call with a fetch to YOUR backend endpoint
3. Backend (Firebase Function or similar) holds the key and proxies the request

## Adding a new format

To add a 4th format alongside Modern / Classic / Classic 2:

1. Add a new `<div class="format-card" data-fmt="myformat">` in `index.html` inside `#format-grid`
2. Add `sysMyFormat` system prompt in `05-system-prompts.js`
3. Add `renderMyFormat()` in `07-renderers.js`
4. In `06-generate.js`, route to it: `i.format === 'myformat' ? sysMyFormat : ...` and `i.format === 'myformat' ? renderMyFormat(data, i) : ...`
