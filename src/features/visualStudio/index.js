/* Public surface of the Visual Studio feature. The whole studio lives under
   src/features/visualStudio/ and is reachable through this single entry point,
   which keeps the rest of the app decoupled from its internals (and eases the
   future standalone-app extraction).

   ── The two admin image surfaces joined it in Wave 4 ──────────────────────

   `/admin/picture-bank` (PictureBankAdmin) and `/admin/visuals`
   (VisualStudioAdmin) were the last of the image pipeline still living in
   `src/components/admin/`. They belong here rather than in an `adminImages`
   feature of their own, because CLAUDE.md's own description of this folder
   already claimed them: visualStudio "drives admin image authoring AND the
   teacher Picture & Diagram Studio".

   Moving VisualStudioAdmin also RETIRED a shrink-only debt line.
   `test:import-boundaries` recorded it reaching past this front door into
   `services/visualAssetService` — legal only because it sat outside any
   feature. Inside, that is an ordinary intra-feature import, so the entry was
   deleted rather than re-pointed. The legacy list went 7 → 6; it only shrinks.

   Both admin pages stay UNEXPORTED under the route-mount exception, like
   VisualStudioPage's own consumers do not exist. `pictureBankStarterPack` and
   the `visualCostReport` pair travelled into `lib/` with their node tests, and
   `test:picture-starter-pack` / `test:visual-cost` were re-pointed in the same
   commit. `pictureBankService` (10 consumers, including AssessmentStudio and
   two components of this feature) stays in `src/utils/`. */

export { default as VisualStudioPage } from './pages/VisualStudioPage'
