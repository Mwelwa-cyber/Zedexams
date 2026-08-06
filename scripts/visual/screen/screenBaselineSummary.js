/**
 * The screen family's half of the baseline review sheet.
 *
 * `baselineSummary.js` owns the SHEET — the count that leads it, the index per
 * family, the separators, the file every writer workflow reads. This owns what
 * a reviewer needs in front of them to approve one screen capture as the
 * reference every later comparison is measured against.
 *
 * ## What a screen section says that a paper section cannot
 *
 * A paper baseline describes itself with page count, anchors and embedded
 * figures. None of those exist here: the unit is a viewport, not a sheet. What
 * takes their place is the **named page checks** — the assertions the stage ran
 * IN THE PAGE before the screenshot was taken. They are the part of this that a
 * pixel comparison structurally cannot do: a baseline recorded from wrong output
 * looks identical, forever, to one recorded from right output. So the section
 * states which checks ran, and the reviewer is told what to look at rather than
 * asked to certify sixteen images from a filename.
 *
 * No DOM, no browser, no pngjs — this builds strings, so it is exercised by the
 * plain-node suite on a runner with no Chromium.
 */
import { createHash } from 'node:crypto'
import { SCREEN_PAGE_CHECKS } from './screenPageChecks.js'

/**
 * What a reviewer should actually look FOR. The point of the one human look
 * this gate gets is not "do these files exist" — it is whether the renders are
 * right, because whatever they show is what gets locked.
 */
export const SCREEN_REVIEW_CHECKLIST = Object.freeze([
  'a fraction is STACKED — numerator above a bar above denominator, never "3/4"',
  'answer choices run in ONE vertical column, each row full width',
  'every choice carries a letter badge, in order from A, past D where there are five',
  'a 1-mark question shows NO marks pill (it conforms to the old runner; changing that is a post-cutover product decision)',
  'an unrevealed question shows no correct/incorrect signal anywhere',
  'nothing is clipped at the phone width',
])

/** One screen capture's section of the review sheet. */
export function screenBaselineSection({
  fixture, viewport, png, width, height, identity, environment, reason, source, sourceCommit = '',
}) {
  const sha = createHash('sha256').update(png).digest('hex')
  const checks = (fixture.pageChecks ?? []).map((name) =>
    `| \`${name}\` | ${SCREEN_PAGE_CHECKS[name]?.describe ?? '— not implemented —'} |`).join('\n')

  return `Recorded **${fixture.id}/${viewport.id}** — ${fixture.title} — for **screen**.

**Reason:** ${reason}
**Source:** ${source}${sourceCommit ? ` (commit \`${sourceCommit}\`)` : ''}
**Baseline identity:** \`${identity}\`

### What this fixture protects

${fixture.protects.map((claim) => `- ${claim}`).join('\n')}

### Viewport

| | |
|---|---|
| Name | ${viewport.id} |
| CSS size | ${viewport.width} × ${viewport.height} |
| Device scale | ${viewport.deviceScaleFactor}× |
| Captured image | ${width} × ${height} px (full page) |

### Rendering environment

| | |
|---|---|
| Chromium | ${environment.chromium || '—'} |
| OS | ${environment.os} |
| Fonts | ${environment.fonts.count} (digest \`${environment.fonts.digest}\`) |

A baseline is only comparable against this environment; a later run in a
different one is refused as an environment error rather than reported as
sixteen visual failures.

### Page checks that passed before this was captured

${checks ? `| Check | What it measures |\n|---|---|\n${checks}` : '_(none declared — this capture is watched by pixels alone)_'}

A failing check refuses the capture rather than recording it, so every image in
this diff drew correctly by these measures at the moment it was taken. What the
checks cannot tell you is whether it LOOKS right, which is the next section.

### Please look at the image and confirm

${SCREEN_REVIEW_CHECKLIST.map((line) => `- [ ] ${line}`).join('\n')}

### Baseline file

| File | sha256 |
|---|---|
| \`${fixture.id}/${viewport.id}.png\` | \`${sha}\` |

Every rendered page is attached to the workflow run.
`
}

/** The whole entry, ready for `appendBaselineSummaryEntry`. */
export function screenBaselineEntry(input) {
  const { fixture, viewport, width, height, identity } = input
  return {
    key: `screen/${fixture.id}/${viewport.id}`,
    family: 'screen',
    // WHICH FILE this entry describes, relative to `tests/visual/baselines/`.
    //
    // The collector verifies every described baseline actually arrived in the
    // artifact. Checking that a `baselines/` tree merely EXISTS proves nothing
    // here: the recorder uploads the whole tree from a checkout that already
    // contains the committed browser-print and docx baselines, so an artifact
    // that lost every newly recorded screen page still has a non-empty one.
    path: `${identity}/${fixture.id}/${viewport.id}.png`,
    columns: ['Fixture', 'Viewport', 'Image'],
    cells: [`${fixture.id} — ${fixture.title}`, viewport.id, `${width} × ${height}`],
    section: screenBaselineSection(input),
  }
}
