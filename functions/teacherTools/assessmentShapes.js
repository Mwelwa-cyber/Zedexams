/**
 * assessmentShapes — the maths/graph subset of the deterministic SVG diagram
 * catalog (src/components/diagrams/diagramCatalog.js) that the assessment AI is
 * allowed to request as an EXACT figure (kind "shape" / "shape_options").
 *
 * Why a separate allowlist instead of importing the catalog?
 *   The catalog is an ESM module under src/ (browser app + tests). Cloud
 *   Functions are a separate CommonJS package; pulling a src/ ESM file into the
 *   functions bundle is awkward. So we keep a small CommonJS mirror of just the
 *   keys + param names the model needs, and a test (assessmentShapes.test.js)
 *   asserts every key + field here still exists in the real catalog so the two
 *   never drift.
 *
 * Only maths-relevant entries are exposed — shapes, solids, graphs, Venn,
 * number lines and mappings. Science/geography/organiser diagrams stay on the
 * raster (drawn-picture) path.
 */

// key -> { params: [field names], desc: short usage hint for the prompt }
const SHAPE_LIBRARY = {
  // 2-D shapes
  triangle: {params: ["a", "b", "c", "cap"], desc: "triangle with vertex labels a,b,c"},
  righttriangle: {params: ["a", "b", "c", "cap"], desc: "right-angled triangle"},
  square: {params: ["side", "cap"], desc: "square with a side label"},
  rectangle: {params: ["l", "w", "cap"], desc: "rectangle with length l and width w labels"},
  parallelogram: {params: ["base", "side", "cap"], desc: "parallelogram with base and slant-side labels"},
  parallelogramh: {params: ["base", "height", "cap"], desc: "parallelogram with base and a dashed perpendicular height (use for area = base × height)"},
  trapezium: {params: ["top", "bottom", "height", "cap"], desc: "trapezium with top, bottom and height labels"},
  rhombus: {params: ["side", "cap"], desc: "rhombus with a side label"},
  pentagon: {params: ["cap"], desc: "regular pentagon"},
  hexagon: {params: ["cap"], desc: "regular hexagon"},
  circle: {params: ["center", "radius", "cap"], desc: "circle with centre and radius labels"},
  angle: {params: ["label", "cap"], desc: "a single marked angle"},
  triangleangle: {params: ["angle", "a", "b", "cc", "cap"], desc: "triangle with one angle marked (e.g. angle 'c'); a/b/cc are optional vertex labels"},
  // 3-D solids
  cube: {params: ["side", "cap"], desc: "cube with a side label"},
  cuboid: {params: ["l", "w", "h", "cap"], desc: "cuboid with length, width and height labels (use for volume)"},
  cylinder: {params: ["r", "h", "cap"], desc: "cylinder with radius and height labels"},
  cone: {params: ["r", "h", "cap"], desc: "cone with radius and height labels"},
  sphere: {params: ["r", "cap"], desc: "sphere with a radius label"},
  // graphs & number work
  numberline: {params: ["min", "max", "step", "highlight", "cap"], desc: "number line from min to max in steps; highlight marks one value"},
  numberlinejump: {params: ["min", "max", "step", "jumps", "cap"], desc: "number line showing integer jumps for add/subtract; jumps like \"-3>2,2>5\" (each draws a +/- hop arc). Use for integer arithmetic."},
  coordgrid: {params: ["range", "cap"], desc: "Cartesian coordinate grid, axes from -range to +range"},
  fractionbar: {params: ["parts", "shaded", "cap"], desc: "fraction bar split into 'parts' with 'shaded' shaded"},
  barchart: {params: ["labels", "values", "cap"], desc: "bar chart; labels and values are comma lists"},
  piechart: {params: ["labels", "values", "cap"], desc: "pie chart; labels and values are comma lists"},
  linegraph: {params: ["labels", "values", "cap"], desc: "line graph; x labels and y values are comma lists"},
  // sets & relations
  venn2: {params: ["a", "b", "cap"], desc: "two-set Venn diagram with set names A and B"},
  venn3: {params: ["a", "b", "c", "cap"], desc: "three-set Venn diagram"},
  vennelements: {params: ["a", "b", "onlyA", "both", "onlyB", "outside", "cap"], desc: "two-set Venn with elements placed in each region (comma lists): onlyA, both (A∩B), onlyB, outside"},
  mapping: {params: ["left", "right", "links", "cap"], desc: "mapping/relation diagram; left & right are comma lists, links like '1>2,2>3' (1-based rows)"},
};

const SHAPE_KEYS = new Set(Object.keys(SHAPE_LIBRARY));

function isAllowedShape(key) {
  return typeof key === "string" && SHAPE_KEYS.has(key);
}

/**
 * Coerce an AI-supplied params object to a safe string map: known shape values
 * are arbitrary short strings (labels / comma lists / numbers-as-text). We keep
 * any keys (the catalog ignores unknown ones and fills defaults), but clamp the
 * count and each value's length, and stringify everything.
 */
function clampShapeParams(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n >= 12) break;
    if (typeof k !== "string" || !k) continue;
    if (v === null || v === undefined) continue;
    out[k.slice(0, 40)] = String(v).slice(0, 200);
    n += 1;
  }
  return out;
}

/** Compact reference block injected into the prompt so the model knows the keys. */
function shapeLibraryReference() {
  return Object.entries(SHAPE_LIBRARY)
      .map(([key, {params, desc}]) => `  - ${key} — ${desc} (params: ${params.join(", ")})`)
      .join("\n");
}

module.exports = {
  SHAPE_LIBRARY,
  isAllowedShape,
  clampShapeParams,
  shapeLibraryReference,
};
