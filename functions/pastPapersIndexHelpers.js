/**
 * Pure helpers for the past-papers index (no firebase-functions / admin
 * imports, so they're unit-testable with plain `node`). The trigger +
 * cron wiring that consumes these lives in pastPapersIndex.js.
 */

// The lightweight fields that determine the published list. A write that
// leaves all of these unchanged (e.g. a views/downloads bump or an
// assets[] edit) can't affect the index, so the trigger skips its
// rebuild.
const LIGHT_FIELDS = [
  "status",
  "title",
  "grade",
  "subject",
  "year",
  "quizId",
  "specimen",
  "examBoard",
  "paperNumber",
];

/** Project a pastPapers doc down to the lightweight shape the hub renders. */
function lightEntry(id, data) {
  const entry = {
    id,
    title: data.title || "",
    grade: data.grade != null ? String(data.grade) : null,
    subject: data.subject || null,
    year: typeof data.year === "number" ? data.year : null,
    quizId: data.quizId || null,
    specimen: Boolean(data.specimen),
    examBoard: data.examBoard || "ECZ",
  };
  // paperNumber is optional — omit when absent rather than writing null
  // noise (the hub treats missing the same as null).
  if (data.paperNumber != null) entry.paperNumber = data.paperNumber;
  return entry;
}

/**
 * A stable signature of just the index-relevant fields. Two docs with
 * the same signature produce the same index entry, so the trigger can
 * skip a rebuild when before/after signatures match.
 */
function lightSignature(data) {
  if (!data) return "∅";
  return LIGHT_FIELDS.map((k) => JSON.stringify(data[k] ?? null)).join("|");
}

module.exports = {LIGHT_FIELDS, lightEntry, lightSignature};
