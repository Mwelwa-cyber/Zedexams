// scanPages — pure helpers for the multi-page scan session page list.
//
// A "scan session" is an ordered list of captured pages. Each page is a plain
// object: { id, dataUrl, mime, blurry, variance }. Keeping all ordering /
// add / replace / remove logic as pure array transforms (no React, no DOM, no
// IndexedDB) lets the scanner's trickiest behaviour — pages never silently
// replacing one another, order preserved on reorder — be unit-tested under
// plain `node`.

let pageCounter = 0

// Monotonic id so React keys stay stable across reorders. Not cryptographic.
export function nextPageId() {
  pageCounter += 1
  return `pg_${Date.now().toString(36)}_${pageCounter}`
}

export function makePage({ dataUrl, mime = 'image/jpeg', blurry = false, variance = null, id } = {}) {
  return {
    id: id || nextPageId(),
    dataUrl: dataUrl || '',
    mime,
    blurry: Boolean(blurry),
    variance: variance == null ? null : variance,
  }
}

// Append a new page to the end — this is the "Add Next Page" path. It must
// never overwrite an existing page; that was the whole bug this feature fixes.
export function addPage(pages, page) {
  return [...pages, page]
}

// Replace the page at `index` in place, keeping every other page and the
// overall order untouched — the "Retake This Page" / "Replace Current Page"
// path.
export function replacePage(pages, index, page) {
  if (index < 0 || index >= pages.length) return pages
  const next = pages.slice()
  next[index] = { ...page, id: pages[index].id }
  return next
}

export function removePage(pages, index) {
  if (index < 0 || index >= pages.length) return pages
  return pages.filter((_, i) => i !== index)
}

// Move the page at `index` one slot toward the front (dir=-1) or back (dir=+1).
// A no-op at the boundaries. Returns a new array; never mutates the input.
export function movePage(pages, index, dir) {
  const target = index + dir
  if (index < 0 || index >= pages.length) return pages
  if (target < 0 || target >= pages.length) return pages
  const next = pages.slice()
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

export function hasBlurryPage(pages) {
  return pages.some(p => p.blurry)
}

// Human-readable progress steps for the capture indicator:
// "Page 1 captured" … "Page N captured" + a trailing "Ready to convert" that is
// only `done` once at least one page exists.
export function progressSteps(pages) {
  const steps = pages.map((_, i) => ({
    key: `page-${i}`,
    label: `Page ${i + 1} captured`,
    done: true,
  }))
  steps.push({
    key: 'ready',
    label: 'Ready to convert',
    done: pages.length > 0,
  })
  return steps
}
