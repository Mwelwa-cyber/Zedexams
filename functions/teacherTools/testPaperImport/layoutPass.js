/**
 * layoutPass — the "understand the page before you extract it" stage of the AI
 * Paper Reconstruction pipeline.
 *
 * Two things live here:
 *
 * 1. ROUTING (pure, zero AI cost) — decide, per detected object, which
 *    extraction/reconstruction pipeline it should take. This is the "two-tier"
 *    cost model: simple printed text rides the one cheap vision pass we already
 *    did, while only genuinely complex objects (tables, pictographs, graphs,
 *    rich diagrams) or low-confidence reads escalate to an expensive per-object
 *    call (rebuildTable / redraw / a focused re-read). Because the primary
 *    vision pass already returns each figure's `kind`/`complexity`/`confidence`,
 *    the routing decision needs NO extra model call — it's a lookup.
 *
 * 2. An OPTIONAL cheap layout classifier (`runLayoutPass`) — a lightweight
 *    model pass that inventories every object on a page (question, section,
 *    instruction, table, pictograph, graph, math, diagram, answer_space, image,
 *    label, passage) with a bounding box + confidence, BEFORE the expensive
 *    structured extraction. It is advisory: the extraction still works if it
 *    returns nothing, so a layout-model failure degrades to today's behaviour.
 *    The model call is injected so this unit-tests with no network.
 *
 * Pure + dependency-light (HttpsError is looked up lazily) so the routing half
 * loads and tests under the root-only CI `node` env with no firebase deps.
 */

// The object types the layout pass recognises — mirrors the product spec's
// "detect every object" list.
const LAYOUT_OBJECT_TYPES = [
  "question", "section", "instruction", "table", "pictograph", "graph",
  "math", "diagram", "answer_space", "image", "label", "passage", "other",
];
const LAYOUT_TYPE_SET = new Set(LAYOUT_OBJECT_TYPES);

// How a detected object should be handled downstream.
//   cheap        : already captured by the main vision pass; no extra AI.
//   reconstruct  : needs an expensive per-object rebuild (table/diagram/graph).
//   review       : uncertain — surface for the teacher, don't auto-trust.
const ROUTES = Object.freeze({
  CHEAP: "cheap",
  RECONSTRUCT: "reconstruct",
  REVIEW: "review",
});

// Figure kinds (from the primary vision pass's diagram taxonomy) that are best
// reconstructed as an editable TYPED TABLE rather than kept/redrawn as a picture.
const TABLE_KINDS = new Set(["table", "pictograph", "pictogram", "tally", "food_chart"]);
// Figure kinds that are data graphics — reconstructable but as a chart/table,
// not a photo. Kept distinct so the UI can suggest the right rebuild.
const GRAPH_KINDS = new Set(["bar_chart", "line_graph", "pie_chart", "venn", "number_line"]);

// Below this confidence we don't trust an automatic route — send it to review.
const ROUTE_REVIEW_BELOW = 0.6;

function normKind(kind) {
  return String(kind || "").toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Decide how a detected FIGURE should be handled. Pure.
 * @param {object} d { kind, complexity, confidence }
 * @returns {{route: string, rebuild: 'table'|'graph'|'diagram'|null, reason: string}}
 */
function routeDiagram(d = {}) {
  const kind = normKind(d.kind);
  const conf = Number(d.confidence);
  const known = Number.isFinite(conf);

  // A low-confidence detection is never auto-reconstructed — a wrong rebuild is
  // worse than keeping the original crop for the teacher to judge.
  if (known && conf < ROUTE_REVIEW_BELOW) {
    return {route: ROUTES.REVIEW, rebuild: null, reason: "low_confidence"};
  }

  if (TABLE_KINDS.has(kind)) {
    return {route: ROUTES.RECONSTRUCT, rebuild: "table", reason: "table_like"};
  }
  if (GRAPH_KINDS.has(kind)) {
    return {route: ROUTES.RECONSTRUCT, rebuild: "graph", reason: "data_graphic"};
  }
  // Simple line figures can be redrawn cleanly; complex/realistic ones are
  // better kept as the (enhanced) original — both are teacher-driven choices in
  // the review screen, so we mark them 'reconstruct' to surface the options.
  if (kind && kind !== "other") {
    return {route: ROUTES.RECONSTRUCT, rebuild: "diagram", reason: "figure"};
  }
  return {route: ROUTES.REVIEW, rebuild: null, reason: "unclassified"};
}

/**
 * Decide how a layout-inventory OBJECT should be handled. Pure.
 * @param {object} o { type, confidence }
 */
function routeObject(o = {}) {
  const type = String(o.type || "").toLowerCase();
  const conf = Number(o.confidence);
  const known = Number.isFinite(conf);
  if (known && conf < ROUTE_REVIEW_BELOW) {
    return {route: ROUTES.REVIEW, reason: "low_confidence"};
  }
  if (type === "table" || type === "pictograph" || type === "graph") {
    return {route: ROUTES.RECONSTRUCT, reason: "structured_data"};
  }
  if (type === "diagram" || type === "image") {
    return {route: ROUTES.RECONSTRUCT, reason: "figure"};
  }
  if (type === "math") {
    // Math needs a careful read but not image generation — flag for a check.
    return {route: ROUTES.REVIEW, reason: "math"};
  }
  // Plain text objects (question/section/instruction/label/answer_space/passage)
  // are covered by the main cheap pass.
  return {route: ROUTES.CHEAP, reason: "text"};
}

/**
 * Clamp a single {x,y,w,h} box (fractions 0-1) or return null.
 */
function normBox(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
  };
  const x = num(raw.x); const y = num(raw.y); const w = num(raw.w); const h = num(raw.h);
  if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) return null;
  return {x, y, w, h};
}

/**
 * Normalise a raw layout-model response into a clean per-page inventory. Pure.
 * Drops objects with an unrecognised type; clamps confidence to 0-1; attaches
 * the routing decision so callers don't recompute it.
 * @returns {{objects: Array<{type,box,confidence,route,reason}>}}
 */
function normaliseLayout(raw) {
  const rawObjects = Array.isArray(raw && raw.objects) ? raw.objects : [];
  const objects = [];
  for (const o of rawObjects) {
    const type = String(o && o.type || "").toLowerCase();
    if (!LAYOUT_TYPE_SET.has(type)) continue;
    let confidence = Number(o.confidence);
    confidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null;
    const {route, reason} = routeObject({type, confidence});
    objects.push({type, box: normBox(o.box), confidence, route, reason});
  }
  return {objects};
}

/** Count objects by type in a normalised inventory. Pure. */
function summariseLayout(layout) {
  const counts = {};
  const objects = layout && Array.isArray(layout.objects) ? layout.objects : [];
  for (const o of objects) counts[o.type] = (counts[o.type] || 0) + 1;
  return {
    total: objects.length,
    counts,
    questions: counts.question || 0,
    tables: (counts.table || 0) + (counts.pictograph || 0),
    diagrams: (counts.diagram || 0) + (counts.graph || 0) + (counts.image || 0),
    reconstruct: objects.filter((o) => o.route === ROUTES.RECONSTRUCT).length,
    review: objects.filter((o) => o.route === ROUTES.REVIEW).length,
  };
}

const LAYOUT_SYSTEM_PROMPT = [
  "You are the LAYOUT stage of an exam-paper digitiser. Do NOT transcribe text.",
  "Look at the page image and list every distinct OBJECT you can see, in reading",
  "order, so a later stage knows what to extract and how. For each object give:",
  "- type: one of question, section, instruction, table, pictograph, graph,",
  "  math, diagram, answer_space, image, label, passage, other.",
  "- box: a tight {x,y,w,h} bounding box as fractions 0-1 of the page.",
  "- confidence: 0-1, how sure you are of the type.",
  "Be generous in DETECTING tables, pictographs, graphs and diagrams — the",
  "point of this pass is to make sure none of them are missed. Return only the",
  "structured object list via the tool.",
].join("\n");

const LAYOUT_TOOL_SCHEMA = {
  type: "object",
  properties: {
    objects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {type: "string", enum: LAYOUT_OBJECT_TYPES},
          box: {
            type: "object",
            properties: {
              x: {type: "number"}, y: {type: "number"},
              w: {type: "number"}, h: {type: "number"},
            },
          },
          confidence: {type: "number"},
        },
        required: ["type"],
      },
    },
  },
  required: ["objects"],
};

function httpsError(code, message) {
  try {
    const {HttpsError} = require("firebase-functions/v2/https");
    return new HttpsError(code, message);
  } catch {
    return Object.assign(new Error(message), {code});
  }
}

/**
 * Run the cheap layout classifier over one page image. Advisory: on any model
 * failure it returns an empty inventory rather than throwing, so the caller can
 * carry on with the main extraction.
 *
 * @param {object} args { image: {data, mediaType} }
 * @param {object} deps { classify: async (image) => rawLayout }
 * @returns {Promise<{objects: [...], summary: {...}}>}
 */
async function runLayoutPass(args, deps = {}) {
  const {image = null} = args || {};
  if (!image || !image.data) {
    throw httpsError("failed-precondition", "No page image supplied for layout analysis.");
  }
  if (typeof deps.classify !== "function") {
    throw httpsError("internal", "Layout analysis is not configured.");
  }
  let raw;
  try {
    raw = await deps.classify(image);
  } catch {
    // Advisory — never sink the import because the cheap pass failed.
    return {objects: [], summary: summariseLayout({objects: []}), degraded: true};
  }
  const layout = normaliseLayout(raw);
  return {...layout, summary: summariseLayout(layout)};
}

// The cheap classifier model. Defaults to Haiku (fast + cheap vision) so the
// layout pass never spends Sonnet money; overridable without a code change.
const LAYOUT_MODEL =
  process.env.SCANNED_LAYOUT_MODEL || "claude-haiku-4-5-20251001";

/**
 * Callable factory for the cheap layout pass. Auth + secret + quota wiring
 * mirrors createRebuildTableFromImage. Reads ONE page image and returns its
 * object inventory. Advisory by contract — the client treats a failure as "no
 * layout" and falls back to the main extraction alone.
 */
function createAnalyzePaperLayout(anthropicApiKeySecret) {
  const {onCall, HttpsError} = require("firebase-functions/v2/https");
  const {getUserRole, isStaffRole} = require("../../aiService");

  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 60, memory: "512MiB"},
    async (request) => {
      const uid = request.auth && request.auth.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");

      const data = request.data || {};
      try {
        const role = await getUserRole(uid);
        if (!isStaffRole(role)) {
          throw new HttpsError(
            "permission-denied",
            "Teacher tools are available to approved teachers only.",
          );
        }
        const anthropicKey = anthropicApiKeySecret.value() || process.env.ANTHROPIC_API_KEY || "";
        if (!anthropicKey) {
          throw new HttpsError("failed-precondition", "Layout analysis is not available — admin needs to configure the AI key.");
        }

        // Decode the incoming page dataUrl.
        const dataUrl = String(data.dataUrl || "");
        const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
        if (!match) {
          throw new HttpsError("invalid-argument", "A page image is required for layout analysis.");
        }
        const image = {mediaType: match[1], data: match[2].replace(/\s+/g, "")};

        const deps = {
          classify: async (img) => {
            const {callClaude} = require("../anthropicClient");
            const result = await callClaude(anthropicKey, {
              systemPrompt: LAYOUT_SYSTEM_PROMPT,
              model: LAYOUT_MODEL,
              messages: [{
                role: "user",
                content: [
                  {type: "image", source: {type: "base64", media_type: img.mediaType, data: img.data}},
                  {type: "text", text: "List the objects on this page using the tool."},
                ],
              }],
              mode: "tool",
              toolName: "emit_layout",
              toolDescription: "Return the page's object inventory.",
              toolInputSchema: LAYOUT_TOOL_SCHEMA,
              maxTokens: 1500,
              temperature: 0,
            });
            return result && result.parsed;
          },
        };

        return await runLayoutPass({image}, deps);
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        console.error("analyzePaperLayout unexpected error", {uid, err});
        // Advisory: return an empty inventory rather than failing the import.
        return {objects: [], summary: summariseLayout({objects: []}), degraded: true};
      }
    },
  );
}

module.exports = {
  ROUTES,
  LAYOUT_OBJECT_TYPES,
  LAYOUT_MODEL,
  routeDiagram,
  routeObject,
  normaliseLayout,
  summariseLayout,
  normBox,
  runLayoutPass,
  createAnalyzePaperLayout,
  LAYOUT_SYSTEM_PROMPT,
  LAYOUT_TOOL_SCHEMA,
  ROUTE_REVIEW_BELOW,
};
