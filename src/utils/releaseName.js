/**
 * The one definition of "which build is this" — used to name Sentry releases
 * and to stamp telemetry.
 *
 * ## Why this module exists
 *
 * The release string used to be assembled in two places that had to agree by
 * hand: `sentryRelease()` in vite.config.js (which names the uploaded source
 * maps) and `RELEASE` in utils/sentry.js (which stamps every event). The
 * comment above the first one said it must be "byte-for-byte identical" to the
 * second — a correctness requirement enforced by nothing. If they ever drifted,
 * maps would stop binding to events and every production stack trace would go
 * silently minified. One exported function removes that class of bug.
 *
 * ## Why the sha is in the name
 *
 * `VITE_APP_VERSION` is a manually-bumped GitHub secret. It has read `1.1.0`
 * across every deploy for months while the repo's own tags moved to v1.2.7, so
 * EVERY production build shipped under the identical release id
 * `zedexams@1.1.0-production`. Sentry therefore could not tell two deploys
 * apart, which costs more than a cosmetic version number:
 *
 *   • "Resolved in the next release" cannot work — the next release has the
 *     same name as the broken one.
 *   • A recurrence cannot be classified as a regression, because there is no
 *     later release for it to regress INTO.
 *   • An incoming event cannot answer the only question that matters during a
 *     rollout: did this come from a build that has the fix?
 *
 * That last one is not hypothetical — it is exactly the question that could not
 * be answered about PYTHON-K after its fix shipped.
 *
 * The commit sha is already published to the bundle as `VITE_BUILD_SHA` by
 * deploy-hosting.yml, whose own comment notes that the version secret "is
 * identical across deploys, so it cannot tell two shells apart during a rollout
 * hold — the sha can". It simply was never wired into the release name. It is
 * now, so the release id is unique per deploy and points at the exact commit.
 *
 * Format: `zedexams@<version>+<build>-<mode>`, e.g.
 * `zedexams@1.2.7+03f0b74b-production`. The `+build` metadata separator is
 * semver's own convention for "same version, different build".
 */

/** Package name portion of the release id. */
export const RELEASE_PREFIX = 'zedexams'

/**
 * Shorten a commit sha to the id stamped on builds and telemetry.
 *
 * `'dev'` stands in wherever no deploy stamped one — local dev, tests, and the
 * smoke build. Kept here rather than inlined so the release name and
 * `utils/buildId` cannot disagree about how many characters a build id has.
 */
export function shortBuildId(sha) {
  return (sha || 'dev').slice(0, 8)
}

/**
 * Build the release identifier.
 *
 * Every input is optional and degrades to a truthful placeholder rather than
 * throwing: a build with no version and no sha is named
 * `zedexams@dev+dev-development`, which is wrong about nothing.
 */
export function buildReleaseName({ version, sha, mode } = {}) {
  return `${RELEASE_PREFIX}@${version || 'dev'}+${shortBuildId(sha)}-${mode || 'development'}`
}
