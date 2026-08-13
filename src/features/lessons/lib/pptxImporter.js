import { unzipSync, strFromU8 } from 'fflate'
import { createBlankSlide, ensureEndSlide, makeLessonId } from './lessonConstants'

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

const MAX_IMPORT_IMAGE_BYTES = 5 * 1024 * 1024

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

function fileNameToTitle(fileName = '') {
  return fileName
    .replace(/\.pptx$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extensionFromPath(path = '') {
  return path.split('.').pop()?.toLowerCase() || ''
}

function isImageRelationship(rel) {
  return rel?.type?.toLowerCase().includes('/image') || /^ppt\/media\//i.test(rel?.path || '')
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

function extractParagraphs(shape) {
  const txBody = descendantsByLocalName(shape, 'txBody')[0]
  if (!txBody) return []

  return descendantsByLocalName(txBody, 'p')
    .map(paragraph => {
      const text = cleanText(descendantsByLocalName(paragraph, 't').map(node => node.textContent).join(' '))
      if (!text) return null
      const paragraphProps = firstChildByLocalName(paragraph, 'pPr')
      const level = Number(paragraphProps?.getAttribute('lvl') || 0)
      const hasBullet = descendantsByLocalName(paragraphProps || paragraph, 'buChar').length > 0 ||
        descendantsByLocalName(paragraphProps || paragraph, 'buAutoNum').length > 0 ||
        /^[•\-*]\s+/.test(text) ||
        level > 0
      return {
        text: text.replace(/^[•\-*]\s+/, ''),
        isBullet: hasBullet,
        level,
      }
    })
    .filter(Boolean)
}

function getPlaceholderType(shape) {
  const ph = descendantsByLocalName(shape, 'ph')[0]
  return ph?.getAttribute('type') || ''
}

function extractTextRuns(slideDoc) {
  const shapes = elementsByLocalName(slideDoc, 'sp')
  const runs = []

  shapes.forEach(shape => {
    const paragraphs = extractParagraphs(shape)
    if (!paragraphs.length) return
    const placeholderType = getPlaceholderType(shape)
    const text = paragraphs.map(paragraph => paragraph.text).join(' ')
    runs.push({
      placeholderType,
      text,
      paragraphs,
      isTitle: placeholderType === 'title' || placeholderType === 'ctrTitle' || placeholderType === 'subTitle',
    })
  })

  return runs
}

function extractPicBounds(pic) {
  const spPr = firstDescendantByLocalName(pic, 'spPr')
  const xfrm = firstChildByLocalName(spPr, 'xfrm') || firstDescendantByLocalName(pic, 'xfrm')
  const off = firstChildByLocalName(xfrm, 'off')
  const ext = firstChildByLocalName(xfrm, 'ext')
  const cx = numberAttr(ext, 'cx')
  const cy = numberAttr(ext, 'cy')

  return {
    x: numberAttr(off, 'x'),
    y: numberAttr(off, 'y'),
    cx,
    cy,
    area: cx * cy,
  }
}

function extractPicName(pic) {
  const cNvPr = firstDescendantByLocalName(pic, 'cNvPr')
  return cNvPr?.getAttribute('name') || ''
}

function isBackgroundLikeImage(bounds, slideSize, isRepeated, picName = '') {
  const slideArea = slideSize.cx * slideSize.cy
  const coverage = slideArea > 0 ? bounds.area / slideArea : 0
  const centeredFullSlide = bounds.cx >= slideSize.cx * 0.82 && bounds.cy >= slideSize.cy * 0.82
  const nameLooksDecorative = /background|bg|backdrop|template|theme/i.test(picName)
  return coverage >= 0.62 || centeredFullSlide || (isRepeated && (coverage >= 0.42 || nameLooksDecorative))
}

function collectImageUsage(slidePaths, zipEntries) {
  const usage = new Map()

  slidePaths.forEach(slidePath => {
    const relPath = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
    const relationships = parseRelationships(zipEntries, relPath, 'ppt/slides')
    relationships.forEach(rel => {
      if (!isImageRelationship(rel)) return
      usage.set(rel.path, (usage.get(rel.path) || 0) + 1)
    })
  })

  return usage
}

function createImageAsset(rel, bytes, assetCache) {
  const extension = extensionFromPath(rel.path)
  const contentType = PPTX_MIME[extension]
  if (!contentType) return null

  const cached = assetCache.get(rel.path)
  if (cached) return cached

  const blob = new Blob([bytes], { type: contentType })
  const objectUrl = typeof URL !== 'undefined' && URL.createObjectURL
    ? URL.createObjectURL(blob)
    : ''
  const asset = {
    assetId: makeLessonId('pptx-img'),
    sourcePath: rel.path,
    extension,
    contentType,
    size: bytes.length,
    blob,
    objectUrl,
  }
  assetCache.set(rel.path, asset)
  return asset
}

function imageFromRelationship({ rel, zipEntries, warnings, assetCache }) {
  if (!rel) {
    warnings.push('An image relationship could not be resolved.')
    return null
  }

  const extension = extensionFromPath(rel.path)
  if (!PPTX_MIME[extension]) {
    warnings.push(`An unsupported image type was skipped: ${extension || 'unknown'}.`)
    return null
  }

  const bytes = zipEntries[rel.path]
  if (!bytes) {
    warnings.push('An image file referenced by this slide was not found.')
    return null
  }

  if (bytes.length > MAX_IMPORT_IMAGE_BYTES) {
    warnings.push('An image was larger than 5 MB and was skipped.')
    return null
  }

  return createImageAsset(rel, bytes, assetCache)
}

function extractImages({ slideDoc, relationships, zipEntries, warnings, imageUsage, slideSize, assetCache }) {
  const images = []
  const seenEmbedIds = new Set()

  elementsByLocalName(slideDoc, 'pic').forEach(pic => {
    const blip = firstDescendantByLocalName(pic, 'blip')
    const embedId = attr(blip, 'embed')
    if (!embedId) {
      warnings.push('A PowerPoint picture did not include an embedded image relationship.')
      return
    }
    seenEmbedIds.add(embedId)

    const rel = relationships.get(embedId)
    const asset = imageFromRelationship({ rel, zipEntries, warnings, assetCache })
    if (!asset) return

    const bounds = extractPicBounds(pic)
    const isRepeated = (imageUsage.get(rel.path) || 0) > 1
    const picName = extractPicName(pic)
    images.push({
      ...asset,
      bounds,
      picName,
      isRepeated,
      isBackgroundLike: isBackgroundLikeImage(bounds, slideSize, isRepeated, picName),
      imageUrl: asset.objectUrl,
    })
  })

  descendantsByLocalName(slideDoc, 'blip').forEach(blip => {
    const embedId = attr(blip, 'embed')
    if (!embedId || seenEmbedIds.has(embedId)) return

    const rel = relationships.get(embedId)
    if (!isImageRelationship(rel)) return
    const asset = imageFromRelationship({ rel, zipEntries, warnings, assetCache })
    if (!asset) return

    images.push({
      ...asset,
      bounds: { x: 0, y: 0, cx: 0, cy: 0, area: 0 },
      picName: 'PowerPoint background image',
      isRepeated: (imageUsage.get(rel.path) || 0) > 1,
      isBackgroundLike: true,
      imageUrl: asset.objectUrl,
    })
  })

  return images
}

function choosePrimaryImage(images) {
  if (!images.length) return null

  const contentImages = images.filter(image => !image.isBackgroundLike)
  const candidates = contentImages.length ? contentImages : images

  return [...candidates].sort((a, b) => {
    if (a.isRepeated !== b.isRepeated) return a.isRepeated ? 1 : -1
    if (a.isBackgroundLike !== b.isBackgroundLike) return a.isBackgroundLike ? 1 : -1
    return (b.bounds?.area || 0) - (a.bounds?.area || 0) || b.size - a.size
  })[0]
}

function addImageFields(slide, image, title) {
  if (!image) return slide
  return {
    ...slide,
    imageUrl: image.imageUrl || '',
    imageAlt: title,
    importAssetId: image.assetId,
    imageSourcePath: image.sourcePath,
  }
}

function makeExtraImageSlide({ image, title, slidePath, index, extraIndex }) {
  const warning = 'Created from an additional PowerPoint image on the same slide; check placement and caption before publishing.'
  return createBlankSlide('imageText', {
    id: makeLessonId('pptx-extra-img'),
    title: `${title || `Imported Slide ${index + 1}`} image ${extraIndex + 1}`,
    body: 'Review this imported picture and add any caption or explanation learners need.',
    imageUrl: image.imageUrl || '',
    imageAlt: title || `Imported image ${extraIndex + 1}`,
    importAssetId: image.assetId,
    imageSourcePath: image.sourcePath,
    sourceSlidePath: slidePath,
    requiresReview: true,
    reviewNotes: [warning],
    importWarnings: [warning],
  })
}

function slideFromPowerPoint({ slideDoc, slidePath, relationships, zipEntries, index, importState }) {
  const warnings = []
  const runs = extractTextRuns(slideDoc)
  const images = extractImages({
    slideDoc,
    relationships,
    zipEntries,
    warnings,
    imageUsage: importState.imageUsage,
    slideSize: importState.slideSize,
    assetCache: importState.assetCache,
  })
  const hasGraphicFrame = elementsByLocalName(slideDoc, 'graphicFrame').length > 0
  const hasTable = descendantsByLocalName(slideDoc, 'tbl').length > 0
  const hasChart = descendantsByLocalName(slideDoc, 'chart').length > 0

  const primaryImage = choosePrimaryImage(images)
  const contentImages = images.filter(image => !image.isBackgroundLike)
  const ignoredBackgrounds = images.filter(image => image.isBackgroundLike && image !== primaryImage)
  const extraImages = contentImages.filter(image => image !== primaryImage)

  if (!runs.length && !images.length) {
    warnings.push('No editable text or supported image could be extracted from this slide.')
  }
  if (hasChart) warnings.push('A chart was detected and should be recreated or checked in the slide builder.')
  if (hasTable) warnings.push('A table was detected; please check that its content imported in the right order.')
  if (hasGraphicFrame && !hasTable && !hasChart) warnings.push('A complex PowerPoint object was detected and may need manual review.')
  if (runs.length > 4) warnings.push('This slide had several text boxes; please check reading order.')
  if (extraImages.length) warnings.push('Multiple PowerPoint images were split into extra editable image slides.')
  if (ignoredBackgrounds.length) warnings.push('A repeated or background-like PowerPoint image was ignored on this slide.')
  if (primaryImage?.isBackgroundLike && images.length === 1) warnings.push('Only a background-like image was available, so it was used. Check that this is useful for learners.')

  const titleRun = runs.find(run => run.isTitle) || runs.find(run => run.text.length <= 90)
  const title = titleRun?.text || `Imported Slide ${index + 1}`
  const contentRuns = runs.filter(run => run !== titleRun)
  const allParagraphs = contentRuns.flatMap(run => run.paragraphs)
  const bulletParagraphs = allParagraphs.filter(paragraph => paragraph.isBullet)
  const nonBulletText = allParagraphs
    .filter(paragraph => !paragraph.isBullet)
    .map(paragraph => paragraph.text)
    .join('\n\n')

  let type = 'text'
  if (primaryImage) type = 'imageText'
  else if (bulletParagraphs.length >= 2) type = 'bullets'
  else if (index === 0 && runs.length <= 2) type = 'title'

  const common = {
    id: makeLessonId('pptx-slide'),
    title,
    sourceSlidePath: slidePath,
    requiresReview: warnings.length > 0,
    reviewNotes: warnings,
    importWarnings: warnings,
  }

  let mainSlide
  if (type === 'title') {
    mainSlide = createBlankSlide('title', {
      ...common,
      subtitle: contentRuns[0]?.text || '',
      body: contentRuns.slice(1).map(run => run.text).join('\n\n'),
    })
  } else if (type === 'imageText') {
    mainSlide = addImageFields(createBlankSlide('imageText', {
      ...common,
      body: nonBulletText || bulletParagraphs.map(paragraph => paragraph.text).join('\n'),
      bullets: bulletParagraphs.map(paragraph => paragraph.text),
    }), primaryImage, title)
  } else if (type === 'bullets') {
    mainSlide = createBlankSlide('bullets', {
      ...common,
      body: nonBulletText,
      bullets: bulletParagraphs.map(paragraph => paragraph.text),
    })
  } else {
    mainSlide = createBlankSlide('text', {
      ...common,
      body: nonBulletText || contentRuns.map(run => run.text).join('\n\n') || title,
    })
  }

  return [
    mainSlide,
    ...extraImages.map((image, extraIndex) => makeExtraImageSlide({ image, title, slidePath, index, extraIndex })),
  ]
}

export async function importPowerPointLesson(file) {
  if (!file) throw new Error('Choose a PowerPoint file first.')
  if (!file.name.toLowerCase().endsWith('.pptx')) throw new Error('Please upload a .pptx PowerPoint file.')

  const buffer = await file.arrayBuffer()
  const zipEntries = unzipSync(new Uint8Array(buffer))
  const slidePaths = getSlidePaths(zipEntries)
  if (!slidePaths.length) throw new Error('No slides were found in this PowerPoint file.')

  const importState = {
    assetCache: new Map(),
    imageUsage: collectImageUsage(slidePaths, zipEntries),
    slideSize: getPresentationSize(zipEntries),
  }

  const slides = slidePaths.flatMap((slidePath, index) => {
    const slideDoc = parseXml(strFromU8(zipEntries[slidePath]), slidePath)
    const relPath = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
    const relationships = parseRelationships(zipEntries, relPath, 'ppt/slides')
    return slideFromPowerPoint({ slideDoc, slidePath, relationships, zipEntries, index, importState })
  })

  const importedSlides = ensureEndSlide(slides)
  const needsReview = importedSlides.some(slide => slide.requiresReview)
  const firstTitle = importedSlides.find(slide => slide.type === 'title')?.title || importedSlides[0]?.title

  return {
    title: firstTitle || fileNameToTitle(file.name) || 'Imported PowerPoint Lesson',
    slides: importedSlides,
    imageAssets: Array.from(importState.assetCache.values()),
    sourceFileName: file.name,
    assetBatchId: makeLessonId('lesson-assets'),
    importStatus: needsReview ? 'needs_review' : 'success',
    mode: 'imported_pptx',
    creationMode: 'imported_pptx',
  }
}
