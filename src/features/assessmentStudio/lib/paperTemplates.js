/**
 * paperTemplates — ready-made paper structures for common Zambian school
 * formats, so a teacher doesn't have to hand-build "SECTION A: 15 multiple
 * choice, SECTION B: 5 structured" every single time.
 *
 * A template is a DECLARATIVE spec (no content, just shape): named sections,
 * the question types in each, how many, and the marks per question. Picking a
 * template seeds the studio with empty-but-correctly-typed blocks the teacher
 * then fills in — the structure is done, the writing is theirs.
 *
 * `instantiateTemplate()` turns a spec into real studio state (sections[] +
 * parts[]) using the same builders the rest of the studio uses, so a templated
 * paper is indistinguishable from a hand-built one. Kept dependency-light
 * (only quizSections, which is itself Firebase-free) so it unit-tests in node.
 */

import {
  createStandaloneSection,
  createPartGroup,
  createPassageSection,
  emptyPassageQuestion,
} from '../../../utils/quizSections.js'

// Seed shapes per question type — mirrors AssessmentStudio's handleBlockPick so
// a templated MCQ / short-answer / structured / essay block behaves exactly
// like one added from the block picker.
const TYPE_SEEDS = {
  mcq: { type: 'mcq', detectedType: 'mcq', options: ['', '', '', ''], correctAnswer: 0 },
  true_false: { type: 'mcq', detectedType: 'mcq', options: ['True', 'False', '', ''], correctAnswer: 0 },
  short_answer: { type: 'short_answer', detectedType: 'short_answer', options: [], correctAnswer: '' },
  // "structured" is the studio's diagram-type multi-mark question.
  structured: { type: 'diagram', detectedType: 'diagram', options: [], correctAnswer: '', diagramText: 'Structured response' },
  essay: { type: 'essay', detectedType: 'essay', options: [], correctAnswer: '' },
}

function seedFor(type) {
  return TYPE_SEEDS[type] || TYPE_SEEDS.short_answer
}

/**
 * The template catalogue. Each entry is subject-agnostic so it works for any
 * paper; the copy is generic Zambian exam wording the teacher edits in place.
 *
 * Shape:
 *   id, name, description — picker card content
 *   badge                 — short tag shown on the card
 *   duration              — suggested minutes (backfilled into the form)
 *   blocks[]              — ordered sections:
 *     { part:{title,instructions}, questions:[{type,count,marks}] }  — a numbered section
 *     { passage:{kind,instructions,questions:[{type,count,marks}]} } — a comprehension/source block
 */
export const PAPER_TEMPLATES = [
  {
    id: 'end-of-term',
    name: 'End-of-term exam',
    description: 'Objective Section A plus a structured Section B — the standard end-of-term shape with a full marking key.',
    badge: 'Exam',
    duration: 90,
    blocks: [
      {
        part: {
          title: 'SECTION A: Objective Questions',
          instructions: 'Answer ALL questions in this section. For each question, circle the letter of the correct answer.',
        },
        questions: [{ type: 'mcq', count: 15, marks: 1 }],
      },
      {
        part: {
          title: 'SECTION B: Structured Questions',
          instructions: 'Answer ALL questions in the spaces provided. Show your working where necessary.',
        },
        questions: [{ type: 'structured', count: 5, marks: 5 }],
      },
    ],
  },
  {
    id: 'mid-term',
    name: 'Mid-term test',
    description: 'A shorter two-part test — multiple choice plus a handful of short-answer questions for a half-term check.',
    badge: 'Test',
    duration: 60,
    blocks: [
      {
        part: {
          title: 'SECTION A: Multiple Choice',
          instructions: 'Choose the correct answer from the options given.',
        },
        questions: [{ type: 'mcq', count: 10, marks: 1 }],
      },
      {
        part: {
          title: 'SECTION B: Short Answer',
          instructions: 'Answer ALL questions in the spaces provided.',
        },
        questions: [{ type: 'short_answer', count: 5, marks: 2 }],
      },
    ],
  },
  {
    id: 'weekly-quiz',
    name: 'Weekly topic quiz',
    description: 'A quick single-topic check: a few multiple-choice questions and a couple of short answers. Great for a Friday review.',
    badge: 'Quiz',
    duration: 30,
    blocks: [
      {
        questions: [
          { type: 'mcq', count: 6, marks: 1 },
          { type: 'short_answer', count: 3, marks: 2 },
        ],
      },
    ],
  },
  {
    id: 'mcq-only',
    name: 'Multiple-choice quiz',
    description: 'Twenty objective questions, one mark each — fast to mark and ideal for an answer-sheet bubble grid.',
    badge: 'Objective',
    duration: 40,
    blocks: [
      {
        part: {
          title: 'Multiple Choice Questions',
          instructions: 'Circle the letter of the correct answer for each question.',
        },
        questions: [{ type: 'mcq', count: 20, marks: 1 }],
      },
    ],
  },
  {
    id: 'structured-essay',
    name: 'Structured & essay',
    description: 'Compulsory structured questions and a choice of essays — the upper-grade / examination shape.',
    badge: 'Senior',
    duration: 120,
    blocks: [
      {
        part: {
          title: 'SECTION A: Structured Questions',
          instructions: 'Answer ALL questions in this section.',
        },
        questions: [{ type: 'structured', count: 4, marks: 10 }],
      },
      {
        part: {
          title: 'SECTION B: Essays',
          instructions: 'Answer any TWO questions from this section. Each essay carries 20 marks.',
        },
        questions: [{ type: 'essay', count: 3, marks: 20 }],
      },
    ],
  },
  {
    id: 'comprehension',
    name: 'Comprehension & grammar',
    description: 'A reading passage with comprehension questions followed by a short grammar section — the English-paper shape.',
    badge: 'English',
    duration: 60,
    blocks: [
      {
        passage: {
          kind: 'comprehension',
          instructions: 'Read the passage below carefully and answer the questions that follow.',
          questions: [{ type: 'short_answer', count: 5, marks: 2 }],
        },
      },
      {
        part: {
          title: 'SECTION B: Grammar',
          instructions: 'Answer ALL questions in the spaces provided.',
        },
        questions: [{ type: 'short_answer', count: 5, marks: 1 }],
      },
    ],
  },
]

export function getTemplateById(id) {
  return PAPER_TEMPLATES.find((t) => t.id === id) || null
}

/**
 * Summarise a template for its picker card without instantiating anything.
 * @returns {{questionCount:number, totalMarks:number, sectionCount:number, typeLabel:string}}
 */
export function templateStats(template) {
  if (!template) return { questionCount: 0, totalMarks: 0, sectionCount: 0, typeLabel: '' }
  let questionCount = 0
  let totalMarks = 0
  let sectionCount = 0
  const types = new Set()
  for (const block of template.blocks || []) {
    if (block.part || block.passage) sectionCount += 1
    const questions = block.passage ? (block.passage.questions || []) : (block.questions || [])
    for (const q of questions) {
      const count = Number(q.count) || 0
      questionCount += count
      totalMarks += count * (Number(q.marks) || 0)
      if (q.type) types.add(q.type)
    }
  }
  const TYPE_LABELS = {
    mcq: 'multiple choice', true_false: 'true/false', short_answer: 'short answer',
    structured: 'structured', essay: 'essay',
  }
  const typeLabel = [...types].map((t) => TYPE_LABELS[t] || t).join(' · ')
  return { questionCount, totalMarks, sectionCount, typeLabel }
}

/**
 * Turn a template spec into real studio state.
 * @returns {{ sections: Array, parts: Array, formPatch: object }}
 *   sections/parts plug straight into setSections/setParts; formPatch carries
 *   backfill-only metadata (duration) the studio applies to unset fields.
 */
export function instantiateTemplate(template) {
  const sections = []
  const parts = []
  let order = 0

  for (const block of template?.blocks || []) {
    if (block.passage) {
      const subQuestions = []
      for (const q of block.passage.questions || []) {
        // Use the same per-type seed the standalone path + the studio's block
        // picker use, so a templated short-answer/structured sub-question gets
        // the right shape (options:[] + correctAnswer:'' for text answers, the
        // 'structured'→diagram mapping with its diagramText). Passing only
        // {type, marks} used to leave emptyPassageQuestion's MCQ defaults
        // (four option slots + correctAnswer 0) on a short-answer comprehension
        // question, so it reopened looking like a multiple-choice.
        const seed = seedFor(q.type)
        for (let n = 0; n < (Number(q.count) || 1); n += 1) {
          subQuestions.push(emptyPassageQuestion({ ...seed, marks: Number(q.marks) || 1 }))
        }
      }
      sections.push(createPassageSection({
        passageKind: block.passage.kind || 'comprehension',
        instructions: block.passage.instructions || '',
        questions: subQuestions.length ? subQuestions : undefined,
      }))
      continue
    }

    // A `part` block becomes a numbered Part the questions are assigned to via
    // question.partId (the studio tracks membership by id, not nesting). A block
    // with no `part` produces loose questions (partId null).
    let partId = null
    if (block.part) {
      const part = createPartGroup({
        title: block.part.title || '',
        instructions: block.part.instructions || '',
        order,
      })
      order += 1
      parts.push(part)
      partId = part.id
    }

    for (const q of block.questions || []) {
      const seed = seedFor(q.type)
      for (let n = 0; n < (Number(q.count) || 1); n += 1) {
        sections.push(createStandaloneSection({ ...seed, marks: Number(q.marks) || 1, partId }))
      }
    }
  }

  const formPatch = {}
  if (template?.duration) formPatch.duration = String(template.duration)

  return { sections, parts, formPatch }
}
