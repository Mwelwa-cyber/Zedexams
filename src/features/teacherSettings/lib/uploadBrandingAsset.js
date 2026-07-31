// Branding-asset uploads for Teacher Settings (browser-only IO).
//
// Every asset lives under user-branding/{uid}/ with a VERSIONED filename
// (base-<timestamp>.ext). Overwriting a Storage object in place resets its
// download token, which would break the URL snapshots already stamped onto
// saved papers (assessments store schoolLogoUrl) — so a re-upload mints a new
// object and old papers keep working. Superseded versions are left in place
// (small images) and are swept with the whole prefix on account deletion
// (functions/storageCleanup USER_KEYED_PREFIXES). storage.rules caps uploads
// at 5 MB image/(jpeg|png|webp).
//
// Photos re-encode to JPEG via the shared compressImage; logos, signatures,
// and letterheads go through preparePngImage, which PRESERVES ALPHA — a
// signature flattened to JPEG would print as a white box on papers.

import { getDownloadURL, ref as storageRef, uploadBytes, deleteObject } from 'firebase/storage'
import { storage } from '../../../firebase/config'
import { compressImage } from '../../../utils/imageCompression'
import { assertFileSignature } from '../../../utils/fileSignature'

export const BRANDING_ASSETS = {
  photo: { base: 'profile-photo', ext: 'jpg', maxWidth: 512, keepAlpha: false },
  schoolLogo: { base: 'school-logo', ext: 'png', maxWidth: 800, keepAlpha: true },
  teacherSignature: { base: 'signature', ext: 'png', maxWidth: 800, keepAlpha: true },
  letterhead: { base: 'letterhead', ext: 'png', maxWidth: 1600, keepAlpha: true },
}

const MAX_BYTES = 5 * 1024 * 1024
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Downscale to maxWidth and re-encode as PNG, keeping transparency.
function preparePngImage(file, maxWidth) {
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
      canvas.getContext('2d').drawImage(image, 0, 0, width, height)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Image processing failed'))),
        'image/png',
      )
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not load image'))
    }
    image.src = objectUrl
  })
}

// Upload one branding asset. Returns { url, path } for Firestore.
export async function uploadBrandingAsset(uid, kind, file) {
  const spec = BRANDING_ASSETS[kind]
  if (!uid || !spec) throw new Error('Unknown upload')
  if (!OK_TYPES.includes(file?.type)) {
    throw new Error('Please choose a JPG, PNG or WebP image.')
  }
  // The declared type is the client's word — verify the real bytes (STOR-003).
  await assertFileSignature(file, OK_TYPES, { label: 'a JPG, PNG or WebP image' })
  if (file.size > MAX_BYTES * 4) {
    // Pre-compression sanity cap (post-compression enforced by rules).
    throw new Error('That image is too large — please choose one under 20 MB.')
  }
  const blob = spec.keepAlpha
    ? await preparePngImage(file, spec.maxWidth)
    : await compressImage(file, spec.maxWidth, 0.85)
  if (blob.size > MAX_BYTES) {
    throw new Error('That image is too large even after compression — try a smaller one.')
  }
  const path = `user-branding/${uid}/${spec.base}-${Date.now()}.${spec.ext}`
  const ref = storageRef(storage, path)
  await uploadBytes(ref, blob, {
    contentType: spec.keepAlpha ? 'image/png' : 'image/jpeg',
    cacheControl: 'private, max-age=300',
  })
  const url = await getDownloadURL(ref)
  return { url, path }
}

// Remove the CURRENT object by its stored path ("Remove" flows pass the
// *Path field from Firestore). Ignores not-found so a dangling reference can
// still be cleared.
export async function deleteBrandingAssetByPath(path) {
  if (!path || !path.startsWith('user-branding/')) return
  try {
    await deleteObject(storageRef(storage, path))
  } catch (err) {
    if (err?.code !== 'storage/object-not-found') throw err
  }
}
