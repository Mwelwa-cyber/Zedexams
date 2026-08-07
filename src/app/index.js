/**
 * src/app — the application shell: App.jsx, the route registry, the provider
 * stack, route guards and layouts. Target home per docs/architecture.md §12.
 *
 * Scaffolded in Phase 1; nothing has moved in yet. `App.jsx`, `src/contexts/`
 * and the guard/layout components stay where they are until the phase that
 * migrates them (§13, Phase 4), because moving a route declaration is a
 * user-facing change and Phase 1 is not.
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
