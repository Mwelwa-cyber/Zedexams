/**
 * extractClassList — read photographed / scanned class-list pages into learner
 * rows.
 *
 * The thin IO wrapper around ./extractClassListCore (prompt + parsing, plain
 * node tested). Role gating, App Check, rate limiting and the daily AI cap
 * live in the callable in functions/index.js, matching runNoteOcr.
 *
 * NOTHING THIS RETURNS IS SAVED ANYWHERE. The callable hands the rows back to
 * the browser, the teacher reviews them on the import review screen, and the
 * writes happen from there. A class list is not a thing to be written by a
 * model without a person having read it (§6).
 */

const { callAnthropic } = require('../aiService')
const {
  SYSTEM_PROMPT,
  EXTRACTION_TOOL,
  MAX_PAGES_PER_CALL,
  buildImageContent,
  parseExtraction,
} = require('./extractClassListCore')

/**
 * @param {object} args
 * @param {Array}  args.pages   [{ pageNumber, dataUrl }]
 * @param {string} args.apiKey
 * @param {string} args.uid
 * @returns {Promise<{ pages, totalRows, rejectedPages }>}
 */
async function runClassListExtraction({ pages, apiKey, uid }) {
  const { content, accepted, rejected } = buildImageContent(pages)

  if (content.length === 0) {
    // Every page was rejected before a model was ever called. Reported as
    // failed pages rather than as an empty class list.
    return {
      pages: (Array.isArray(pages) ? pages : []).map((p) => ({
        pageNumber: p?.pageNumber ?? null,
        status: 'failed',
        note: 'This page was not a readable image.',
        rows: [],
      })),
      totalRows: 0,
      rejectedPages: rejected,
    }
  }

  const raw = await callAnthropic(apiKey, {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    maxTokens: 8000,
    // Zero, because this is transcription. Every degree of creativity here is
    // a name that gets tidied into one the model finds more plausible.
    temperature: 0,
    tools: [EXTRACTION_TOOL],
    toolChoice: { type: 'tool', name: EXTRACTION_TOOL.name },
    track: { uid, tool: 'extractClassListPages' },
  })

  let toolInput
  try {
    toolInput = JSON.parse(raw)
  } catch {
    toolInput = null
  }

  const result = parseExtraction(toolInput, { requestedPages: accepted })
  return { ...result, rejectedPages: rejected }
}

module.exports = { runClassListExtraction, MAX_PAGES_PER_CALL }
