/**
 * Editable templates (brief item 9) backed by the existing diagram catalog
 * (src/curriculum/diagrams/diagramCatalog.js). A template renders a real
 * structural diagram (shapes, number line, Venn, bar chart, plant/animal cell,
 * circuit, flow chart…) to a PNG and drops it onto the canvas, where the
 * teacher annotates it with labels and arrows — that annotation IS the
 * "editing".
 *
 * Subject-specific illustrations the catalog doesn't carry (human body, water
 * cycle, weather…) stay as AI generation presets in TemplatesPanel.
 *
 * Browser-only (rasterises SVG via <canvas>).
 */

import { renderDiagramSvg, getDiagram } from '../../../curriculum/diagrams/diagramCatalog'
import { svgToPngBlob } from '../../../utils/svgRasterizer'

// Curated, classroom-friendly subset of the catalog. `params` use the
// catalog's own defaults unless noted.
export const LIBRARY_TEMPLATES = [
  { id: 'numberline', title: 'Number line', libraryKey: 'numberline', subject: 'Mathematics' },
  { id: 'barchart', title: 'Bar chart', libraryKey: 'barchart', subject: 'Mathematics' },
  { id: 'piechart', title: 'Pie chart', libraryKey: 'piechart', subject: 'Mathematics' },
  { id: 'linegraph', title: 'Line graph', libraryKey: 'linegraph', subject: 'Mathematics' },
  { id: 'coordgrid', title: 'Coordinate grid', libraryKey: 'coordgrid', subject: 'Mathematics' },
  { id: 'fractionbar', title: 'Fraction bar', libraryKey: 'fractionbar', subject: 'Mathematics' },
  { id: 'vennelements', title: 'Venn diagram', libraryKey: 'vennelements', subject: 'Mathematics' },
  { id: 'clockface', title: 'Clock face', libraryKey: 'clockface', subject: 'Mathematics' },
  { id: 'triangle', title: 'Triangle', libraryKey: 'triangle', subject: 'Mathematics' },
  { id: 'rectangle', title: 'Rectangle', libraryKey: 'rectangle', subject: 'Mathematics' },
  { id: 'circle', title: 'Circle', libraryKey: 'circle', subject: 'Mathematics' },
  { id: 'cube', title: 'Cube', libraryKey: 'cube', subject: 'Mathematics' },
  { id: 'cylinder', title: 'Cylinder', libraryKey: 'cylinder', subject: 'Mathematics' },
  { id: 'plantcell', title: 'Plant cell', libraryKey: 'plantcell', subject: 'Integrated Science' },
  { id: 'animalcell', title: 'Animal cell', libraryKey: 'animalcell', subject: 'Integrated Science' },
  { id: 'circuit', title: 'Electric circuit', libraryKey: 'circuit', subject: 'Integrated Science' },
  { id: 'foodchain', title: 'Food chain', libraryKey: 'foodchain', subject: 'Integrated Science' },
  { id: 'forcearrows', title: 'Force arrows', libraryKey: 'forcearrows', subject: 'Integrated Science' },
  { id: 'compass', title: 'Compass', libraryKey: 'compass', subject: 'Social Studies' },
  { id: 'flowchart', title: 'Flow chart', libraryKey: 'flowchart', subject: 'Integrated Science' },
  { id: 'timeline', title: 'Timeline', libraryKey: 'timeline', subject: 'Social Studies' },
  { id: 'mindmap', title: 'Mind map', libraryKey: 'mindmap', subject: 'English' },
].filter((t) => Boolean(getDiagram(t.libraryKey)))

function svgViewBoxSize(svg) {
  const m = /viewBox="([\d.\s-]+)"/.exec(svg || '')
  if (m) {
    const parts = m[1].trim().split(/\s+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) return { w: parts[2], h: parts[3] }
  }
  return { w: 800, h: 600 }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('Could not read template image'))
    fr.readAsDataURL(blob)
  })
}

/**
 * Rasterise a library template to a data URL and return a "visual" object the
 * editor can open. Black on white so it prints cleanly.
 * @returns {Promise<object>}
 */
export async function loadLibraryTemplate(template) {
  const svg = renderDiagramSvg(template.libraryKey, template.params || {}, '#111111')
  if (!svg) throw new Error('That template is unavailable.')
  const { w, h } = svgViewBoxSize(svg)
  // 2× for crisp print; cap the long side so the data URL stays light.
  const scale = Math.min(2, 1200 / Math.max(w, h))
  const blob = await svgToPngBlob(svg, Math.round(w * scale), Math.round(h * scale))
  const dataUrl = await blobToDataUrl(blob)
  return {
    imageUrl: dataUrl,
    title: template.title,
    subject: template.subject || '',
    style: 'bw_test_diagram',
    isBlackAndWhite: true,
    sourceType: 'template',
    templateKey: template.libraryKey,
  }
}
