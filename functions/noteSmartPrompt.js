// functions/noteSmartPrompt.js
//
// Highlight extraction for a study note: given its blocks, ask Claude for the
// few most-important VERBATIM sentences/items per block. Pure (no Firebase) so
// it is unit-tested directly. The client renders these as <mark> highlights.

// Block types learners read as prose — worth highlighting. (image/table/quiz/
// quickcheck/keyterms are excluded: not free-prose or already structured.)
const HIGHLIGHTABLE = new Set(['paragraph','keyidea','bullets','numbers','note','tip','think','summary','objectives'])
const MAX_PER_BLOCK = 3

function blockText(b) {
  if (b.text) return String(b.text)
  if (Array.isArray(b.items)) return b.items.join('\n')
  if (Array.isArray(b.lines)) return b.lines.join('\n')
  return ''
}

function buildHighlightMessages({ blocks }) {
  const items = (blocks || [])
    .filter(b => b && b.id && HIGHLIGHTABLE.has(b.type) && blockText(b).trim())
    .map(b => ({ id: b.id, type: b.type, text: blockText(b) }))
  const system = `You highlight the most important parts of a study note for a learner.
For each block, pick the few VERBATIM sentences or list items that are the key things to remember (definitions, key facts, exam-critical points).
- Quote EXACTLY from the block's text — copy the sentence/item word for word, no paraphrasing.
- At most ${MAX_PER_BLOCK} per block; only the genuinely important ones (skip filler/examples).
- Each key MUST be copied exactly from an "id" field in the input array — never invent, rename, or shorten ids; if a block has nothing worth highlighting, omit its id entirely.
- Output ONLY JSON: { "highlights": { "<exact id from input>": ["exact excerpt", ...] }, "warnings": ["..."] }.`
  const user = `Blocks (JSON):\n${JSON.stringify(items).slice(0, 50000)}`
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

function stripFences(raw) {
  if (!raw) return ''
  const f = String(raw).match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return (f ? f[1] : String(raw)).trim()
}

function parseHighlights(raw) {
  const text = stripFences(raw)
  let data
  try { data = JSON.parse(text) } catch {
    const span = text.match(/\{[\s\S]*\}/)
    if (!span) throw new Error('Could not parse a highlights JSON object.')
    data = JSON.parse(span[0])
  }
  const src = data && typeof data.highlights === 'object' && data.highlights ? data.highlights : {}
  const highlights = {}
  for (const [id, arr] of Object.entries(src)) {
    if (!Array.isArray(arr)) continue
    const list = arr.filter(s => typeof s === 'string' && s.trim().length >= 8).map(s => s.trim()).slice(0, MAX_PER_BLOCK)
    if (list.length) highlights[id] = list
  }
  const warnings = Array.isArray(data?.warnings) ? data.warnings.filter(w => typeof w === 'string') : []
  return { highlights, warnings }
}

function buildSummaryMessages({ blocks }) {
  const items = (blocks || [])
    .filter(b => b && b.id && (b.type === 'heading' || HIGHLIGHTABLE.has(b.type)))
    .map(b => ({ id: b.id, type: b.type, level: b.level, text: blockText(b) }))
  const system = `You write a short summary for each SECTION of a study note.
A section starts at a level-2 heading (type "heading", level 2) and includes the blocks under it until the next level-2 heading.
- For each level-2 heading, write a 1-2 sentence plain-English TL;DR (max ~40 words) of what that section teaches — what a learner would read before the section.
- Key each summary by the EXACT id of its level-2 heading block. Do NOT summarize level-3 sub-headings.
- Use clear Zambian-English. Output ONLY JSON: { "summaries": { "<exact level-2 heading id>": "summary" }, "warnings": ["..."] }.`
  const user = `Blocks (JSON):\n${JSON.stringify(items).slice(0, 50000)}`
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

function parseSummaries(raw) {
  const text = stripFences(raw)
  let data
  try { data = JSON.parse(text) } catch {
    const span = text.match(/\{[\s\S]*\}/)
    if (!span) throw new Error('Could not parse a summaries JSON object.')
    data = JSON.parse(span[0])
  }
  const src = data && typeof data.summaries === 'object' && data.summaries ? data.summaries : {}
  const summaries = {}
  for (const [id, s] of Object.entries(src)) {
    if (typeof s === 'string' && s.trim().length >= 8) summaries[id] = s.trim()
  }
  const warnings = Array.isArray(data?.warnings) ? data.warnings.filter(w => typeof w === 'string') : []
  return { summaries, warnings }
}

module.exports = { buildHighlightMessages, parseHighlights, buildSummaryMessages, parseSummaries, HIGHLIGHTABLE, MAX_PER_BLOCK }
