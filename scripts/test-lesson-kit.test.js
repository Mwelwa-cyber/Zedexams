/**
 * Regression guard for the Lesson Plan Studio "lesson kit".
 *
 * After a plan is generated, the studio shows a "Create for this lesson" bar
 * that deep-links into the Worksheet / Homework / Notes studios with the
 * lesson's grade/subject/topic pre-filled. The hand-off is: the vanilla studio
 * (06-generate.js) converts its raw coords to the CBC vocabulary the React
 * generators expect (classToCbcGrade / subjectToCbcSubject) and calls the
 * window.__studioOnGenerated bridge; LessonPlanStudio.jsx renders the bar and
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

// 2. The React studio imports the serialiser and renders the bar.
// The new studio is a pure-React component — no window bridge needed.
const studio = read('src/components/teacher/studio/LessonPlanStudio.jsx')
check(/import \{ buildGeneratorQueryString \} from/.test(studio), 'LessonPlanStudio imports buildGeneratorQueryString (the generators\' deserialiser)')
check(/Create for this lesson/.test(studio), 'LessonPlanStudio renders the "Create for this lesson" bar')

// 3. The bar deep-links into the companion studios with the query string.
for (const route of [
  '/teacher/generate/worksheet',
  '/teacher/generate/homework',
  '/teacher/generate/notes',
  '/teacher/test-papers/new',
]) {
  check(new RegExp(`navigate\\(\`${route}\\$\\{buildGeneratorQueryString\\(kit\\)\\}\``).test(studio),
    `LessonPlanStudio deep-links to ${route} with the pre-fill query string`)
}

// 4. The bar only shows once a plan exists (gated on kit state).
check(/\{kit && \(/.test(studio), 'LessonPlanStudio only shows the kit bar after a plan is generated')

// 5. AssessmentStudio consumes the deep-link params (the others read them via
//    useFormDefaultsFromUrl; AssessmentStudio uses the dedicated converter).
const assessment = read('src/components/teacher/AssessmentStudio.jsx')
check(/assessmentDefaultsFromParams\(searchParams\)/.test(assessment),
  'AssessmentStudio seeds its form from the lesson-kit deep link')

if (failures) {
  console.error(`\n✗ lesson-kit guard FAILED (${failures} issue(s)).`)
  process.exit(1)
}
console.log('\n✓ lesson-kit guard passed.')
