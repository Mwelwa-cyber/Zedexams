/**
 * Re-export only. The Notes Studio's option vocabulary lives in the shared
 * notes package, which the Cloud Functions generator reads too.
 *
 * @see functions/shared/notes/notesOptionsCore.js
 *
 * DO NOT ADD A RULE HERE. A default, a label or a budget defined in this file
 * is one the generator never sees, which is how a studio ends up asking for a
 * half-page document and a server ends up writing two pages of one.
 */
export {
  AUDIENCE_LABELS,
  DEFAULT_AUDIENCE,
  DETAIL_LABELS,
  ENGLISH_LEVELS,
  ENGLISH_LEVEL_LABELS,
  FORMAT_LABELS,
  LEGACY_AUDIENCE,
  LENGTH_LABELS,
  NOTE_AUDIENCES,
  NOTE_DETAIL,
  NOTE_FORMATS,
  NOTE_LENGTHS,
  PAPER_SIZES,
  PAPER_SIZE_LABELS,
  isLearnerNotes,
  lengthBudget,
  normalizeAudience,
  normalizeDetail,
  normalizeEnglishLevel,
  normalizeFormat,
  normalizeLength,
  normalizeNotesOptions,
  normalizePaperSize,
  notesLibraryLabel,
  readAudience,
} from '../../functions/shared/notes/notesOptionsCore.js'
