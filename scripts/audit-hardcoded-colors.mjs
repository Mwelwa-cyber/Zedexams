#!/usr/bin/env node
/* global console, process */
/**
 * Step 1 audit — every hardcoded colour in app code, counted and TRIAGED.
 *
 * The raw count is not the useful number. A literal is correct in several
 * places, and an audit that cannot tell those apart produces a number nobody
 * can act on:
 *
 *  - THEME DEFINITIONS are where literals belong. src/index.css's palette
 *    blocks and teacherThemeCore.js / the reading-theme mirrors ARE the token
 *    values; "replace them with tokens" is circular.
 *  - EXPORT AND PRINT paths (assessmentToDocx, assessmentToPdf, htmlToPdf,
 *    the paper renderers) emit colour into a .docx or a print window. Neither
 *    has CSS custom properties, and both must stay light regardless of the
 *    teacher's screen theme — a paper prints on white paper. These are
 *    already governed by `npm run test:monochrome`.
 *  - ARTWORK — mascot and illustration SVGs — is a picture, not a surface.
 *  - CHROME FOREGROUNDS: `text-white` on a dark sidebar, hero or coloured
 *    fill is correct in every theme, because the fill under it is unchanged.
 *
 * What is left after those is the real list: neutral surfaces and inks on
 * themed app screens, which is what breaks in the dark.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const SKIP_DIR = new Set(['node_modules', 'dist', 'coverage', '.git', 'android'])
const EXT = new Set(['.jsx', '.js', '.css'])

const isTest = (p) => /\.(test|spec)\.[jt]sx?$/.test(p) || /(^|\/)(test|__tests__)\//.test(p)

// ── Exempt: a literal here is the right answer ───────────────────────────
const EXEMPT = [
  [/^src\/contexts\/(teacherTheme|readingTheme|reading-)/i, 'theme definition'],
  [/^src\/config\/(theme|palette)/i, 'theme definition'],
  [/^src\/utils\/(assessmentToDocx|assessmentToPdf|htmlToPdf|fullLessonToPdf|fullLessonToDocx|lessonPlanToPdf|lessonPlanToDocx|.*ToDocx|.*ToPdf|safeRender|paperGolden|monochrome|figureContrast|paperPagination)/i, 'export / print target'],
  [/^src\/utils\/(printable|paperContentModel|figure|diagramCatalog)/i, 'export / print target'],
  [/^src\/components\/teacher\/views\/PaperBlocks/, 'export / print target'],
  [/^src\/components\/diagrams\//, 'export / print target'],
  [/^src\/components\/ui\/(ProfessorPako|Mascot|Illustration|.*Icon)/i, 'artwork'],
  [/^src\/components\/ui\/icons/, 'artwork'],
  [/^src\/features\/visualStudio\//, 'image authoring'],
]
const exemptReason = (f) => EXEMPT.find(([re]) => re.test(f))?.[1] || null

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXT.has(extname(full))) out.push(full)
  }
  return out
}

const PATTERNS = [
  ['neutral-bg', /\b(?:dark:|hover:|focus:|group-hover:|active:|md:|sm:|lg:|xl:)*bg-(?:white|gray-\d{2,3}|slate-\d{2,3}|stone-\d{2,3}|zinc-\d{2,3}|neutral-\d{2,3}|amber-50|orange-50)\b/g],
  ['neutral-text', /\b(?:dark:|hover:|focus:|group-hover:|active:|md:|sm:|lg:|xl:)*text-(?:black|gray-\d{2,3}|slate-\d{2,3}|stone-\d{2,3}|zinc-\d{2,3}|neutral-\d{2,3})\b/g],
  ['neutral-border', /\b(?:dark:|hover:|focus:|group-hover:|active:|md:|sm:|lg:|xl:)*border-(?:white|black|gray-\d{2,3}|slate-\d{2,3}|stone-\d{2,3}|zinc-\d{2,3}|neutral-\d{2,3})\b/g],
  ['arbitrary', /\b(?:bg|text|border|from|to|via|ring|placeholder|divide)-\[#[0-9a-fA-F]{3,8}\]/g],
  ['hex', /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g],
  ['css-white', /(?:^|[\s:(,])(?:white|black)(?=[\s;,)]|$)/gm],
  ['rgb', /rgba?\(\s*\d/g],
]

const files = walk(SRC).filter((f) => !isTest(relative(ROOT, f)))
const live = []
const exempt = []
for (const file of files) {
  const rel = relative(ROOT, file)
  const raw = readFileSync(file, 'utf8')
  const counts = {}
  let total = 0
  for (const [name, re] of PATTERNS) {
    const hits = raw.match(re) || []
    if (hits.length) { counts[name] = hits.length; total += hits.length }
  }
  if (!total) continue
  const reason = exemptReason(rel)
  ;(reason ? exempt : live).push({ file: rel, total, counts, reason })
}
live.sort((a, b) => b.total - a.total)
exempt.sort((a, b) => b.total - a.total)

const sum = (rows) => rows.reduce((s, r) => s + r.total, 0)

// Which themed container each file renders inside decides how it is fixed.
const SURFACE = [
  // `GameStickerStyles` is its own row because it is the one file here that is
  // NOT exclusive to `.force-light-theme`: `GamesShell` and `QuizList` mount it
  // inside that container, but `learnerDashboard`'s GradeHub and
  // SubjectDrillDown mount it inside `.learner-game-theme`, and the stylesheet
  // carries rules for both (`.learner-game-theme .zx-card` overrides the base
  // `.zx-card`). Filing it under the force-light bucket alone would hand a
  // remediation the wrong scope — the same failure this map's dead patterns
  // cause, one file at a time instead of a whole surface.
  [/^src\/shared\/components\/GameStickerStyles/, 'learner: Games/Quizzes — BOTH .force-light-theme and .learner-game-theme'],
  [/^src\/features\/(games|quiz\/pages\/QuizList)|^src\/shared\/components\/Confetti/, 'learner: Games/Quizzes (.force-light-theme — remapped in #2027)'],
  // `.tdv2` is one themed container whose files now sit in two places: the
  // shell chrome here, and the stylesheet + tiles that both it and
  // `features/dashboardV2` use, which moved to the bottom layer in PR A of
  // the teacherShell migration; the chrome itself became a feature in PR B.
  // Same surface, same fix — one label. A regex naming a path that no longer
  // exists matches nothing and drops the surface out of the audit silently,
  // which is the failure §13 records for the other path-classified ledgers.
  [/^src\/features\/teacherShell\/|^src\/shared\/styles\/dashboardV2\.css|^src\/shared\/components\/(glassSurface\.css|GlassToolTile|BottomSheet)/, 'teacher: dashboardV2 (.tdv2 — tokenised, has is-dark)'],
  [/^src\/components\/teacher\/|^src\/features\/teacherSettings\//, 'teacher: .studio-theme'],
  [/^src\/components\/admin\//, 'admin'],
  // `src/features/quiz/` is the learner RUNTIME (runner + results); QuizList is
  // on the `.force-light-theme` row above, as it was before the migration. The
  // named `shared/components` files are the reading-assist cluster promoted out
  // of `components/quiz/` — named individually rather than by directory,
  // because that directory also holds teacher and admin chrome.
  [/^src\/components\/(dashboard|exams|lessons|papers|parent|classes|quiz)\/|^src\/features\/(lessons|notes|learnerHome|learnerSettings|quiz)\/|^src\/shared\/components\/(PassageViewer|ReadingSettings|TextToSpeechButton|ThemePreview|QuizReviewScreen|ExtraQuestionImages|ZoomableImage)/, 'learner: reading themes (body.theme-*)'],
  [/^src\/components\/(marketing|seo)\//, 'marketing (public, pinned light)'],
  [/^src\/components\/(auth|subscription|ui|layout)\//, 'shared chrome'],
]
const surfaceOf = (f) => SURFACE.find(([re]) => re.test(f))?.[1] || 'other'

const mode = process.argv[2] || 'top'
const limit = mode === 'all' ? live.length : 45

console.log(`# Step 1 — hardcoded-colour audit\n`)
console.log(`**${sum(live) + sum(exempt)} occurrences across ${live.length + exempt.length} files.**\n`)
console.log(`- **${sum(live)}** in ${live.length} files that render on a themed screen — the real list.`)
console.log(`- **${sum(exempt)}** in ${exempt.length} files where a literal is the correct answer (see below).\n`)

console.log(`## Themed screens — the files to fix\n`)
console.log('| # | File | Count | Breakdown | Surface |')
console.log('|---|------|-------|-----------|---------|')
live.slice(0, limit).forEach((r, i) => {
  const b = Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')
  console.log(`| ${i + 1} | ${r.file} | ${r.total} | ${b} | ${surfaceOf(r.file)} |`)
})
if (live.length > limit) {
  const rest = live.slice(limit)
  console.log(`\n…and ${rest.length} more files totalling ${sum(rest)} occurrences (run with \`all\`).`)
}

const roll = {}
for (const r of live) { const k = surfaceOf(r.file); roll[k] = (roll[k] || 0) + r.total }
console.log('\n## By themed surface\n')
console.log('| Surface | Occurrences | Files |')
console.log('|---------|-------------|-------|')
for (const [k, v] of Object.entries(roll).sort((a, b) => b[1] - a[1])) {
  console.log(`| ${k} | ${v} | ${live.filter((r) => surfaceOf(r.file) === k).length} |`)
}

console.log('\n## Exempt — a literal is correct here\n')
const eroll = {}
for (const r of exempt) { eroll[r.reason] = (eroll[r.reason] || 0) + r.total }
console.log('| Reason | Occurrences | Files |')
console.log('|--------|-------------|-------|')
for (const [k, v] of Object.entries(eroll).sort((a, b) => b[1] - a[1])) {
  console.log(`| ${k} | ${v} | ${exempt.filter((r) => r.reason === k).length} |`)
}
