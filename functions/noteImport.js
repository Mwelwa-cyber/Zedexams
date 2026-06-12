// functions/noteImport.js
//
// Server glue for Notes document import. Anthropic-only:
//   • runNoteImport — document text → study blocks (best-effort JSON; client
//     validates with coerceStudyBlocks)
//   • runNoteOcr    — page images → plain text (vision), for the scanned path
// Both are thin wrappers over aiService.callAnthropic. assertDailyLimit / app
// check / role gating live in the index.js callables that call these.

const { callAnthropic } = require('./aiService')
const { buildNoteStructureMessages, parseStructuredNote, NOTE_OCR_SYSTEM_PROMPT } = require('./noteStructurePrompt')

const STRUCTURE_MODEL = process.env.NOTE_IMPORT_MODEL || undefined // default = aiService default (Sonnet)

async function runNoteImport({ documentText, fileName = '', apiKey, uid }) {
  const messages = buildNoteStructureMessages({ fileName, documentText })
  const systemPrompt = messages[0].content
  const userMessages = [{ role: 'user', content: messages[1].content }]
  const raw = await callAnthropic(apiKey, {
    systemPrompt,
    messages: userMessages,
    maxTokens: 8000,
    temperature: 0.2,
    json: true,
    model: STRUCTURE_MODEL,
    track: { uid, tool: 'structureImportedNote' },
  })
  return parseStructuredNote(raw)
}

// pages: [{ pageNumber, dataUrl }]. Returns { text } — concatenated transcription.
// Image content shape mirrors scannedQuizImport.js buildClaudeMessages (lines 536-538):
//   { type: "image", source: { type: "base64", media_type, data } }
// This is the standard Anthropic vision content block that callAnthropic passes through.
// Vision input guards, matching scannedQuizImport.js: only image types
// Anthropic accepts, and a per-image byte cap to avoid abuse.
const OCR_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const OCR_MAX_IMAGE_BYTES = 5 * 1024 * 1024 // ~5 MB decoded per page

async function runNoteOcr({ pages, apiKey, uid }) {
  const content = []
  for (const p of pages) {
    const m = String(p?.dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i)
    if (!m) continue
    const mediaType = m[1].toLowerCase()
    if (!OCR_ALLOWED_MIME.has(mediaType)) continue
    const data = m[2].replace(/\s+/g, '')
    // base64 decodes to ~3/4 of its length; skip pages over the cap.
    if (data.length * 0.75 > OCR_MAX_IMAGE_BYTES) continue
    content.push({ type: 'text', text: `Page ${p.pageNumber}` })
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })
  }
  if (content.length === 0) return { text: '' }
  const raw = await callAnthropic(apiKey, {
    systemPrompt: NOTE_OCR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    maxTokens: 8000,
    temperature: 0,
    track: { uid, tool: 'ocrNotePages' },
  })
  return { text: String(raw || '').trim() }
}

module.exports = { runNoteImport, runNoteOcr }
