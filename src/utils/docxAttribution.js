/**
 * Shared "Made with ZedExams" page footer for teacher-tool DOCX exports.
 *
 * Free-plan teachers export real documents from the studios every day
 * (the library's download buttons are already paid-only), and those
 * documents travel — WhatsApp groups, staffrooms, head teachers' desks.
 * The footer is the document's only attribution on that journey.
 * Pro/Max (and admin) exports stay clean: studios resolve the flag with
 * isFreePlanTeacher() from teacherLibraryService and pass it down as
 * opts.attribution.
 *
 * Pure docx helpers — no app imports — so every exporter chunk stays
 * dependency-light.
 */

import { AlignmentType, Footer, Paragraph, TextRun } from 'docx'

export function attributionFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: 'Made with ZedExams — free CBC teacher tools at zedexams.com/teachers',
            size: 14,
            color: '888888',
          }),
        ],
      }),
    ],
  })
}

/**
 * Spread into a section literal: `...attributionSection(opts)` adds the
 * page footer when opts.attribution is true, and nothing otherwise.
 */
export function attributionSection(opts) {
  return opts?.attribution ? { footers: { default: attributionFooter() } } : {}
}
