/**
 * Studio registry — the ONE declaration the library home grid, the Create menu
 * and (from step 4) the folder drill-down all render from.
 *
 * Three decisions in here are worth reading before adding an entry:
 *
 * 1. **A StudioId is an existing `LIBRARY_TYPES` id** ('lesson_plans'), not a
 *    new singular spelling. Every saved document, every persisted `library.path`
 *    and `TOOL_TO_LIBRARY_TYPE` already speak that vocabulary; a second id space
 *    is the same drift virtual folders exist to end.
 *
 * 2. **`icon` and `tint` are name tokens, not imported components or hex.** This
 *    file is imported by the plain-node suite, which cannot load React icon
 *    components, and the folder pastels are deliberately theme-independent (see
 *    the palette comment in TeacherLibrary.jsx). The page resolves both tokens;
 *    `studios.spec.jsx` fails if one does not resolve, so a typo is a red build
 *    rather than a blank card.
 *
 * 3. **`hierarchy` is what the library ACTUALLY drills through today**
 *    (curriculum → grade → term → subject), read off `LIBRARY_SECTIONS`'
 *    `hasTerm`. `requiredDimensions` is narrower: it is what THIS studio can
 *    actually capture, so "sorted" means something different per studio. A class
 *    timetable has no subject and often no term, and demanding them would park
 *    every timetable in Needs-sorting forever — a queue of documents nobody can
 *    ever clear teaches teachers to ignore the badge.
 *
 * Scope of the registry guarantee, stated precisely: once a studio saves through
 * `saveLibraryDocument` and has its rules and indexes, adding its entry here
 * surfaces its library folder, count, hierarchy and create action with no
 * further library UI changes. A brand-new studio still needs its own route,
 * collection, rules and indexes — this removes the library plumbing, not the
 * studio.
 *
 * Pure — no React, no Firebase.
 */

import { LIBRARY_SECTIONS, LIBRARY_TYPES } from '../../config/library.js'

/** @typedef {'curriculum'|'grade'|'term'|'subject'} LibraryDimension */
export const LIBRARY_DIMENSIONS = Object.freeze(['curriculum', 'grade', 'term', 'subject'])

/** @typedef {string} StudioId */

/**
 * @typedef {object} StudioDef
 * @property {StudioId} id                     matches a LIBRARY_TYPES value
 * @property {string} label                    'Lesson Plans'
 * @property {string} icon                     export name in src/components/ui/icons
 * @property {string} tint                     palette token (see FOLDER_TINTS)
 * @property {string} collection               the Firestore collection this studio WRITES to
 * @property {string} ownerField                that collection's OWN owner field
 * @property {string|null} createRoute         null when nothing can be created
 * @property {boolean} readOnly                true when the platform, not the teacher, owns the documents
 * @property {LibraryDimension[]} hierarchy    drill-down levels, outermost first
 * @property {LibraryDimension[]} requiredDimensions  ⊆ hierarchy; what "sorted" means here
 */

// Where each studio's documents actually live (Phase 0). Eleven of the twelve
// sections share `aiGenerations`, which is why every library query carries a
// `studio` filter and every composite index includes it — the collection alone
// does not identify the studio here.
const GENERATIONS = 'aiGenerations'
const ASSESSMENTS = 'assessments'
const APPROVED_SYLLABI = 'approvedSyllabi'

/**
 * The field each collection ALREADY uses to name its owner — and the field a
 * library query must therefore filter on.
 *
 * This is not a duplicate of `libraryMeta.createdBy`, and the difference is not
 * cosmetic. Firestore evaluates a list/count query's rule against the QUERY, not
 * the results: `aiGenerations` allows a read when `resource.data.ownerUid ==
 * request.auth.uid`, so a query that scopes itself by `libraryMeta.createdBy`
 * instead is denied outright — the rule cannot prove the query is safe. (The
 * emulator run that found this returned PERMISSION_DENIED on every folder count.)
 * The metadata block still carries `createdBy`, because that is the name the
 * future school model extends; the query filters on what the rules gate on.
 */
const OWNER_FIELD = {
  [GENERATIONS]: 'ownerUid',
  [ASSESSMENTS]: 'createdBy',
  [APPROVED_SYLLABI]: 'createdBy',
}

const C = 'curriculum'
const G = 'grade'
const T = 'term'
const S = 'subject'

/**
 * Per-studio overrides. Everything not named here comes from LIBRARY_SECTIONS,
 * so a label or create route is edited in one place and both surfaces follow.
 */
const STUDIO_CONFIG = {
  [LIBRARY_TYPES.SCHEMES_OF_WORK]: {
    icon: 'BookOpen', tint: 'warm-cream', collection: GENERATIONS,
    hierarchy: [C, G, T, S], requiredDimensions: [C, G, T, S],
  },
  [LIBRARY_TYPES.WEEKLY_FORECASTS]: {
    icon: 'CalendarDays', tint: 'soft-mint', collection: GENERATIONS,
    hierarchy: [C, G, T, S], requiredDimensions: [C, G, T, S],
  },
  [LIBRARY_TYPES.RECORDS_OF_WORK]: {
    icon: 'ClipboardList', tint: 'soft-peach', collection: GENERATIONS,
    hierarchy: [C, G, T, S], requiredDimensions: [C, G, T, S],
  },
  // Platform-owned and view-only: the teacher creates nothing here, so it can
  // never produce a needs-sorting document. Kept in the registry because the
  // home grid still shows the folder.
  [LIBRARY_TYPES.SYLLABI]: {
    icon: 'Files', tint: 'soft-blue', collection: APPROVED_SYLLABI, readOnly: true,
    hierarchy: [C, G, S], requiredDimensions: [C, G],
  },
  [LIBRARY_TYPES.LESSON_PLANS]: {
    icon: 'PencilLine', tint: 'lavender', collection: GENERATIONS,
    hierarchy: [C, G, T, S], requiredDimensions: [C, G, T, S],
  },
  [LIBRARY_TYPES.NOTES]: {
    icon: 'DocumentTextIcon', tint: 'soft-teal', collection: GENERATIONS,
    hierarchy: [C, G, T, S], requiredDimensions: [C, G, T, S],
  },
  // NOTE: assessments drill one level deeper than any LibraryDimension —
  // Topic / Monthly / Mid / End of Term sits under subject. That leaf is not a
  // classification dimension (it never decides whether a paper is sorted), so
  // it stays out of `hierarchy` and is re-attached by the drill-down in step 4.
  [LIBRARY_TYPES.ASSESSMENTS]: {
    icon: 'BarChart3', tint: 'soft-coral', collection: ASSESSMENTS,
    hierarchy: [C, G, T, S], requiredDimensions: [C, G, T, S],
  },
  // The SBA studios save grade + subject; an SBA task is scheduled within a
  // term but the studio does not ask for one, so term is browsable, not required.
  [LIBRARY_TYPES.SBA_TASKS]: {
    icon: 'ClipboardCheckList', tint: 'soft-sky', collection: GENERATIONS,
    hierarchy: [C, G, T, S], requiredDimensions: [C, G, S],
  },
  // An SBA grade spans the whole year — no term level at all.
  [LIBRARY_TYPES.SBA_MARK_SHEETS]: {
    icon: 'Calculator', tint: 'soft-sage', collection: GENERATIONS,
    hierarchy: [C, G, S], requiredDimensions: [C, G, S],
  },
  [LIBRARY_TYPES.SBA_PLANS]: {
    icon: 'Layers', tint: 'soft-periwinkle', collection: GENERATIONS,
    hierarchy: [C, G, S], requiredDimensions: [C, G, S],
  },
  // A mark schedule covers a class for a term across every subject: the studio
  // stores grade + term and no subject, so subject is not a level here.
  [LIBRARY_TYPES.MARK_SCHEDULES]: {
    icon: 'ListChecks', tint: 'soft-rose', collection: GENERATIONS,
    hierarchy: [C, G, T], requiredDimensions: [G, T],
  },
  // A timetable is one class's week. Grade is the only thing it always knows —
  // the spec's own example of a document that is correctly filed with a null
  // term and a null curriculum.
  [LIBRARY_TYPES.CLASS_TIMETABLES]: {
    icon: 'CalendarDays', tint: 'soft-butter', collection: GENERATIONS,
    hierarchy: [C, G, T], requiredDimensions: [G],
  },
}

/** @type {StudioDef[]} */
export const STUDIOS = Object.freeze(LIBRARY_SECTIONS.map((section) => {
  const config = STUDIO_CONFIG[section.id]
  if (!config) {
    // A section with no registry config would render a card that navigates into
    // a hierarchy nobody declared. Fail at import, not at click.
    throw new Error(`[library/studios] no studio config for section "${section.id}"`)
  }
  if (!OWNER_FIELD[config.collection]) {
    // Without this, every query on the collection would be denied at read time.
    throw new Error(`[library/studios] no owner field declared for "${config.collection}"`)
  }
  return Object.freeze({
    id: section.id,
    label: section.label,
    icon: config.icon,
    tint: config.tint,
    collection: config.collection,
    ownerField: OWNER_FIELD[config.collection],
    createRoute: section.createTo || null,
    readOnly: Boolean(config.readOnly),
    emptyHint: section.emptyHint,
    hierarchy: Object.freeze([...config.hierarchy]),
    requiredDimensions: Object.freeze([...config.requiredDimensions]),
  })
}))

export const STUDIO_BY_ID = Object.freeze(
  Object.fromEntries(STUDIOS.map((studio) => [studio.id, studio])),
)

/** The registry entry for a studio id, or null. */
export function getStudio(studioId) {
  return STUDIO_BY_ID[studioId] || null
}

/**
 * The registry entry for a studio id, or a thrown error naming it. Used on the
 * write path, where filing a document under a studio nobody declared would
 * produce a document no folder query can ever find.
 */
export function requireStudio(studioId) {
  const studio = getStudio(studioId)
  if (!studio) throw new Error(`Unknown library studio: ${String(studioId)}`)
  return studio
}

/** The studios a teacher can create into, in registry order. */
export function creatableStudios() {
  return STUDIOS.filter((studio) => studio.createRoute && !studio.readOnly)
}

/**
 * Is this document fully classified for its studio?
 *
 * The predicate every surface shares — the save utility, the Unsorted count, the
 * migration backfill. Absent and explicitly null are the same thing here (`==`
 * is deliberate), because a legacy document that never had a grade field and a
 * new one saved with `grade: null` are equally unsorted.
 *
 * @param {Record<string, unknown>} meta
 * @param {StudioDef} studioDef
 * @returns {'complete'|'needs_sorting'}
 */
export function computeClassificationState(meta, studioDef) {
  const source = meta || {}
  return studioDef.requiredDimensions.some((dim) => source[dim] == null)
    ? 'needs_sorting'
    : 'complete'
}

/**
 * Which required dimensions are missing, in hierarchy order. Feeds the typed
 * save error and (in step 5) the triage screen's dropdowns.
 *
 * @returns {LibraryDimension[]}
 */
export function missingRequiredDimensions(meta, studioDef) {
  const source = meta || {}
  return studioDef.hierarchy.filter(
    (dim) => studioDef.requiredDimensions.includes(dim) && source[dim] == null,
  )
}
