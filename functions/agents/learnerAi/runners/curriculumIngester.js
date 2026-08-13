/**
 * Curriculum Ingester — pure parser + extractor helpers.
 *
 * Sibling to curriculumWatcher.js. When the watcher detects that a
 * trusted source has changed (or is being seen for the first time),
 * it hands the fetched HTML to this module which:
 *
 *   1. discoverModuleLinks(html, baseUrl)
 *      → array of candidate module download URLs (PDF, DOCX, HTML)
 *
 *   2. parseDocument(buffer, kind)
 *      → { text, headings[] } for any of the three formats
 *
 *   3. classifyModule({ url, anchorText, headings, firstChars })
 *      → { grade, subject, term, topic, confidence }
 *
 *   4. chunkText(text)
 *      → array of overlapping text windows ready for embedding
 *
 *   5. embedChunks(chunks, apiKey)
 *      → array of { text, embedding } using OpenAI text-embedding-3-small
 *
 *   6. buildCurriculumDoc(meta) / buildRagChunkDocs(curriculumDocId, embedded, meta)
 *      → Firestore-ready shapes that match resolveCbcContext()'s
 *        expectations in functions/teacherTools/cbcKnowledge.js
 *
 * Design notes:
 *   - No Firestore writes here. The watcher owns persistence so we
 *     keep one privacy boundary, one test surface, and one place where
 *     batch commits + idempotency keys live.
 *   - HTML parsing is regex-based on purpose: avoids a 500KB+ cheerio
 *     dependency for two sources whose structure is simple (links + headings).
 *   - PDF + DOCX parsing use pdf-parse and mammoth — added to
 *     functions/package.json.
 *   - Same chunking strategy + embedding model as
 *     functions/scripts/ingest-private-cbc.mjs so a manual
 *     `npm run cbc:ingest` and an automated agent run produce
 *     interchangeable docs.
 */

const crypto = require("crypto");

// ── Constants ─────────────────────────────────────────────────────

const MAX_LINKS_PER_PAGE = 200;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 100;
const MAX_CHUNKS_PER_MODULE = 200;
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_BATCH_SIZE = 50;

const PDF_EXT = /\.pdf(\?|$|#)/i;
const DOCX_EXT = /\.docx(\?|$|#)/i;
const DOC_EXT = /\.doc(\?|$|#)/i;
const HTML_EXT = /\.(html?|aspx?|php)(\?|$|#)/i;

// ── HTML link discovery ───────────────────────────────────────────

/**
 * Extract candidate module links from an HTML page. Same-host links
 * only — the caller (curriculumWatcher.js) enforces the host allowlist;
 * we just hand back canonical absolute URLs so it can decide.
 *
 * Heuristics:
 *   - PDF / DOC / DOCX → likely a syllabus or module download.
 *   - HTML sub-page within the same host → likely a topic-listing
 *     page worth crawling once (the watcher applies crawlDepth).
 *   - Anchors with grade/subject hints in their text → prioritised.
 *
 * Caps the result at MAX_LINKS_PER_PAGE so a runaway link page can't
 * blow up an agent run.
 */
function discoverModuleLinks(html, baseUrl) {
  if (typeof html !== "string" || !html) return [];
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const out = [];
  const seen = new Set();
  // Cheap anchor extractor — captures href + the visible inner text.
  // Good enough for WordPress menus + Greenstone library indexes.
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    if (out.length >= MAX_LINKS_PER_PAGE) break;
    const rawHref = match[1].trim();
    if (!rawHref || rawHref.startsWith("#")) continue;
    // Parse first, then allowlist the protocol. A denylist of schemes
    // ("javascript:", "mailto:", …) misses variants like "JavaScript:",
    // "vbscript:", "data:" or whitespace tricks; only http(s) is crawlable.
    let abs;
    try {
      const parsed = new URL(rawHref, base);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      abs = parsed.toString();
    } catch {
      continue;
    }
    // Drop the fragment so /page#x and /page#y don't both make it through.
    const noFrag = abs.split("#")[0];
    if (seen.has(noFrag)) continue;

    const kind =
      PDF_EXT.test(noFrag) ? "pdf" :
      DOCX_EXT.test(noFrag) ? "docx" :
      DOC_EXT.test(noFrag) ? "doc" :
      HTML_EXT.test(noFrag) ? "html" :
      // No extension at all on the path? Many CMSes (WordPress, Greenstone)
      // serve HTML from extensionless URLs — treat them as html candidates.
      !/\.[a-z0-9]{2,5}(\?|$)/i.test(new URL(noFrag).pathname) ? "html" :
      null;
    if (!kind) continue;

    const anchorText = match[2]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);

    seen.add(noFrag);
    out.push({url: noFrag, anchorText, kind});
  }
  return out;
}

// ── Document parsing ──────────────────────────────────────────────

/**
 * Parse a downloaded document into plain text + heading lines.
 *
 *   parseDocument(buffer | string, kind)  → { text, headings[] }
 *
 * kind is one of: 'pdf' | 'docx' | 'doc' | 'html'
 *
 * For .doc (legacy Word, pre-2007) we don't have a parser — return
 * `{text: '', headings: [], unsupported: true}` so the watcher records
 * it as a known-limitation rather than crashing.
 */
async function parseDocument(buffer, kind) {
  if (kind === "html") {
    const html = typeof buffer === "string" ?
      buffer : Buffer.from(buffer).toString("utf8");
    return parseHtml(html);
  }
  if (kind === "pdf") {
    return parsePdf(buffer);
  }
  if (kind === "docx") {
    return parseDocx(buffer);
  }
  return {text: "", headings: [], unsupported: true};
}

function parseHtml(html) {
  if (!html) return {text: "", headings: []};
  // Pull out h1..h4 contents before we strip tags so we don't lose them.
  const headings = [];
  const hRe = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = hRe.exec(html)) !== null && headings.length < 200) {
    const t = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (t) headings.push(t);
  }
  // End tags may carry trailing junk ("</script foo>") — allow attributes in
  // the close tag so a malformed end tag can't smuggle the element through.
  let text = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, " ");
  // Strip remaining tags to a fixpoint so removals can't reassemble a tag
  // (e.g. "<scr<x>ipt>").
  let prev;
  do {
    prev = text;
    text = text.replace(/<[^>]+>/g, " ");
  } while (text !== prev);
  // Decode entities in one pass ("&amp;" handled together with the rest) so a
  // double-encoded "&amp;lt;" can never decode all the way to "<".
  const entities = {"nbsp": " ", "amp": "&", "lt": "<", "gt": ">", "quot": "\""};
  text = text
      .replace(/&(nbsp|amp|lt|gt|quot);/gi, (m, name) => entities[name.toLowerCase()])
      .replace(/\s+/g, " ")
      .trim();
  return {text, headings};
}

async function parsePdf(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return {text: "", headings: []};
  }
  // pdf-parse v2 (PDFParse class) is wrapped in ../../../pdfTextExtractor,
  // which lazily requires pdf-parse and never throws — it returns
  // {unsupported}/{error} so this function keeps its existing
  // graceful-degradation contract (see issue #1884). The 200-page cap that
  // v1 expressed as `{max: 200}` maps to the v2 `{first: 200}` page range.
  const {extractPdfText} = require("../../../pdfTextExtractor");
  const parsed = await extractPdfText(buffer, {maxPages: 200});
  if (parsed.unsupported) {
    return {text: "", headings: [], unsupported: true, reason: parsed.reason};
  }
  if (parsed.error) {
    return {text: "", headings: [], error: parsed.error};
  }
  const text = String(parsed.text || "")
      .replace(/^@/g, "")
      .replace(/\r\n/g, "\n")
      .trim();
  // Treat short ALL-CAPS or Title-Case lines as headings.
  const headings = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) =>
        l.length > 3 && l.length < 120 &&
        /^[A-Z0-9][A-Z0-9 :,\-/&()]{2,}$/.test(l),
      )
      .slice(0, 200);
  return {text, headings};
}

async function parseDocx(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return {text: "", headings: []};
  }
  let mammoth;
  try {
    mammoth = require("mammoth");
  } catch (err) {
    return {text: "", headings: [], unsupported: true,
      reason: `mammoth_missing:${(err && err.message || "").slice(0, 80)}`};
  }
  try {
    const res = await mammoth.convertToHtml({buffer});
    const {text, headings} = parseHtml(res && res.value || "");
    return {text, headings};
  } catch (err) {
    return {text: "", headings: [],
      error: `docx_parse_failed:${(err && err.message || "").slice(0, 120)}`};
  }
}

// ── Classification ────────────────────────────────────────────────

// Accept "Grade 5", "Grade-5", "Gr 5", "gr.5" — match patterns
// that appear in URL paths, anchor text, and headings.
const GRADE_RE = /\b(?:Grade|Gr\.?)[\s\-_]*(\d{1,2})\b/i;
const TERM_RE = /\bTerm[\s\-_]*([1-3])\b/i;

const SUBJECT_KEYWORDS = Object.freeze({
  mathematics: ["mathematics", "maths"],
  english: ["english"],
  science: ["science", "integrated science"],
  "social-studies": ["social studies", "social-studies"],
  "expressive-arts": ["expressive arts", "expressive-arts", "creative arts"],
  technology: ["technology", "ict", "computer studies"],
  cinyanja: ["cinyanja", "chinyanja"],
  "home-economics": ["home economics", "home-economics", "home science"],
  "religious-education": ["religious education", "religious-education"],
  "civic-education": ["civic education", "civic-education"],
  "cts": ["creative and technology studies", "cts"],
});

/**
 * Best-effort classifier. We look at:
 *   - the anchor text the user clicked
 *   - the URL path (filenames often encode "grade-5-mathematics.pdf")
 *   - the first few headings or first 4KB of body text
 *
 * Returns confidence so the watcher can flag low-confidence imports
 * for admin review without dropping them.
 */
function classifyModule({url, anchorText, headings, firstChars}) {
  const hay = [
    String(anchorText || ""),
    String(url || ""),
    Array.isArray(headings) ? headings.join("\n") : "",
    String(firstChars || ""),
  ].join("\n").toLowerCase();

  const gradeMatch = hay.match(GRADE_RE);
  const grade = gradeMatch ? Number(gradeMatch[1]) : null;
  const termMatch = hay.match(TERM_RE);
  const term = termMatch ? Number(termMatch[1]) : null;

  let subject = null;
  for (const [canonical, kws] of Object.entries(SUBJECT_KEYWORDS)) {
    if (kws.some((kw) => hay.includes(kw))) {
      subject = canonical;
      break;
    }
  }

  // Topic — first heading wins, fallback to anchor text.
  let topic = null;
  if (Array.isArray(headings) && headings.length > 0) {
    topic = String(headings[0]).slice(0, 120);
  } else if (anchorText) {
    topic = String(anchorText).slice(0, 120);
  }

  const signals = [grade, subject].filter(Boolean).length;
  const confidence =
    signals === 2 ? "high" :
    signals === 1 ? "medium" :
    "low";

  return {grade, subject, term, topic, confidence};
}

// ── Document type detection ───────────────────────────────────────

// Keyword set per document type. Order matters: the most specific
// types are listed first so e.g. "scheme of work" wins over
// "syllabus" if both appear (a scheme of work often references a
// syllabus). All matches are case-insensitive against a combined
// haystack of anchor text + URL pathname + the first few headings.
//
// "module" is intentionally a generic catch-all near the bottom; if
// nothing else matches the row stays as documentType:"unknown" so
// admins can spot the gap and refine the heuristics.

// Keywords are matched against a haystack with hyphens/underscores
// already normalised to spaces, so each entry only needs the
// space-separated form. Use space + word for multi-word keywords.
const DOCUMENT_TYPE_KEYWORDS = Object.freeze([
  ["scheme_of_work", ["scheme of work", "schemes of work", "sow"]],
  ["lesson_plan",    ["lesson plan", "lesson plans"]],
  ["assessment",     [
    "assessment", "exam paper", "examination", "past paper", "test paper",
  ]],
  ["teachers_guide", [
    "teacher's guide", "teachers guide", "teacher guide", "teaching guide",
  ]],
  ["learners_book",  [
    "learner's book", "learners book", "learner book",
    "pupil's book", "pupils book", "pupil book",
    "textbook",
  ]],
  ["syllabus",       ["syllabus", "syllabi", "curriculum framework"]],
  ["module",         ["module", "modules"]],
]);

/**
 * Detect the document type of an ingested module. Pure function so
 * the watcher can call it without going through Firestore, and the
 * SPA admin queue can filter by the result without needing to re-fetch.
 *
 * Returns one of:
 *   scheme_of_work | lesson_plan | assessment | teachers_guide |
 *   learners_book | syllabus | module | unknown
 */
function detectDocumentType({url, anchorText, headings}) {
  let path = "";
  try { path = new URL(String(url || "")).pathname; } catch { /* ignore */ }
  // Normalise hyphens and underscores to spaces so URL slugs like
  // `pupils-book.pdf` or `scheme_of_work` match the same keywords
  // that anchor text uses with regular spaces.
  const hay = [
    String(anchorText || ""),
    path,
    Array.isArray(headings) ? headings.slice(0, 5).join(" ") : "",
  ].join(" ").toLowerCase().replace(/[-_]+/g, " ");

  for (const [type, keywords] of DOCUMENT_TYPE_KEYWORDS) {
    if (keywords.some((kw) => hay.includes(kw))) return type;
  }
  return "unknown";
}

// ── Chunking ──────────────────────────────────────────────────────

/**
 * Sliding-window chunker — same shape as the inline chunker in
 * functions/scripts/ingest-private-cbc.mjs. 1000-char windows with
 * 100-char overlap. Returns at most MAX_CHUNKS_PER_MODULE windows
 * so a 500-page syllabus doesn't fan out to thousands of embeddings.
 */
function chunkText(text) {
  const clean = String(text || "")
      .replace(/^@/g, "")
      .replace(/\s+/g, " ")
      .trim();
  if (!clean) return [];
  const out = [];
  let i = 0;
  while (i < clean.length && out.length < MAX_CHUNKS_PER_MODULE) {
    const slice = clean.slice(i, i + CHUNK_SIZE);
    if (slice.trim().length > 0) out.push(slice);
    if (i + CHUNK_SIZE >= clean.length) break;
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return out;
}

// ── Embedding ─────────────────────────────────────────────────────

/**
 * Call OpenAI's embeddings API in batches. Returns the same `chunks`
 * array enriched with `embedding: number[]`. If apiKey is missing or
 * fetch is unavailable, returns chunks without embeddings (the watcher
 * still writes them — RAG just won't return them via vector similarity,
 * keyword fallback still works).
 */
async function embedChunks(chunks, apiKey, opts = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  if (!apiKey || typeof fetch !== "function") {
    return chunks.map((text) => ({text, embedding: null}));
  }
  const out = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({model: opts.model || EMBED_MODEL, input: batch}),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn("[curriculumIngester] embed batch failed",
            res.status, errText.slice(0, 200));
        for (const text of batch) out.push({text, embedding: null});
        continue;
      }
      const json = await res.json();
      const arr = (json && json.data) || [];
      batch.forEach((text, idx) => {
        const embedding = arr[idx] && Array.isArray(arr[idx].embedding) ?
          arr[idx].embedding : null;
        out.push({text, embedding});
      });
    } catch (err) {
      console.warn("[curriculumIngester] embed batch threw",
          err && err.message);
      for (const text of batch) out.push({text, embedding: null});
    }
  }
  return out;
}

// ── Firestore doc builders ────────────────────────────────────────

function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

/**
 * Build a deterministic id for a curriculum doc so re-runs overwrite
 * the same row instead of fanning out duplicates. Keyed on sourceUrl
 * so the same PDF re-discovered next week updates in place.
 */
function curriculumDocId(meta) {
  return sha256(String(meta.sourceUrl || meta.url || "")).slice(0, 32);
}

function ragChunkDocId(curriculumId, index) {
  return `${curriculumId}_${String(index).padStart(4, "0")}`;
}

/**
 * Curriculum taxonomy doc. Same collection name (`curriculum/`) that
 * the manual cbc:ingest script writes to, so resolveCbcContext()'s
 * private-RAG path picks these up automatically.
 */
function buildCurriculumDoc(meta) {
  return {
    id: curriculumDocId(meta),
    data: {
      source: meta.sourceId || null,
      sourceUrl: meta.sourceUrl || null,
      sourceName: meta.sourceName || null,
      parsedFrom: meta.kind || null,
      anchorText: meta.anchorText || null,
      grade: meta.grade != null ? meta.grade : null,
      subject: meta.subject || null,
      term: meta.term != null ? meta.term : null,
      topic: meta.topic || null,
      // Categorical document type — admins filter the staged queue by
      // this. Detected from anchor + url + first headings via
      // detectDocumentType(). Always a known enum value (never null).
      documentType: meta.documentType || "unknown",
      confidence: meta.confidence || "low",
      byteLength: meta.byteLength || 0,
      chunkCount: meta.chunkCount || 0,
      importedBy: "curriculumWatcher",
      reviewStatus: "needs_check",
    },
  };
}

/**
 * RAG chunk docs. Schema mirrors what ingest-private-cbc.mjs writes
 * so the retrieval code in resolveCbcContext() doesn't need to know
 * whether a chunk came from a manual ingest or this agent.
 */
function buildRagChunkDocs(curriculumId, embedded, meta) {
  return embedded.map((c, index) => ({
    id: ragChunkDocId(curriculumId, index),
    data: {
      syllabus_id: curriculumId,
      source_group: meta.sourceId || "auto_ingested",
      curriculum_doc_id: curriculumId,
      source_url: meta.sourceUrl || null,
      title: meta.topic || meta.anchorText || null,
      grade: meta.grade != null ? meta.grade : null,
      subject: meta.subject || null,
      term: meta.term != null ? meta.term : null,
      chunk_index: index,
      text: c.text,
      embedding: c.embedding || null,
      embedding_model: c.embedding ? EMBED_MODEL : null,
    },
  }));
}

module.exports = {
  // Pure helpers (testable)
  discoverModuleLinks,
  parseDocument,
  parseHtml,
  classifyModule,
  detectDocumentType,
  chunkText,
  embedChunks,
  buildCurriculumDoc,
  buildRagChunkDocs,
  curriculumDocId,
  ragChunkDocId,
  sha256,
  // Constants exposed for tests + admin tooling
  MAX_LINKS_PER_PAGE,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  MAX_CHUNKS_PER_MODULE,
  EMBED_MODEL,
  SUBJECT_KEYWORDS,
  DOCUMENT_TYPE_KEYWORDS,
};
