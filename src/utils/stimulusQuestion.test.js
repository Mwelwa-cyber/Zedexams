/**
 * Tests for stimulus / source-based question detection + splitting.
 *
 * Run: node src/utils/stimulusQuestion.test.js
 */

import {
  isStimulusText,
  classifyStimulusKind,
  splitSubQuestions,
  stimulusDescriptorFromQuestion,
  detectLabelledParts,
} from './stimulusQuestion.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

console.log('isStimulusText')
assert(isStimulusText('Study the diagram below and answer the questions that follow.'), 'detects "study the diagram below"')
assert(isStimulusText('Read the passage below and answer the questions.'), 'detects "read the passage below"')
assert(isStimulusText('Use the table below to answer the questions that follow.'), 'detects "use the table below"')
assert(isStimulusText('Observe the map and answer the following.'), 'detects "observe the map"')
assert(!isStimulusText('What is the capital of Zambia?'), 'plain question is not a stimulus')

console.log('\nclassifyStimulusKind')
assert(classifyStimulusKind('Study the diagram below') === 'diagram', 'diagram → diagram')
assert(classifyStimulusKind('Look at the picture of the heart') === 'diagram', 'picture → diagram')
assert(classifyStimulusKind('Read the passage below') === 'source', 'passage → source')
assert(classifyStimulusKind('Use the table below') === 'source', 'table → source')
assert(classifyStimulusKind('Observe the map of Zambia') === 'map', 'map → map')

console.log('\nsplitSubQuestions')
{
  const text = 'The diagram below shows the human respiratory system. Study it carefully and answer the questions that follow. (a) Name the parts labelled P, Q and R. (3) (b) State the function of the part labelled R. (1) (c) Name the gas that is breathed out during respiration. (1)'
  const out = splitSubQuestions(text)
  assert(out !== null, 'splits a 3-part stimulus question')
  assert(out.parts.length === 3, 'finds 3 sub-parts')
  assert(/respiratory system/.test(out.stem) && !/\(a\)/.test(out.stem), 'stem holds the instruction, not the sub-parts')
  assert(out.parts[0].marks === 3 && out.parts[1].marks === 1 && out.parts[2].marks === 1, 'reads per-sub-part marks')
  assert(/Name the parts labelled P, Q and R/.test(out.parts[0].text), 'sub-part text preserved without marks suffix')
}
assert(splitSubQuestions('A single question with no sub-parts.') === null, 'returns null when no sub-parts')

console.log('\ndetectLabelledParts')
assert(detectLabelledParts('Name the parts labelled P, Q and R.').join(',') === 'P,Q,R', 'extracts P, Q, R')
assert(detectLabelledParts('Label the parts A, B, C').join(',') === 'A,B,C', 'extracts A, B, C')
assert(detectLabelledParts('Name parts 1, 2 and 3').join(',') === '1,2,3', 'extracts 1, 2, 3')
assert(detectLabelledParts('State the function of the lungs.').length === 0, 'no labels when none asked for')

console.log('\nstimulusDescriptorFromQuestion')
{
  const text = 'The diagram below shows the human respiratory system. Study it and answer the questions that follow. (a) Name the parts labelled P, Q and R. (3) (b) State the function of the part labelled R. (1) (c) Name the gas breathed out. (1)'
  const d = stimulusDescriptorFromQuestion({ text })
  assert(d !== null, 'builds a descriptor')
  assert(d.passageKind === 'diagram', 'classifies as a diagram stimulus')
  assert(d.questions.length === 3, 'produces 3 sub-questions')
  assert(d.questions[0].answerFormat === 'labelled_blanks', '"name the parts P, Q, R" sub-question uses labelled blanks')
  assert(d.questions[0].blankLabels.join(',') === 'P,Q,R', 'labelled blanks carry P, Q, R')
  assert(d.questions[0].marks === 3, 'first sub-question keeps its 3 marks')
  assert(d.questions[1].answerFormat === 'lines', 'a plain sub-question uses ruled lines')
}
assert(stimulusDescriptorFromQuestion({ text: 'What is 2 + 2?' }) === null, 'plain question yields no stimulus descriptor')

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll stimulusQuestion tests passed.')
