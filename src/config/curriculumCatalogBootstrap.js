/**
 * Wires the canonical curriculum catalogue's runtime dependencies at app
 * startup: the syllabi-backed topic provider and the diagnostics sink.
 *
 * Kept out of curriculumCatalog.js so that module stays pure + node-testable
 * (no fetch, no analytics). Call bootstrapCurriculumCatalogue() once from
 * main.jsx. Safe to call in any environment — the syllabi resolvers fail closed
 * to [] off the network and diagnostics init is best-effort.
 */

import { registerTopicProvider } from './curriculumCatalog.js'
import {
  resolveSyllabusTopics,
  resolveSyllabusSubtopics,
} from '../shared/utils/syllabusTopicOptions.js'
import { initCurriculumDiagnostics } from '../utils/curriculumDiagnostics.js'

// Canonical curriculum id → the syllabi framework token.
function frameworkFor(curriculumId) {
  return String(curriculumId) === 'obc' ? '2013' : '2023'
}

let _done = false

export function bootstrapCurriculumCatalogue({ capture, reportError } = {}) {
  if (_done) return
  _done = true
  // The catalogue speaks canonical ids: gradeId is already a KB grade code
  // (ECE_N / G4), subjectId a canonical slug (english / numeracy) — so the
  // adapter only has to translate the curriculum id to the syllabi framework.
  registerTopicProvider({
    source: 'syllabi-merged',
    getTopics: (curriculumId, gradeId, subjectId) =>
      resolveSyllabusTopics(gradeId, subjectId, frameworkFor(curriculumId)),
    getSubtopics: (curriculumId, gradeId, subjectId, topicId) =>
      resolveSyllabusSubtopics(gradeId, subjectId, topicId, frameworkFor(curriculumId)),
  })
  try {
    initCurriculumDiagnostics({ capture, reportError })
  } catch {
    // best-effort
  }
}
