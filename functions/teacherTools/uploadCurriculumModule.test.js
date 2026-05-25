// Pure-helper tests for the admin curriculum-upload pipeline. Mirrors
// the style of functions/aiPromptPolicy.test.js — plain assertions
// against pure functions, no test runner.
//
// Imports go through ./uploadCurriculumModuleHelpers (not
// uploadCurriculumModule) so the test loads cleanly in CI's repo-root
// `npm ci` environment — the callable file pulls in firebase-functions/v2
// which only lives in functions/package.json.

const assert = require("assert");

const {
  extOf,
  sanitiseStoragePath,
  sanitiseGrade,
  sanitiseSubject,
  sanitiseTerm,
  sanitiseTopic,
  sanitiseDocumentType,
  detectKindFromPath,
  parseXlsx,
  buildAdminCurriculumDoc,
  buildAdminRagChunkDocs,
  buildAdminCurriculumDocId,
  SUPPORTED_DOCUMENT_TYPES,
  EXT_TO_KIND,
} = require("./uploadCurriculumModuleHelpers");

const {
  buildIngestTagsFor,
  scoreChunk,
} = require("./privateCurriculum");

// exceljs is in functions/package.json but not the repo root. Skip the
// workbook construction cases when it isn't available — parseXlsx itself
// degrades to {unsupported:true} in that case, so we still cover the
// no-buffer + degraded paths.
let ExcelJSAvailable = false;
try {
  require.resolve("exceljs");
  ExcelJSAvailable = true;
} catch { /* skip */ }

function group(name, fn) {
  process.stdout.write(`\n  ${name}\n`);
  fn();
}
function it(desc, fn) {
  try {
    fn();
    process.stdout.write(`    ok  ${desc}\n`);
  } catch (err) {
    process.stdout.write(`    FAIL ${desc}\n    ${err.stack || err.message}\n`);
    process.exitCode = 1;
  }
}

process.stdout.write("uploadCurriculumModule helpers\n");

group("extOf", () => {
  it("extracts a lowercase extension", () => {
    assert.strictEqual(extOf("notes.PDF"), "pdf");
    assert.strictEqual(extOf("workbook.xlsx"), "xlsx");
    assert.strictEqual(extOf("guide.docx"), "docx");
  });
  it("returns empty for no extension", () => {
    assert.strictEqual(extOf("README"), "");
    assert.strictEqual(extOf(""), "");
    assert.strictEqual(extOf(null), "");
  });
  it("handles query strings + fragments", () => {
    assert.strictEqual(extOf("guide.pdf?v=2"), "pdf");
    assert.strictEqual(extOf("notes.docx#page=3"), "docx");
  });
});

group("sanitiseStoragePath", () => {
  it("accepts a curriculum-uploads pdf", () => {
    assert.strictEqual(
        sanitiseStoragePath("curriculum-uploads/uid1/1700000000-notes.pdf"),
        "curriculum-uploads/uid1/1700000000-notes.pdf",
    );
  });
  it("accepts docx + xlsx", () => {
    assert.ok(sanitiseStoragePath("curriculum-uploads/uid1/wb.xlsx"));
    assert.ok(sanitiseStoragePath("curriculum-uploads/uid1/g.docx"));
  });
  it("rejects paths outside the prefix", () => {
    assert.strictEqual(sanitiseStoragePath("syllabus-uploads/v1/x.pdf"), null);
    assert.strictEqual(sanitiseStoragePath("/curriculum-uploads/x.pdf"), null);
  });
  it("rejects unsupported extensions", () => {
    assert.strictEqual(sanitiseStoragePath("curriculum-uploads/u/x.doc"), null);
    assert.strictEqual(sanitiseStoragePath("curriculum-uploads/u/x.txt"), null);
    assert.strictEqual(sanitiseStoragePath("curriculum-uploads/u/x"), null);
  });
  it("blocks path traversal", () => {
    assert.strictEqual(
        sanitiseStoragePath("curriculum-uploads/uid1/../etc/passwd.pdf"),
        null,
    );
  });
});

group("sanitiseGrade / sanitiseSubject / sanitiseTerm / sanitiseTopic", () => {
  it("normalises grade tokens", () => {
    assert.strictEqual(sanitiseGrade(" g6 "), "G6");
    assert.strictEqual(sanitiseGrade("F2"), "F2");
    assert.strictEqual(sanitiseGrade("ece"), "ECE");
    assert.strictEqual(sanitiseGrade("Grade 6"), null);
    assert.strictEqual(sanitiseGrade(""), null);
  });
  it("normalises subject keys", () => {
    assert.strictEqual(sanitiseSubject("Mathematics"), "mathematics");
    assert.strictEqual(sanitiseSubject("integrated science"), "integrated_science");
    assert.strictEqual(sanitiseSubject(""), null);
    assert.strictEqual(sanitiseSubject("a".repeat(80)), null);
  });
  it("validates terms", () => {
    assert.strictEqual(sanitiseTerm("2"), 2);
    assert.strictEqual(sanitiseTerm(1), 1);
    assert.strictEqual(sanitiseTerm(0), null);
    assert.strictEqual(sanitiseTerm(4), null);
    assert.strictEqual(sanitiseTerm(null), null);
    assert.strictEqual(sanitiseTerm(""), null);
  });
  it("clips topic strings", () => {
    assert.strictEqual(sanitiseTopic("  Fractions  "), "Fractions");
    assert.strictEqual(sanitiseTopic(null), null);
    assert.strictEqual(sanitiseTopic("x".repeat(300)).length, 200);
  });
});

group("sanitiseDocumentType", () => {
  it("falls back to module for unknown values", () => {
    assert.strictEqual(sanitiseDocumentType("invented"), "module");
    assert.strictEqual(sanitiseDocumentType(""), "module");
    assert.strictEqual(sanitiseDocumentType(null), "module");
  });
  it("accepts every supported value", () => {
    for (const t of SUPPORTED_DOCUMENT_TYPES) {
      assert.strictEqual(sanitiseDocumentType(t), t);
    }
  });
});

group("detectKindFromPath", () => {
  it("maps each known extension", () => {
    assert.strictEqual(detectKindFromPath("curriculum-uploads/u/x.pdf"), "pdf");
    assert.strictEqual(detectKindFromPath("curriculum-uploads/u/x.docx"), "docx");
    assert.strictEqual(detectKindFromPath("curriculum-uploads/u/x.xlsx"), "xlsx");
  });
  it("returns null for unknown extensions", () => {
    assert.strictEqual(detectKindFromPath("curriculum-uploads/u/x.zip"), null);
  });
  it("exports the expected kind table", () => {
    assert.deepStrictEqual(
        Object.keys(EXT_TO_KIND).sort(),
        ["docx", "pdf", "xlsx"],
    );
  });
});

group("buildAdminCurriculumDocId", () => {
  it("is deterministic for the same uid + path", () => {
    const a = buildAdminCurriculumDocId("uid1", "curriculum-uploads/uid1/x.pdf");
    const b = buildAdminCurriculumDocId("uid1", "curriculum-uploads/uid1/x.pdf");
    assert.strictEqual(a, b);
    assert.match(a, /^[0-9a-f]{32}$/);
  });
  it("differs when uid or path differ", () => {
    const a = buildAdminCurriculumDocId("uid1", "curriculum-uploads/uid1/x.pdf");
    const b = buildAdminCurriculumDocId("uid2", "curriculum-uploads/uid1/x.pdf");
    const c = buildAdminCurriculumDocId("uid1", "curriculum-uploads/uid1/y.pdf");
    assert.notStrictEqual(a, b);
    assert.notStrictEqual(a, c);
  });
});

group("buildAdminCurriculumDoc", () => {
  it("stamps importedBy + reviewStatus correctly", () => {
    const doc = buildAdminCurriculumDoc({
      uid: "uid1",
      storagePath: "curriculum-uploads/uid1/g6-fractions.pdf",
      filename: "g6-fractions.pdf",
      kind: "pdf",
      grade: "G6",
      subject: "mathematics",
      term: 2,
      topic: "Fractions",
      documentType: "module",
      byteLength: 1234,
      chunkCount: 5,
    });
    assert.strictEqual(doc.importedBy, "admin_upload");
    assert.strictEqual(doc.reviewStatus, "approved");
    assert.strictEqual(doc.uploadedBy, "uid1");
    assert.strictEqual(doc.documentType, "module");
    assert.strictEqual(doc.grade, "G6");
    assert.strictEqual(doc.term, 2);
    assert.strictEqual(doc.confidence, "high");
  });
});

group("buildAdminRagChunkDocs", () => {
  it("carries tags + documentType onto every chunk", () => {
    const embedded = [
      {text: "alpha", embedding: [0.1, 0.2]},
      {text: "beta", embedding: null},
    ];
    const docs = buildAdminRagChunkDocs("abc123", embedded, {
      filename: "f.pdf",
      grade: "G6",
      subject: "mathematics",
      term: 2,
      topic: "Fractions",
      documentType: "module",
      tags: ["maths_up", "module", "admin_upload"],
    });
    assert.strictEqual(docs.length, 2);
    assert.strictEqual(docs[0].id, "abc123_0000");
    assert.strictEqual(docs[1].id, "abc123_0001");
    assert.deepStrictEqual(docs[0].data.tags,
        ["maths_up", "module", "admin_upload"]);
    assert.strictEqual(docs[0].data.documentType, "module");
    assert.strictEqual(docs[0].data.topic_title, "Fractions");
    assert.strictEqual(docs[0].data.source_group, "admin_upload");
    assert.strictEqual(docs[1].data.embedding, null);
    assert.strictEqual(docs[0].data.embedding_model, "text-embedding-3-small");
  });
});

group("parseXlsx", () => {
  if (ExcelJSAvailable) {
    it("flattens a small workbook into text", async () => {
      const ExcelJS = require("exceljs");
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet("Term 1");
      sheet.addRow(["Week", "Topic", "Outcome"]);
      sheet.addRow([1, "Fractions", "Identify halves"]);
      sheet.addRow([2, "Decimals", "Place value"]);
      const buf = await wb.xlsx.writeBuffer();
      const res = await parseXlsx(Buffer.from(buf));
      assert.ok(res.text.length > 30);
      assert.ok(res.text.includes("Fractions"));
      assert.ok(res.text.includes("Decimals"));
      assert.ok(res.headings.includes("Term 1"));
    });
    it("returns empty text for an empty workbook", async () => {
      const ExcelJS = require("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet("Blank");
      const buf = await wb.xlsx.writeBuffer();
      const res = await parseXlsx(Buffer.from(buf));
      assert.strictEqual(typeof res.text, "string");
    });
  } else {
    it("(skipped — exceljs not installed at root) degrades gracefully", async () => {
      const res = await parseXlsx(Buffer.from([0, 1, 2, 3]));
      assert.ok(res.unsupported,
          "parseXlsx should set unsupported when exceljs is missing");
      assert.match(res.reason || "", /exceljs_missing/);
    });
  }
  it("rejects non-buffer input gracefully", async () => {
    const res = await parseXlsx(null);
    assert.strictEqual(res.text, "");
    assert.deepStrictEqual(res.headings, []);
  });
});

group("buildIngestTagsFor (privateCurriculum)", () => {
  it("returns the syllabus tags for upper-primary maths", () => {
    const tags = buildIngestTagsFor("G6", "mathematics");
    assert.ok(tags.includes("maths_up"),
        `expected maths_up in ${tags.join(",")}`);
    assert.ok(tags.includes("upper_primary"));
  });
  it("returns the o-level english tags for F2", () => {
    const tags = buildIngestTagsFor("F2", "english");
    assert.ok(tags.includes("english_o"));
    assert.ok(tags.includes("o_level"));
  });
  it("returns ECE tags for ECE maths", () => {
    const tags = buildIngestTagsFor("ECE", "mathematics");
    assert.ok(tags.includes("ece_syllabus"));
    assert.ok(tags.includes("ece"));
  });
  it("returns only the band tag for an unknown subject", () => {
    const tags = buildIngestTagsFor("G5", "esoteric_subject");
    // SUBJECT_PROFILES has no esoteric_subject — should still include the
    // band so grade-scoped queries pick something up.
    assert.ok(tags.includes("upper_primary"));
  });
  it("returns empty for nonsensical grade", () => {
    const tags = buildIngestTagsFor("XYZ", "mathematics");
    assert.deepStrictEqual(tags, []);
  });
});

group("scoreChunk documentType boost", () => {
  const baseRequest = {
    gradeProfile: {band: "upper_primary", gradeNumber: 6, formNumber: null},
    subjectId: "mathematics",
    subjectProfile: {labels: ["mathematics"], syllabi: {}},
    topicText: "Fractions",
    subtopicText: "",
    topicPhrase: "fractions",
    subtopicPhrase: "",
    topicTokens: ["fractions"],
    subtopicTokens: [],
    subjectTokens: ["mathematics"],
    queryTags: ["maths_up"],
  };
  function chunkOf(documentType) {
    return {
      title: "Fractions worksheet",
      subject: "mathematics",
      topic_title: "Fractions",
      subtopic_title: "",
      text: "Identify halves and quarters using fraction strips.",
      grade: 6,
      tags: ["maths_up"],
      documentType,
    };
  }
  it("scores module higher than syllabus on otherwise-equal chunks", () => {
    const moduleScore = scoreChunk(chunkOf("module"), baseRequest);
    const syllabusScore = scoreChunk(chunkOf("syllabus"), baseRequest);
    assert.ok(moduleScore > syllabusScore,
        `expected module(${moduleScore}) > syllabus(${syllabusScore})`);
  });
  it("scores syllabus higher than a chunk with no documentType", () => {
    const syllabusScore = scoreChunk(chunkOf("syllabus"), baseRequest);
    const noneScore = scoreChunk(chunkOf(undefined), baseRequest);
    assert.ok(syllabusScore > noneScore);
  });
  it("scores teachers_guide / scheme_of_work between module and syllabus", () => {
    const moduleScore = scoreChunk(chunkOf("module"), baseRequest);
    const guideScore = scoreChunk(chunkOf("teachers_guide"), baseRequest);
    const sowScore = scoreChunk(chunkOf("scheme_of_work"), baseRequest);
    const syllabusScore = scoreChunk(chunkOf("syllabus"), baseRequest);
    assert.ok(guideScore >= syllabusScore && guideScore <= moduleScore);
    assert.ok(sowScore >= syllabusScore && sowScore <= moduleScore);
  });
});

if (process.exitCode) {
  process.stdout.write("\nFAILED\n");
  process.exit(process.exitCode);
}
process.stdout.write("\nAll pass.\n");
