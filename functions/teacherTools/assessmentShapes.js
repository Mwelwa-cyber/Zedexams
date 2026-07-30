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
  clockface: {params: ["hour", "minute", "cap"], desc: "analogue clock face showing a time; set hour (1-12) and minute (0-59). Use for telling/reading the time."},
  protractor: {params: ["angle", "cap"], desc: "an angle drawn on a protractor and measured in degrees; set 'angle' to its size, e.g. 60. Use for measuring/naming angles."},
  // 3-D solids
  cube: {params: ["side", "cap"], desc: "cube with a side label"},
  cuboid: {params: ["l", "w", "h", "cap"], desc: "cuboid with length, width and height labels (use for volume)"},
  cylinder: {params: ["r", "h", "cap"], desc: "cylinder with radius and height labels"},
  cone: {params: ["r", "h", "cap"], desc: "cone with radius and height labels"},
  sphere: {params: ["r", "cap"], desc: "sphere with a radius label"},
  pyramid: {params: ["l", "w", "h", "notToScale", "cap"], desc: "rectangular-based pyramid drawn in the TRUE proportions of its measurements, with a dashed perpendicular height (use for volume/surface-area questions)"},
  frustum: {params: ["l", "w", "tl", "tw", "h", "notToScale", "cap"], desc: "frustum of a rectangular pyramid: base l x w, smaller top tl x tw centred over it, dashed height — the top MUST be smaller than the base"},
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

  // ── Secondary mathematics (Forms 1-4 / Grade 12) ──────────────────────────
  // Every one of these is COMPUTED from its parameters, so the figure is
  // mathematically true: the image of a rotation, the turning point of a
  // plotted quadratic and an ogive's quartiles are all correct by
  // construction. Give the parameters and let the figure do the geometry —
  // never describe a diagram in prose and hope.
  circletheorem: {params: ["centre", "points", "joins", "angles", "tangent", "notToScale", "cap"], desc: "circle-theorem figure (angle at the centre, same segment, cyclic quadrilateral, tangent, alternate segment). points 'A@160,B@60,C@300' places each point at that many degrees anticlockwise from the 3 o'clock position; joins 'O-A,A-B' draws chords and radii (O is the centre); angles 'AOC=110,ABC=x' marks an angle at the middle letter; tangent 'C:T,U' adds the tangent at C with its ends named"},
  bearings: {params: ["legs", "unit", "notToScale", "cap"], desc: "bearings journey drawn on true bearings with a north line at each turning point; legs 'A>B,060,8;B>C,135,6' is from>to, three-figure bearing, distance"},
  elevation: {params: ["angle", "mode", "observer", "object", "base", "height", "notToScale", "cap"], desc: "angle of elevation or depression, drawn at its true size; mode is 'elevation' or 'depression'"},
  labelledtriangle: {params: ["a", "b", "c", "angleA", "angleB", "angleC", "sideAB", "sideBC", "sideCA", "notToScale", "cap"], desc: "triangle for sine/cosine-rule questions; numeric angles are drawn at their true size, and any label may be a symbol such as x"},
  functiongraph: {params: ["fn", "xMin", "xMax", "yMin", "yMax", "show", "notToScale", "cap"], desc: "a function plotted exactly from its equation; fn like 'y = x^2 - 2x - 3', 'y = 2x + 1' or 'y = 6/x' (polynomials to a cubic, and the reciprocal — no brackets or other functions); show 'roots,turning,yintercept' marks those points with their coordinates"},
  transformation: {params: ["object", "type", "by", "objectLabel", "imageLabel", "xMin", "xMax", "yMin", "yMax", "notToScale", "cap"], desc: "object and its computed image on a grid; object '(1,1),(4,1),(1,3)'; type translation|reflection|rotation|enlargement|shear|stretch; by 'translation 3,-2' / 'reflection y=x' / 'rotation 90,0,0' (angle,centre; positive is anticlockwise) / 'enlargement 2,0,0' (factor,centre) / 'shear x,2' / 'stretch y,3'"},
  vectordiagram: {params: ["vectors", "grid", "xMin", "xMax", "yMin", "yMax", "notToScale", "cap"], desc: "directed line segments; vectors 'a:(0,0)>(4,2),b:(4,2)>(6,-2)' is name:from>to"},
  histogram: {params: ["boundaries", "frequencies", "density", "xLabel", "yLabel", "notToScale", "cap"], desc: "histogram from a grouped frequency table; boundaries '0,10,20,30' and one frequency per class. Set density 'yes' for frequency density when the classes have unequal widths"},
  frequencypolygon: {params: ["boundaries", "frequencies", "xLabel", "yLabel", "notToScale", "cap"], desc: "frequency polygon through the class midpoints, closing to zero at each end"},
  ogive: {params: ["boundaries", "frequencies", "readOff", "xLabel", "yLabel", "notToScale", "cap"], desc: "cumulative frequency curve; readOff 'median,quartiles' draws the read-off lines at the true interpolated positions"},
  travelgraph: {params: ["points", "xLabel", "yLabel", "shade", "notToScale", "cap"], desc: "distance-time or speed-time graph; points '0,0;1,60;2.5,60;4,0' is time,value in time order. shade 'yes' fills the area under the graph for area-under-graph questions"},
  linearprogramming: {params: ["constraints", "shade", "regionLabel", "xMin", "xMax", "yMin", "yMax", "notToScale", "cap"], desc: "feasible region from inequalities; constraints 'x+y<=6,2x+y<=8,x>=0,y>=0'. Strict inequalities get a dashed boundary automatically; shade 'unwanted' (exam convention) or 'wanted'"},
  earthgeometry: {params: ["points", "showParallels", "showMeridians", "notToScale", "cap"], desc: "latitude and longitude sketch on a globe; points 'P:60N,20E;Q:60N,80E' — points on the same parallel are drawn at the same height"},
  venn3elements: {params: ["a", "b", "c", "onlyA", "onlyB", "onlyC", "aAndB", "aAndC", "bAndC", "all", "outside", "notToScale", "cap"], desc: "three-set Venn with all seven regions written in, plus the outside — use this rather than venn3 when a question needs A∩B∩C"},
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
