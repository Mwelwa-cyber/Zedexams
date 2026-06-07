// functions/noteStructurePrompt.js
//
// Notes document-import: the Claude system/user prompt that turns raw document
// text into `study`-note blocks, plus a tolerant parser. Pure (no Firebase) so
// it is unit-tested directly. The CLIENT does the authoritative validation via
// coerceStudyBlocks (studySchema.js) — this parser only produces best-effort
// JSON and never trusts the model blindly.

// The block vocabulary the model may emit. Mirrors src/features/notes/lib/
// studyBlocks.js — keep in sync if block types change.
const BLOCK_SPEC = `
Allowed block objects (emit a JSON array of these, in reading order):
- { "type":"heading", "level":2|3, "text": "..." }   // level 2 = section, 3 = sub-section
- { "type":"paragraph", "text": "... use **bold** for key terms ..." }
- { "type":"bullets", "items": ["...","..."] }
- { "type":"numbers", "items": ["...","..."] }
- { "type":"keyterms", "rows": [{ "term":"...", "def":"..." }] }
- { "type":"keyidea", "text":"the one key idea" }
- { "type":"note", "lines":["..."] }      // 🧠 remember
- { "type":"tip", "lines":["..."] }       // 💡 study tip
- { "type":"summary", "items":["...","..."] }
- { "type":"quickcheck", "q":"...", "a":"...", "level":"Easy|Medium|Exam Level" }
- { "type":"exam", "q":"...", "a":"..." }
- { "type":"mistake", "wrong":"...", "correct":"..." }
- { "type":"table", "headers":["..."], "rows":[{ "cells":["..."] }] }
- { "type":"picture", "caption":"...", "lines":["describe the diagram"] }  // for a diagram you can SEE described but not extract
- { "type":"image", "assetRef":"<the id from a [[IMAGE:id]] marker>", "caption":"..." }  // ONLY when an [[IMAGE:id]] marker is present`

const SYSTEM_PROMPT = `You convert a textbook/notes document into a structured study note for Zambian CBC learners.
Rewrite the content faithfully and comprehensively into the block format below — do NOT summarize away detail; keep the full teaching content, but organize it with clear section headings, paragraphs, key-term tables, and the occasional quick-check.
${BLOCK_SPEC}

Rules:
- Output ONLY a JSON object: { "blocks": [ ... ], "warnings": [ "..." ] }. No prose outside the JSON.
- Start with a level-2 heading for the topic. Use level-2 headings for major sections so the note is navigable.
- Where you see a marker like [[IMAGE:abc123]], emit an { "type":"image", "assetRef":"abc123", "caption":"..." } block AT THAT POSITION. Never invent assetRef ids; only use ids from markers.
- Prefer keyterms blocks for definitions, summary for end-of-section recaps, quickcheck for self-testing.
- Keep learner-friendly Zambian-English wording. Put warnings (e.g. "input looked truncated") in the warnings array.`

// OCR prompt used by the scanned-PDF path (vision → plain text).
const NOTE_OCR_SYSTEM_PROMPT = `You are an OCR engine. Transcribe the text content of each page image faithfully into clean reading-order plain text (markdown headings/lists allowed). Do not summarize, do not add commentary. If a page contains a diagram you cannot transcribe, write a short line like "[Diagram: <what it shows>]". Output only the transcribed text.`

function buildNoteStructureMessages({ fileName = '', documentText = '' }) {
  const user = `File: ${String(fileName || 'document')}\n\nDocument text to convert into a study note:\n"""\n${String(documentText || '').slice(0, 60000)}\n"""`
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ]
}

function stripFences(raw) {
  if (!raw) return ''
  const fence = String(raw).match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return (fence ? fence[1] : String(raw)).trim()
}

// Tolerant parse: accept { blocks, warnings } or a bare blocks array. Keep only
// objects with a string `type`. Throws if no JSON can be recovered at all.
function parseStructuredNote(raw) {
  const text = stripFences(raw)
  let data
  try {
    data = JSON.parse(text)
  } catch {
    // last-ditch: grab the first {...} or [...] span
    const span = text.match(/[[{][\s\S]*[\]}]/)
    if (!span) throw new Error('Could not parse a JSON note from the model output.')
    data = JSON.parse(span[0])
  }
  const rawBlocks = Array.isArray(data) ? data : Array.isArray(data?.blocks) ? data.blocks : null
  if (!rawBlocks) throw new Error('Model output had no blocks array.')
  const blocks = rawBlocks.filter(b => b && typeof b === 'object' && typeof b.type === 'string')
  const warnings = Array.isArray(data?.warnings) ? data.warnings.filter(w => typeof w === 'string') : []
  return { blocks, warnings }
}

module.exports = { buildNoteStructureMessages, parseStructuredNote, NOTE_OCR_SYSTEM_PROMPT, SYSTEM_PROMPT }
