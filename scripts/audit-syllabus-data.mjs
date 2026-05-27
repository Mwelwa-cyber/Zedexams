#!/usr/bin/env node
/**
 * Heuristic auditor for public/syllabi/curriculum-data.json.
 *
 * The JSON was OCR'd from CDC PDFs so it carries a long tail of typos
 * and structural quirks ("4.1. S ETS" instead of "4.1. SETS", blank
 * SPECIFIC COMPETENCES, etc.). They're not bugs in the code — the AI
 * grounds on whatever the JSON says — but they reach teachers in the
 * Syllabi Library and CBC KB editor, and they end up in `<cbc_context>`
 * blocks verbatim.
 *
 * This script doesn't fix anything. It surfaces a punch list the admin
 * can work through in the new row-level editor at /admin/cbc-kb. Exits
 * 0 always — these flags are heuristic, not failures.
 *
 * Run: npm run audit:syllabus-data
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PATH = join(ROOT, "public", "syllabi", "curriculum-data.json");

const data = JSON.parse(readFileSync(PATH, "utf8"));

const issues = []; // { kind, subject, sheet, topic, subtopic, detail, suggested? }
const counts = new Map();

function record(issue) {
  issues.push(issue);
  counts.set(issue.kind, (counts.get(issue.kind) || 0) + 1);
}

// ── Heuristics ──────────────────────────────────────────────────────────

// "S ETS" / "WO RDS" — a single uppercase letter, whitespace, two-or-more
// uppercase letters. Strong indicator of an OCR mid-word break.
const BROKEN_WORD = /\b([A-Z])\s+([A-Z]{2,})\b/g;

// Doubled spaces — usually harmless visually but lossy in the prompt.
const DOUBLE_SPACE = / {2,}/;

// Lone digit standing in for a letter (typical OCR substitution).
// We only flag this when wedged inside a word, e.g. "S0LVE" or "1NTRO".
const DIGIT_IN_WORD = /[A-Za-z]\d[A-Za-z]/;

// A bullet glyph not followed by whitespace, e.g. "•Naming things…".
const TIGHT_BULLET = /•(?!\s)/;

// Long alphabetic runs of all-caps that are also short — likely a heading
// the parser captured as a topic but shouldn't be expanded by the AI.
// (Skipped by length; just noted as a marker for the admin.)

function checkTextField(value, kind, ctx) {
  if (typeof value !== "string" || !value) return;

  // The orphan capital could belong to either neighbour ("S ETS" → SETS;
  // "CONSTRUCTIO N PROCESSES" → CONSTRUCTION PROCESSES). We can't pick
  // automatically without a wordlist, so flag the row and let the admin
  // make the call.
  BROKEN_WORD.lastIndex = 0;
  if (BROKEN_WORD.test(value)) {
    record({...ctx, kind: "broken_word", detail: value});
  }
  if (DOUBLE_SPACE.test(value)) {
    record({...ctx, kind: "double_space", detail: value});
  }
  if (DIGIT_IN_WORD.test(value)) {
    record({...ctx, kind: "digit_in_word", detail: value});
  }
  if (TIGHT_BULLET.test(value)) {
    record({...ctx, kind: "tight_bullet", detail: value});
  }
}

// ── Walk the data ───────────────────────────────────────────────────────

let totalRows = 0;
const dupKey = new Map(); // `${subj}||${sheet}||${topic.toLowerCase()}` → count

for (const [subject, sheets] of Object.entries(data || {})) {
  for (const [sheetName, sheet] of Object.entries(sheets || {})) {
    let lastTopic = "";
    let sheetHasSubtopics = false;
    for (const row of sheet?.rows || []) {
      if (row?.type !== "data") continue;
      totalRows++;
      const cells = row.cells || {};
      const topic = String(cells.TOPIC || "").trim();
      const sub = String(cells["SUB-TOPIC"] || cells.SUBTOPIC || "").trim();
      const competence = String(cells["SPECIFIC COMPETENCES"] || "").trim();
      const activities = String(cells["LEARNING ACTIVITIES"] || "").trim();
      const standard = String(cells["EXPECTED STANDARD"] || "").trim();

      if (topic) lastTopic = topic;
      if (sub) sheetHasSubtopics = true;
      const ctx = {subject, sheet: sheetName, topic: lastTopic, subtopic: sub};

      checkTextField(topic, "topic", ctx);
      checkTextField(sub, "subtopic", ctx);
      checkTextField(competence, "competence", ctx);
      checkTextField(activities, "activities", ctx);
      checkTextField(standard, "standard", ctx);

      // A row with TOPIC + no SUB-TOPIC is legitimate when it's the
      // section header that introduces a topic group. Only flag the
      // empty-content case: TOPIC set but nothing else — no sub-topic,
      // no competence, no activities. That's a genuinely useless row
      // the AI will see verbatim.
      if (topic && !sub && !competence && !activities && !standard) {
        record({...ctx, kind: "empty_row", detail: "row has TOPIC but no content cells"});
      }
      if (sub && !competence) {
        record({...ctx, kind: "empty_competence", detail: "SPECIFIC COMPETENCES is blank"});
      }
      if (sub && !activities) {
        record({...ctx, kind: "empty_activities", detail: "LEARNING ACTIVITIES is blank"});
      }

      // Duplicate-topic detection: only count the *first* row that introduces
      // each topic (i.e. has TOPIC set). Continuation rows leave TOPIC blank.
      if (topic) {
        const k = `${subject}||${sheetName}||${topic.toLowerCase()}`;
        dupKey.set(k, (dupKey.get(k) || 0) + 1);
      }
    }
  }
}

for (const [k, n] of dupKey.entries()) {
  if (n > 1) {
    const [subject, sheet, topic] = k.split("||");
    record({
      kind: "duplicate_topic",
      subject, sheet, topic, subtopic: "",
      detail: `topic appears ${n}× in this sheet`,
    });
  }
}

// ── Output ──────────────────────────────────────────────────────────────

console.log(`Syllabus data audit — ${PATH}`);
console.log("=".repeat(60));
console.log(`Total data rows scanned: ${totalRows}`);
console.log(`Issues flagged:          ${issues.length}\n`);

if (issues.length === 0) {
  console.log("No heuristic issues found.\n");
  process.exit(0);
}

// Group by kind for the punch list.
const byKind = new Map();
for (const i of issues) {
  if (!byKind.has(i.kind)) byKind.set(i.kind, []);
  byKind.get(i.kind).push(i);
}

// Show the first N of each kind so the output stays readable. The count
// in the summary at the bottom reports the true totals.
const PER_KIND_LIMIT = 8;

const KIND_LABELS = {
  broken_word: "Broken word (OCR mid-word space)",
  double_space: "Doubled whitespace",
  digit_in_word: "Digit substituted inside a word",
  tight_bullet: "Bullet glyph without trailing space",
  empty_row: "Row has TOPIC but no content",
  empty_competence: "SPECIFIC COMPETENCES is blank",
  empty_activities: "LEARNING ACTIVITIES is blank",
  duplicate_topic: "Topic appears more than once in the sheet",
};

const KIND_ORDER = [
  "broken_word",
  "digit_in_word",
  "tight_bullet",
  "double_space",
  "empty_row",
  "empty_competence",
  "empty_activities",
  "duplicate_topic",
];

for (const kind of KIND_ORDER) {
  const list = byKind.get(kind);
  if (!list || list.length === 0) continue;
  console.log(`\n[${kind}] ${KIND_LABELS[kind] || kind}  (${list.length})`);
  console.log("-".repeat(60));
  for (const i of list.slice(0, PER_KIND_LIMIT)) {
    console.log(`  ${i.subject} → ${i.sheet}`);
    if (i.topic) console.log(`    Topic:    ${i.topic}`);
    if (i.subtopic) console.log(`    Sub-topic: ${i.subtopic}`);
    if (i.detail && i.detail !== i.topic && i.detail !== i.subtopic) {
      console.log(`    ${truncate(i.detail, 140)}`);
    }
  }
  if (list.length > PER_KIND_LIMIT) {
    console.log(`  …and ${list.length - PER_KIND_LIMIT} more`);
  }
}

console.log("\n" + "=".repeat(60));
console.log("Summary:");
for (const kind of KIND_ORDER) {
  const n = counts.get(kind) || 0;
  if (n > 0) console.log(`  ${kind.padEnd(20)} ${String(n).padStart(4)}`);
}
console.log("\nFix in the CBC KB editor at /admin/cbc-kb (search by topic name).");
console.log("Edits write to syllabusOverrides — the source JSON stays canonical.\n");

function truncate(s, n) {
  if (!s) return "";
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
