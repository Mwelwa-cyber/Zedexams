/**
 * Public surface of the Announcements feature — platform-wide banner messages
 * an admin publishes to learners, teachers or admins (the `announcements`
 * collection).
 *
 * Migrated under docs/architecture.md Phase 4, following
 * docs/MIGRATION_TEMPLATE.md. The move changed no behaviour, no Firestore
 * shape and no route: `/admin/announcements` renders the same page from a new
 * path, and the banner mounts in the same place in the shell.
 *
 * ONE name is exported, because one name is consumed: `App.jsx` mounts the
 * banner in the app shell above the router. THE PAGE IS DELIBERATELY NOT
 * EXPORTED — `pages/AnnouncementsAdmin.jsx` is reached only by
 * `lazy(() => import('…/pages/AnnouncementsAdmin'))` in App.jsx, under the
 * route-mount exception Phase 1 recorded. Re-exporting it here would drag the
 * whole admin editor into the shell chunk, which every visitor loads — the
 * banner is rendered on the public landing page.
 *
 * The two halves of the collection live together on purpose: the writer (the
 * admin page) and the reader (the banner) share one audience vocabulary
 * (`all` / `learners` / `teachers` / `admins`) and one severity vocabulary
 * (`info` / `warn` / `success`), and they are the only two places that know
 * either. Splitting them across `components/admin/` and `components/banners/`
 * is what made that pair invisible.
 */

export { default as AnnouncementBanner } from './components/AnnouncementBanner'
