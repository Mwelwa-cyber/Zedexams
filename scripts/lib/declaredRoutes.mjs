/**
 * Where the app's routes are declared, for the text-level route guards.
 *
 * They all used to read `<Route path="...">` out of src/app/App.jsx, which was
 * the whole story until the /teacher/* routes moved into
 * teacherRoutes.jsx (declared as data so a spec can render every one and
 * assert the shared shell; since 2026-08-15 it lives in src/app/routes/,
 * beside the guards). Nothing announced the original move to the
 * parsers: they simply saw fewer routes, and a guard that silently stops
 * covering a third of the app is worse than one that fails.
 *
 * So the knowledge of WHERE routes live is now in one module. A future move
 * updates this file; the guards keep working.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const APP_PATH = 'src/app/App.jsx'
export const TEACHER_ROUTES_PATH = 'src/app/routes/teacherRoutes.jsx'

export const readSource = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** `<Route path="X">` declarations in App.jsx. */
export function appRoutePaths(appSrc = readSource(APP_PATH)) {
  return [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1])
}

/**
 * Paths in the teacher route table. Two declaration shapes:
 *   page('/teacher/x', …) / studio(…) / bare(…) / redirect(…)
 *   { path: '/teacher/x', shell: true, element: … }
 */
export function teacherRoutePaths(src = readSource(TEACHER_ROUTES_PATH)) {
  const fromHelpers = [...src.matchAll(/\b(?:page|studio|bare|redirect)\(\s*'([^']+)'/g)].map((m) => m[1])
  const fromObjects = [...src.matchAll(/\bpath:\s*'([^']+)'/g)].map((m) => m[1])
  return [...new Set([...fromHelpers, ...fromObjects])]
}

/**
 * Teacher routes as {path, gated, chunk} entries, shaped like the ones
 * test-public-routes parses out of App.jsx's <Route> elements so the same
 * guard assertions work against both sites.
 *
 * `page(...)` and `studio(...)` are the shell constructors and expand to
 * <TeacherRoute> — which is <ProtectedRoute requiredRole="teacher"> wrapping
 * <TeacherLayout> — so both guard names are recorded for them. Anything else
 * is read literally: a `bare(...)` route is only gated if its element really
 * names a guard.
 */
export function teacherRouteEntries(src = readSource(TEACHER_ROUTES_PATH)) {
  const entries = []
  const seen = new Set()

  for (const m of src.matchAll(/\b(page|studio|bare|redirect)\(\s*'([^']+)'([^\n]*)/g)) {
    const [, kind, path, rest] = m
    const shellWrapped = kind === 'page' || kind === 'studio'
    entries.push({
      path,
      kind,
      // The constructors are the guard: expand them so a caller checking for
      // 'TeacherRoute' sees what the route actually renders.
      chunk: shellWrapped ? `TeacherRoute ProtectedRoute requiredRole ${rest}` : rest,
      gated: shellWrapped || /ProtectedRoute|AdminRoute|TeacherRoute|requiredRole/.test(rest),
    })
    seen.add(path)
  }

  // Object-literal routes (e.g. the dashboard preview, which wraps
  // TeacherLayout directly because it is deliberately unauthenticated).
  for (const m of src.matchAll(/\{\s*path:\s*'([^']+)',([\s\S]{0,240}?)\n\s*\},/g)) {
    const [, path, body] = m
    if (seen.has(path)) continue
    entries.push({
      path,
      kind: 'object',
      chunk: body,
      gated: /ProtectedRoute|AdminRoute|TeacherRoute|requiredRole/.test(body),
    })
  }

  return entries
}

/**
 * Paths App.jsx wraps in <LearnerOnlyRoute> — the routes a teacher account
 * cannot open. Read from the route declaration rather than kept as a list,
 * so adding a learner route can't quietly leave a guard behind.
 *
 * Each <Route> is declared on one line, so the element is matched on that
 * line; a route split across lines would be missed, which is why the caller
 * asserts a floor on the count.
 */
export function learnerOnlyRoutePaths(appSrc = readSource(APP_PATH)) {
  return appSrc
    .split('\n')
    .filter((line) => line.includes('<LearnerOnlyRoute>'))
    .map((line) => line.match(/<Route\s+path="([^"]+)"/)?.[1])
    .filter(Boolean)
}

/**
 * Every route path the router declares, from both files.
 *
 * Throws rather than returning a short list if either parser comes back
 * empty-handed: "no routes matched" and "this file has no routes" look
 * identical to a caller, and the first one means the regex has drifted.
 */
export function declaredRoutePaths() {
  const app = appRoutePaths()
  const teacher = teacherRoutePaths()
  if (app.length < 50) {
    throw new Error(`Parsed only ${app.length} routes from ${APP_PATH} — parser drifted?`)
  }
  if (teacher.length < 40) {
    throw new Error(`Parsed only ${teacher.length} routes from ${TEACHER_ROUTES_PATH} — parser drifted?`)
  }
  return [...app, ...teacher]
}

/** True if `path` is served by some declared route (params/wildcards honoured). */
export function makeRouteMatcher(paths = declaredRoutePaths()) {
  const matchers = paths.map((p) => {
    if (p === '*') return () => false // the catch-all 404 never legitimises a link
    const pattern = p
      .replace(/\/\*$/, '(/.*)?') // trailing wildcard: /settings/* also serves /settings
      .replace(/:[A-Za-z0-9_]+/g, '[^/]+')
    const re = new RegExp(`^${pattern}$`)
    return (candidate) => re.test(candidate)
  })
  return (candidate) => matchers.some((m) => m(candidate))
}
