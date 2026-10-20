import assert from 'node:assert/strict'
import {
  resolveFocusActivities,
  toggleFocusActivity,
  focusActivityPromptLines,
} from './activityFocus.js'

const row = { learningActivities: ['Defining ICT', 'Distinguishing ICT tools', 'Creating a chart'] }

// Nothing chosen means no focus, and the plan uses every activity.
assert.deepEqual(resolveFocusActivities(row, undefined), [])
assert.deepEqual(resolveFocusActivities(row, []), [])
assert.deepEqual(resolveFocusActivities(null, ['Defining ICT']), [])
assert.deepEqual(focusActivityPromptLines(row, []), [])

// The result comes back in syllabus order, whatever order the ticks were made in.
assert.deepEqual(
  resolveFocusActivities(row, ['Creating a chart', 'Defining ICT']),
  ['Defining ICT', 'Creating a chart'],
)

// A leftover from another sub-topic or competence drops out.
assert.deepEqual(resolveFocusActivities(row, ['Old activity', 'Creating a chart']), ['Creating a chart'])
assert.deepEqual(resolveFocusActivities(row, ['Old activity']), [])

// Toggle on, toggle off, and the toggle clears leftovers.
let chosen = toggleFocusActivity(row, [], 'Creating a chart')
assert.deepEqual(chosen, ['Creating a chart'])
chosen = toggleFocusActivity(row, chosen, 'Defining ICT')
assert.deepEqual(chosen, ['Defining ICT', 'Creating a chart'])
chosen = toggleFocusActivity(row, chosen, 'Creating a chart')
assert.deepEqual(chosen, ['Defining ICT'])
assert.deepEqual(toggleFocusActivity(row, ['Stale'], 'Defining ICT'), ['Defining ICT'])

// The prompt names only the chosen activities.
const lines = focusActivityPromptLines(row, ['Distinguishing ICT tools'])
assert.equal(lines.length, 1)
assert.match(lines[0], /Distinguishing ICT tools/)
assert.doesNotMatch(lines[0], /Defining ICT/)

console.log('activityFocus: all assertions passed')
