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
  "quizStatus",
  "specimen",
  "examBoard",
  "paperNumber",
  "slug",
  // Source identity. These belong in the signature as well as the entry:
  // labelling a paper is exactly the kind of write that MUST rebuild the
  // index, because it is what makes the paper visible at all.
  "source",
  "isOfficial",
  "sourceConfidence",
  "session",
];

/** The confidences that make a paper publishable. Mirror of LEARNER_VISIBLE_CONFIDENCE. */
const PUBLISHABLE_CONFIDENCE = ["explicit", "inferred"];
/**
 * Mirror of PAPER_SOURCES (src/config/paperSources.js) — the id set, and the
 * subset that is official.
 *
 * Duplicated rather than imported for the same reason `deriveQuizStatus` below
 * is: that module is ESM under src/ and this one is CommonJS shipped inside
 * functions/. `pastPapersIndex.test.js` asserts both lists against the real
 * registry, so a source added there and forgotten here fails the build rather
 * than quietly dropping every paper of that source out of the public index.
 */
const KNOWN_SOURCES = ["ecz", "prisca", "school_mock", "other"];
const OFFICIAL_SOURCES = ["ecz"];

/**
 * May this paper appear in the public index?
 *
 * The index doc is world-readable in one piece, so the per-document read rule
 * cannot protect it — whatever is written here IS published. This function is
 * therefore the same gate as `_paperSourceEstablished()` in firestore.rules,
 * applied at build time: a paper whose provenance is unknown is left out
 * entirely rather than written and filtered client-side.
 */
function isPublishablePaper(data) {
  if (!data || data.status !== "published") return false;
  const source = typeof data.source === "string" ? data.source.trim().toLowerCase() : "";
  if (!KNOWN_SOURCES.includes(source)) return false;
  const confidence = typeof data.sourceConfidence === "string"
    ? data.sourceConfidence.trim().toLowerCase()
    : "unknown";
  return PUBLISHABLE_CONFIDENCE.includes(confidence);
}

/**
 * Mirror of `derivePaperQuizStatus` in src/utils/pastPaperQuizStatus.js.
 * Duplicated rather than imported because that module is ESM under src/ and
 * this one is CommonJS shipped inside functions/ — see the "one copy of the
 * rules" note in CLAUDE.md for why a synced copy would be worse than a small
 * mirror. Kept honest by pastPapersIndex.test.js, which asserts the same
 * cases the src-side test does.
 *
 * Fail-closed both ways: an unrecognised status is ignored in favour of the
 * quizId signal, and "attached" with no id reads as pending — the index feeds
 * the archive hub's "has a quiz" badge, and a badge on a paper with no quiz
 * behind it is a dead link.
 */
function deriveQuizStatus(data) {
  const quizId = typeof data.quizId === "string" && data.quizId.trim()
    ? data.quizId.trim()
    : null;
  const stated = typeof data.quizStatus === "string"
    ? data.quizStatus.trim().toLowerCase()
    : null;
  if (stated === "attached") return quizId ? "attached" : "pending";
  if (stated === "pending") return "pending";
  return quizId ? "attached" : "pending";
}

/** Project a pastPapers doc down to the lightweight shape the hub renders. */
function lightEntry(id, data) {
  const quizStatus = deriveQuizStatus(data);
  const entry = {
    id,
    title: data.title || "",
    grade: data.grade != null ? String(data.grade) : null,
    subject: data.subject || null,
    year: typeof data.year === "number" ? data.year : null,
    // A pending paper never publishes an id into the index — the hub links
    // straight off this field, so carrying the draft quiz's id here would put
    // a "Take quiz" button on a paper whose quiz has no questions yet.
    quizId: quizStatus === "attached" ? data.quizId : null,
    quizStatus,
    specimen: Boolean(data.specimen),
    examBoard: data.examBoard || "ECZ",
    // The hub badges, sorts and filters on these three, so they travel with
    // the lightweight entry. `isOfficial` is re-derived from the source rather
    // than copied: a document whose stored boolean disagrees with its own
    // source must not be able to publish a mock as an official exam.
    source: data.source || null,
    isOfficial: OFFICIAL_SOURCES.includes(data.source),
    sourceConfidence: data.sourceConfidence || null,
    session: data.session || null,
  };
  // paperNumber is optional — omit when absent rather than writing null
  // noise (the hub treats missing the same as null).
  if (data.paperNumber != null) entry.paperNumber = data.paperNumber;
  // slug (SEO/shareable identity, derived on write by the normalizer) — carry
  // it to the archive when present; older docs without one simply omit it.
  if (data.slug) entry.slug = data.slug;
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

module.exports = {
  LIGHT_FIELDS,
  KNOWN_SOURCES,
  OFFICIAL_SOURCES,
  PUBLISHABLE_CONFIDENCE,
  deriveQuizStatus,
  isPublishablePaper,
  lightEntry,
  lightSignature,
};
