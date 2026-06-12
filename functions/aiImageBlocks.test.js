/**
 * Unit tests for the vision-block helpers shared by the AI answer tools.
 * Plain `node` script — runs under CI's root-only `npm ci`.
 *
 * Run: node functions/aiImageBlocks.test.js
 */

const assert = require("node:assert");
const {
  sanitizeImageUrl,
  sanitizeOptionImages,
  buildQuestionImageBlocks,
  hasQuestionImages,
} = require("./aiImageBlocks");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("aiImageBlocks");

const HTTPS = "https://firebasestorage.googleapis.com/v0/b/x/o/q.png?alt=media&token=abc";

// ── sanitizeImageUrl ───────────────────────────────────────────────────────
ok("keeps a clean https Firebase URL", sanitizeImageUrl(HTTPS) === HTTPS);
ok("trims surrounding whitespace", sanitizeImageUrl(`  ${HTTPS}  `) === HTTPS);
ok("rejects blob: URLs", sanitizeImageUrl("blob:https://app/abc") === "");
ok("rejects data: URLs", sanitizeImageUrl("data:image/png;base64,AAAA") === "");
ok("rejects plain http", sanitizeImageUrl("http://x/y.png") === "");
ok("rejects URLs with embedded spaces", sanitizeImageUrl("https://x/y z.png") === "");
ok("rejects non-strings", sanitizeImageUrl(null) === "" && sanitizeImageUrl({}) === "");
ok("rejects an over-long URL", sanitizeImageUrl(`https://x/${"a".repeat(2100)}`) === "");

// ── sanitizeOptionImages ───────────────────────────────────────────────────
const opts = sanitizeOptionImages([HTTPS, "blob:bad", "", HTTPS]);
ok("keeps slot alignment, blanking junk", opts.length === 4 && opts[0] === HTTPS && opts[1] === "" && opts[3] === HTTPS);
ok("caps option images at 6", sanitizeOptionImages(new Array(20).fill(HTTPS)).length === 6);
ok("non-array → empty", sanitizeOptionImages("x").length === 0);

// ── hasQuestionImages ──────────────────────────────────────────────────────
ok("detects a question image", hasQuestionImages({imageUrl: HTTPS}) === true);
ok("detects a passage image", hasQuestionImages({passageImageUrl: HTTPS}) === true);
ok("detects an option image", hasQuestionImages({optionImages: ["", HTTPS]}) === true);
ok("none → false", hasQuestionImages({imageUrl: "blob:x", optionImages: [""]}) === false);
ok("empty payload → false", hasQuestionImages() === false);

// ── buildQuestionImageBlocks ───────────────────────────────────────────────
const empty = buildQuestionImageBlocks({imageUrl: "blob:nope"});
ok("no usable images → no blocks", Array.isArray(empty) && empty.length === 0);

const blocks = buildQuestionImageBlocks({
  passageImageUrl: HTTPS,
  imageUrl: HTTPS,
  optionImages: ["", HTTPS],
}, "id: q7");
// passage(label+image) + question(label+image) + optionB(label+image) = 6
ok("emits a label+image pair per picture", blocks.length === 6);
ok("uses Anthropic url image source", blocks[1].type === "image" && blocks[1].source.type === "url" && blocks[1].source.url === HTTPS);
ok("labels the passage diagram", /Shared picture/.test(blocks[0].text));
ok("weaves the id tag into labels", /id: q7/.test(blocks[0].text));
ok("labels option B with its letter", blocks[4].type === "text" && /option B/.test(blocks[4].text));

console.log(`\naiImageBlocks: ${passed} passed`);
