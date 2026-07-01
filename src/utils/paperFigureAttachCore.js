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
    if (!fig?.passageId || !Number.isInteger(page) || page < 1) {
      skipped.push(fig)
      continue
    }
    if (pdf) {
      plan.push({ passageId: fig.passageId, title: fig.title || '', page, box: fig.box || null, source: { kind: 'pdf', asset: pdf } })
    } else if (images[page - 1]) {
      plan.push({ passageId: fig.passageId, title: fig.title || '', page, box: fig.box || null, source: { kind: 'image', asset: images[page - 1] } })
    } else {
      skipped.push(fig)
    }
  }
  return { plan, skipped }
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
