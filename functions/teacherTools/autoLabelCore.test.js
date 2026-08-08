/**
 * Tests for autoLabelCore (Visual Studio v2, spec 1C) — image-input guards,
 * prompt content, and strict validation/sanitation of the model's proposals.
 * Plain `node` script, no Firebase.
 */

const assert = require("node:assert");
const {
  parseImageDataUrl,
  buildAutoLabelSystemPrompt,
  buildAutoLabelUserContent,
  parseAutoLabelParts,
  LOW_CONFIDENCE_THRESHOLD,
  MAX_AUTO_LABELS,
} = require("./autoLabelCore");

// ── parseImageDataUrl ───────────────────────────────────────────────────────

const png = `data:image/png;base64,${Buffer.from("fake-png").toString("base64")}`;
{
  const img = parseImageDataUrl(png);
  assert.equal(img.mediaType, "image/png");
  assert.ok(img.data.length > 0);
}
assert.equal(parseImageDataUrl("https://example.com/a.png"), null, "plain URL refused");
assert.equal(parseImageDataUrl("data:image/svg+xml;base64,AAAA"), null, "non-Anthropic MIME refused");
assert.equal(parseImageDataUrl(""), null);
{
  // Over the 5 MB decoded cap → refused.
  const big = `data:image/png;base64,${"A".repeat(7 * 1024 * 1024)}`;
  assert.equal(parseImageDataUrl(big), null, "oversized image refused");
}

// ── prompt content ──────────────────────────────────────────────────────────

{
  const sys = buildAutoLabelSystemPrompt();
  assert.ok(sys.includes("\"parts\""), "system prompt shows the JSON shape");
  assert.ok(/normalized 0-1/i.test(sys), "anchor contract stated");
  assert.ok(/grade/i.test(sys), "grade-vocabulary rule stated");

  const image = parseImageDataUrl(png);
  const content = buildAutoLabelUserContent({
    image, subject: "Integrated Science", grade: "7", topic: "Digestive system",
    contextBlock: "OUTCOME: identify organs", existingWords: ["Stomach"],
  });
  assert.equal(content.length, 2, "text block + image block");
  assert.equal(content[1].type, "image");
  assert.equal(content[1].source.media_type, "image/png");
  const text = content[0].text;
  assert.ok(text.includes("Integrated Science"));
  assert.ok(text.includes("Digestive system"));
  assert.ok(text.includes("OUTCOME: identify organs"), "grounding block included");
  assert.ok(/do NOT propose these parts again\): Stomach/.test(text), "existing words passed");

  const bare = buildAutoLabelUserContent({image});
  assert.ok(!/grounding/i.test(bare[0].text), "no grounding header when context missing");
}

// ── parseAutoLabelParts ─────────────────────────────────────────────────────

const good = JSON.stringify({
  parts: [
    {word: "Stomach", anchor: {x: 0.42, y: 0.55}, confidence: 0.93},
    {word: "Liver", anchor: {x: 0.35, y: 0.3}, confidence: 0.6},
  ],
});

{
  const r = parseAutoLabelParts(good);
  assert.equal(r.ok, true);
  assert.equal(r.parts.length, 2);
  assert.equal(r.parts[0].word, "Stomach");
  assert.deepEqual(r.parts[0].anchor, {x: 0.42, y: 0.55});
  assert.ok(r.parts[1].confidence < LOW_CONFIDENCE_THRESHOLD, "low-confidence part flows through for the amber flag");
}

// Markdown fences stripped; empty parts is a VALID answer (not a retry).
assert.equal(parseAutoLabelParts("```json\n" + good + "\n```").ok, true);
{
  const r = parseAutoLabelParts("{\"parts\":[]}");
  assert.equal(r.ok, true);
  assert.deepEqual(r.parts, []);
}

// Malformed shapes → ok:false (runner's silent-retry trigger).
assert.equal(parseAutoLabelParts("not json at all").ok, false);
assert.equal(parseAutoLabelParts("{\"labels\":[]}").ok, false);
assert.equal(parseAutoLabelParts("null").ok, false);

// Bounds: a rounding hair outside clamps; far outside drops the part.
{
  const r = parseAutoLabelParts(JSON.stringify({parts: [
    {word: "Edge", anchor: {x: 1.01, y: 0}, confidence: 0.9},
    {word: "Gone", anchor: {x: 1.4, y: 0.5}, confidence: 0.9},
    {word: "NoAnchor", confidence: 0.9},
  ]}));
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].word, "Edge");
  assert.equal(r.parts[0].anchor.x, 1, "epsilon overshoot clamped");
}

// Missing confidence defaults conservatively; junk confidence clamps.
{
  const r = parseAutoLabelParts(JSON.stringify({parts: [
    {word: "A", anchor: {x: 0.5, y: 0.5}},
    {word: "B", anchor: {x: 0.1, y: 0.1}, confidence: 7},
  ]}));
  assert.equal(r.parts[0].confidence, 0.5);
  assert.equal(r.parts[1].confidence, 1);
}

// Duplicates: same word at ~the same spot collapses to the best instance;
// the same word far apart (left/right wing) survives.
{
  const r = parseAutoLabelParts(JSON.stringify({parts: [
    {word: "Wing", anchor: {x: 0.2, y: 0.5}, confidence: 0.6},
    {word: "wing", anchor: {x: 0.21, y: 0.5}, confidence: 0.9},
    {word: "Wing", anchor: {x: 0.8, y: 0.5}, confidence: 0.8},
  ]}));
  assert.equal(r.parts.length, 2);
  assert.equal(r.parts[0].confidence, 0.9, "near-duplicate kept the higher confidence");
  assert.deepEqual(r.parts[0].anchor, {x: 0.21, y: 0.5});
}

// existingWords filter (re-run proposes only unlabelled parts), case-insensitive.
{
  const r = parseAutoLabelParts(good, {existingWords: ["stomach"]});
  assert.deepEqual(r.parts.map((p) => p.word), ["Liver"]);
}

// Cap at MAX_AUTO_LABELS.
{
  const many = {parts: Array.from({length: MAX_AUTO_LABELS + 10}, (_, i) => (
    {word: `Part ${i}`, anchor: {x: 0.5, y: 0.5}, confidence: 0.9}
  ))};
  const r = parseAutoLabelParts(JSON.stringify(many));
  assert.equal(r.parts.length, MAX_AUTO_LABELS);
}

// Blank / whitespace words drop; long words bound to 60 chars.
{
  const r = parseAutoLabelParts(JSON.stringify({parts: [
    {word: "   ", anchor: {x: 0.5, y: 0.5}},
    {word: "x".repeat(100), anchor: {x: 0.5, y: 0.5}},
  ]}));
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].word.length, 60);
}

console.log("autoLabelCore.test: all assertions passed");
