/**
 * The one entry point that turns any runner's source data into the canonical
 * assessment (`docs/architecture.md` §4, the "Assessment Normaliser" box).
 *
 * Every consumer calls this and nothing else. The point of a single door is
 * that adding a fifth source later is an adapter plus a case here, rather than
 * a fifth place that decides what a question is — which is precisely how four
 * runners came to disagree about the same three collections.
 *
 * An unknown source THROWS rather than returning null or an empty assessment.
 * An empty assessment is indistinguishable from a real one with no questions,
 * and the engine would render a blank runner instead of reporting that it was
 * handed something it does not understand.
 */
import { fromQuiz } from './fromQuiz.js'
import { fromGame } from './fromGame.js'
import { ASSESSMENT_SOURCES } from '../schemas/index.js'

export { fromQuiz, fromGame }

/**
 * @param {object} input
 * @param {'quiz'|'pastPaperQuiz'|'game'} input.source
 * @returns {object} a canonical assessment (see `../schemas/index.js`)
 */
export function normaliseAssessment(input) {
  const source = input?.source
  switch (source) {
    case 'quiz':
    case 'pastPaperQuiz':
      return fromQuiz(input)
    case 'game':
      return fromGame(input)
    default:
      throw new Error(
        `normaliseAssessment: unknown source ${JSON.stringify(source)}. ` +
        `Expected one of ${ASSESSMENT_SOURCES.join(', ')}.`,
      )
  }
}
