#!/usr/bin/env node
/**
 * parse-cdc-module — CLI wrapper around cdcModuleParser.
 *
 * Reads a Zambian CDC "Teaching Module" PDF, extracts space-corrected text,
 * parses it into curriculum-module objects, validates each against the real
 * functions/teacherTools/curriculumModuleSchema.js, and writes a JSON array
 * ready for the importCurriculumModules callable / admin Curriculum upload.
 *
 *   node scripts/curriculum/parse-cdc-module.mjs <module.pdf> \
 *        [--grade G8] [--subject civic_education] [--term 1] \
 *        [--out functions/data/modules/civic_g8_t1.json]
 *
 * grade / subject / term are auto-detected from the cover page when omitted.
 * pdf-parse is resolved from functions/node_modules (the only place it's a
 * dependency) — run `cd functions && npm install` first if it's missing.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, resolve, relative, isAbsolute } from "node:path";
import fs from "node:fs";
import { parseCdcModule } from "./cdcModuleParser.mjs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

function loadPdfParse() {
  try {
    return require(join(ROOT, "functions", "node_modules", "pdf-parse"));
  } catch {
    console.error(
      "pdf-parse not found. Run `cd functions && npm install` first " +
      "(it's a Cloud Functions dependency).");
    process.exit(2);
  }
}
const { validateCurriculumModule } =
  require(join(ROOT, "functions", "teacherTools", "curriculumModuleSchema.js"));

// Re-insert spaces/line-breaks the default extractor drops, using glyph
// positions. Without this CDC PDFs come out as "CivicEducationrefersto…".
function pageRender(pageData) {
  return pageData.getTextContent().then((tc) => {
    let last = null;
    let out = "";
    for (const it of tc.items) {
      if (last) {
        const dy = Math.abs(it.transform[5] - last.transform[5]);
        const gap = it.transform[4] - (last.transform[4] + (last.width || 0));
        if (dy > (last.height ? last.height * 0.5 : 4)) out += "\n";
        else if (gap > (last.height ? last.height * 0.18 : 1.2)) out += " ";
      }
      out += it.str;
      last = it;
    }
    return out;
  });
}

// Order matters — first match wins, so the more specific / lower-grade names
// (Literacy, Numeracy, Oral English, Literature in English) come before the
// generic English / Mathematics they contain.
const SUBJECTS = [
  [/civic\s+education/i, "civic_education"],
  [/\bcommerce\b/i, "commerce"],
  [/design\s+and\s+technology/i, "design_and_technology"],
  [/creative\s+and\s+technology\s+studies/i, "creative_and_technology_studies"],
  [/information\s+and\s+communication\s+technology|\bICT\b/i, "ict"],
  [/food\s+and\s+nutrition/i, "food_and_nutrition"],
  [/literature\s+in\s+english/i, "literature_in_english"],
  [/oral\s+english/i, "oral_english"],
  [/musical\s+arts/i, "musical_arts_education"],
  [/travel\s+and\s+tourism/i, "travel_and_tourism"],
  [/principles\s+of\s+accounts|accountancy|accounting/i, "principles_of_accounts"],
  [/\bliteracy\b/i, "literacy"],
  [/\bnumeracy\b/i, "numeracy"],
  [/\bgeography\b/i, "geography"],
  [/\bhistory\b/i, "history"],
  [/religious\s+education/i, "religious_education"],
  [/\bbiology\b/i, "biology"],
  [/\bchemistry\b/i, "chemistry"],
  [/\bphysics\b/i, "physics"],
  [/integrated\s+science/i, "integrated_science"],
  [/\bmathematics\b/i, "mathematics"],
  [/social\s+studies/i, "social_studies"],
  [/home\s+economics/i, "home_economics"],
  [/expressive\s+arts/i, "expressive_arts"],
  [/\benglish\b/i, "english"],
];

function detectMeta(coverText) {
  const cover = coverText.slice(0, 3000);
  // Pick the subject whose name appears EARLIEST in the cover — the title sits
  // at the very top, while template boilerplate (e.g. a stray "Creative and
  // Technology Studies" copyright line) can appear lower and must not win.
  let subject = "";
  let best = Infinity;
  for (const [re, slug] of SUBJECTS) {
    const m = cover.match(re);
    if (m && m.index < best) { best = m.index; subject = slug; }
  }

  let grade = "";
  const form = cover.match(/\bform\s+(\d)\b/i);
  const gr = cover.match(/\bgrade\s+(\d{1,2})\b/i);
  if (form) grade = `G${Number(form[1]) + 7}`; // Form 1 = Grade 8
  else if (gr) grade = `G${gr[1]}`;
  else if (/early\s+childhood|\bece\b|\[\s*3\s*-\s*4\s*years?\s*\]/i.test(cover)) grade = "ECE";

  // The cover often glues "GRADE 1TERM 2", so don't require a word boundary.
  const term = cover.match(/term\s*(?:([123])|one|two|three)/i);
  let termNum = 1;
  if (term) {
    if (term[1]) termNum = Number(term[1]);
    else termNum = /two/i.test(term[0]) ? 2 : /three/i.test(term[0]) ? 3 : 1;
  }
  return { grade, subject, term: termNum };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pdfPath = args._[0];
  if (!pdfPath) {
    console.error("Usage: parse-cdc-module <module.pdf> [--grade] [--subject] [--term] [--out]");
    process.exit(2);
  }
  const pdf = loadPdfParse();
  const data = await pdf(fs.readFileSync(pdfPath), { pagerender: pageRender });

  const detected = detectMeta(data.text);
  const meta = {
    grade: (args.grade || detected.grade || "").toUpperCase(),
    subject: (args.subject || detected.subject || "").toLowerCase(),
    term: Number(args.term || detected.term || 1),
  };
  if (!meta.grade || !meta.subject) {
    console.error(`Could not determine grade/subject (got ${JSON.stringify(meta)}). Pass --grade and --subject.`);
    process.exit(2);
  }

  const { modules, warnings } = parseCdcModule(data.text, meta);

  // Validate each against the authoritative schema; keep only valid rows.
  const valid = [];
  const invalid = [];
  for (const m of modules) {
    const res = validateCurriculumModule(m);
    if (res.ok) valid.push(res.value);
    else invalid.push({ subtopic: m.subtopic, errors: res.errors });
  }

  // A combined-term PDF (e.g. Term 1 & 2 in one file) yields modules across
  // several terms via in-document TERM dividers — name the file for the range.
  const terms = [...new Set(valid.map((v) => v.term))].sort();
  const termTag = terms.length <= 1 ?
    `t${terms[0] || meta.term}` : `t${terms[0]}-${terms[terms.length - 1]}`;
  // Confine the write to the repository. This is a local dev CLI, but a stray
  // or hostile --out ("--out /etc/x" or "--out ../../x") shouldn't be able to
  // write outside the project tree — cheap hardening in case it's ever wired
  // into automation.
  const outPath = resolve(args.out ||
    join(ROOT, "functions", "data", "modules",
      `${meta.subject}_${meta.grade.toLowerCase()}_${termTag}.json`));
  const rel = relative(ROOT, outPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    console.error(`Refusing to write outside the repository: ${outPath}`);
    process.exit(2);
  }
  fs.mkdirSync(dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(valid, null, 2) + "\n");

  const byTerm = terms.map((t) => `T${t}:${valid.filter((v) => v.term === t).length}`).join(" ");
  console.log(`\n${basename(pdfPath)}`);
  console.log(`  meta: grade=${meta.grade} subject=${meta.subject} term=${meta.term} (${args.grade || args.subject ? "override" : "auto"})`);
  console.log(`  sub-topics parsed: ${modules.length}  valid: ${valid.length}  invalid: ${invalid.length}  [${byTerm}]`);
  console.log(`  → ${outPath}`);
  for (const w of warnings.slice(0, 12)) console.log(`  ! ${w}`);
  for (const iv of invalid.slice(0, 12)) console.log(`  ✗ "${iv.subtopic}": ${iv.errors.join("; ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
