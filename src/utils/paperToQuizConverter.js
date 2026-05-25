/**
 * paperToQuizConverter — one-click conversion of an admin-managed past
 * paper PDF into a learner-facing quiz draft.
 *
 * Why a separate util: the existing /admin/quizzes/new?mode=import flow
 * expects the admin to manually pick a file from disk. Past papers are
 * already in Storage at paper.pdfPath — there's no reason to make the
 * admin download and re-upload. This fetches the blob, wraps it in a
 * File, hands it to the existing importQuizDocument() parser, and
 * persists the result as a draft quiz with paper metadata pre-filled.
 *
 * Inputs:
 *   - paper: the past paper Firestore doc ({ id, grade, subject, year,
 *     paperNumber, title, pdfPath, ... })
 *   - uid: the admin's UID (becomes createdBy on the new quiz)
 *   - createQuiz, saveQuestions: the useFirestore() hooks injected so
 *     the converter stays UI-free and unit-testable
 *   - onProgress?: optional ({ step }) => void for the UI progress text
 *
 * Output: { quizId, questionCount, warnings, importStatus }
 *
 * The resulting quiz is saved with isPublished: false and status: 'draft'
 * so nothing reaches learners until the admin reviews and publishes via
 * the existing /admin/content flow.
 */

import { getDownloadURL, ref as storageRef } from 'firebase/storage'
import { storage } from '../firebase/config'
import { importQuizDocument, revokeImportedQuizAssets } from '../components/quiz/documentQuizImporter'
import { serializeQuizSections } from './quizSections'
import { SUBJECTS } from '../config/curriculum'

// Map the past-paper subject id ('mathematics', 'english') to the
// label format the learner-facing quizzes collection uses
// ('Mathematics', 'English'). Falls back to a title-case slug if the
// subject isn't in the canonical SUBJECTS list.
function subjectLabel(subjectId) {
  const match = SUBJECTS.find((s) => s.id === subjectId)
  if (match?.label) return match.label
  return String(subjectId || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function safeFilename(name) {
  return String(name || 'paper')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 80) || 'paper'
}

async function downloadPdfAsFile(pdfPath) {
  // getDownloadURL gives us a Hosting-token URL that bypasses CORS for
  // the same-origin Firebase Storage SDK. fetch() then yields the
  // bytes; we wrap them in a File so importQuizDocument's existing
  // type-sniffing accepts the input unchanged.
  const url = await getDownloadURL(storageRef(storage, pdfPath))
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Storage download failed: HTTP ${res.status}`)
  }
  const blob = await res.blob()
  const filename = pdfPath.split('/').pop() || 'paper.pdf'
  return new File([blob], filename, { type: 'application/pdf' })
}

export async function convertPaperToQuizDraft({
  paper,
  uid,
  createQuiz,
  saveQuestions,
  onProgress = () => {},
}) {
  if (!paper?.pdfPath) {
    throw new Error('This paper has no PDF file attached. Upload one first.')
  }
  if (!uid) {
    throw new Error('Sign in required.')
  }

  onProgress({ step: 'Downloading past paper PDF…' })
  const file = await downloadPdfAsFile(paper.pdfPath)

  onProgress({ step: 'Parsing PDF into questions…' })
  let imported
  try {
    imported = await importQuizDocument(file)
  } catch (err) {
    throw new Error(`Couldn't parse the PDF: ${err?.message || 'unknown error'}`)
  }

  const serialized = serializeQuizSections(imported.sections, imported.parts)
  const questions = serialized.questions
  const passages = serialized.passages
  if (questions.length === 0) {
    revokeImportedQuizAssets(imported.imageAssets)
    throw new Error(
      'The PDF was parsed but no questions came out — it may be a scanned/image-only ' +
      'paper that needs OCR before this can work. Try a text-based PDF.',
    )
  }

  const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 1), 0)
  const reviewCount = questions.filter((q) => q.requiresReview).length
  const subjectFmt = subjectLabel(paper.subject)
  const title = [
    `Grade ${paper.grade}`,
    subjectFmt,
    paper.year ? `${paper.year}` : null,
    paper.paperNumber ? `Paper ${paper.paperNumber}` : null,
  ].filter(Boolean).join(' ')

  onProgress({ step: 'Saving as draft quiz…' })
  const quizId = await createQuiz({
    title: title || `Past paper — ${safeFilename(paper.title || paper.id)}`,
    subject: subjectFmt,
    grade: String(paper.grade),
    term: '',
    description: `Auto-converted from past paper ${paper.title || paper.id}. Review before publishing.`,
    passages,
    parts: serialized.parts,
    passageCount: passages.length,
    totalMarks,
    questionCount: questions.length,
    reviewCount,
    importStatus: imported.importStatus,
    sourceFileName: file.name,
    sourceContentType: 'application/pdf',
    importWarnings: imported.warnings || [],
    mode: 'imported_document',
    isPublished: false,
    status: 'draft',
    createdBy: uid,
    durationMinutes: 30,
    quizType: 'practice',
    // Soft link back to the originating past paper — useful for an
    // admin "where did this quiz come from?" audit.
    sourcePastPaperId: paper.id,
  })

  await saveQuestions(quizId, questions)
  revokeImportedQuizAssets(imported.imageAssets)

  return {
    quizId,
    questionCount: questions.length,
    warnings: imported.warnings || [],
    importStatus: imported.importStatus,
  }
}
