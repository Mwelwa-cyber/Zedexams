/**
 * Document Export Engine — the home for every module that turns a saved
 * artifact into a file a teacher can hand out (docs/architecture.md §11.1, §12).
 *
 * ## This index is a CONTRACT, not a barrel — and that is load-bearing
 *
 * It re-exports nothing, deliberately. Consumers import the one exporter they
 * need by path:
 *
 *     import { downloadRubricDocx } from '../../engines/export-engine/rubricToDocx'
 *
 * A barrel here would undo the three pull requests that created this
 * directory. #2172, #2177 and #2178 established, by measurement, that putting
 * exporters behind a single module makes Rollup group every consumer of ANY of
 * them into a chunk that statically imports `docx-vendor` — 382 kB — which is
 * how the public share page, the locked-studio sample and the `/teachers`
 * marketing page each came to download a Word runtime to draw a card. Ten
 * exporters behind one door would be the same mistake at ten times the size.
 *
 * `npm run check:bundle-edges` fails if that regresses, and
 * `npm run test:exporter-home` fails if a new exporter is born outside this
 * directory. Neither is advisory; both run on every pull request.
 *
 * ## The contract every module here follows
 *
 * Two layers, and the split is the reason any of this is testable:
 *
 *   • `build<Thing>Document(data, opts)` → a `docx` `Document`, and
 *     `build<Thing>PrintableHtml(data, opts)` → an HTML string. PURE: no DOM
 *     writes, no downloads, no clock. These are what the golden tests assert
 *     on, which is why the assertions can be exact.
 *   • `download<Thing>Docx(data, opts)` / `download<Thing>Pdf(data, opts)`, and
 *     the `print<Thing>Pdf(...)` variants. These wrap a builder, hand the
 *     result to `saveBlob` or a print window, and return nothing interesting.
 *
 * `opts.attribution` adds the free-tier watermark. It is applied by the
 * builders rather than by callers on purpose: a path that assembles its own
 * artifact is a path that can forget the watermark, and there is no test that
 * would notice.
 *
 * ## What is here, and what is still coming
 *
 * Ten modules: the docx and PDF exporters for rubric, homework, worksheet,
 * teacher notes and flashcards — the five features already migrated under
 * Phase 4. Rubric's studio is retired and Worksheet's is flag-withdrawn; their
 * exporters still matter and still move, because saved artifacts have to stay
 * readable and exportable regardless of whether the tool that made them is
 * still offered.
 *
 * The other ~27 exporters stay in `src/utils/` until their features migrate.
 * They are enumerated in `scripts/test-exporter-home.mjs` as a SHRINK-ONLY
 * list, so the remaining work is countable rather than remembered, and adding
 * a new one there fails.
 *
 * ## Constraints
 *
 *   • **No Firebase.** An engine sits below features and reaches data through
 *     `src/services/` (§14.2). None of these modules imports it today, and the
 *     import-boundary test enforces that in both the static and dynamic forms.
 *   • **Shared helpers stay in `src/utils/`** — `saveBlob`, `xmlText`,
 *     `docxAttribution`, `htmlPdfExport`, `htmlToPdf`, `exportWatermark`,
 *     `toolNotationDocx`, `toolNotationRender`, `notesOptions`. Exporters that
 *     have NOT migrated still use them, so moving them now would strand the
 *     majority to tidy the minority. An engine may import downward.
 *   • Whatever lands here stays under the visual-regression gate; baselines
 *     are recorded by CI only (§14.15).
 */

export {}
