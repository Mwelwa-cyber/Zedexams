/**
 * Plain-node unit test for the download-echo core helpers (no firebase deps).
 * Run: node functions/downloadEcho.test.js
 */

const assert = require("assert");
const {
  sanitizeType,
  contentDispositionFor,
  parseEchoData,
} = require("./downloadEchoCore");

// sanitizeType: known studio types pass through; everything else is neutralised
// to a generic binary attachment (defence-in-depth against inline rendering).
assert.strictEqual(
  sanitizeType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
);
assert.strictEqual(sanitizeType("application/pdf"), "application/pdf");
assert.strictEqual(sanitizeType("application/pdf; charset=utf-8"), "application/pdf");
assert.strictEqual(sanitizeType("text/html"), "application/octet-stream");
assert.strictEqual(sanitizeType(""), "application/octet-stream");
assert.strictEqual(sanitizeType(undefined), "application/octet-stream");

// contentDispositionFor: attachment + readable ASCII fallback + UTF-8 form.
const cd = contentDispositionFor("Grade 4 Integrated Science Lesson Plan - The Eye.docx");
assert.ok(cd.startsWith("attachment;"), "is an attachment");
assert.ok(
  cd.includes('filename="Grade 4 Integrated Science Lesson Plan - The Eye.docx"'),
  "carries the readable name",
);
const utf8 = cd.split("filename*=UTF-8''")[1];
assert.strictEqual(
  decodeURIComponent(utf8),
  "Grade 4 Integrated Science Lesson Plan - The Eye.docx",
  "UTF-8 form round-trips",
);

// A non-ASCII name is stripped from the quoted fallback but preserved in UTF-8.
const cd2 = contentDispositionFor("Notes — café.docx");
assert.ok(!cd2.includes('"Notes — café.docx"'), "no raw non-ASCII in the quoted fallback");
assert.strictEqual(
  decodeURIComponent(cd2.split("filename*=UTF-8''")[1]),
  "Notes — café.docx",
);

// A name with a quote can't break out of the quoted fallback.
assert.ok(!contentDispositionFor('a"b.docx').includes('"a"b.docx"'));

// parseEchoData: pulls the base64 out of a urlencoded `data=` body; the `+`/`/`
// of base64 arrive percent-encoded and must decode back exactly.
const sample = "TWFuPw=="; // base64
const body = `data=${encodeURIComponent(sample)}`;
assert.strictEqual(parseEchoData(body), sample, "extracts + decodes base64");
assert.strictEqual(parseEchoData("name=x"), null, "missing data → null");
assert.strictEqual(parseEchoData(""), null, "empty body → null");

console.log("downloadEcho.test.js: OK");
