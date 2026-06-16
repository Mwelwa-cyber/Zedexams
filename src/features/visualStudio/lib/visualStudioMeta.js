/**
 * Visual Studio — static option metadata + mappings onto the existing
 * `generateDiagram` Cloud Function.
 *
 * This module is intentionally dependency-free (pure constants + tiny pure
 * helpers) so it can be unit-tested with plain `node` and so the whole
 * Visual Studio feature folder stays portable — the long-term goal is for
 * `src/features/visualStudio/` to be liftable into a standalone web/desktop
 * app with only the Firebase glue swapped out.
 *
 * The image generator (`generateDiagram`) already speaks a fixed vocabulary
 * of providers / styles / pixel sizes (see functions/teacherTools/generateDiagram.js).
 * Visual Studio exposes a friendlier, teacher-facing set of choices and maps
 * them down here — so the UI never has to know Recraft style slugs.
 */

// Teacher-facing visual styles. `id` is stored on the asset; `provider` +
// `genStyle` are what we hand to generateDiagram. Black-and-white printable
// styles come first because that is the primary Zambian test/worksheet need.
export const VISUAL_STYLES = [
  {
    id: 'bw_test_diagram',
    label: 'Black-and-white test diagram',
    hint: 'Clean line art that photocopies sharply onto a printed test.',
    provider: 'recraft',
    genStyle: 'line_art',
    blackAndWhite: true,
  },
  {
    id: 'labelled_diagram',
    label: 'Labelled diagram',
    hint: 'Line diagram you then label with P, Q, R or full words.',
    provider: 'recraft',
    genStyle: 'line_art',
    blackAndWhite: true,
  },
  {
    id: 'unlabelled_diagram',
    label: 'Unlabelled diagram',
    hint: 'Plain diagram with no labels — add blanks for learners.',
    provider: 'recraft',
    genStyle: 'line_art',
    blackAndWhite: true,
  },
  {
    id: 'line_drawing',
    label: 'Simple line drawing',
    hint: 'Hand-drawn outline feel, light on detail.',
    provider: 'recraft',
    genStyle: 'hand_drawn_outline',
    blackAndWhite: true,
  },
  {
    id: 'photocopy_friendly',
    label: 'Photocopy-friendly picture',
    hint: 'Bolder engraved line work that survives a faint photocopier.',
    provider: 'recraft',
    genStyle: 'engraving',
    blackAndWhite: true,
  },
  {
    id: 'colouring_page',
    label: 'Colouring-page style',
    hint: 'Big bold outlines learners can colour in.',
    provider: 'recraft',
    genStyle: 'line_art',
    blackAndWhite: true,
  },
  {
    id: 'colour_illustration',
    label: 'Colour classroom illustration',
    hint: 'Bright flat colour illustration (uses more of your monthly quota).',
    provider: 'kie',
    genStyle: null,
    blackAndWhite: false,
  },
  {
    id: 'realistic_science',
    label: 'Realistic science diagram',
    hint: 'Photo-realistic reference image (uses more of your monthly quota).',
    provider: 'openai',
    genStyle: null,
    blackAndWhite: false,
  },
]

export const VISUAL_STYLE_MAP = Object.fromEntries(
  VISUAL_STYLES.map((s) => [s.id, s]),
)

// What the picture will be used for. Drives a hint in the prompt and the
// `useCase` metadata stored on the asset (used by the "used in" filters).
export const USE_CASES = [
  { id: 'assessment', label: 'Assessment', promptHint: 'a printed test or exam paper' },
  { id: 'worksheet', label: 'Worksheet', promptHint: 'a class worksheet' },
  { id: 'lessonPlan', label: 'Lesson plan', promptHint: 'a lesson-plan illustration' },
  { id: 'notes', label: 'Notes', promptHint: 'study notes' },
  { id: 'poster', label: 'Poster', promptHint: 'a classroom wall poster' },
  { id: 'flashcard', label: 'Flashcard', promptHint: 'a flashcard' },
]

export const USE_CASE_MAP = Object.fromEntries(USE_CASES.map((u) => [u.id, u]))

// Which labelled/answer variants the teacher wants out of the editor.
export const OUTPUT_TYPES = [
  { id: 'teacher_labelled', label: 'Teacher version (with labels)' },
  { id: 'learner_blank', label: 'Learner version (blank labels)' },
  { id: 'answer_key', label: 'Answer key version' },
  { id: 'picture_only', label: 'Picture only' },
]

export const OUTPUT_TYPE_MAP = Object.fromEntries(
  OUTPUT_TYPES.map((o) => [o.id, o]),
)

// Map a generator output-type onto the editor's version toggle, so a teacher
// who picks "Learner version" lands in the editor already showing P/Q/R.
const OUTPUT_TYPE_TO_VERSION = {
  teacher_labelled: 'teacher',
  learner_blank: 'learner',
  answer_key: 'answerKey',
  picture_only: 'picture',
}

/** @returns {('teacher'|'learner'|'answerKey'|'picture')} */
export function outputTypeToVersion(outputType) {
  return OUTPUT_TYPE_TO_VERSION[outputType] || 'teacher'
}

// Display-size preset stored on the asset / question (matches the studio's
// imageWidth presets so a Visual Studio image sizes the same in a paper).
export const IMAGE_SIZES = [
  { id: 'small', label: 'Small', imageWidth: 'small' },
  { id: 'medium', label: 'Medium', imageWidth: 'medium' },
  { id: 'large', label: 'Large', imageWidth: 'full' },
]

export const ORIENTATIONS = [
  { id: 'square', label: 'Square' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' },
]

// generateDiagram pixel-size whitelist, chosen by orientation + size. Larger
// sizes ask the model for more detail; the on-page display width is a
// separate preset (IMAGE_SIZES.imageWidth).
const GEN_SIZE_BY_ORIENTATION = {
  square: { small: '1024x1024', medium: '1024x1024', large: '1024x1024' },
  portrait: { small: '1024x1365', medium: '1024x1365', large: '1024x1707' },
  landscape: { small: '1365x1024', medium: '1365x1024', large: '1707x1024' },
}

export const MAX_IMAGES_PER_BATCH = 4
export const MIN_IMAGES_PER_BATCH = 1

/**
 * Resolve the concrete generateDiagram parameters for a Visual Studio choice.
 * @param {{ styleId?: string, orientation?: string, sizeId?: string }} choice
 * @returns {{ provider: string, style: (string|undefined), size: string, blackAndWhite: boolean }}
 */
export function resolveGenerationParams({ styleId, orientation, sizeId } = {}) {
  const style = VISUAL_STYLE_MAP[styleId] || VISUAL_STYLE_MAP.bw_test_diagram
  const orient = GEN_SIZE_BY_ORIENTATION[orientation] ? orientation : 'landscape'
  const sizeKey = (sizeId === 'small' || sizeId === 'medium' || sizeId === 'large')
    ? sizeId
    : 'medium'
  return {
    provider: style.provider,
    style: style.genStyle || undefined,
    size: GEN_SIZE_BY_ORIENTATION[orient][sizeKey],
    blackAndWhite: style.blackAndWhite,
  }
}

/** Clamp a requested image count into the allowed batch range. */
export function clampImageCount(n) {
  const v = Math.round(Number(n) || 0)
  if (!Number.isFinite(v)) return MIN_IMAGES_PER_BATCH
  return Math.max(MIN_IMAGES_PER_BATCH, Math.min(MAX_IMAGES_PER_BATCH, v))
}
