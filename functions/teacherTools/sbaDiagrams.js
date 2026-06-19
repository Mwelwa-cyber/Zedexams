/**
 * sbaDiagrams — the deterministic SVG diagram catalog subset the SBA task
 * generator is allowed to request as an EXACT library figure ({libraryKey,
 * params}).
 *
 * SBA tasks are broader than the maths-heavy Assessment generator: an
 * Integrated Science experiment wants a plant cell or a simple circuit, a
 * Social Studies task wants a compass rose or a timeline. So unlike
 * `assessmentShapes` (maths/graphs only — science stays on the raster path),
 * this allowlist also exposes the catalog's Science, Geography and Organiser
 * figures, which are pure deterministic SVGs that print identically every time.
 *
 * Like assessmentShapes it's a CommonJS mirror of keys + param names (Cloud
 * Functions are a separate package from the src/ ESM catalog). The drift guard
 * `scripts/test-sba-diagrams.mjs` asserts every key + field here still exists in
 * the real catalog so the two never drift.
 */

const {SHAPE_LIBRARY, clampShapeParams} = require("./assessmentShapes");

// Catalog figures beyond the maths set that make sense on an SBA task — drawn
// deterministically from the catalog (no AI image generation).
const EXTRA_LIBRARY = {
  // Science
  plantcell: {params: ["cap"], desc: "a labelled plant cell (cell wall, nucleus, chloroplasts)"},
  animalcell: {params: ["cap"], desc: "a labelled animal cell (nucleus, mitochondria)"},
  circuit: {params: ["cap"], desc: "a simple electric circuit — battery, bulb, switch"},
  forcearrows: {params: ["up", "down", "left", "right", "cap"], desc: "forces acting on an object as labelled arrows (up, down, left, right)"},
  foodchain: {params: ["a", "b", "c", "d", "cap"], desc: "a food chain of up to four linked items, e.g. Sun → Grass → Goat → Lion"},
  // Geography
  compass: {params: ["cap"], desc: "a compass rose showing N, S, E, W"},
  contourlines: {params: ["cap"], desc: "contour lines representing a hill"},
  // Organisers
  mindmap: {params: ["centre", "a", "b", "c", "d", "cap"], desc: "a mind map — a centre topic with up to four branches (centre, a, b, c, d)"},
  tchart: {params: ["left", "right", "cap"], desc: "a T-chart for comparing two sides (left, right headers)"},
  timeline: {params: ["years", "events", "cap"], desc: "a timeline; years and events are comma lists"},
  flowchart: {params: ["a", "b", "c", "d", "cap"], desc: "a four-step flowchart (a, b, c, d)"},
};

// SBA gets the maths set plus the extra figures above.
const SBA_DIAGRAM_LIBRARY = {...SHAPE_LIBRARY, ...EXTRA_LIBRARY};

const SBA_DIAGRAM_KEYS = new Set(Object.keys(SBA_DIAGRAM_LIBRARY));

function isAllowedSbaDiagram(key) {
  return typeof key === "string" && SBA_DIAGRAM_KEYS.has(key);
}

/** Compact reference block injected into the prompt so the model knows the keys. */
function sbaDiagramReference() {
  return Object.entries(SBA_DIAGRAM_LIBRARY)
      .map(([key, {params, desc}]) => `  - ${key} — ${desc} (params: ${params.join(", ")})`)
      .join("\n");
}

module.exports = {
  SBA_DIAGRAM_LIBRARY,
  isAllowedSbaDiagram,
  // Param clamping is generic (short string map); reuse the shapes helper.
  clampDiagramParams: clampShapeParams,
  sbaDiagramReference,
};
