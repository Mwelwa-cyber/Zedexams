/**
 * templatePlanPreview — the rendering options a Template Bank template is drawn
 * with, in ONE place.
 *
 * A template is a lesson plan with its identity removed (see
 * `functions/teacherTools/lessonPlanTemplateBank.js` — `anonymizeLessonPlan`
 * whitelists the curriculum header keys and drops school / teacher / date /
 * time / class / pupil counts). The content is the same structured plan object
 * the studio renders; what a template lacks is the teacher's own choices, and
 * those have to be *stated* rather than defaulted quietly, because they decide
 * what the document looks like:
 *
 *   - **format `classic`.** A template shows the single bordered progression
 *     table — STAGES | TEACHER'S ACTIVITIES | LEARNERS' ACTIVITIES | ASSESSMENT
 *     — which is the layout a Zambian head teacher expects and the cheapest in
 *     paper. The preview used to pass `modern`, whose per-stage mini-tables have
 *     no STAGES column at all and carry no inline borders.
 *   - **`headerStyle: 'ministry'`.** The masthead reads MINISTRY OF EDUCATION /
 *     school / LESSON PLAN. `resolveLessonFormat` otherwise defaults to
 *     `'school'`, which drops the Ministry line.
 *   - **The teacher fields are blanks, not empty.** A template deliberately
 *     leaves Name of Teacher / Date / Time for whoever uses it, and a printed
 *     rule is what says so. This is a value passed to the renderer, never a
 *     branch inside it — the renderer must not learn what a template is.
 *
 * Pure: no React, no DOM, no Firebase. Both the preview and
 * `createLessonPlanFromTemplate` read it, so the document a teacher previews is
 * the document they get.
 */

import { normalizeCurriculum } from '../../../utils/schemeFormat.js'

/** The printed rule a template leaves for the teacher to complete. */
export const TEMPLATE_BLANK = '______'

/**
 * The curriculum a template's plan is written against, in the vocabulary
 * `renderPlanHtml` takes ('cbc' | 'previous').
 *
 * `normalizeCurriculum` already accepts every spelling in the repo
 * (cbc/obc/previous/2023/2013), so no caller needs to know which one its
 * neighbour stored. A template with no curriculum recorded reads as CBC, which
 * is what the bank has always assumed — but an OBC template now renders with
 * OBC's own vocabulary instead of being relabelled into CBC's.
 *
 * @param {object} template
 * @returns {'cbc' | 'previous'}
 */
export function templateCurriculumMode(template) {
  const header = template?.content?.header
  const raw = template?.curriculum || (header && header.curriculum) || ''
  return normalizeCurriculum(raw) === 'obc' ? 'previous' : 'cbc'
}

/** The syllabus tag the library classification takes ('CBC' | 'OBC'). */
export function templateSyllabusHint(template) {
  return templateCurriculumMode(template) === 'previous' ? 'OBC' : 'CBC'
}

function firstText(...vals) {
  for (const v of vals) {
    // `durationMinutes` is stored as a number on some plans and a string on
    // others — both are a duration, and neither should fall through to the
    // next candidate.
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/**
 * The `renderPlanHtml` meta for a template.
 *
 * @param {object} template   a normalised Template Bank row
 * @param {object} [overrides] teacher-supplied header fields (Use Template).
 *   Any field left out keeps the template's printed blank; pass `''` to print
 *   nothing at all.
 * @returns {object} render meta
 */
export function templatePreviewMeta(template, overrides = {}) {
  const content = template?.content || {}
  const header = (content.header && typeof content.header === 'object') ? content.header : {}
  const has = (key) => Object.prototype.hasOwnProperty.call(overrides, key)
  const field = (key) => (has(key) ? String(overrides[key] ?? '') : TEMPLATE_BLANK)

  return {
    format: 'classic',
    // The paper format travels WITH the plan (the studio's own convention), so
    // the preview, the print window and the Word export agree.
    lessonFormat: { headerStyle: 'ministry' },
    // Identity: blank rules on a template, the teacher's own words once used.
    school: has('school') ? String(overrides.school ?? '') : '',
    teacherName: field('teacherName'),
    date: field('date'),
    time: field('time'),
    // Curriculum coordinates, preferring the plan's own header (which keeps the
    // syllabus code) over the bank's stripped search coordinate.
    klass: firstText(overrides.class, header.grade, template?.grade),
    subject: firstText(header.subject, template?.subject),
    topic: firstText(header.topic, template?.topic),
    subtopic: firstText(header.subtopic, template?.subtopic),
    duration: firstText(header.duration, header.durationMinutes, '40'),
  }
}
