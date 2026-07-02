import { describe, it, expect } from 'vitest'
import {
  STUDIO_SYSTEM_PROMPT_CBC,
  STUDIO_SYSTEM_PROMPT_PREVIOUS,
  STUDIO_SYSTEM_PROMPT,
} from '../studioSystemPrompt'

// These prompts back the Writing Style toggle (Simple / Standard / Professional)
// in the Lesson Plan Studio. Previously the CBC prompt hard-pinned a single
// "PROFESSIONAL WRITING STANDARDS" register, so all three styles produced the
// same formal output and the toggle was inert. These tests lock in that the
// prompts now DEFER register to the style requested in the user prompt.

describe('studioSystemPrompt — writing-style honouring', () => {
  it('CBC prompt tells the model to match the requested WRITING STYLE', () => {
    expect(STUDIO_SYSTEM_PROMPT_CBC).toMatch(/WRITING STYLE/i)
    expect(STUDIO_SYSTEM_PROMPT_CBC).toMatch(/Simple/)
    expect(STUDIO_SYSTEM_PROMPT_CBC).toMatch(/Professional/)
  })

  it('CBC prompt no longer hard-pins a single professional register', () => {
    // The old wording forced every plan to one register regardless of the
    // toggle. It must not reappear.
    expect(STUDIO_SYSTEM_PROMPT_CBC).not.toMatch(/PROFESSIONAL WRITING STANDARDS/)
  })

  it('CBC prompt states the correctness rules apply to ALL styles', () => {
    expect(STUDIO_SYSTEM_PROMPT_CBC).toMatch(/apply to ALL/i)
  })

  it('Previous-curriculum prompt also honours the requested WRITING STYLE', () => {
    expect(STUDIO_SYSTEM_PROMPT_PREVIOUS).toMatch(/WRITING STYLE/i)
    expect(STUDIO_SYSTEM_PROMPT_PREVIOUS).toMatch(/Simple/)
    expect(STUDIO_SYSTEM_PROMPT_PREVIOUS).toMatch(/Professional/)
  })

  it('keeps the universal quality rules (full stops, no placeholders)', () => {
    for (const p of [STUDIO_SYSTEM_PROMPT_CBC, STUDIO_SYSTEM_PROMPT_PREVIOUS]) {
      expect(p).toMatch(/full stop/i)
      expect(p).toMatch(/TBD|N\/A|placeholder/i)
    }
  })

  it('default export alias points at the CBC prompt', () => {
    expect(STUDIO_SYSTEM_PROMPT).toBe(STUDIO_SYSTEM_PROMPT_CBC)
  })
})

// Rural-teacher feedback: generated activities assumed projectors, printing and
// lab kits village schools don't have. Both prompts must now default to a
// low-resource Zambian classroom unless the user prompt says otherwise.
describe('studioSystemPrompt — low-resource default', () => {
  it('both prompts assume no projector/photocopier/electricity by default', () => {
    for (const p of [STUDIO_SYSTEM_PROMPT_CBC, STUDIO_SYSTEM_PROMPT_PREVIOUS]) {
      expect(p).toMatch(/Respect the school's resources/i)
      expect(p).toMatch(/NO projector, computers, photocopier or reliable electricity/)
      expect(p).toMatch(/free local alternative/i)
    }
  })
})

// Regression for the "blank skeleton" bug: the rewrite dropped the JSON-key
// contract, so the model invented its own keys and the renderer (which reads
// generalCompetences / stages[].{teacher,pupils,assessment}) showed nothing.
describe('studioSystemPrompt — JSON output contract', () => {
  it('CBC prompt names the canonical top-level + stage keys', () => {
    for (const key of [
      'generalCompetences', 'specificCompetence', 'lessonGoal', 'rationale',
      'priorKnowledge', 'references', 'learningEnvironment', 'materials',
      'expectedStandard', '"stages"', '"teacher"', '"pupils"', '"assessment"',
    ]) {
      expect(STUDIO_SYSTEM_PROMPT_CBC).toContain(key)
    }
  })

  it('CBC prompt explicitly forbids the renamed stage keys that broke the renderer', () => {
    expect(STUDIO_SYSTEM_PROMPT_CBC).toMatch(/do NOT rename/i)
    expect(STUDIO_SYSTEM_PROMPT_CBC).toContain('teacherActivities')
  })

  it('Previous-curriculum prompt names canonical stage keys', () => {
    for (const key of ['"teacher"', '"pupils"', '"assessment"', '"stages"', 'specificOutcomes']) {
      expect(STUDIO_SYSTEM_PROMPT_PREVIOUS).toContain(key)
    }
  })
})
