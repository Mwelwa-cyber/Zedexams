/**
 * diagramBrief — the "intelligent redrawing" brain for the Test Paper Studio
 * photo import.
 *
 * The photo importer's job is to feel like an intelligent document editor, not
 * a photo cropper. Once Claude has *understood* a paper and described each
 * detected figure as structured JSON (kind, caption, the parts to label, chart
 * data, maths object groups, …), this module turns that description into:
 *
 *   1. a strict black-and-white, photocopy-safe DIAGRAM PROMPT that
 *      OpenAI gpt-image-1 can redraw from (buildDiagramPrompt), and
 *   2. a LIBRARY QUERY + match scorer so we reuse an existing ZedExams Diagram
 *      Library picture before paying to generate a new one (buildLibraryQuery /
 *      pickReusableDiagram), and
 *   3. the LIBRARY METADATA to save a freshly-generated diagram back into the
 *      bank for the next paper (buildLibraryMetadata).
 *
 * IMPORTANT split of responsibilities (mirrors the rest of the codebase):
 *   - Claude does ALL document/text understanding and produces the structured
 *     description this module consumes. This module never reads images.
 *   - The image provider (generateDiagram) only ever receives the text brief
 *     this module builds — never the original photo — and it prepends its own
 *     "no colour / no text labels" guard (see generateDiagram.buildFinalPrompt).
 *     So we describe WHAT to draw and WHERE label lines go, and leave the
 *     printable-style enforcement + label text to the existing pipeline.
 *
 * Everything here is PURE and dependency-free so it unit-tests under plain
 * `node` with no firebase-functions / network dependency (see
 * diagramBrief.test.js).
 */

// The five choices a teacher always gets for a detected figure (the product
// spec's "Diagram Handling Options"). `needsGeneration` marks the two that
// call the image model; the rest are resolved client-side / by keeping or
// dropping the original crop.
const DIAGRAM_HANDLING_OPTIONS = [
  {
    id: "keep_original",
    label: "Keep original image",
    description: "Use the photographed figure exactly as it was scanned.",
    needsGeneration: false,
  },
  {
    id: "clean_original",
    label: "Clean original drawing",
    description: "Keep the original figure but tidy it up for printing.",
    needsGeneration: false,
  },
  {
    id: "redraw",
    label: "Redraw using AI",
    description:
      "Recreate the same figure as crisp black-and-white educational line art.",
    needsGeneration: true,
  },
  {
    id: "replace",
    label: "Replace with a better educational diagram",
    description:
      "Generate a clearer, textbook-quality version of this figure.",
    needsGeneration: true,
  },
  {
    id: "remove",
    label: "Remove diagram and leave blank space",
    description: "Drop the figure and leave room for the learner / teacher.",
    needsGeneration: false,
  },
];

const HANDLING_IDS = new Set(DIAGRAM_HANDLING_OPTIONS.map((o) => o.id));

// Human-readable subject phrase per detected figure kind. These feed the
// natural-language prompt; they are intentionally drawing instructions, not
// labels. Kinds mirror scannedQuizImport's diagram taxonomy plus the extra
// test-paper element kinds the importer detects (pictograph, matching, maths
// object groups, fill-in/true-false visuals).
const KIND_PHRASE = {
  plant: "a labelled diagram of a plant",
  animal: "a labelled diagram of an animal",
  body_part: "a labelled diagram of the human body part",
  labelled_science: "a labelled science diagram",
  circuit: "a clean electrical circuit diagram using standard symbols",
  map: "a simple outline map",
  food_chart: "a food chart / food pyramid diagram",
  tool: "a simple line drawing of the tool",
  number_line: "a number line",
  shape: "a geometry shape",
  geometry: "a geometry figure",
  venn: "a Venn diagram",
  bar_chart: "a bar chart / bar graph with plain axes",
  line_graph: "a line graph with plain axes",
  pie_chart: "a pie chart divided into clear segments",
  pictograph: "a pictograph (picture graph) with rows of repeated symbols and a key",
  table: "a plain ruled table with clear rows, columns and cell borders",
  matching: "a matching exercise with two columns of items to be joined by lines",
  multiplication_groups: "groups of identical objects arranged for a multiplication question",
  object_groups: "groups of identical counting objects",
  measurement: "a measurement diagram (ruler / scale)",
  safety_symbol: "a chemical / laboratory safety symbol",
  symbol: "a clear educational symbol",
  drawing: "a simple educational line drawing",
  photo: "a clear line illustration",
  other: "a clear educational diagram",
};

// Default canvas orientation per kind. Wide figures (graphs, number lines,
// tables, matching) read better landscape; tall biological diagrams portrait.
const LANDSCAPE_KINDS = new Set([
  "bar_chart", "line_graph", "number_line", "table", "matching",
  "measurement", "map", "food_chart",
]);
const PORTRAIT_KINDS = new Set([
  "plant", "body_part", "animal",
]);

function clampStr(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

// Normalise a free-form "list of things" field (labels / elements) that Claude
// may return as an array or a comma/newline string. Returns a deduped,
// trimmed, bounded array of short phrases.
function toList(value, max = 16) {
  let arr;
  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === "string") {
    arr = value.split(/[,\n;]/);
  } else {
    arr = [];
  }
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const s = clampStr(item, 60).toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(clampStr(item, 60));
    if (out.length >= max) break;
  }
  return out;
}

// Normalise chart / pictograph data points: [{label, value}]. Tolerates
// numbers-as-strings and drops entries with no usable label.
function toDataPoints(value, max = 12) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const label = clampStr(row.label ?? row.name ?? row.category, 40);
    if (!label) continue;
    const num = Number(row.value ?? row.count ?? row.amount);
    out.push({label, value: Number.isFinite(num) ? num : null});
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Normalise a raw model-detected diagram into the stable shape the rest of this
 * module relies on. Defensive: every field is optional in the input.
 */
function normaliseDetected(raw = {}) {
  const kind = clampStr(raw.kind, 40).toLowerCase() || "other";
  const mg = raw.mathGroups || raw.groups || null;
  let mathGroups = null;
  if (mg && typeof mg === "object") {
    const groups = Number(mg.groups ?? mg.count);
    const perGroup = Number(mg.perGroup ?? mg.each ?? mg.size);
    if (Number.isFinite(groups) && Number.isFinite(perGroup) && groups > 0 && perGroup > 0) {
      mathGroups = {
        groups: Math.min(20, Math.round(groups)),
        perGroup: Math.min(20, Math.round(perGroup)),
        item: clampStr(mg.item || "circle", 24) || "circle",
      };
    }
  }
  return {
    kind,
    caption: clampStr(raw.caption, 200),
    description: clampStr(raw.description, 600),
    labels: toList(raw.labels),
    elements: toList(raw.elements ?? raw.parts ?? raw.items),
    data: toDataPoints(raw.data ?? raw.dataPoints),
    mathGroups,
  };
}

/**
 * buildDiagramPrompt — turn a structured detected-diagram description into a
 * single natural-language prompt for the image model.
 *
 * Returns { prompt, style, size }. Style is always a printable line-art family
 * value generateDiagram accepts; size is portrait/landscape per kind. The
 * provider layer prepends the hard "black & white, no text" guard, so we focus
 * on an accurate, photocopy-friendly description and where label LINES belong.
 */
function buildDiagramPrompt(rawDetected, context = {}) {
  const d = normaliseDetected(rawDetected);
  const subjectPhrase = KIND_PHRASE[d.kind] || KIND_PHRASE.other;

  const parts = [];
  // Lead with the strongest signal: the caption, else the kind phrase.
  if (d.caption) {
    parts.push(`${subjectPhrase}: ${d.caption}.`);
  } else {
    parts.push(`${subjectPhrase}.`);
  }
  if (d.description) parts.push(d.description + ".");

  // Maths object groups (e.g. "3 × 2" drawn as two groups of three circles).
  if (d.mathGroups) {
    const {groups, perGroup, item} = d.mathGroups;
    parts.push(
      `Draw exactly ${groups} separate groups, each containing ${perGroup} ` +
      `identical ${item}s, with clear space between the groups so each group ` +
      `is easy to count.`,
    );
  }

  // Chart / pictograph data.
  if (d.data.length) {
    const rows = d.data
      .map((r) => (r.value == null ? r.label : `${r.label} = ${r.value}`))
      .join("; ");
    if (d.kind === "pictograph") {
      parts.push(
        `Show one row per category with a repeated identical symbol for each ` +
        `unit and a key. Categories and values: ${rows}.`,
      );
    } else {
      parts.push(`Plot these values: ${rows}.`);
    }
  }

  // Things to draw as distinct shapes (without writing their names — the studio
  // overlays label text on the leader lines separately).
  if (d.elements.length) {
    parts.push(`Include these distinct parts, drawn separately: ${d.elements.join(", ")}.`);
  }
  if (d.labels.length) {
    parts.push(
      `Provide a thin leader/label line pointing to each of: ${d.labels.join(", ")} ` +
      `(leave the line blank — do not write any words).`,
    );
  }

  // Context grounds the drawing at the right level without leaking into labels.
  const grade = clampStr(context.grade, 24);
  if (grade) {
    parts.push(`Keep it simple and accurate enough for a ${grade} learner.`);
  }

  // The universal printable rules. The provider guard repeats the colour/text
  // bans, but stating them here keeps the brief self-describing and steers
  // providers that weight the user prompt more heavily.
  parts.push(
    "Educational textbook style with accurate proportions, clean vector-style " +
    "black-and-white line art on a plain white background, no colour, no " +
    "shading, no gradients, no shadows, suitable for photocopying.",
  );

  return {
    prompt: clampStr(parts.join(" "), 800),
    style: "line_art",
    size: sizeForKind(d.kind),
  };
}

function sizeForKind(kind) {
  if (LANDSCAPE_KINDS.has(kind)) return "1365x1024";
  if (PORTRAIT_KINDS.has(kind)) return "1024x1365";
  return "1024x1024";
}

// ─── Diagram Library (picture bank) reuse ───────────────────────────────────

const STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "to", "with", "for", "in", "on",
  "diagram", "figure", "fig", "picture", "image", "drawing", "labelled",
  "labeled", "simple", "clean", "below", "above", "show", "study",
]);

// Break a phrase into meaningful lowercase tokens for keyword matching.
function tokenise(text) {
  return clampStr(text, 400)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * buildLibraryQuery — what to look for in the Diagram Library before
 * generating. Returns { term, keywords, subject } matching the pictureBank
 * search shape (searchActivePictures filters on name + keywords + subject).
 */
function buildLibraryQuery(rawDetected, context = {}) {
  const d = normaliseDetected(rawDetected);
  const subject = clampStr(context.subject || rawDetected?.subject, 60).toLowerCase();
  const term = d.caption || KIND_PHRASE[d.kind] || d.kind;

  const keywordSource = [
    d.kind,
    ...tokenise(d.caption),
    ...d.labels.flatMap(tokenise),
    ...d.elements.flatMap(tokenise),
    ...tokenise(context.topic),
    ...tokenise(context.subtopic),
  ];
  const seen = new Set();
  const keywords = [];
  for (const k of keywordSource) {
    const s = clampStr(k, 40).toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    keywords.push(s);
    if (keywords.length >= 20) break;
  }

  return {term: clampStr(term, 120), keywords, subject};
}

/**
 * scoreLibraryMatch — how well a library picture matches what we need, 0..1.
 * Combines keyword overlap (the dominant signal), subject agreement and a
 * name/term token overlap. Pure + deterministic so it unit-tests cleanly.
 */
function scoreLibraryMatch(candidate = {}, query = {}) {
  const wantKw = new Set(query.keywords || []);
  if (wantKw.size === 0) return 0;

  const candKw = new Set([
    ...(Array.isArray(candidate.keywords) ? candidate.keywords : []).map((k) => clampStr(k, 40).toLowerCase()),
    ...tokenise(candidate.name),
  ]);

  let overlap = 0;
  for (const k of wantKw) if (candKw.has(k)) overlap += 1;
  const keywordScore = overlap / wantKw.size; // 0..1

  // Subject agreement: a generic ('_generic') library entry is neutral, a
  // matching subject is a bonus, a clashing subject is a penalty.
  const candSubject = clampStr(candidate.subject, 60).toLowerCase();
  let subjectScore = 0.5;
  if (query.subject) {
    if (!candSubject || candSubject === "_generic") subjectScore = 0.5;
    else if (candSubject === query.subject) subjectScore = 1;
    else subjectScore = 0.1;
  }

  return Number((keywordScore * 0.8 + subjectScore * 0.2).toFixed(4));
}

/**
 * pickReusableDiagram — choose the best library picture to reuse, or null when
 * nothing clears the bar. `minScore` defaults to a deliberately conservative
 * 0.5 so we only reuse a genuinely-matching figure (a wrong reused diagram is
 * worse than spending a few cents generating a fresh one).
 */
function pickReusableDiagram(candidates, query, {minScore = 0.5} = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  let best = null;
  let bestScore = 0;
  for (const cand of list) {
    if (!cand || !cand.url) continue;
    const score = scoreLibraryMatch(cand, query);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  if (best && bestScore >= minScore) {
    return {picture: best, score: bestScore};
  }
  return null;
}

/**
 * buildLibraryMetadata — the pictureBank document fields for a freshly
 * generated diagram so future papers can reuse it. Staged (not active) so an
 * admin still reviews tags before teachers can find it (matches the existing
 * picture-bank lifecycle).
 */
function buildLibraryMetadata(rawDetected, context = {}, extra = {}) {
  const d = normaliseDetected(rawDetected);
  const query = buildLibraryQuery(rawDetected, context);
  const name = d.caption || KIND_PHRASE[d.kind] || "Imported diagram";
  return {
    name: clampStr(name, 120),
    nameLower: clampStr(name, 120).toLowerCase(),
    subject: query.subject || "_generic",
    gradeBand: clampStr(context.grade, 24),
    topic: clampStr(context.topic, 80),
    subtopic: clampStr(context.subtopic, 80),
    diagramType: d.kind,
    keywords: query.keywords,
    source: "test_paper_import",
    status: "staged",
    ...(extra.url ? {url: extra.url} : {}),
    ...(extra.storagePath ? {storagePath: extra.storagePath} : {}),
    ...(extra.prompt ? {sourcePrompt: clampStr(extra.prompt, 500)} : {}),
  };
}

module.exports = {
  DIAGRAM_HANDLING_OPTIONS,
  HANDLING_IDS,
  KIND_PHRASE,
  normaliseDetected,
  buildDiagramPrompt,
  sizeForKind,
  buildLibraryQuery,
  scoreLibraryMatch,
  pickReusableDiagram,
  buildLibraryMetadata,
  tokenise,
};
