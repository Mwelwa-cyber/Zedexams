/**
 * Picture-bank auto-naming — looks at uploaded teaching figures with Claude
 * vision and suggests a clear name, search keywords and a CBC subject for
 * each, so admins don't have to hand-tag a bulk upload one by one.
 *
 * Design notes:
 *  - One vision call names a whole batch. Images are interleaved with
 *    "Image N:" labels and the tool returns an array keyed by `index`, the
 *    same trick the scanned-paper importer uses to keep page→answer mapping
 *    reliable.
 *  - Haiku 4.5 by default — naming a diagram is far cheaper than OCR and the
 *    output is short. Override with PICTURE_NAMING_MODEL at deploy time.
 *  - Pure orchestrator: the model client is injected so the unit test runs
 *    with no network and no API key. The callable in index.js downloads the
 *    image bytes from Storage and passes them in as base64.
 *  - Suggestions are written back as `aiSuggested*` fields; pictures stay
 *    `status:'staged'` so an admin still reviews before teachers see them.
 */

const {ALLOWED_SUBJECTS} = require("./teacherTools/assessmentAllowlists");

// CI's "Tests" job runs `npm run test:all` after a ROOT-only install (no
// functions/node_modules), so a top-level require of firebase-functions would
// make this file unloadable there. Fall back to a plain coded Error in tests;
// production always has firebase-functions installed.
function httpsError(code, message) {
  try {
    const {HttpsError} = require("firebase-functions/v2/https");
    return new HttpsError(code, message);
  } catch {
    return Object.assign(new Error(message), {code});
  }
}

const GENERIC_SUBJECT = "_generic";

// Cap per call so the vision payload and output stay well within limits and a
// single failure never wipes out a huge batch. The callable chunks above this.
const MAX_PICTURES_PER_CALL = 10;

const NAMING_MODEL = process.env.PICTURE_NAMING_MODEL || "claude-haiku-4-5";

const SUBJECT_ENUM = [...ALLOWED_SUBJECTS, GENERIC_SUBJECT];

const SYSTEM_PROMPT = [
  "You are the picture-bank librarian for ZedExams, a Zambian CBC learning",
  "platform. Teachers search a shared bank of teaching figures (labelled",
  "diagrams, maps, charts, illustrations) by name and keyword when building",
  "assessments.",
  "Look at each image and give it a short, specific, searchable name plus",
  "keywords so a teacher's search lands on it.",
  "Rules:",
  "- name: concise and descriptive, like a textbook caption — e.g.",
  "  \"Human ear, labelled\", \"Map of Zambia with provinces\",",
  "  \"Water cycle diagram\", \"Venn diagram, two sets\". Max ~80 characters.",
  "  Never return a file name, \"Extracted image\", \"untitled\" or a guess",
  "  with no basis in what you see.",
  "- keywords: 3 to 8 lowercase single words or short phrases a teacher might",
  "  type, covering the subject matter and synonyms (e.g. ear, hearing,",
  "  senses, eardrum). No punctuation, no duplicates.",
  "- subject: pick the single best CBC subject key from the allowed list, or",
  "  \"_generic\" when the image fits many subjects (shapes, generic graphs,",
  "  Venn templates, blank maps).",
  "- If an image is a logo, watermark, decoration or unreadable, set name to",
  "  an empty string and keywords to an empty array so the admin can discard",
  "  it.",
  "Return one entry per image using the tool, each with its 0-based index.",
].join("\n");

const NAME_TOOL = {
  name: "name_pictures",
  description: "Return a suggested name, keywords and subject for each image.",
  input_schema: {
    type: "object",
    properties: {
      pictures: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: {
              type: "integer",
              description: "0-based position of the image in the message.",
            },
            name: {
              type: "string",
              description: "Concise descriptive caption, or \"\" to discard.",
            },
            keywords: {
              type: "array",
              items: {type: "string"},
              description: "3-8 lowercase search terms.",
            },
            subject: {
              type: "string",
              enum: SUBJECT_ENUM,
              description: "Best CBC subject key, or \"_generic\".",
            },
          },
          required: ["index", "name", "keywords", "subject"],
        },
      },
    },
    required: ["pictures"],
  },
};

function clampString(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function cleanKeywords(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const k of list) {
    const v = clampString(k, 60).toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 12);
}

function cleanSubject(value) {
  const v = clampString(value, 60).toLowerCase();
  return ALLOWED_SUBJECTS.has(v) ? v : GENERIC_SUBJECT;
}

/**
 * Build the Claude message: interleave "Image N:" labels with image blocks,
 * then a short instruction tail. `pictures` items carry { mediaType, data }
 * where data is raw base64 (no data: prefix), matching the scanned importer.
 */
function buildNamingMessages(pictures) {
  const content = [];
  pictures.forEach((pic, idx) => {
    content.push({type: "text", text: `Image ${idx + 1} (index ${idx}):`});
    content.push({
      type: "image",
      source: {type: "base64", media_type: pic.mediaType, data: pic.data},
    });
  });
  const hints = pictures
    .map((pic, idx) => {
      const bits = [];
      if (pic.subjectHint && pic.subjectHint !== GENERIC_SUBJECT) {
        bits.push(`likely subject ${pic.subjectHint}`);
      }
      if (pic.gradeBand) bits.push(`grade ${pic.gradeBand}`);
      return bits.length ? `Image ${idx + 1}: ${bits.join(", ")}.` : "";
    })
    .filter(Boolean)
    .join("\n");
  content.push({
    type: "text",
    text: [
      `Name all ${pictures.length} image(s) above using the name_pictures tool.`,
      "Return exactly one entry per image, each with its 0-based index.",
      hints ? `Optional hints (verify against the image, don't trust blindly):\n${hints}` : "",
    ].filter(Boolean).join("\n"),
  });
  return [{role: "user", content}];
}

function parseNamingResult(raw, count) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return new Map();
  }
  const items = Array.isArray(parsed?.pictures) ? parsed.pictures : [];
  const byIndex = new Map();
  for (const item of items) {
    const idx = Number(item?.index);
    if (Number.isInteger(idx) && idx >= 0 && idx < count && !byIndex.has(idx)) {
      byIndex.set(idx, {
        name: clampString(item?.name, 120),
        keywords: cleanKeywords(item?.keywords),
        subject: cleanSubject(item?.subject),
      });
    }
  }
  return byIndex;
}

/**
 * Name one batch of pictures (<= MAX_PICTURES_PER_CALL).
 * pictures: [{ id, mediaType, data, subjectHint?, gradeBand? }]
 * Returns [{ id, name, keywords, subject, ok }] aligned to input order.
 */
async function nameOnePictureBatch({pictures, anthropicKey}, deps = {}) {
  const callClaude = deps.callClaude ||
    require("./teacherTools/anthropicClient").callClaude;

  const result = await callClaude(anthropicKey, {
    track: {tool: "pictureNaming"},
    systemPrompt: SYSTEM_PROMPT,
    messages: buildNamingMessages(pictures),
    model: deps.model || NAMING_MODEL,
    maxTokens: 1500,
    temperature: 0.2,
    mode: "tool",
    toolName: NAME_TOOL.name,
    toolDescription: NAME_TOOL.description,
    toolInputSchema: NAME_TOOL.input_schema,
  });

  // callClaude(mode:'tool') returns the schema-enforced object on `.parsed`;
  // fall back to text/raw so injected test doubles can return either shape.
  const raw = result?.parsed ?? result?.text ?? result;
  const byIndex = parseNamingResult(raw, pictures.length);
  return pictures.map((pic, idx) => {
    const hit = byIndex.get ? byIndex.get(idx) : null;
    if (hit && hit.name && hit.keywords.length) {
      return {id: pic.id, ...hit, ok: true};
    }
    return {
      id: pic.id,
      name: hit?.name || "",
      keywords: hit?.keywords || [],
      subject: hit?.subject || GENERIC_SUBJECT,
      ok: false,
    };
  });
}

/**
 * Name a whole upload: chunks into vision calls of MAX_PICTURES_PER_CALL and
 * runs them sequentially (shared rate limit, predictable cost). A failed
 * chunk is recorded as a warning and its pictures come back ok:false rather
 * than aborting the run.
 *
 * pictures: [{ id, mediaType, data, subjectHint?, gradeBand? }]
 * Returns { results: [{ id, name, keywords, subject, ok }], warnings: [] }
 */
async function runNamePictures({pictures, anthropicKey}, deps = {}) {
  const list = Array.isArray(pictures) ? pictures.filter((p) => p && p.id && p.data) : [];
  if (!list.length) {
    throw httpsError("invalid-argument", "No pictures to name.");
  }

  const results = [];
  const warnings = [];
  for (let i = 0; i < list.length; i += MAX_PICTURES_PER_CALL) {
    const batch = list.slice(i, i + MAX_PICTURES_PER_CALL);
    try {
      const named = await nameOnePictureBatch({pictures: batch, anthropicKey}, deps);
      results.push(...named);
    } catch (err) {
      warnings.push(`Could not name ${batch.length} picture(s) (${err?.message || "AI error"}).`);
      for (const pic of batch) {
        results.push({id: pic.id, name: "", keywords: [], subject: GENERIC_SUBJECT, ok: false});
      }
    }
  }
  return {results, warnings};
}

module.exports = {
  runNamePictures,
  nameOnePictureBatch,
  buildNamingMessages,
  parseNamingResult,
  cleanKeywords,
  cleanSubject,
  MAX_PICTURES_PER_CALL,
  NAMING_MODEL,
  GENERIC_SUBJECT,
};
