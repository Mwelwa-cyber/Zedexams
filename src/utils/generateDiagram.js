/**
 * Client wrapper for the `generateDiagram` Cloud Function.
 *
 * Calls the Recraft-backed callable which returns a stable Firebase
 * Storage URL for a freshly-generated B&W line-art diagram.
 *
 * Usage:
 *   const { url, prompt } = await generateDiagram({
 *     prompt: 'Cross-section of human skin with epidermis, dermis, hypodermis',
 *     style: 'line_art', // optional
 *     size: '1365x1024', // optional
 *   })
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const functions = getFunctions(app, 'us-central1')
const generateDiagramCallable = httpsCallable(functions, 'generateDiagram')

// Server has timeoutSeconds: 120. Allow a small margin so the server's
// own error surfaces rather than the client giving up first.
const DIAGRAM_TIMEOUT_MS = 130000

function messageFromError(error) {
  const code = error?.code || ''
  const msg = error?.message || ''
  if (code.includes('failed-precondition') && /quota|limit/i.test(msg)) {
    return msg
  }
  if (code.includes('failed-precondition') && /not configured/i.test(msg)) {
    return 'Diagram generation is not available — admin needs to configure the Recraft key.'
  }
  if (code.includes('resource-exhausted')) {
    return 'Monthly diagram limit reached. Upgrade your plan or try again next month.'
  }
  if (code.includes('permission-denied')) {
    return 'Diagram generation is only available to approved teachers.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in to generate diagrams.'
  }
  if (/recraft request failed/i.test(msg)) {
    return 'Recraft could not generate that diagram — try a simpler prompt.'
  }
  return msg || 'Diagram generation failed. Please try again.'
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Diagram generation timed out. Please try again.')),
      ms,
    )
    promise
      .then(
        value => { clearTimeout(timer); resolve(value) },
        err => { clearTimeout(timer); reject(err) },
      )
      .catch(err => { clearTimeout(timer); reject(err) })
  })
}

export async function generateDiagram({ prompt, style, size } = {}) {
  const cleanPrompt = String(prompt || '').trim()
  if (!cleanPrompt) {
    throw new Error('Please describe the diagram you want to generate.')
  }
  try {
    const result = await withTimeout(
      generateDiagramCallable({ prompt: cleanPrompt, style, size }),
      DIAGRAM_TIMEOUT_MS,
    )
    const data = result?.data || {}
    if (!data.url) {
      throw new Error('Recraft returned no image. Please try again.')
    }
    return {
      url: data.url,
      prompt: data.prompt || cleanPrompt,
      style: data.style || style || 'line_art',
      size: data.size || size || '1365x1024',
      sizeBytes: data.sizeBytes || 0,
    }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}
