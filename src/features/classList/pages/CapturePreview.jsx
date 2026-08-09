/**
 * /teacher/register-preview/capture — the multi-page capture flow, with three
 * pages already photographed.
 *
 * The real CaptureClassListFlow, seeded through its `initialPages` prop.
 * That prop exists FOR this route and is documented as such on the component:
 * the alternative was a hand-built replica of the page strip, which would
 * make the preview a drawing of the screen rather than the screen. A seam a
 * preview route uses is cheaper to keep honest than a second implementation.
 *
 * The page thumbnails are a generated SVG of a ruled Zambian register page —
 * no photograph of a real class list, because a real one carries eighty
 * children's names and guardian phone numbers and has no business in a repo.
 */

import CaptureClassListFlow from '../components/CaptureClassListFlow'

/** A ruled register page, drawn rather than photographed. */
function registerPageSvg(pageNumber, firstRow) {
  const rows = Array.from({ length: 14 }, (_, i) => {
    const y = 96 + i * 34
    return `
      <line x1="24" y1="${y}" x2="576" y2="${y}" stroke="#c9c4bb" stroke-width="1"/>
      <text x="34" y="${y - 10}" font-family="Georgia, serif" font-size="15" fill="#3b3730">${firstRow + i}</text>
      <text x="80" y="${y - 10}" font-family="Georgia, serif" font-size="15" fill="#3b3730">ADM-${String(firstRow + i).padStart(3, '0')}</text>
      <rect x="176" y="${y - 24}" width="${190 + ((i * 37) % 90)}" height="12" rx="6" fill="#5b5449" opacity="0.55"/>
      <text x="470" y="${y - 10}" font-family="Georgia, serif" font-size="15" fill="#3b3730">${i % 2 ? 'F' : 'M'}</text>
    `
  }).join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="#f6f3ec"/>
    <text x="24" y="44" font-family="Georgia, serif" font-size="20" fill="#2b2822">JEMAREEN ACADEMY — GRADE 4A</text>
    <text x="24" y="68" font-family="Georgia, serif" font-size="14" fill="#5b5449">Class list 2026 — page ${pageNumber}</text>
    <line x1="24" y1="80" x2="576" y2="80" stroke="#2b2822" stroke-width="2"/>
    <text x="34" y="94" font-family="Georgia, serif" font-size="12" fill="#5b5449">No.</text>
    <text x="80" y="94" font-family="Georgia, serif" font-size="12" fill="#5b5449">Adm No.</text>
    <text x="176" y="94" font-family="Georgia, serif" font-size="12" fill="#5b5449">Name of pupil</text>
    <text x="470" y="94" font-family="Georgia, serif" font-size="12" fill="#5b5449">Sex</text>
    ${rows}
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const PAGES = [1, 2, 3].map((n) => {
  const url = registerPageSvg(n, (n - 1) * 14 + 1)
  return {
    id: `preview-page-${n}`,
    position: n,
    previewUrl: url,
    dataUrl: url,
    imageDigest: `preview-digest-${n}`,
    width: 600,
    height: 800,
    fileName: `register-page-${n}.jpg`,
    rotation: 0,
    enhanced: false,
    sourceFile: null,
    status: 'extracted',
    rows: [],
  }
})

export default function CapturePreview() {
  const back = () => { window.location.href = '/teacher/register-preview' }
  return (
    <CaptureClassListFlow
      className="Grade 4A · Jemareen Academy"
      initialPages={PAGES}
      onCancel={back}
      onExtracted={() => { window.location.href = '/teacher/register-preview/review' }}
    />
  )
}
