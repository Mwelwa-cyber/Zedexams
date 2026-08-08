/**
 * paperFigureAttachCore — the PURE half of the figure-attach pass (see
 * paperFigureAttach.js for the DOM/Storage executor and the full story).
 * Dependency-free so it runs under plain `node` in the test suite.
 */

// Role semantics mirror pastPapers.js getAssetRole: anything not explicitly
// 'mark-scheme' is the question paper (back-compat with pre-role assets).
// Kept local so this module stays import-free for the node test runner.
function isPaperRoleAsset(asset) {
  return asset?.role !== 'mark-scheme'
}

function isPdfAsset(asset) {
  return String(asset?.contentType || '').toLowerCase() === 'application/pdf'
}

function isImageAsset(asset) {
  return String(asset?.contentType || '').toLowerCase().startsWith('image/')
}

// Default padding added around an AI-detected figure box before cropping, as
// a fraction of the box's own width/height — generous enough that an
// arrowhead or axis label sitting right at the reported edge doesn't get cut
// off, small enough not to pull in the neighbouring question's text.
const DEFAULT_CROP_PADDING = 0.025

/**
 * Pad a figure box outward by `paddingFrac` (relative to the box's own size)
 * and clamp the result to the page (0..1 on both axes). Pure geometry — no
 * DOM/canvas — so the automatic-crop step (Phase 9) is unit-testable and the
 * manual cropper (ImageCropModal) can reuse the exact same padding math for
 * its "Expand crop +2% / +5%" actions. Returns null for a degenerate box.
 */
export function padAndClampBox(box, paddingFrac = DEFAULT_CROP_PADDING) {
  if (!box || typeof box !== 'object') return null
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN)
  const x = num(box.x), y = num(box.y), w = num(box.w), h = num(box.h)
  if ([x, y, w, h].some((n) => !Number.isFinite(n)) || w <= 0 || h <= 0) return null
  const pad = Math.max(0, Number(paddingFrac) || 0)
  const padX = w * pad
  const padY = h * pad
  const x0 = Math.max(0, x - padX)
  const y0 = Math.max(0, y - padY)
  const x1 = Math.min(1, x + w + padX)
  const y1 = Math.min(1, y + h + padY)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

/**
 * Decide, for each figure the importer located, which uploaded asset (and page
 * within it) to crop from. Mark-scheme assets are never used — the figure is
 * printed on the question paper. Rules:
 *   - If the paper has a PDF asset, every figure's sourcePage indexes into the
 *     FIRST paper-role PDF (papers are uploaded as one PDF).
 *   - Otherwise the paper was uploaded as page photos: sourcePage N maps to
 *     the Nth paper-role image asset (1-based, upload order — the same order
 *     the server read them in).
 * Figures with no usable source (missing passageId/page, page beyond the
 * photo count) land in `skipped` so the caller reports an honest count. Pure.
 */
export function planFigureAttachments(figures = [], assets = []) {
  const list = Array.isArray(figures) ? figures : []
  const paperAssets = (Array.isArray(assets) ? assets : []).filter(isPaperRoleAsset)
  const pdf = paperAssets.find(isPdfAsset) || null
  const images = paperAssets.filter(isImageAsset)

  const plan = []
  const skipped = []
  for (const fig of list) {
    const page = Number.parseInt(fig?.sourcePage, 10)
    // A figure targets either a passage block (shared map/figure — the
    // original contract) or a single question's own picture (questionId,
    // added for the crop-from-page pipeline). Exactly one id is expected.
    const passageId = fig?.passageId || null
    const questionId = !passageId ? (fig?.questionId || null) : null
    if ((!passageId && !questionId) || !Number.isInteger(page) || page < 1) {
      skipped.push(fig)
      continue
    }
    const target = passageId
      ? { targetKind: 'passage', passageId }
      : { targetKind: 'question', questionId }
    if (pdf) {
      plan.push({ ...target, title: fig.title || '', page, box: fig.box || null, source: { kind: 'pdf', asset: pdf } })
    } else if (images[page - 1]) {
      plan.push({ ...target, title: fig.title || '', page, box: fig.box || null, source: { kind: 'image', asset: images[page - 1] } })
    } else {
      skipped.push(fig)
    }
  }
  return { plan, skipped }
}

/**
 * Pick the uploaded asset (and kind) that holds page N of the question paper —
 * the same source rules planFigureAttachments applies per figure, exposed for
 * the Quiz Editor's on-demand "Crop from page" (which needs a page image with
 * no figure report at all). Returns {kind:'pdf'|'image', asset} or null when
 * the paper has no usable source for that page. Pure.
 */
export function pickPaperPageSource(assets = [], pageNumber) {
  const page = Number.parseInt(pageNumber, 10)
  if (!Number.isInteger(page) || page < 1) return null
  const paperAssets = (Array.isArray(assets) ? assets : []).filter(isPaperRoleAsset)
  const pdf = paperAssets.find(isPdfAsset) || null
  if (pdf) return { kind: 'pdf', asset: pdf }
  const images = paperAssets.filter(isImageAsset)
  return images[page - 1] ? { kind: 'image', asset: images[page - 1] } : null
}

/**
 * Merge freshly attached figure URLs onto a quiz doc's passages array.
 * Returns a new array (never mutates); untouched passages pass through as-is.
 * A passage keeps its existing imageUrl unless a fresh crop was attached. Pure.
 */
export function mergeFigureUrlsIntoPassages(passages = [], attachedById = {}) {
  return (Array.isArray(passages) ? passages : []).map(p => {
    const hit = p && p.id != null ? attachedById[p.id] : null
    if (!hit) return p
    return {
      ...p,
      imageUrl: hit.url,
      imageAlt: hit.alt || p.imageAlt || '',
    }
  })
}
