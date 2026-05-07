import { unzipSync, strFromU8 } from 'fflate'
import { makeLessonId } from './lessonConstants'

const PPTX_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

const DEFAULT_SLIDE_SIZE = {
  cx: 12192000,
  cy: 6858000,
}

const DEFAULT_RENDER_WIDTH = 1280

function parseXml(xmlText, fileName) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const parserError = doc.getElementsByTagName('parsererror')[0]
  if (parserError) throw new Error(`Could not parse ${fileName}.`)
  return doc
}

function elementsByLocalName(root, name) {
  return Array.from(root.getElementsByTagName('*')).filter(node => node.localName === name)
}

function firstChildByLocalName(root, name) {
  return Array.from(root?.children || []).find(node => node.localName === name) || null
}

function descendantsByLocalName(root, name) {
  return Array.from(root.getElementsByTagName('*')).filter(node => node.localName === name)
}

function firstDescendantByLocalName(root, name) {
  return descendantsByLocalName(root, name)[0] || null
}

function attr(node, name) {
  if (!node) return ''
  return node.getAttribute(name) || node.getAttribute(`r:${name}`) || ''
}

function numberAttr(node, name, fallback = 0) {
  const value = Number(node?.getAttribute(name))
  return Number.isFinite(value) ? value : fallback
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function normalizePath(path) {
  const parts = []
  path.split('/').forEach(part => {
    if (!part || part === '.') return
    if (part === '..') parts.pop()
    else parts.push(part)
  })
  return parts.join('/')
}

function resolveTarget(baseDir, target) {
  if (!target) return ''
  if (target.startsWith('/')) return normalizePath(target.slice(1))
  return normalizePath(`${baseDir}/${target}`)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function extensionFromPath(path = '') {
  return path.split('.').pop()?.toLowerCase() || ''
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function bytesToDataUrl(bytes, path) {
  const extension = extensionFromPath(path)
  const mime = PPTX_MIME[extension] || 'application/octet-stream'
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

function parseRelationships(zipEntries, relPath, baseDir) {
  const relBytes = zipEntries[relPath]
  if (!relBytes) return new Map()
  const doc = parseXml(strFromU8(relBytes), relPath)
  const relationships = new Map()
  elementsByLocalName(doc, 'Relationship').forEach(rel => {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (!id || !target) return
    relationships.set(id, {
      id,
      type: rel.getAttribute('Type') || '',
      target,
      path: resolveTarget(baseDir, target),
    })
  })
  return relationships
}

function relsPathForPart(partPath) {
  const index = partPath.lastIndexOf('/')
  return `${partPath.slice(0, index)}/_rels/${partPath.slice(index + 1)}.rels`
}

function baseDirForPart(partPath) {
  return partPath.slice(0, partPath.lastIndexOf('/'))
}

function relatedXmlPart(relationships, typeName, zipEntries) {
  const rel = Array.from(relationships.values()).find(item => item.type.toLowerCase().includes(`/${typeName}`))
  if (!rel?.path || !zipEntries[rel.path]) return null
  return {
    path: rel.path,
    doc: parseXml(strFromU8(zipEntries[rel.path]), rel.path),
    relationships: parseRelationships(zipEntries, relsPathForPart(rel.path), baseDirForPart(rel.path)),
  }
}

function getPresentationSize(zipEntries) {
  const presentationBytes = zipEntries['ppt/presentation.xml']
  if (!presentationBytes) return DEFAULT_SLIDE_SIZE

  try {
    const doc = parseXml(strFromU8(presentationBytes), 'ppt/presentation.xml')
    const size = elementsByLocalName(doc, 'sldSz')[0]
    return {
      cx: numberAttr(size, 'cx', DEFAULT_SLIDE_SIZE.cx),
      cy: numberAttr(size, 'cy', DEFAULT_SLIDE_SIZE.cy),
    }
  } catch (error) {
    console.warn('PowerPoint slide size parsing failed:', error)
    return DEFAULT_SLIDE_SIZE
  }
}

function getSlidePaths(zipEntries) {
  const presentationBytes = zipEntries['ppt/presentation.xml']
  const presentationRels = parseRelationships(zipEntries, 'ppt/_rels/presentation.xml.rels', 'ppt')

  if (presentationBytes && presentationRels.size) {
    try {
      const doc = parseXml(strFromU8(presentationBytes), 'ppt/presentation.xml')
      const ordered = elementsByLocalName(doc, 'sldId')
        .map(node => presentationRels.get(attr(node, 'id'))?.path)
        .filter(path => path && zipEntries[path])
      if (ordered.length) return ordered
    } catch (error) {
      console.warn('PowerPoint slide order parsing failed:', error)
    }
  }

  return Object.keys(zipEntries)
    .filter(path => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0))
}

function toPx(value, scale) {
  return Math.round(numberAttr({ getAttribute: () => value }, '', 0) * scale * 100) / 100
}

function boundsToViewBox(pic, scale) {
  const spPr = firstDescendantByLocalName(pic, 'spPr')
  const xfrm = firstChildByLocalName(spPr, 'xfrm') || firstDescendantByLocalName(pic, 'xfrm')
  const off = firstChildByLocalName(xfrm, 'off')
  const ext = firstChildByLocalName(xfrm, 'ext')
  return {
    x: toPx(off?.getAttribute('x') || 0, scale),
    y: toPx(off?.getAttribute('y') || 0, scale),
    width: Math.max(1, toPx(ext?.getAttribute('cx') || 0, scale)),
    height: Math.max(1, toPx(ext?.getAttribute('cy') || 0, scale)),
  }
}

function getColor(root, fallback) {
  const color = descendantsByLocalName(root, 'srgbClr')[0]?.getAttribute('val')
  return color ? `#${color}` : fallback
}

function getSlideBackground(slideDoc) {
  const bgPr = descendantsByLocalName(slideDoc, 'bgPr')[0]
  if (!bgPr) return ''
  return getColor(bgPr, '#ffffff')
}

function getShapeText(shape) {
  const txBody = descendantsByLocalName(shape, 'txBody')[0]
  if (!txBody) return []

  return descendantsByLocalName(txBody, 'p')
    .map(paragraph => {
      const runs = descendantsByLocalName(paragraph, 't').map(node => cleanText(node.textContent)).filter(Boolean)
      const text = runs.join(' ')
      if (!text) return null
      const paragraphProps = firstChildByLocalName(paragraph, 'pPr')
      const isBullet = descendantsByLocalName(paragraphProps || paragraph, 'buChar').length > 0 ||
        descendantsByLocalName(paragraphProps || paragraph, 'buAutoNum').length > 0 ||
        Number(paragraphProps?.getAttribute('lvl') || 0) > 0
      return { text, isBullet }
    })
    .filter(Boolean)
}

function getPlaceholderType(shape) {
  const ph = descendantsByLocalName(shape, 'ph')[0]
  return ph?.getAttribute('type') || ''
}

function shapeFontSize(shape, placeholderType) {
  const runProps = descendantsByLocalName(shape, 'rPr')[0]
  const size = Number(runProps?.getAttribute('sz'))
  if (Number.isFinite(size) && size > 0) return Math.max(10, Math.round(size / 100))
  if (placeholderType === 'title' || placeholderType === 'ctrTitle') return 42
  if (placeholderType === 'subTitle') return 28
  return 22
}

function shapeAlignment(shape) {
  const algn = descendantsByLocalName(shape, 'pPr')[0]?.getAttribute('algn')
  if (algn === 'ctr') return 'center'
  if (algn === 'r') return 'right'
  return 'left'
}

function renderTextShape(shape, scale) {
  const paragraphs = getShapeText(shape)
  if (!paragraphs.length) return ''

  const bounds = boundsToViewBox(shape, scale)
  if (bounds.width <= 1 || bounds.height <= 1) return ''

  const placeholderType = getPlaceholderType(shape)
  const fontSize = shapeFontSize(shape, placeholderType)
  const color = getColor(shape, '#111827')
  const fontWeight = placeholderType === 'title' || placeholderType === 'ctrTitle' ? 800 : 650
  const textAlign = shapeAlignment(shape)
  const html = paragraphs.map(paragraph => {
    const bullet = paragraph.isBullet ? '<span style="margin-right: 10px;">&bull;</span>' : ''
    return `<div style="margin:0 0 8px 0;">${bullet}<span>${escapeHtml(paragraph.text)}</span></div>`
  }).join('')

  return `
    <foreignObject x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:100%;height:100%;padding:6px 8px;overflow:hidden;color:${color};font-family:Arial,Helvetica,sans-serif;font-size:${fontSize}px;font-weight:${fontWeight};line-height:1.18;text-align:${textAlign};">
        ${html}
      </div>
    </foreignObject>
  `
}

function renderPicture(pic, relationships, zipEntries, scale, warnings) {
  const blip = firstDescendantByLocalName(pic, 'blip')
  const rel = relationships.get(attr(blip, 'embed'))
  if (!rel) {
    warnings.push('A picture relationship could not be resolved.')
    return ''
  }

  const extension = extensionFromPath(rel.path)
  if (!PPTX_MIME[extension]) {
    warnings.push(`Unsupported picture type skipped: ${extension || 'unknown'}.`)
    return ''
  }

  const bytes = zipEntries[rel.path]
  if (!bytes) {
    warnings.push('A picture file referenced by the presentation was missing.')
    return ''
  }

  const bounds = boundsToViewBox(pic, scale)
  const href = bytesToDataUrl(bytes, rel.path)
  return `<image href="${href}" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" preserveAspectRatio="xMidYMid meet" />`
}

function renderLayer({ doc, relationships, zipEntries, scale, warnings, includeText }) {
  const pictures = elementsByLocalName(doc, 'pic')
    .map(pic => renderPicture(pic, relationships, zipEntries, scale, warnings))
    .join('')
  const textShapes = includeText
    ? elementsByLocalName(doc, 'sp').map(shape => renderTextShape(shape, scale)).join('')
    : ''

  if (elementsByLocalName(doc, 'graphicFrame').length) {
    warnings.push('A chart, table, or complex object may not look exactly like PowerPoint.')
  }

  return `${pictures}${textShapes}`
}

function buildSlideSvg({ slideDoc, relationships, zipEntries, width, height, scale, warnings }) {
  const layout = relatedXmlPart(relationships, 'slideLayout', zipEntries)
  const master = layout ? relatedXmlPart(layout.relationships, 'slideMaster', zipEntries) : null
  const background = getSlideBackground(slideDoc) || getSlideBackground(layout?.doc) || getSlideBackground(master?.doc) || '#ffffff'
  const masterLayer = master ? renderLayer({ doc: master.doc, relationships: master.relationships, zipEntries, scale, warnings, includeText: false }) : ''
  const layoutLayer = layout ? renderLayer({ doc: layout.doc, relationships: layout.relationships, zipEntries, scale, warnings, includeText: false }) : ''
  const slideLayer = renderLayer({ doc: slideDoc, relationships, zipEntries, scale, warnings, includeText: true })

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="${background}" />
      ${masterLayer}
      ${layoutLayer}
      ${slideLayer}
    </svg>
  `
}

// Rasterize the generated SVG to PNG via a canvas before upload. Storing SVGs
// in Firebase Storage exposed two attack surfaces — a malicious .pptx whose
// shape attributes inject `" onload="..."` into the SVG (the generator escapes
// text but not numeric attribute values), and direct-URL navigation to the
// stored .svg which would execute scripts cross-origin against
// firebasestorage.googleapis.com. PNGs cannot carry script. Canvas rasterizes
// `<foreignObject>` HTML in modern browsers; the SVG references only data:
// URIs internally, so the canvas never goes tainted.
async function svgToPngBlob(svg, width, height) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Slide rasterization requires a browser environment.')
  }
  const svgBlob  = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const objectUrl = URL.createObjectURL(svgBlob)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise((resolve, reject) => {
      img.onload  = () => resolve()
      img.onerror = () => reject(new Error('Browser could not rasterize a slide image.'))
      img.src = objectUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width  = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    return await new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas could not produce a PNG for this slide.'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function renderPowerPointToImages(file) {
  if (!file) throw new Error('Choose a PowerPoint file first.')
  if (!file.name.toLowerCase().endsWith('.pptx')) throw new Error('Please upload a .pptx PowerPoint file.')

  const buffer = await file.arrayBuffer()
  const zipEntries = unzipSync(new Uint8Array(buffer))
  const slidePaths = getSlidePaths(zipEntries)
  if (!slidePaths.length) throw new Error('No slides were found in this PowerPoint file.')

  const size = getPresentationSize(zipEntries)
  const width = DEFAULT_RENDER_WIDTH
  const height = Math.round(width * (size.cy / size.cx))
  const scale = width / size.cx
  const conversionWarnings = []

  const slideImages = []
  for (const [index, slidePath] of slidePaths.entries()) {
    const slideWarnings = []
    const slideDoc = parseXml(strFromU8(zipEntries[slidePath]), slidePath)
    const relPath = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
    const relationships = parseRelationships(zipEntries, relPath, 'ppt/slides')
    const svg = buildSlideSvg({
      slideDoc,
      relationships,
      zipEntries,
      width,
      height,
      scale,
      warnings: slideWarnings,
    })
    const blob = await svgToPngBlob(svg, width, height)
    const objectUrl = URL.createObjectURL(blob)

    slideWarnings.forEach(warning => conversionWarnings.push(`Slide ${index + 1}: ${warning}`))
    slideImages.push({
      id: makeLessonId('pptx-view-slide'),
      order: index + 1,
      imageUrl: objectUrl,
      objectUrl,
      blob,
      width,
      height,
      extension: 'png',
      contentType: 'image/png',
      alt: `PowerPoint slide ${index + 1}`,
      sourceSlidePath: slidePath,
      warnings: slideWarnings,
    })
  }

  return {
    slideImages,
    slideCount: slideImages.length,
    width,
    height,
    conversionWarnings,
  }
}
