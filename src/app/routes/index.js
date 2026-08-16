/**
 * Route registry. Learner, admin and public routes join the data-driven
 * pattern `teacherRoutes.jsx` (now this directory's sibling) already uses, so
 * `scripts/lib/declaredRoutes.mjs` keeps seeing every declared route.
 *
 * `App.jsx` arrived in `src/app/` on 2026-08-16, so the two declaration sites
 * are now siblings — but they are still TWO. Routes are declared in
 * `../App.jsx` and in `teacherRoutes.jsx`, both authoritative, and moving
 * App.jsx did not by itself convert its ~124 lazy `<Route>` elements into the
 * data-driven form. That conversion is the remaining work here, and it is a
 * behaviour change rather than a file move: `declaredRoutes.mjs` parses both
 * sites textually, and five guards (`test:public-routes`,
 * `test:learner-only-routes`, `test:scroll-to-top`, `test:android-splash`,
 * `test:dashboard-v2-links`) fail if the parser stops recognising a shape. Any
 * route that physically moves here regenerates the route register
 * (docs/architecture/03-route-register.md) in the same PR.
 */

export {}
