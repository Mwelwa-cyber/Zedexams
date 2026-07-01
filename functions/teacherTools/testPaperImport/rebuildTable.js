/**
 * rebuildTable — reconstruct a photographed TABLE / pictograph as clean,
 * structured, editable table data (not an image).
 *
 * The Test Paper Studio photo importer detects tables as figures, but a cropped
 * photo of a hand-drawn table is not editable and prints poorly. This reads the
 * cropped table with Claude vision and returns `{ headers, rows }` matching the
 * editor's `tableData` schema, so the studio renders a real typed table on plain
 * white paper — the "Rebuild as table" Diagram Handling Option.
 *
 * The orchestration (`runRebuildTable`) takes its model call + image fetch as
 * injected `deps`, so it unit-tests with no network (see rebuildTable.test.js).
 * The pure normaliser (`normaliseTableData`) clamps the model output to the
 * `tableData` schema (≤6 columns, ≤12 rows, short cells) and squares off ragged
 * rows so the editor never receives a jagged grid.
 */

// Wide enough for real timetables and mark schedules (days-of-week + total),
// which the old 6-column cap silently truncated. The editor + Word/PDF exporters
// render whatever column count they're given, so the ceiling is only a guard
// against a runaway model response.
const TABLE_MAX_COLS = 10;
const TABLE_MAX_ROWS = 16;
const TABLE_CELL_MAX = 60;

function httpsError(code, message) {
  try {
    const {HttpsError} = require("firebase-functions/v2/https");
    return new HttpsError(code, message);
  } catch {
    return Object.assign(new Error(message), {code});
  }
}

function clampCell(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, TABLE_CELL_MAX);
}

function clampStr(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Clamp raw model output to the editor's `tableData` shape:
 *   { headers: string[≤6], rows: string[≤6][≤12] }
 * Squares off ragged rows to the column count (header count, else the widest
 * row) so the editor always gets a rectangular grid. Pure.
 */
function normaliseTableData(raw) {
  let headers = Array.isArray(raw && raw.headers)
    ? raw.headers.map(clampCell).slice(0, TABLE_MAX_COLS)
    : [];
  let rows = Array.isArray(raw && raw.rows)
    ? raw.rows
        .filter((r) => Array.isArray(r))
        .map((r) => r.map(clampCell).slice(0, TABLE_MAX_COLS))
        .slice(0, TABLE_MAX_ROWS)
    : [];

  // Column count: the header row when present, else the widest data row.
  const cols = headers.length || rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (cols > 0) {
    // Every renderer (preview / PDF / Word) requires a header row to draw the
    // table, so synthesise blank headers for a headerless table rather than
    // letting it rebuild but silently fail to render.
    if (!headers.length && rows.length) headers = new Array(cols).fill("");
    headers = headers.slice(0, cols);
    while (headers.length < cols) headers.push("");
    rows = rows.map((r) => {
      const out = r.slice(0, cols);
      while (out.length < cols) out.push("");
      return out;
    });
  }
  // Drop fully-empty trailing rows the model sometimes pads with.
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();

  return {headers, rows};
}

/** True when a normalised table actually carries content worth showing. */
function hasTableContent(table) {
  if (!table) return false;
  const headerFilled = table.headers.some((c) => c);
  const rowsFilled = table.rows.length > 0 && table.rows.some((r) => r.some((c) => c));
  return rowsFilled || (headerFilled && table.rows.length > 0);
}

// System prompt for the table-reading vision call. Kept here (not in the runner)
// so it unit-tests as a plain string and stays close to the schema it targets.
const TABLE_SYSTEM_PROMPT = [
  "You are digitising a SINGLE table or pictograph that was cropped from a",
  "photographed exam paper, so a teacher can print it as a clean editable table.",
  "Read ONLY the table in the image and return its structure via the tool.",
  "",
  "Rules:",
  "- The top row of column headings becomes `headers` (in left-to-right order).",
  "  If the table has no heading row, return an empty `headers` array.",
  "- Each subsequent table row becomes one entry in `rows`, left-to-right, and",
  "  MUST have the same number of cells as the header row.",
  "- PICTOGRAPHS / TALLIES: when a cell holds repeated drawings or marks (smiley",
  "  faces, circles, tally strokes, fruit icons, stars), COUNT them and write the",
  "  COUNT as the cell text (e.g. \"3\"). If a key states each symbol's value,",
  "  multiply. Never describe the drawing in prose — just the number. Preserve",
  "  the KEY/LEGEND (e.g. \"Each ☺ = 2 learners\") in `caption` so the meaning is",
  "  not lost when the drawings become numbers.",
  "- MERGED CELLS: when one cell visibly spans several columns or rows, REPEAT",
  "  its text in every column/row position it covers so every row still has the",
  "  same number of cells and the grid stays rectangular. Never leave a row",
  "  shorter than the others because of a merge.",
  "- Keep every cell SHORT typed text. Transcribe words as written; do not invent",
  "  rows, columns, headings or data that is not visibly in the table.",
  "- Do not include the question text, instructions, or anything outside the table.",
].join("\n");

const TABLE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    headers: {
      type: "array",
      items: {type: "string"},
      description: "Column headings, left to right. Empty array if the table has no heading row.",
    },
    rows: {
      type: "array",
      items: {type: "array", items: {type: "string"}},
      description: "One array of cell strings per table row, each the same length as headers.",
    },
    caption: {
      type: "string",
      description: "A short title for the table, if one is printed near it (optional).",
    },
  },
  required: ["headers", "rows"],
};

/**
 * @param {object} args
 * @param {object} [args.detected] structured detected-figure description
 * @param {object} [args.context]  { subject, grade, topic }
 * @param {object} deps
 * @param {Function} deps.fetchImage  async () => { data(base64), mediaType } | null
 * @param {Function} deps.readTable   async (image, ctx) => { headers, rows, caption }
 */
async function runRebuildTable(args, deps = {}) {
  const {detected = null, context = {}} = args || {};
  if (typeof deps.fetchImage !== "function" || typeof deps.readTable !== "function") {
    throw httpsError("internal", "Table rebuild is not configured.");
  }

  const image = await deps.fetchImage();
  if (!image || !image.data) {
    throw httpsError("failed-precondition", "Could not read the table image. Keep the original, or crop it tighter.");
  }

  const parsed = await deps.readTable(image, {detected, context});
  const tableData = normaliseTableData(parsed);
  if (!hasTableContent(tableData)) {
    throw httpsError(
      "failed-precondition",
      "No table could be read from this figure. Try \"Redraw using AI\" or keep the original.",
    );
  }

  return {
    action: "rebuilt_table",
    source: "rebuilt",
    tableData,
    caption: clampStr((parsed && parsed.caption) || (detected && detected.caption) || "", 120),
  };
}

/**
 * Callable factory. Auth + secret + quota wiring mirrors
 * createRedrawTestPaperDiagram; the model call reuses teacherTools/anthropicClient
 * so the same retry/fallback ladder applies.
 */
function createRebuildTableFromImage(anthropicApiKeySecret) {
  const {onCall, HttpsError} = require("firebase-functions/v2/https");
  const {getUserRole, isStaffRole} = require("../../aiService");
  const {assertAndIncrement} = require("../usageMeter");

  return onCall(
    {secrets: [anthropicApiKeySecret], timeoutSeconds: 120, memory: "512MiB"},
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
        await assertAndIncrement(uid, "diagram");

        const anthropicKey = anthropicApiKeySecret.value() || process.env.ANTHROPIC_API_KEY || "";
        if (!anthropicKey) {
          throw new HttpsError("failed-precondition", "Table rebuild is not available — admin needs to configure the AI key.");
        }

        const deps = {
          fetchImage: async () => {
            const url = data.imageUrl;
            if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const buf = Buffer.from(await resp.arrayBuffer());
            if (!buf.length) return null;
            let mediaType = (resp.headers.get("content-type") || "").split(";")[0].trim();
            if (!/^image\/(png|jpeg|webp)$/.test(mediaType)) mediaType = "image/png";
            return {data: buf.toString("base64"), mediaType};
          },
          readTable: async (image) => {
            const {callClaude} = require("../anthropicClient");
            const result = await callClaude(anthropicKey, {
              systemPrompt: TABLE_SYSTEM_PROMPT,
              messages: [{
                role: "user",
                content: [
                  {type: "image", source: {type: "base64", media_type: image.mediaType, data: image.data}},
                  {type: "text", text: "Rebuild this table as structured data using the tool."},
                ],
              }],
              mode: "tool",
              toolName: "emit_table",
              toolDescription: "Return the table as headers + rows of short typed cell text.",
              toolInputSchema: TABLE_TOOL_SCHEMA,
              maxTokens: 1500,
              temperature: 0,
            });
            return result && result.parsed;
          },
        };

        return await runRebuildTable({detected: data.detected, context: data.context || {}}, deps);
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        console.error("rebuildTableFromImage unexpected error", {uid, err});
        const detail = err && err.message ? err.message : "unknown error";
        throw new HttpsError("internal", `Table rebuild failed: ${detail}`);
      }
    },
  );
}

module.exports = {
  normaliseTableData,
  hasTableContent,
  runRebuildTable,
  createRebuildTableFromImage,
  TABLE_SYSTEM_PROMPT,
  TABLE_TOOL_SCHEMA,
};
