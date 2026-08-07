/**
 * What files a recorded baseline consists of.
 *
 * One module because the collector's arrival check is only as good as the list
 * the recorders declare, and that list is the easiest thing in this pipeline to
 * get quietly wrong: the paper builder declared its copy DIRECTORY, which
 * exists as long as any single file inside it survives, so an artifact that lost
 * every rendered `page-N.png` but kept `environment.json` passed arrival and
 * could reach review as an unusable baseline (Codex on #2143, `r3729416392`).
 *
 * It also has to be reachable from a test. The paper builder lives inside
 * `runVisualGate.mjs`, a script with top-level `await` and side effects that
 * cannot be imported without running the gate — so the computation sat where
 * nothing could exercise it, and a mutation restoring the directory form was
 * caught by nothing. That is the whole reason this is a module rather than an
 * expression at the call site.
 *
 * Paths are relative to `tests/visual/baselines/`, which is what both the
 * artifact and the repository tree are rooted at.
 */

/**
 * Every file a PAPER baseline consists of.
 *
 * `hashes` is the manifest, and a good one: `writeBaseline` builds it by reading
 * the directory back AFTER the writes, so it lists what actually landed rather
 * than what was intended. `recorded.json` is appended because it is written
 * after the hashes are taken and is lost by the same accident.
 */
export function paperBaselinePaths({ identity, fixtureId, copy, hashes }) {
  const names = [...Object.keys(hashes ?? {}), 'recorded.json']
  const unique = [...new Set(names)].filter(Boolean).sort()
  return unique.map((name) => `${identity}/${fixtureId}/${copy}/${name}`)
}

/**
 * The file a SCREEN capture consists of — one image.
 *
 * Returned as a list so both families answer the same question the same way;
 * the collector should not have to know which family it is looking at.
 */
export function screenBaselinePaths({ identity, fixtureId, viewportId }) {
  return [`${identity}/${fixtureId}/${viewportId}.png`]
}
