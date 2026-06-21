/**
 * Plain-node unit test for download header helpers (no firebase deps).
 * Run: node functions/downloadHeaders.test.js
 */

const assert = require("assert");
const {sanitizeFilename, contentDispositionFor} = require("./downloadHeaders");

// sanitizeFilename strips path/illegal chars and collapses whitespace.
assert.strictEqual(
  sanitizeFilename("Grade 4 Integrated Science Lesson Plan - The Eye.docx"),
  "Grade 4 Integrated Science Lesson Plan - The Eye.docx",
);
assert.strictEqual(sanitizeFilename("a/b\\c:d*e?.docx"), "a b c d e .docx");
assert.strictEqual(sanitizeFilename(""), "download");
assert.strictEqual(sanitizeFilename("", "Lesson Plan.docx"), "Lesson Plan.docx");
assert.strictEqual(sanitizeFilename("  spaced   out  .docx"), "spaced out .docx");

// contentDispositionFor: attachment + readable ASCII fallback + UTF-8 form.
const cd = contentDispositionFor("Grade 4 Integrated Science Lesson Plan - The Eye.docx");
assert.ok(cd.startsWith("attachment;"), "is an attachment");
assert.ok(
  cd.includes('filename="Grade 4 Integrated Science Lesson Plan - The Eye.docx"'),
  "carries the readable name",
);
assert.strictEqual(
  decodeURIComponent(cd.split("filename*=UTF-8''")[1]),
  "Grade 4 Integrated Science Lesson Plan - The Eye.docx",
  "UTF-8 form round-trips",
);

// Non-ASCII preserved in the UTF-8 form, stripped from the quoted fallback.
const cd2 = contentDispositionFor("Notes — café.docx");
assert.ok(!cd2.includes('"Notes — café.docx"'), "no raw non-ASCII in quoted fallback");
assert.strictEqual(
  decodeURIComponent(cd2.split("filename*=UTF-8''")[1]),
  "Notes — café.docx",
);

// A quote can't break out of the quoted fallback.
assert.ok(!contentDispositionFor('a"b.docx').includes('"a"b.docx"'));

console.log("downloadHeaders.test.js: OK");
