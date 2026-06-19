import { describe, it, expect } from 'vitest'
import {
  resolveGradeForm,
  resolveSubject,
  resolveTerm,
  classifyForLibrary,
  TOOL_TO_LIBRARY_TYPE,
} from './libraryClassification.js'

// libraryClassification translates the studios' internal shorthand
// (grade 'G4', subject 'mathematics', term 2) into the canonical library
// coordinates that decide WHERE a generated artifact appears in the teacher
// library. Misclassification silently hides content in the wrong folder, so
// the grade/subject/term mapping is worth pinning. Fully pure — no mocks.

describe('resolveGradeForm', () => {
  it('maps internal CBC grade ids to academic grade forms', () => {
    expect(resolveGradeForm('G4')).toEqual({ syllabus: 'CBC', gradeForm: 'Grade 4' })
    expect(resolveGradeForm('G7')).toEqual({ syllabus: 'CBC', gradeForm: 'Grade 7' })
  })

  it('maps internal secondary grade ids to forms', () => {
    expect(resolveGradeForm('G8')).toEqual({ syllabus: 'Secondary', gradeForm: 'Form 1' })
    expect(resolveGradeForm('G12')).toEqual({ syllabus: 'Secondary', gradeForm: 'Form 4' })
  })

  it('treats ECE buckets as CBC Grade 1', () => {
    expect(resolveGradeForm('ECE')).toEqual({ syllabus: 'CBC', gradeForm: 'Grade 1' })
    expect(resolveGradeForm('ECE_R')).toEqual({ syllabus: 'CBC', gradeForm: 'Grade 1' })
  })

  it('accepts already-academic forms, normalising case/spacing', () => {
    expect(resolveGradeForm('Grade 4')).toEqual({ syllabus: 'CBC', gradeForm: 'Grade 4' })
    expect(resolveGradeForm('form 1')).toEqual({ syllabus: 'Secondary', gradeForm: 'Form 1' })
  })

  it('lets an explicit syllabus hint override the default', () => {
    expect(resolveGradeForm('G4', 'OBC')).toEqual({ syllabus: 'OBC', gradeForm: 'Grade 4' })
  })

  it('returns nulls for missing or unrecognisable grades', () => {
    expect(resolveGradeForm(null)).toEqual({ syllabus: null, gradeForm: null })
    expect(resolveGradeForm(undefined, 'CBC')).toEqual({ syllabus: 'CBC', gradeForm: null })
    expect(resolveGradeForm('nonsense')).toEqual({ syllabus: null, gradeForm: null })
  })
})

describe('resolveSubject', () => {
  it('passes through a subject that is already an academic label', () => {
    expect(resolveSubject('Mathematics', 'CBC', 'Grade 4')).toBe('Mathematics')
  })

  it('maps internal subject ids to academic labels (upper primary)', () => {
    expect(resolveSubject('mathematics', 'CBC', 'Grade 4')).toBe('Mathematics')
    expect(resolveSubject('integrated_science', 'CBC', 'Grade 4')).toBe('Integrated Science')
    expect(resolveSubject('home_economics', 'CBC', 'Grade 4')).toBe('Home Economics')
  })

  it('collapses to the combined lower-primary subject for Grades 1–3', () => {
    expect(resolveSubject('mathematics', 'CBC', 'Grade 3')).toBe('Mathematics and Science')
    expect(resolveSubject('expressive_arts', 'CBC', 'Grade 2')).toBe('Creative and Technology Studies')
  })

  it('title-cases an unknown subject id as a last resort', () => {
    expect(resolveSubject('my_custom_subject', 'CBC', 'Grade 4')).toBe('My Custom Subject')
  })

  it('returns null for a missing subject', () => {
    expect(resolveSubject(null, 'CBC', 'Grade 4')).toBeNull()
  })
})

describe('resolveTerm', () => {
  it('normalises bare numbers and Term strings', () => {
    expect(resolveTerm(2)).toBe('Term 2')
    expect(resolveTerm('3')).toBe('Term 3')
    expect(resolveTerm('Term 1')).toBe('Term 1')
    expect(resolveTerm('term 2')).toBe('Term 2')
  })

  it('passes through non-term labels untouched', () => {
    expect(resolveTerm('Annual')).toBe('Annual')
  })

  it('returns null for empty values', () => {
    expect(resolveTerm(null)).toBeNull()
    expect(resolveTerm(undefined)).toBeNull()
    expect(resolveTerm('')).toBeNull()
  })
})

describe('classifyForLibrary', () => {
  it('maps a raw studio payload to canonical library coords', () => {
    const coords = classifyForLibrary({
      libraryType: 'lesson_plans',
      grade: 'G4',
      subject: 'mathematics',
      term: 2,
    })
    expect(coords).toEqual(expect.objectContaining({
      libraryType: 'lesson_plans',
      syllabus: 'CBC',
      gradeForm: 'Grade 4',
      subject: 'Mathematics',
      term: 'Term 2',
      assessmentType: null,
    }))
    expect(coords.path).toBeTruthy()
  })

  it('returns null when libraryType is missing', () => {
    expect(classifyForLibrary({ grade: 'G4', subject: 'mathematics' })).toBeNull()
  })
})

describe('TOOL_TO_LIBRARY_TYPE', () => {
  it('buckets legacy tool ids into library types', () => {
    expect(TOOL_TO_LIBRARY_TYPE.lesson_plan).toBe('lesson_plans')
    expect(TOOL_TO_LIBRARY_TYPE.worksheet).toBe('assessments') // worksheets read as assessments
    expect(TOOL_TO_LIBRARY_TYPE.rubric).toBe('assessments')
    expect(TOOL_TO_LIBRARY_TYPE.flashcards).toBe('notes')
    expect(TOOL_TO_LIBRARY_TYPE.sba_task).toBe('sba_tasks')
  })
})
