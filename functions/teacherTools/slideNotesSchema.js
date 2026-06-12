/**
 * Visual Slide-Notes output validator.
 *
 * Unlike notesSchema.js (teacher delivery notes, text-only), this validates a
 * LEARNER-facing illustrated slide deck — the "Chalkie-style" visual notes.
 *
 * The critical difference from the other teacherTools validators: this one
 * PRESERVES the per-slide `imagePrompt` (a Recraft-ready description) and an
 * `imageUrl` field that starts empty. The notes/full-lesson validators have no
 * image fields and silently strip them; here the image prompt is load-bearing
 * because a second generation pass (generateSlideNotes' enrichment step) reads
 * those prompts, calls the diagram generator, and writes the resulting Storage
 * URLs back into `imageUrl`.
 *
 * Contract mirrors the sibling validators: returns `{ ok, value, errors }`.
 *
 * Slide card types (matching the learner reader in
 * src/features/notes/components/SlideNotesReader.jsx):
 *   hero       — opening slide: big title + subtitle + one illustration
 *   objectives — "what you'll learn": title + bullets + illustration
 *   concept    — one idea: title + body + optional illustration
 *   vocab      — vocabulary grid: title + up to 6 {term, definition, image} cards
 *   diagram    — labelled illustration: title + caption + image + labels
 *   process    — step-by-step flow: title + intro + up to 6 {label, text, image} steps
 */

const SCHEMA_VERSION = "1.0";

// Keep in sync with LESSON_THEMES in src/components/lessons/lessonConstants.js.
const ALLOWED_THEMES = new Set(["fresh", "bright", "sunrise", "focus"]);
const DEFAULT_THEME = "fresh";

const SLIDE_TYPES = new Set([
  "hero", "objectives", "concept", "vocab", "diagram", "process",
]);

const MIN_SLIDES = 4;
const MAX_SLIDES = 16;
const MAX_VOCAB_CARDS = 6;
const MAX_PROCESS_STEPS = 6;
const MAX_LABELS = 8;
const MAX_BULLETS = 8;

// Recraft prompts get truncated to 800 chars downstream anyway; clamp early so
// the deck doc doesn't bloat with runaway prompt strings.
const MAX_IMAGE_PROMPT = 800;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function strArray(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((x) => x.slice(0, maxLen));
}
// An image prompt is optional everywhere. When present we keep it; imageUrl
// always starts empty and is filled by the enrichment pass.
function imagePrompt(v) {
  return str(v, MAX_IMAGE_PROMPT);
}

function normaliseSlide(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = SLIDE_TYPES.has(raw.type) ? raw.type : null;
  if (!type) return null;

  const base = {type, title: str(raw.title, 160)};

  switch (type) {
    case "hero":
      return {
        ...base,
        subtitle: str(raw.subtitle, 240),
        imagePrompt: imagePrompt(raw.imagePrompt),
        imageUrl: "",
        imageAlt: str(raw.imageAlt, 160),
      };
    case "objectives":
      return {
        ...base,
        bullets: strArray(raw.bullets, MAX_BULLETS, 240),
        imagePrompt: imagePrompt(raw.imagePrompt),
        imageUrl: "",
        imageAlt: str(raw.imageAlt, 160),
      };
    case "concept":
      return {
        ...base,
        body: str(raw.body, 1200),
        imagePrompt: imagePrompt(raw.imagePrompt),
        imageUrl: "",
        imageAlt: str(raw.imageAlt, 160),
      };
    case "vocab": {
      const cards = (Array.isArray(raw.cards) ? raw.cards : [])
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
          term: str(c.term, 80),
          definition: str(c.definition, 300),
          imagePrompt: imagePrompt(c.imagePrompt),
          imageUrl: "",
        }))
        .filter((c) => c.term && c.definition)
        .slice(0, MAX_VOCAB_CARDS);
      return {...base, cards};
    }
    case "diagram":
      return {
        ...base,
        caption: str(raw.caption, 400),
        imagePrompt: imagePrompt(raw.imagePrompt),
        imageUrl: "",
        imageAlt: str(raw.imageAlt, 160),
        labels: strArray(raw.labels, MAX_LABELS, 80),
      };
    case "process": {
      const steps = (Array.isArray(raw.steps) ? raw.steps : [])
        .filter((s) => s && typeof s === "object")
        .map((s) => ({
          label: str(s.label, 80),
          text: str(s.text, 300),
          imagePrompt: imagePrompt(s.imagePrompt),
          imageUrl: "",
        }))
        .filter((s) => s.label || s.text)
        .slice(0, MAX_PROCESS_STEPS);
      return {
        ...base,
        intro: str(raw.intro, 400),
        steps,
      };
    }
    default:
      return null;
  }
}

// A slide is "usable" if it carries enough content to render. Empty shells
// (e.g. a vocab slide with no cards) are dropped so the deck never renders a
// blank card.
function slideHasContent(slide) {
  switch (slide.type) {
    case "hero":
      return Boolean(slide.title);
    case "objectives":
      return Boolean(slide.title) && slide.bullets.length > 0;
    case "concept":
      return Boolean(slide.title) && Boolean(slide.body);
    case "vocab":
      return Boolean(slide.title) && slide.cards.length > 0;
    case "diagram":
      return Boolean(slide.title) && Boolean(slide.imagePrompt);
    case "process":
      return Boolean(slide.title) && slide.steps.length > 0;
    default:
      return false;
  }
}

function validateSlideNotes(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  // ── header ─────────────────────────────────────────────────
  const h = input.header || {};
  const header = {
    title: str(h.title, 160),
    grade: str(h.grade, 10),
    subject: str(h.subject, 40),
    topic: str(h.topic, 160),
    subtopic: str(h.subtopic, 200),
    language: isNonEmptyString(h.language) ? str(h.language, 20) : "english",
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.topic) errors.push("header.topic is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");

  // ── theme ──────────────────────────────────────────────────
  const theme = ALLOWED_THEMES.has(input.theme) ? input.theme : DEFAULT_THEME;

  // ── slides ─────────────────────────────────────────────────
  const slides = (Array.isArray(input.slides) ? input.slides : [])
    .map(normaliseSlide)
    .filter((s) => s && slideHasContent(s))
    .slice(0, MAX_SLIDES);

  if (slides.length < MIN_SLIDES) {
    errors.push(
      `A visual deck needs at least ${MIN_SLIDES} usable slides (got ${slides.length}).`,
    );
  }
  // Chalkie-style decks open on a hero. If the model didn't emit one we don't
  // fail — but we flag it so review notices.
  if (slides.length && slides[0].type !== "hero") {
    errors.push("The first slide should be a hero slide.");
  }

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    theme,
    slides,
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

/**
 * Walk every object in the deck that carries an `imagePrompt`, in render
 * order, invoking `fn(target)` on each. The target object is mutated in place
 * by the caller (it sets `target.imageUrl`). Used by the enrichment pass to
 * generate one illustration per prompt without having to know the slide shapes.
 *
 * Returns the count of targets visited (i.e. images that would be generated).
 */
function forEachImageTarget(deck, fn) {
  let count = 0;
  const visit = (target) => {
    if (target && isNonEmptyString(target.imagePrompt)) {
      fn(target);
      count += 1;
    }
  };
  for (const slide of (deck && Array.isArray(deck.slides) ? deck.slides : [])) {
    visit(slide);
    if (Array.isArray(slide.cards)) slide.cards.forEach(visit);
    if (Array.isArray(slide.steps)) slide.steps.forEach(visit);
  }
  return count;
}

module.exports = {
  SCHEMA_VERSION,
  ALLOWED_THEMES,
  DEFAULT_THEME,
  SLIDE_TYPES,
  MIN_SLIDES,
  MAX_SLIDES,
  validateSlideNotes,
  forEachImageTarget,
};
