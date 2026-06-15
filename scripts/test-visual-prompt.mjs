/**
 * Tests for Visual Studio prompt composition + generation-param mapping.
 * Plain-node assertion script (no test framework) — see CLAUDE.md.
 */
import assert from 'node:assert'
import {
  composeVisualPrompt, buildVisualTitle, deriveKeywords,
} from '../src/features/visualStudio/lib/visualPrompt.js'
import {
  resolveGenerationParams, clampImageCount,
} from '../src/features/visualStudio/lib/visualStudioMeta.js'

// composeVisualPrompt grounds the prompt in topic + grade + subject + use case.
const p = composeVisualPrompt({
  grade: 5, subject: 'Integrated Science', topic: 'Human respiratory system',
  useCase: 'assessment', styleId: 'bw_test_diagram',
})
assert.ok(/respiratory/i.test(p), 'prompt mentions the topic')
assert.ok(/Grade 5/.test(p), 'prompt mentions the grade')
assert.ok(/Integrated Science/.test(p), 'prompt mentions the subject')
assert.ok(p.length <= 800, 'prompt is capped at 800 chars')

// Subtopic is the most-specific focus when present.
const p2 = composeVisualPrompt({
  grade: 7, subject: 'Mathematics', topic: 'Fractions', subtopic: 'Addition of fractions',
  styleId: 'bw_test_diagram',
})
assert.ok(/Addition of fractions/.test(p2), 'subtopic drives the focus')

// Empty input still produces a usable fallback prompt.
assert.ok(composeVisualPrompt({}).length > 0, 'empty input yields a fallback')

// resolveGenerationParams maps teacher choices → generateDiagram params.
const g = resolveGenerationParams({ styleId: 'bw_test_diagram', orientation: 'landscape', sizeId: 'medium' })
assert.equal(g.provider, 'recraft', 'B&W → recraft')
assert.equal(g.style, 'line_art', 'B&W → line_art')
assert.equal(g.size, '1365x1024', 'landscape medium pixel size')
assert.equal(g.blackAndWhite, true)

const gc = resolveGenerationParams({ styleId: 'colour_illustration', orientation: 'portrait', sizeId: 'large' })
assert.equal(gc.provider, 'kie', 'colour → kie')
assert.equal(gc.style, undefined, 'colour has no recraft substyle')
assert.equal(gc.size, '1024x1707', 'portrait large pixel size')
assert.equal(gc.blackAndWhite, false)

const gr = resolveGenerationParams({ styleId: 'realistic_science', orientation: 'square', sizeId: 'small' })
assert.equal(gr.provider, 'openai', 'realistic → openai')
assert.equal(gr.size, '1024x1024', 'square pixel size')

// Unknown style falls back to the B&W default.
const gd = resolveGenerationParams({ styleId: 'nope' })
assert.equal(gd.provider, 'recraft')

// clampImageCount stays within the batch range.
assert.equal(clampImageCount(0), 1)
assert.equal(clampImageCount(99), 4)
assert.equal(clampImageCount(3), 3)
assert.equal(clampImageCount('2'), 2)

// Title + keyword derivation.
assert.ok(buildVisualTitle({ topic: 'Water cycle', grade: 5, subject: 'Science' }).startsWith('Water cycle'))
const kw = deriveKeywords({ topic: 'Human respiratory system', subject: 'Science', grade: 5 })
assert.ok(kw.includes('respiratory'), 'keywords include topic tokens')
assert.ok(kw.includes('grade5'), 'keywords include grade tag')

console.log('✓ visual-prompt tests passed')
