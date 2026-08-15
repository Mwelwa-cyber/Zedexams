/**
 * Plain-node tests for the compact lesson-plan renderer (§4, and the layout
 * half of §2.3 / §2.4 / §4.6 / §4.7).
 *
 * These are written against the spec's acceptance criteria rather than against
 * the markup, so a later refactor of the HTML is free as long as the printed
 * document still obeys the rules.
 *
 * Run: node src/components/teacher/studio/utils/renderPlanHtml.test.js
 *      (npm run test:lesson-render)
 */

import assert from 'node:assert/strict'
import { renderPlanHtml, PROGRESSION_WIDTHS } from './renderPlanHtml.js'
import { resolveLessonFormat } from '../../utils/lessonPlanFormat.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// The spec's reference case: Grade 4 Science, 4.1.1 The Respiratory System.
const CBC_PLAN = {
  generalCompetences: ['Communication', 'Analytical Thinking', 'Collaboration'],
  specificCompetence: '4.1.1.1 Demonstrate understanding of the respiratory system.',
  lessonGoal: 'Identify the main parts of the respiratory system.',
  rationale: 'Learners study the nose, trachea, bronchi and lungs. This is lesson 1 in a series of 4.',
  priorKnowledge: 'Learners know humans breathe.',
  references: ['CDC Grade 4 Integrated Science Syllabus, Topic 4.1 p.18', 'Teaching Module 4.1.1 p.24'],
  learningEnvironment: {
    natural: 'Not applicable for this lesson.',
    artificial: 'Classroom with chalkboard, chalk, exercise books and shared textbooks.',
    technological: 'Not applicable for this lesson.',
  },
  materials: ['Chalkboard and chalk', 'Exercise books', 'Hand-drawn chart'],
  expectedStandard: 'Understanding of the respiratory system demonstrated satisfactorily.',
  stages: [
    { name: 'INTRODUCTION', duration: '5 min', teacher: 'Learners place a hand on the chest.', pupils: 'Breathe, feel chest movement.', assessment: 'States that air enters the body.' },
    { name: 'LESSON DEVELOPMENT — Activity 1', duration: '12 min', teacher: 'Draw and label nose, trachea, bronchi, lungs.', pupils: 'Study diagrams in pairs.', assessment: 'Names three parts.' },
    { name: 'EXERCISE / ASSESSMENT', duration: '10 min', teacher: 'Learners draw and label the system.', pupils: 'Draw, label and write.', assessment: 'Diagram with three parts labelled.' },
    { name: 'HOMEWORK', duration: '2 min', teacher: 'Ask an adult about breathing problems.', pupils: 'Record the task.', assessment: 'Task written correctly.' },
    { name: 'CONCLUSION', duration: '3 min', teacher: 'Point to each part.', pupils: 'Name parts.', assessment: 'Names all four parts.' },
  ],
  remedialWork: 'Re-teach labelling with a partial diagram.',
  extensionActivity: 'Write a short paragraph on Asthma.',
}

const OBC_PLAN = {
  specificOutcomes: ['Add whole numbers with sums up to 100 000.'],
  prerequisiteKnowledge: 'Learners have knowledge of addition.',
  rationale: 'Addition with regrouping builds on place value.',
  references: ['Grade 3 Mathematics Syllabus'],
  materials: ['Chart'],
  stages: [
    { name: 'Introduction', duration: '10 min', teacher: 'What is the place value of the underlined digits?', pupils: '7 tens; 8 thousands.', learningPoint: 'Mentioning the place value.' },
    { name: 'Lesson Development', duration: '20 min', teacher: 'Demonstrate adding with regrouping:\n#sum: 38677 + 11314', pupils: 'Work in groups.\n#expand: 38677', learningPoint: 'Adding according to the place value.' },
    { name: 'Conclusion', duration: '10 min', teacher: 'Ask a learner to solve on the board.', pupils: 'Solves on the board.', learningPoint: 'Adding according to the place value.' },
  ],
  homework: 'Expand and add 16 592 + 1 701.',
}

const META = {
  format: 'classic',
  school: 'Jemareen Academy',
  teacherName: 'Mahenga Mwelwa',
  grade: 'Grade 4',
  subject: 'Science',
  topic: '4.1 The Human Body',
  subtopic: '4.1.1 The Respiratory System',
  date: '2026-07-30',
  duration: 40,
  learningEnvironments: ['Artificial'],
  lessonFormat: resolveLessonFormat({ pageBudget: '2' }),
}

const render = (plan = CBC_PLAN, meta = {}, mode = 'cbc') =>
  renderPlanHtml(plan, { ...META, ...meta }, mode)

console.log('\n§2.3 learning environment')
check('exactly one LEARNING ENVIRONMENT line in Simple mode', () => {
  const html = render()
  assert.equal((html.match(/LEARNING ENVIRONMENT/g) || []).length, 1)
  assert.match(html, /LEARNING ENVIRONMENT:<\/b>\s*Classroom/)
})
check('no "Not applicable" text anywhere, in any mode or curriculum', () => {
  for (const display of ['simple', 'detailed']) {
    for (const layout of ['modern', 'classic', 'official']) {
      const html = render(CBC_PLAN, {
        format: layout,
        lessonFormat: resolveLessonFormat({ pageBudget: '2', environmentDisplay: display }),
      })
      assert.doesNotMatch(html, /not applicable/i, `${layout}/${display}`)
    }
  }
})
check('the unselected Natural and Technological categories never print', () => {
  const html = render()
  assert.doesNotMatch(html, /I\.\s*<?b?>?Natural/i)
  assert.doesNotMatch(html, /Technological/i)
})
check('Detailed mode names the category and its description', () => {
  const html = render(CBC_PLAN, {
    lessonFormat: resolveLessonFormat({ pageBudget: '2', environmentDisplay: 'detailed' }),
  })
  assert.match(html, /LEARNING ENVIRONMENT \(ARTIFICIAL\)/)
  assert.match(html, /chalkboard/)
})

console.log('\n§4.1 progression table')
check('no mid-word break is possible in the STAGES column', () => {
  const html = render()
  // The rule travels with the markup, not only in lesson.css — the same HTML is
  // rendered by the library's saved-plan frame and pasted into the print window.
  assert.match(html, /class="stage"[^>]*hyphens:none/)
  assert.match(html, /class="stage"[^>]*overflow-wrap:normal/)
  assert.match(html, /class="stage"[^>]*word-break:normal/)
  assert.match(html, new RegExp(`width:${PROGRESSION_WIDTHS.stage}%`))
})
check('stage names break on their own separators, never mid-word', () => {
  const html = render()
  // "EXERCISE / ASSESSMENT" breaks after the slash…
  assert.match(html, /EXERCISE \/<br>ASSESSMENT/)
  // …and "LESSON DEVELOPMENT — Activity 1" on the em dash.
  assert.match(html, /LESSON DEVELOPMENT<br>Activity 1/)
  // A single word is never split.
  assert.match(html, />HOMEWORK</)
})
check('the four columns use the specified widths', () => {
  const html = render()
  const w = PROGRESSION_WIDTHS
  assert.deepEqual([w.stage, w.teacher, w.learner, w.assessment], [18, 34, 26, 22])
  assert.equal(w.stage + w.teacher + w.learner + w.assessment, 100)
  for (const pct of Object.values(w)) assert.match(html, new RegExp(`width:${pct}%`))
  assert.match(html, /table-layout:fixed/)
})
check('cells carry dash lines, never bullet lists', () => {
  const html = render()
  assert.match(html, /class="li"/)
  assert.match(html, /&ndash;/)
  assert.doesNotMatch(html, /<ul|<ol|<li>/)
})
check('the table header row repeats and the metadata block renders once', () => {
  const html = render()
  assert.equal((html.match(/<thead>/g) || []).length, 1)
  assert.equal((html.match(/class="meta[ "]/g) || []).length, 1)
  assert.equal((html.match(/LESSON PROGRESSION/g) || []).length, 1)
})

console.log('\n§4.3 header')
check('the header carries no horizontal rules', () => {
  const html = render()
  const head = html.slice(0, html.indexOf('class="meta'))
  assert.doesNotMatch(head, /border-top|border-bottom|<hr/)
})
check('labels are underlined, values are not', () => {
  const html = render()
  assert.match(html, /<b>Name of Teacher:<\/b>/)
  assert.match(html, /<span class="val">Mahenga Mwelwa<\/span>/)
})
check('label and value never separate — sub-topic keeps its value', () => {
  const html = render()
  assert.match(html, /<b>Sub-Topic:<\/b>\s*<span class="val">4\.1\.1 The Respiratory System<\/span>/)
})
check('the pupil-count blanks sit with their labels', () => {
  const html = render()
  assert.match(html, /<b>No of pupils:<\/b>\s*<span class="val">B: _+/)
})
check('School header prints the school alone', () => {
  const html = render()
  assert.match(html, /class="school">Jemareen Academy</)
  assert.doesNotMatch(html, /MINISTRY OF EDUCATION/)
})
check('Ministry header prints the ministry above the school', () => {
  const html = render(CBC_PLAN, {
    lessonFormat: resolveLessonFormat({ pageBudget: '2', headerStyle: 'ministry' }),
  })
  assert.match(html, /class="ministry">MINISTRY OF EDUCATION</)
  assert.ok(html.indexOf('MINISTRY OF EDUCATION') < html.indexOf('Jemareen Academy'))
})
check('the ministry wording stays editable', () => {
  const html = render(CBC_PLAN, {
    lessonFormat: resolveLessonFormat({
      pageBudget: '2', headerStyle: 'ministry', ministryLine: 'Ministry of General Education',
    }),
  })
  assert.match(html, /MINISTRY OF GENERAL EDUCATION/)
})

console.log('\n§4.4 single-line sections')
check('References print as one comma/semicolon-separated line', () => {
  const html = render()
  assert.match(html, /<b>REFERENCES:<\/b> CDC Grade 4 Integrated Science Syllabus, Topic 4\.1 p\.18; Teaching Module 4\.1\.1 p\.24/)
})
check('Materials and Competences print as one line each', () => {
  const html = render()
  assert.match(html, /<b>MATERIALS:<\/b> Chalkboard and chalk, Exercise books, Hand-drawn chart/)
  assert.match(html, /<b>GENERAL COMPETENCES:<\/b> Communication, Analytical Thinking, Collaboration/)
})

console.log('\n§4.5 lesson evaluation')
check('one ruled line per field, no underscore runs', () => {
  const html = render()
  const evalBlock = html.slice(html.indexOf('LESSON EVALUATION'))
  assert.equal((evalBlock.match(/class="rule"/g) || []).length, 3)
  // The old rendering was two ~58-underscore rows per field. A run of
  // underscores is one unbreakable "word", so it wrapped unpredictably and cost
  // about a third of a page for three fields.
  assert.doesNotMatch(evalBlock, /_{20,}/)
})
check('the evaluation can be switched off entirely', () => {
  const html = render(CBC_PLAN, {
    lessonFormat: resolveLessonFormat({ pageBudget: '2', sections: { lessonEvaluation: false } }),
  })
  assert.doesNotMatch(html, /LESSON EVALUATION/)
})

console.log('\n§2.4 optional sections')
check('a switched-off section prints nothing, not an empty label', () => {
  const html = render(CBC_PLAN, {
    lessonFormat: resolveLessonFormat({
      pageBudget: '2',
      sections: { rationale: false, references: false, expectedStandard: false },
    }),
  })
  assert.doesNotMatch(html, /RATIONALE/)
  assert.doesNotMatch(html, /REFERENCES/)
  assert.doesNotMatch(html, /EXPECTED STANDARD/)
  assert.match(html, /LESSON GOAL/)
})
check('the 1-page budget drops rationale, remedial and extension by default', () => {
  const html = render(CBC_PLAN, { lessonFormat: resolveLessonFormat({ pageBudget: '1' }) })
  assert.doesNotMatch(html, /RATIONALE/)
  assert.doesNotMatch(html, /REMEDIAL WORK/)
  assert.doesNotMatch(html, /EXTENSION ACTIVITY/)
})
check('switching off the homework row removes the row, not just its text', () => {
  const html = render(CBC_PLAN, {
    lessonFormat: resolveLessonFormat({ pageBudget: '2', sections: { homework: false } }),
  })
  assert.doesNotMatch(html, />HOMEWORK</)
  assert.match(html, />CONCLUSION</)
})

console.log('\n§4.6 OBC parity')
check('an OBC plan uses the OBC column headings', () => {
  const html = renderPlanHtml(OBC_PLAN, { ...META, format: 'classic' }, 'previous')
  assert.match(html, /STAGE\/TIME/)
  assert.match(html, /TEACHER'S ACTIVITY/)
  assert.match(html, /LEARNER'S ACTIVITY/)
  assert.match(html, /LEARNING POINT/)
  assert.doesNotMatch(html, /ASSESSMENT CRITERIA/)
})
check('an OBC plan uses the OBC field set, not relabelled CBC', () => {
  const html = renderPlanHtml(OBC_PLAN, { ...META, format: 'classic' }, 'previous')
  assert.match(html, /SPECIFIC OUTCOMES/)
  assert.match(html, /PRE-REQUISITE/)
  assert.match(html, /<b>Grade:<\/b>/)
  assert.match(html, /Learning\/T Aids/)
  assert.match(html, /<b>Reference:<\/b>/)
  assert.doesNotMatch(html, /GENERAL COMPETENCES/)
  assert.doesNotMatch(html, /SPECIFIC COMPETENCE:/)
  assert.doesNotMatch(html, /EXPECTED STANDARD/)
  assert.doesNotMatch(html, /<b>Class:<\/b>/)
})
check('an OBC plan ends in EVALUATION and LESSON LEARNT', () => {
  const html = renderPlanHtml(OBC_PLAN, { ...META, format: 'classic' }, 'previous')
  assert.match(html, /<b>EVALUATION:<\/b>/)
  assert.match(html, /<b>LESSON LEARNT:<\/b>/)
  assert.doesNotMatch(html, /Successes/)
  assert.doesNotMatch(html, /Way forward/)
})
check('every compactness rule applies identically to OBC', () => {
  const html = renderPlanHtml(OBC_PLAN, { ...META, format: 'classic' }, 'previous')
  assert.match(html, /class="li"/)
  assert.doesNotMatch(html, /<ul|<ol/)
  assert.doesNotMatch(html, /_{20,}/)
  assert.match(html, new RegExp(`width:${PROGRESSION_WIDTHS.stage}%`))
})
check('all three format choices render the same OBC document', () => {
  const a = renderPlanHtml(OBC_PLAN, { ...META, format: 'modern' }, 'previous')
  const b = renderPlanHtml(OBC_PLAN, { ...META, format: 'classic' }, 'previous')
  const c = renderPlanHtml(OBC_PLAN, { ...META, format: 'official' }, 'previous')
  assert.equal(a, b)
  assert.equal(b, c)
})

console.log('\n§4.7 structured cell content')
check('a worked column sum renders as an aligned table inside the cell', () => {
  const html = renderPlanHtml(OBC_PLAN, { ...META, format: 'classic' }, 'previous')
  assert.match(html, /class="lp-sum"/)
  assert.match(html, /TTh/)
  assert.doesNotMatch(html, /#sum:/)
})
check('expanded notation renders as its parts, not the notation', () => {
  const html = renderPlanHtml(OBC_PLAN, { ...META, format: 'classic' }, 'previous')
  assert.match(html, /30 000 \+ 8 000 \+ 600 \+ 70 \+ 7/)
  assert.doesNotMatch(html, /#expand:/)
})
check('a matching block renders line art and the joining space', () => {
  const plan = {
    ...CBC_PLAN,
    stages: [{ name: 'DEVELOPMENT', duration: '15 min', teacher: 'Spread objects on the mat.', pupils: '#match: ball|star, cup|spoon', assessment: 'Matches three pairs.' }],
  }
  const html = render(plan)
  assert.match(html, /class="lp-match"/)
  assert.match(html, /<svg /)
  assert.match(html, /Draw a line to match/)
  assert.doesNotMatch(html, /#match:/)
})

console.log('\nfield-family tolerance')
check('a plan carrying only the exporter array fields still fills its cells', () => {
  // planShape gives a studio plan both families; a plan arriving from the
  // library or an export shape may carry only the arrays. Reading one family
  // and rendering an empty cell for the other is the failure planShape exists
  // to prevent.
  const arrayOnly = {
    stages: [{
      name: 'INTRODUCTION',
      durationMinutes: 5,
      teacherActivities: ['Show objects'],
      learnerActivities: ['Observe and name'],
      assessmentCriteria: ['Names two objects'],
    }],
  }
  const html = render(arrayOnly)
  assert.match(html, /Show objects/)
  assert.match(html, /Observe and name/)
  assert.match(html, /Names two objects/)
})
check('an OBC plan falls back to the CBC name for LEARNING POINT', () => {
  const html = renderPlanHtml(
    { stages: [{ name: 'Introduction', teacher: 'Ask.', pupils: 'Answer.', assessmentCriteria: ['Naming the place value.'] }] },
    { ...META, format: 'classic' },
    'previous',
  )
  assert.match(html, /Naming the place value\./)
})

console.log('\nteaching illustration')
check('a standalone lessonDiagram prints in the preview and the PDF', () => {
  const html = render({ ...CBC_PLAN, lessonDiagram: { url: 'https://x/y.png?a=1&b=2', prompt: 'Respiratory system' } })
  assert.match(html, /TEACHING ILLUSTRATION/)
  assert.match(html, /<img /)
  // The & in a Storage query string must be escaped inside the attribute.
  assert.match(html, /a=1&amp;b=2/)
  assert.match(html, /Respiratory system/)
})
check('it is not printed twice when the same image is attached to a stage', () => {
  const url = 'https://x/y.png'
  const html = render({
    ...CBC_PLAN,
    lessonDiagram: { url, prompt: 'Lungs' },
    diagrams: [{ url, stage: 'INTRODUCTION', caption: 'Lungs' }],
  })
  assert.equal((html.match(/<img /g) || []).length, 1)
  assert.doesNotMatch(html, /TEACHING ILLUSTRATION/)
})
check('a plan with no drawing prints no figure', () => {
  assert.doesNotMatch(render(), /<img /)
})

console.log('\nregression guards')
check('a plan with no stages still renders the five official rows', () => {
  const html = render({ lessonGoal: 'x' })
  for (const stage of ['INTRODUCTION', 'CONCLUSION']) assert.match(html, new RegExp(stage))
})
check('non-object input renders nothing rather than throwing', () => {
  assert.equal(renderPlanHtml(null, META, 'cbc'), '')
  assert.equal(renderPlanHtml('nope', META, 'cbc'), '')
})
check('a plan saved before Page Budget existed still renders', () => {
  const html = renderPlanHtml(CBC_PLAN, {
    format: 'classic', school: 'S', showReflection: true, compactMeta: true,
  }, 'cbc')
  assert.match(html, /LESSON PROGRESSION/)
  assert.match(html, /LESSON EVALUATION/)
})
check('a legacy plan whose evaluation was off keeps it off', () => {
  const html = renderPlanHtml(CBC_PLAN, { format: 'classic', showReflection: false }, 'cbc')
  assert.doesNotMatch(html, /LESSON EVALUATION/)
})
check('content is escaped', () => {
  const html = render({ ...CBC_PLAN, lessonGoal: '<script>alert(1)</script>' })
  // No form of a script tag opening may survive (covers <script>, <script >,
  // <script foo=…>), and the escaped text must be what actually renders.
  assert.ok(!html.toLowerCase().includes('<script'), 'no raw script tag survives')
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'goal was HTML-escaped')
})

console.log(`\n✅ renderPlanHtml — ${passed} checks passed\n`)
