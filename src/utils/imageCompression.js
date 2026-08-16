// compressImage — shared browser-side image downscale + JPEG re-encode.
//
// Extracted from AssessmentStudio so the Assessment Studio and the School
// Profile settings panel share one implementation when uploading a logo.
// Browser-only (uses Image + canvas); never imported by the Node test suite.

/**
 * @param {File|Blob} file
 * @param {number} maxWidth  downscale ceiling; never upscales a smaller image
 * @param {number} quality   JPEG quality 0-1
 * @param {string|null} background
 *   Colour painted under the image before drawing. Defaults to null, which
 *   keeps the original behaviour for every existing caller. Pass '#ffffff'
 *   when the source may carry an alpha channel: the output is always JPEG,
 *   which has no transparency, so an unpainted transparent PNG composites
 *   against the canvas's default transparent-black and arrives as a BLACK
 *   background. That is invisible in a preview thumbnail and ruinous on a
 *   scanned page.
 */
export function compressImage(file, maxWidth = 1200, quality = 0.85, background = null) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = image
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width)
        width = maxWidth
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (background) {
        context.fillStyle = background
        context.fillRect(0, 0, width, height)
      }
      context.drawImage(image, 0, 0, width, height)
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Canvas compression failed'))),
        'image/jpeg',
        quality,
      )
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not load image'))
    }
    image.src = objectUrl
  })
}
