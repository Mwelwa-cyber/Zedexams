/**
 * Flashcard set schema validator.
 */

const SCHEMA_VERSION = "1.0";

const ALLOWED_CATEGORIES = new Set([
  "definition", "formula", "example", "date", "fact", "question", "concept",
]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isNonNegativeNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function validateFlashcards(input) {
  const errors = [];

  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  // ── header ─────────────────────────────────────────────────
  const h = input.header || {};
  const header = {
    title: isNonEmptyString(h.title) ? h.title : "",
    subject: isNonEmptyString(h.subject) ? h.subject : "",
    grade: isNonEmptyString(h.grade) ? h.grade : "",
    topic: isNonEmptyString(h.topic) ? h.topic : "",
    subtopic: isNonEmptyString(h.subtopic) ? h.subtopic : "",
    cardCount: isNonNegativeNumber(h.cardCount) ? Math.round(h.cardCount) : 0,
  };
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");
  if (!header.topic) errors.push("header.topic is required");

  // ── cards ──────────────────────────────────────────────────
  const cards = Array.isArray(input.cards) ?
    input.cards
      .filter((c) => c && typeof c === "object")
      .map((c) => ({
        front: isNonEmptyString(c.front) ? c.front : "(missing front)",
        back: isNonEmptyString(c.back) ? c.back : "(missing back)",
        example: isNonEmptyString(c.example) ? c.example : null,
        hint: isNonEmptyString(c.hint) ? c.hint : null,
        category: ALLOWED_CATEGORIES.has(c.category) ? c.category : "concept",
      })) :
    [];

  if (cards.length === 0) {
    errors.push("The flashcard set has no cards.");
  }

  // Reconcile cardCount with actual number of cards
  header.cardCount = cards.length;

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    cards,
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {
  SCHEMA_VERSION,
  validateFlashcards,
};
