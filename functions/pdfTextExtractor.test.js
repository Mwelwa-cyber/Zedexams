// Real-PDF regression tests for the pdf-parse v2 migration (issue #1884).
//
// Style mirrors functions/aiPromptPolicy.test.js — plain `node` assertions,
// no test runner. Registered as `test:pdf-extractor`; run-all-tests.mjs picks
// it up automatically.
//
// Fixtures are COMMITTED PDFs under functions/testFixtures/ — the test never
// downloads a PDF from the network (a hard requirement of the migration).
//
// pdf-parse lives only in functions/package.json, so at the repo root (where
// CI's `test:all` runs `npm ci` WITHOUT installing functions/ deps) it isn't
// resolvable. Following the same graceful-skip precedent as the exceljs cases
// in uploadCurriculumModule.test.js, the real assertions are skipped with a
// loud notice when pdf-parse can't be loaded — and run in full anywhere it is
// installed (local dev, `cd functions && npm install`, the deploy env).

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {extractPdfText} = require("./pdfTextExtractor");

const FIXTURES = path.join(__dirname, "testFixtures");
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

let failures = 0;
async function it(desc, fn) {
  try {
    await fn();
    process.stdout.write(`    ok  ${desc}\n`);
  } catch (err) {
    failures += 1;
    process.exitCode = 1;
    process.stdout.write(`    FAIL ${desc}\n    ${err.stack || err}\n`);
  }
}

async function run() {
  process.stdout.write("pdfTextExtractor (pdf-parse v2 migration)\n");

  // Track unhandled rejections across the whole run — the migration must not
  // leak a rejected promise from any failure path.
  let sawUnhandled = false;
  process.on("unhandledRejection", (reason) => {
    sawUnhandled = true;
    process.stdout.write(`    !!! unhandledRejection: ${String(reason)}\n`);
  });

  // ── Probe: is pdf-parse installed here? ──────────────────────────────
  const probe = await extractPdfText(readFixture("sample-multipage.pdf"));
  if (probe.unsupported) {
    process.stdout.write(
        "\n  SKIP — pdf-parse is not installed in this environment " +
        `(${probe.reason}).\n` +
        "  This is expected at the repo root (functions/ deps not " +
        "installed).\n" +
        "  Run from an env with functions deps to exercise the real " +
        "assertions:\n" +
        "    cd functions && npm install && npm run test:pdf-extractor\n\n");
    return;
  }

  // ── 1. Normal multi-page text extraction ─────────────────────────────
  await it("extracts text from every page of a normal multi-page PDF",
      async () => {
        const r = await extractPdfText(readFixture("sample-multipage.pdf"));
        assert.ok(!r.error, `unexpected error: ${r.error}`);
        assert.ok(!r.unsupported, "should not be unsupported");
        assert.strictEqual(r.totalPages, 3, "reports 3 total pages");
        assert.strictEqual(r.parsedPages, 3, "parses all 3 pages");
        assert.ok(r.text.includes("SAMPLEPAGE1MARK"), "has page 1 content");
        assert.ok(r.text.includes("SAMPLEPAGE3MARK"), "has page 3 content");
      });

  // ── 2. The 200-page cap is preserved (the core migration risk) ───────
  await it("caps extraction at maxPages=200 on a >200-page PDF", async () => {
    const r = await extractPdfText(
        readFixture("oversized-210-pages.pdf"), {maxPages: 200});
    assert.ok(!r.error, `unexpected error: ${r.error}`);
    assert.strictEqual(r.totalPages, 210, "still reports 210 total pages");
    assert.strictEqual(r.parsedPages, 200, "only 200 pages parsed");
    assert.ok(r.text.includes("PG200END"), "page 200 IS included");
    assert.ok(!r.text.includes("PG201END"),
        "page 201 is truncated (past the cap)");
    assert.ok(!r.text.includes("PG210END"),
        "page 210 is truncated (past the cap)");
  });

  // ── 3. Cap is opt-in: no maxPages ⇒ every page is parsed ─────────────
  await it("parses all pages when no page cap is given", async () => {
    const r = await extractPdfText(readFixture("oversized-210-pages.pdf"));
    assert.strictEqual(r.parsedPages, 210, "all 210 pages parsed");
    assert.ok(r.text.includes("PG210END"), "last page IS included");
  });

  // ── 4. No page-boundary noise leaks into the text ────────────────────
  await it("suppresses v2's default '-- n of m --' page markers", async () => {
    const r = await extractPdfText(readFixture("sample-multipage.pdf"));
    assert.ok(!/--\s*\d+\s+of\s+\d+\s*--/.test(r.text),
        "extracted text must not contain page-joiner markers");
  });

  // ── 5. Malformed PDF fails gracefully (never throws) ─────────────────
  await it("returns an error (does not throw) for a malformed PDF",
      async () => {
        const r = await extractPdfText(readFixture("malformed.pdf"));
        assert.strictEqual(r.text, "", "no text from a malformed PDF");
        assert.ok(r.error, "error field is set");
        assert.match(r.error, /pdf_parse_failed/, "error is tagged");
      });

  // ── 6. Empty + non-buffer inputs degrade gracefully ──────────────────
  await it("handles a zero-byte buffer without throwing", async () => {
    const r = await extractPdfText(Buffer.alloc(0));
    assert.strictEqual(r.text, "");
    assert.ok(r.error, "empty buffer yields a graceful error");
  });
  await it("returns empty for null / non-buffer input", async () => {
    const a = await extractPdfText(null);
    const b = await extractPdfText("not a buffer");
    assert.deepStrictEqual(
        {text: a.text, totalPages: a.totalPages}, {text: "", totalPages: 0});
    assert.strictEqual(b.text, "");
  });

  // ── 7. Repeated failures: no leak, no unhandled rejection ────────────
  await it("survives a burst of failed extractions without leaking handles",
      async () => {
        const bad = readFixture("malformed.pdf");
        if (global.gc) global.gc();
        const before = process.memoryUsage().heapUsed;
        for (let i = 0; i < 40; i += 1) {
          const r = await extractPdfText(bad);
          assert.ok(r.error, `iteration ${i} should error gracefully`);
        }
        if (global.gc) global.gc();
        const after = process.memoryUsage().heapUsed;
        const growthMb = (after - before) / (1024 * 1024);
        // A leaked parser/document handle per iteration would blow well past
        // this. Without --expose-gc the heap number is noisier, so treat this
        // as a smoke ceiling, not a tight assertion.
        assert.ok(growthMb < 50,
            `heap grew ${growthMb.toFixed(1)}MB across 40 failed parses`);
      });

  // Let any late microtasks settle, then check the unhandled-rejection flag.
  await new Promise((r) => setTimeout(r, 150));
  await it("recorded no unhandled promise rejections", () => {
    assert.strictEqual(sawUnhandled, false,
        "a failure path leaked an unhandled rejection");
  });
}

run()
    .then(() => {
      if (failures || process.exitCode) {
        process.stdout.write(`\nFAILED (${failures} assertion group(s)).\n`);
        process.exit(1);
      }
      process.stdout.write("\nAll pass.\n");
    })
    .catch((err) => {
      process.stdout.write(`\nCRASH ${err.stack || err}\n`);
      process.exit(1);
    });
