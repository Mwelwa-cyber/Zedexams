import assert from 'node:assert/strict'
import { processImportedQuestionBlocks } from './documentQuizParserCore.js'
import { buildDocxTableBlocks } from './documentQuizTableBlocks.js'

function cell(text, assets = []) {
  return { text, assets }
}

function runStructuredTableTest() {
  const { blocks, warnings } = buildDocxTableBlocks([
    {
      cells: [
        cell('Question No'),
        cell('Question'),
        cell('A'),
        cell('B'),
        cell('C'),
        cell('D'),
        cell('Answer'),
      ],
    },
    {
      cells: [
        cell('1'),
        cell('What is 2 + 2?'),
        cell('3'),
        cell('4'),
        cell('5'),
        cell('6'),
        cell('B'),
      ],
    },
    { cells: [cell('2'), cell('Choose the mammal.')] },
    { cells: [cell('A'), cell('Eagle')] },
    { cells: [cell('B'), cell('Goat')] },
    { cells: [cell('C'), cell('Lizard')] },
    { cells: [cell('D'), cell('Frog')] },
    { cells: [cell('Answer'), cell('B')] },
  ])

  assert.equal(warnings.length, 0)
  assert.deepEqual(
    blocks.map(block => block.text),
    [
      '1. What is 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nAnswer: B',
      '2. Choose the mammal.',
      'A. Eagle',
      'B. Goat',
      'C. Lizard',
      'D. Frog',
      'Answer: B',
    ],
  )

  const { questions, summary } = processImportedQuestionBlocks(blocks, [])
  assert.equal(summary.questions, 2)

  const firstQuestion = questions.find(question => String(question.sourceQuestionNumber) === '1')
  const secondQuestion = questions.find(question => String(question.sourceQuestionNumber) === '2')

  assert.ok(firstQuestion)
  assert.ok(secondQuestion)
  assert.deepEqual(firstQuestion.options, ['3', '4', '5', '6'])
  assert.equal(firstQuestion.correctAnswer, 1)
  assert.deepEqual(secondQuestion.options, ['Eagle', 'Goat', 'Lizard', 'Frog'])
  assert.equal(secondQuestion.correctAnswer, 1)
}

function runFallbackWarningTest() {
  const { blocks, warnings } = buildDocxTableBlocks([
    { cells: [cell('Prompt'), cell('Needs review'), cell('Extra note')] },
  ])

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].text, 'Prompt\nNeeds review\nExtra note')
  assert.equal(blocks[0].source, 'docx-table')
  assert.deepEqual(
    warnings,
    ['A complex Word table row was flattened into text. Review those questions before publishing.'],
  )
}

runStructuredTableTest()
runFallbackWarningTest()
console.log('documentQuizTableBlocks tests passed')
