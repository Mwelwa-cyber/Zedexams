/**
 * src/shared — cross-cutting building blocks with no domain of their own:
 * components, hooks, icons, constants, schemas, validation, utils
 * (docs/architecture.md §12).
 *
 * "Shared" is a layer, not a dumping ground. It is the BOTTOM of the src
 * layering — it may not import from `src/app/`, `src/features/`,
 * `src/engines/` or `src/curriculum/`, and the import-boundary rules in
 * eslint.config.js fail the build if it does. Anything that needs one of those
 * belongs to that layer instead.
 *
 * Empty until the features that own today's shared code migrate. The flat
 * `src/utils/` is subdivided file by file as its owning feature moves (§2) —
 * not in one sweep, and never by copying: a utility exists once.
 *
 * A namespace marker, not a barrel. Import the area (`src/shared/utils`,
 * `src/shared/hooks`); a root barrel would pull every shared component into the
 * chunk of anything that wanted one string helper.
 */

export {}
