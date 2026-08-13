/**
 * Regression guard for the Lesson Plan Studio "Teaching Kit".
 *
 * After a plan is generated, the studio shows a Teaching Kit panel that
 * deep-links into the Worksheet / Homework / Notes / Test Paper studios with the
 * lesson pre-filled AND aligned: Notes is grounded on the saved plan via
 * `lessonPlanId`, while the others receive the plan's CBC anchors through
 * `buildAlignmentInstructions`. The hand-off is: the vanilla studio
 * (06-generate.js) converts its raw coords to the CBC vocabulary the React
 * generators expect (classToCbcGrade / subjectToCbcSubject) and calls the
 * window.__studioOnGenerated bridge; LessonPlanStudio.jsx renders the panel and
 * navigates with buildGeneratorQueryString — the SAME serialiser the React
 * generators read via useFormDefaultsFromUrl. These are static (text-level)
 * checks that the wiring can't silently regress.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let failures = 0
const read = (rel) => readFileSync(join(root, rel), 'utf8')
function check(cond, msg) {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures += 1
  }
}

// 1. The vanilla studio reports a finished plan to React with CBC coords.
const gen = read('public/studio/06-generate.js')
check(/window\.__studioOnGenerated\s*\(/.test(gen), '06-generate.js calls the __studioOnGenerated bridge after a generation')
check(/classToCbcGrade\(i\.klass\)/.test(gen), '06-generate.js normalises the grade via classToCbcGrade')
check(/subjectToCbcSubject\(i\.subject\)/.test(gen), '06-generate.js normalises the subject via subjectToCbcSubject')
for (const key of ['grade:', 'subject:', 'topic:', 'subtopic:', 'term:']) {
  check(new RegExp(`window\\.__studioOnGenerated\\(\\{[\\s\\S]*?${key}`).test(gen),
    `06-generate.js passes ${key.replace(':', '')} to the kit`)
}

// 2. The React studio imports the serialiser and renders the Teaching Kit.
// The new studio is a pure-React component — no window bridge needed.
const studio = read('src/features/lessonPlanStudio/pages/LessonPlanStudio.jsx')
check(/import \{ buildGeneratorQueryString \} from/.test(studio), 'LessonPlanStudio imports buildGeneratorQueryString (the generators\' deserialiser)')
check(/Teaching Kit/.test(studio), 'LessonPlanStudio renders the Teaching Kit panel')
check(/buildGeneratorQueryString\(/.test(studio), 'LessonPlanStudio serialises the kit with buildGeneratorQueryString')

// 3. The kit deep-links into each companion studio with the pre-fill query
//    string. The route strings are quoted literals in openKitTool().
for (const route of [
  '/teacher/generate/worksheet',
  '/teacher/generate/homework',
  '/teacher/generate/notes',
  '/teacher/assessment-papers/new',
]) {
  check(studio.includes(`'${route}'`),
    `LessonPlanStudio deep-links to ${route} with the pre-fill query string`)
}

// 3b. The kit ALIGNS each tool to the lesson: Notes via the saved plan's
//     lessonPlanId, the others via the plan's CBC anchors as instructions.
check(/lessonPlanId/.test(studio), 'LessonPlanStudio grounds Notes on the saved plan via lessonPlanId')
check(/buildAlignmentInstructions\(/.test(studio), 'LessonPlanStudio aligns kit tools with the plan\'s CBC anchors')

// 4. The kit only shows once a plan exists (gated on kit state) AND while the
//    generated document is on screen — never over the creation wizard, whose
//    sticky step navigation owns the bottom edge (wizard redesign 2026-07).
check(/\{kit && studioView === 'canvas' && \(/.test(studio), 'LessonPlanStudio only shows the kit bar after a plan is generated (canvas view)')

// 5. AssessmentStudio consumes the deep-link params (the others read them via
//    useFormDefaultsFromUrl; AssessmentStudio uses the dedicated converter).
const assessment = read('src/features/assessmentStudio/pages/AssessmentStudio.jsx')
check(/assessmentDefaultsFromParams\(searchParams\)/.test(assessment),
  'AssessmentStudio seeds its form from the lesson-kit deep link')

if (failures) {
  console.error(`\n✗ lesson-kit guard FAILED (${failures} issue(s)).`)
  process.exit(1)
}
console.log('\n✓ lesson-kit guard passed.')
