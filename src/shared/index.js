/**
 * src/shared — cross-cutting building blocks with no domain of their own:
 * components, hooks, icons, constants, schemas, styles, validation, utils
 * (docs/architecture.md §12).
 *
 * `styles/` is the newest area and the only one that is not code. It holds a
 * cross-cutting stylesheet a whole themed surface depends on — today
 * `dashboardV2.css`, which the teacher shell AND `features/dashboardV2` both
 * import. Filing 4,047 lines of `.tdv2` selectors under `components/` would
 * have made the ownership read as one component's, which it is not.
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
