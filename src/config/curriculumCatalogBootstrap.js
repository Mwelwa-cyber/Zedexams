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
import { initCurriculumDiagnostics } from '../utils/curriculumDiagnostics.js'

/**
 * The syllabi resolvers are loaded on FIRST TOPIC LOOKUP, not at startup.
 *
 * This module is imported by main.jsx, so a static import here is on the eager
 * critical path of every route — the landing page, /login, /pricing, a learner
 * opening a past paper. And `syllabusTopicOptions` is the head of a long chain:
 * it reaches syllabusKbService → adminCbcKbService → quizDocumentImport →
 * quizSections, so registering the provider was pulling the admin CBC-KB
 * service and the quiz-import model into the first paint of a marketing page
 * that can never call either. Measured at 62 KiB raw / 20 KiB gzipped of eager
 * JS, none of it reachable until a teacher opens a topic picker.
 *
 * Deferring is contract-preserving rather than a behaviour change: the provider
 * contract is documented as `Promise<string[]>|string[]` and
 * getTopicsForSubject/getSubtopicsForTopic already `await` the result, so a
 * provider that resolves its own module first is indistinguishable from one
 * that was loaded up front. The resolvers are themselves already `async`.
 *
 * The module promise is cached, so the dynamic import costs one round trip on
 * the first lookup and nothing on every lookup after it.
 */
let _syllabiResolvers = null
function loadSyllabiResolvers() {
  if (!_syllabiResolvers) {
    _syllabiResolvers = import('../shared/utils/syllabusTopicOptions.js')
  }
  return _syllabiResolvers
}

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
    getTopics: async (curriculumId, gradeId, subjectId) => {
      const { resolveSyllabusTopics } = await loadSyllabiResolvers()
      return resolveSyllabusTopics(gradeId, subjectId, frameworkFor(curriculumId))
    },
    getSubtopics: async (curriculumId, gradeId, subjectId, topicId) => {
      const { resolveSyllabusSubtopics } = await loadSyllabiResolvers()
      return resolveSyllabusSubtopics(gradeId, subjectId, topicId, frameworkFor(curriculumId))
    },
  })
  try {
    initCurriculumDiagnostics({ capture, reportError })
  } catch {
    // best-effort
  }
}
