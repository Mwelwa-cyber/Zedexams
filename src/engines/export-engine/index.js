/**
 * Document Export Engine — DOCX, PDF and print, page preview, and the
 * free-tier watermark (docs/architecture.md §11.1, §12).
 *
 * The watermark lives INSIDE the engine so every export path inherits it; a
 * path that renders its own artifact is a path that can forget it.
 *
 * Empty until Phase 4. The live exporters (`assessmentToDocx`,
 * `htmlToPdf`, `assessmentPaperLayout`, `paperContentModel`) stay in
 * `src/utils/` until then, and whatever moves here stays under the
 * visual-regression gate: baselines are recorded by CI only (§14.15).
 */

export {}
