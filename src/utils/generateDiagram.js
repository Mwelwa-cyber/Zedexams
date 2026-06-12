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
  if (code.includes('failed-precondition') && /openai key looks invalid/i.test(msg)) {
    // Pass the diagnostic through verbatim — it tells the admin exactly which
    // secret to rotate. Surfaced when OpenAI returns 401 from generateDiagram.
    return msg
  }
  if (code.includes('resource-exhausted') && /openai image api is rate-limited/i.test(msg)) {
    return msg
  }
  if (code.includes('failed-precondition') && /colour illustrations are not available|kie api key is not configured/i.test(msg)) {
    return 'Colour illustrations are currently unavailable. Switch to Line art and try again.'
  }
  if (code.includes('failed-precondition') && /kie key looks invalid/i.test(msg)) {
    return msg
  }
  if (code.includes('resource-exhausted') && /kie image api is rate-limited/i.test(msg)) {
    return msg
  }
  if (/kie image request failed/i.test(msg)) {
    return 'Could not generate that colour illustration — try a simpler prompt.'
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
  if (/not_enough_credits/i.test(msg)) {
    // Recraft's 400 body for an empty balance — no prompt will ever work,
    // so don't send the admin off to "simplify" anything.
    return 'The Recraft account is out of image credits — top up at recraft.ai, then run this again.'
  }
  if (/recraft request failed/i.test(msg)) {
    // The server includes Recraft's HTTP status: "Recraft request failed
    // (401): …". Surface the account-level causes so an admin sees "rotate
    // the key" instead of a misleading "simplify your prompt" when every
    // single generation is failing.
    const status = Number((/recraft request failed \((\d{3})\)/i.exec(msg) || [])[1])
    if (status === 401 || status === 403) {
      return 'The Recraft API key was rejected (HTTP ' + status + ') — admin needs to rotate RECRAFT_API_KEY.'
    }
    if (status === 402) {
      return 'The Recraft account is out of credits — top it up, or switch to the Colour/Photoreal styles.'
    }
    if (status === 429) {
      return 'Recraft is rate-limiting us — wait a minute and try again.'
    }
    return `Recraft could not generate that diagram${status ? ` (HTTP ${status})` : ''} — try a simpler prompt.`
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

export async function generateDiagram({ prompt, style, size, provider } = {}) {
  const cleanPrompt = String(prompt || '').trim()
  if (!cleanPrompt) {
    throw new Error('Please describe the diagram you want to generate.')
  }
  try {
    const result = await withTimeout(
      generateDiagramCallable({ prompt: cleanPrompt, style, size, provider }),
      DIAGRAM_TIMEOUT_MS,
    )
    const data = result?.data || {}
    if (!data.url) {
      throw new Error('The AI returned no image. Please try again.')
    }
    return {
      url: data.url,
      prompt: data.prompt || cleanPrompt,
      style: data.style || style || 'line_art',
      size: data.size || size || '1365x1024',
      provider: data.provider || provider || 'recraft',
      sizeBytes: data.sizeBytes || 0,
    }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}
