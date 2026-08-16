/**
 * src/app — the application shell: App.jsx, the route registry, the provider
 * stack, route guards and layouts. Target home per docs/architecture.md §12.
 *
 * Scaffolded in Phase 1 and now largely occupied: `App.jsx` moved in on
 * 2026-08-16, the guards arrived with the teacher migration, `routes/` holds
 * `teacherRoutes.jsx`, and `providers/` holds `AppProviders.jsx`.
 *
 * Two things are still outside, and neither is merely pending — see the
 * markers for the reason in each case. `src/contexts/` cannot move into
 * `providers/` while 294 files under `features/` import it (a feature may not
 * import `app/`), and `layouts/` is empty because both layouts it was
 * scaffolded for became features under that same rule.
 *
 * This file is a namespace marker, not a barrel. Importing an area directly
 * (`src/app/guards`, `src/app/providers`) keeps a guard import from dragging
 * every provider and layout into the same chunk — the router is fully lazy and
 * a barrel-of-barrels here would quietly undo that.
 *
 * Layering (enforced by the import-boundary rules in eslint.config.js):
 * app may import anything below it; nothing below it may import app.
 */

export {}
