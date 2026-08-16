/**
 * Syllabus catalogue validation report.
 *
 * Reads BOTH curriculum catalogues as the app actually parses them and reports
 * what is wrong with the source data. It is a REPORT — it never edits a
 * syllabus file. Curriculum content is the Ministry's, not ours: a title that
 * looks broken to a script may be a real heading, so every finding here is for
 * a human to confirm before anyone touches the data.
 *
 *   node scripts/validate-syllabus-catalogue.mjs            # full report
 *   node scripts/validate-syllabus-catalogue.mjs --summary  # counts only
 *   node scripts/validate-syllabus-catalogue.mjs --strict    # exit 1 if any
 *                                                            # finding remains
 *
 * Deliberately NOT registered as a `test:*` script: run-all-tests.mjs would
 * pick it up and CI would fail on curriculum data we have decided not to
 * silently rewrite. Run it by hand (or from an admin task) when the catalogue
 * changes, and act on the findings in the Syllabi Studio.
 *
 * Checks
 *   1. malformed titles          — a word split across a space ("ANIMA LS")
 *   2. suspicious spacing        — doubled spaces, spaced codes ("11. 10"),
 *                                  space before punctuation
 *   3. duplicate / conflicting   — one code used twice INSIDE one grade+subject:
 *                                  identical content (a double ingest) vs two
 *                                  different topics (needs a human). Codes
 *                                  shared across SEPARATE subjects are correct
 *                                  and are listed apart, as confirmation.
 *   4. orphaned nodes            — a sub-topic code whose parent topic is gone
 *   5. thin coverage             — a grade+subject with implausibly few topics
 *   6. page-break damage         — what the topic-tree repair had to fix, so
 *                                  the raw extent of the problem stays visible
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { extract2013TopicLookupRaw } from '../src/utils/syllabus2013Topics.js'
import { syllabiToKbTopics } from '../src/utils/syllabusMapping.js'
import { parseTopicCode, looksLikeTopicFragment, normalizeTopicTree } from '../src/utils/syllabusTopicTree.js'
import { parseLookupKey } from '../src/curriculum/resolvers/curriculumTopicIdentity.js'
// The same ascending-run detection the Commerce split uses. Here it tells apart
// "two syllabi share a subject key" from "one syllabus is laid out in numbered
// components" — see the componentSections check below.
import { sectionsByCodeReset } from '../src/utils/syllabusSubjectSplit.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const SUMMARY_ONLY = args.has('--summary')
const STRICT = args.has('--strict')

/* ── check 1: split words ────────────────────────────────────────────────── */

// Short tokens that are genuinely words, so "LIFE AND LIVING" is never read as
// a split of "LIFEAND". Everything else of 1-3 letters sitting next to another
// word is a candidate for a word the PDF extraction broke in half.
const REAL_SHORT_WORDS = new Set([
  'A', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'I', 'IF', 'IN', 'IS', 'IT',
  'ME', 'MY', 'NO', 'OF', 'ON', 'OR', 'SO', 'TO', 'UP', 'US', 'WE', 'AND',
  'ARE', 'ART', 'BUT', 'CAN', 'DAY', 'FOR', 'HOW', 'ICT', 'ITS', 'LAW', 'MAP',
  'NEW', 'NOT', 'ONE', 'OUR', 'OUT', 'OWN', 'PE', 'SET', 'SEX', 'THE', 'TWO',
  'USE', 'VIA', 'WAR', 'WAY', 'WHO', 'WHY', 'YOU', 'AIR', 'ICE', 'OIL', 'FAT',
  'GAS', 'SUN', 'EAR', 'EYE', 'ARM', 'LEG', 'JOB', 'FUN', 'HIV', 'STI', 'TB',
  'ADD', 'AGE', 'AID', 'AIM', 'BAG', 'BED', 'BOX', 'BOY', 'BUS', 'CAR', 'CAT',
  'COW', 'CUP', 'CUT', 'DOG', 'EGG', 'END', 'FIT', 'GOD', 'HEN', 'HOT', 'KEY',
  'KIT', 'LEG', 'MAN', 'MIX', 'NET', 'NUT', 'PAY', 'PEN', 'PIG', 'POT', 'RUN',
  'SEA', 'SIT', 'SKY', 'TEA', 'TIN', 'TOP', 'TOY', 'WEB', 'WET', 'ZOO',
])

function findSplitWords(title) {
  const tokens = String(title).split(/\s+/).filter(Boolean)
  const findings = []
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = tokens[i]
    const b = tokens[i + 1]
    if (!/^[A-Za-z]+$/.test(a) || !/^[A-Za-z]+$/.test(b)) continue
    // Only one of the pair may be the short half, and the two must share a
    // case style — "PLANT AND ANIMA LS" splits at ANIMA|LS, not at AND|ANIMA.
    const shortIsB = b.length <= 3 && a.length >= 4
    const shortIsA = a.length <= 3 && b.length >= 4
    if (!shortIsA && !shortIsB) continue
    const short = (shortIsB ? b : a).toUpperCase()
    if (REAL_SHORT_WORDS.has(short)) continue
    const sameCase = (a === a.toUpperCase() && b === b.toUpperCase()) ||
      (a === a.toLowerCase() && b === b.toLowerCase())
    if (!sameCase) continue
    findings.push(`${a} ${b} → ${a}${b}?`)
  }
  return findings
}

/* ── check 2: suspicious spacing ─────────────────────────────────────────── */

function findSpacingIssues(title) {
  const out = []
  const raw = String(title)
  if (/\s{2,}/.test(raw)) out.push('double space')
  if (/^\d+(?:\s*\.\s*\d+)*\s*\.\s+\d/.test(raw)) out.push('space inside the code')
  if (/\s+[,.;:]/.test(raw)) out.push('space before punctuation')
  if (raw !== raw.trim()) out.push('leading/trailing space')
  return out
}

/* ── the walk ────────────────────────────────────────────────────────────── */

// Fewer than this many topics for a whole grade+subject almost always means an
// ingestion failure rather than a genuinely short syllabus.
const THIN_COVERAGE_TOPICS = 3

/**
 * Are these two titles the SAME topic spelled differently?
 *
 * "4.3.7 SPELLINGS" / "4.3.7 SPELLING" and "LANGUAGE USE IN SOCIAL SETTING" /
 * "LANGUAGE IN A SOCIAL SETTING" are one topic ingested twice with a typo, not
 * two components of an integrated subject. Without this they look like a
 * component boundary (two ascending runs) and get waved through as legitimate.
 *
 * Word-overlap rather than string distance, because the differences are dropped
 * or reordered WORDS. Trailing "s" is folded so a plural is not a new word.
 */
function sameTopicDifferentSpelling(a, b) {
  const tokens = (t) => new Set(
      String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
          .filter(Boolean)
          .map((w) => w.replace(/s$/, '')),
  )
  const left = tokens(a)
  const right = tokens(b)
  if (left.size === 0 || right.size === 0) return false
  let shared = 0
  for (const w of left) if (right.has(w)) shared += 1
  const union = new Set([...left, ...right]).size
  return shared / union >= 0.6
}

function auditLookup(framework, lookup, sourceIndex = new Map()) {
  const findings = {
    splitWords: [], spacing: [],
    duplicateRecords: [], conflictingRecords: [], ambiguousParents: [],
    componentSections: [],
    sharedCodesAcrossSubjects: [], orphans: [],
    thinCoverage: [], pageBreakDamage: [],
  }

  for (const [key, inner] of lookup) {
    const codeOwners = new Map()   // code → the titles using it
    const presentKeys = new Set()
    // Which nesting depths this sheet actually uses. A sheet whose topic codes
    // are uniformly three deep ("1.2.1 COMPREHENSION") has no missing parent —
    // that IS its topic level. Only a sheet that uses BOTH depths can orphan a
    // node by losing the shallower one.
    const presentDepths = new Set()

    for (const topic of inner.keys()) {
      const parsed = parseTopicCode(topic)
      if (!parsed) continue
      presentKeys.add(parsed.key)
      presentDepths.add(parsed.key.split('.').length)
    }

    // Which numbered run each topic sits in. A syllabus laid out in components
    // (Grade 5 Home Economics presents Food & Nutrition, Home Management and
    // Needle Work & Crafts one after another, each starting again at 5.1) makes
    // several ascending runs inside ONE subject. That repetition is the
    // Ministry's own layout, not damage — see the componentSections check below.
    const sectionOfTopic = new Map()
    const runs = sectionsByCodeReset([...inner.keys()])
    runs.sections.forEach((labels, index) => {
      for (const label of labels) if (!sectionOfTopic.has(label)) sectionOfTopic.set(label, index)
    })

    for (const [topic, subs] of inner) {
      const parsed = parseTopicCode(topic)
      const title = parsed ? parsed.title : topic

      for (const hit of findSplitWords(title)) {
        findings.splitWords.push({ key, topic, detail: hit })
      }
      for (const issue of findSpacingIssues(topic)) {
        findings.spacing.push({ key, topic, detail: issue })
      }
      if (parsed) {
        if (!codeOwners.has(parsed.code)) codeOwners.set(parsed.code, [])
        codeOwners.get(parsed.code).push(topic)
        // A code whose parent topic is absent even though the sheet does use
        // that level elsewhere: the hierarchy repair has nowhere to put it, so
        // it stays stranded as a lone topic.
        const parentDepth = parsed.parentKey ? parsed.parentKey.split('.').length : 0
        if (parentDepth > 0 && presentDepths.has(parentDepth) &&
            !presentKeys.has(parsed.parentKey)) {
          findings.orphans.push({ key, topic, detail: `parent ${parsed.parentKey} missing` })
        }
      } else if (looksLikeTopicFragment(topic)) {
        findings.pageBreakDamage.push({
          key, topic: topic.slice(0, 70), detail: 'prose fragment in the TOPIC column',
        })
      }
      // A topic with no sub-topics at all in a numbered catalogue is usually a
      // heading that lost its rows.
      void subs
    }

    // A code used twice INSIDE one grade+subject is a real problem, but there
    // are two very different kinds and they need different actions:
    //
    //   • duplicate   — same code, same title. The row was ingested twice; one
    //                   copy can be deleted without losing anything.
    //   • conflicting — same code, DIFFERENT titles. Two distinct topics are
    //                   claiming one number, so the syllabus itself has to be
    //                   read to decide which is right. Never auto-resolvable,
    //                   and it makes any sub-topic of that code ambiguous.
    //
    // Codes repeated across SEPARATE subjects are not counted here at all —
    // that is correct numbering, and it is reported separately below.
    for (const [code, owners] of codeOwners) {
      if (owners.length < 2) continue
      const titles = new Set(owners.map((t) => {
        const parsed = parseTopicCode(t)
        return (parsed ? parsed.title : t).trim().toLowerCase().replace(/\s+/g, ' ')
      }))
      if (titles.size === 1) {
        findings.duplicateRecords.push({
          key, topic: owners[0], detail: `code ${code} ingested ${owners.length}× with identical content`,
        })
      } else {
        // Attribute each side to its source document. When they differ, this is
        // not one broken syllabus — it is two syllabi sharing a subject key.
        const docs = new Set()
        for (const owner of owners) {
          const from = sourceIndex.get(`${key}|${String(owner).trim().toLowerCase()}`)
          for (const d of (from || [])) docs.add(shortDoc(d))
        }
        // ONE document whose owners each sit in a different numbered run: these
        // are the components of an integrated subject, each numbering from
        // <grade>.1. Confirmed against the CDC source for Grade 5-7 Home
        // Economics, which carries one set of general outcomes for the whole
        // subject and then presents FOOD AND NUTRITION, HOME MANAGEMENT and
        // NEEDLE WORK AND CRAFTS as sections of it. Splitting that into separate
        // subjects would be wrong — it is one subject, taught and examined as one.
        // …unless the titles are the same topic spelled two ways, which is a
        // typo pair rather than a component boundary.
        const titleList = owners.map((t) => {
          const parsed = parseTopicCode(t)
          return parsed ? parsed.title : t
        })
        const nearDuplicate = titleList.length === 2 &&
          sameTopicDifferentSpelling(titleList[0], titleList[1])

        const runIndexes = new Set(owners.map((o) => sectionOfTopic.get(o)))
        const isComponentLayout = !nearDuplicate &&
          docs.size === 1 &&
          runs.sections.length > 1 &&
          runIndexes.size === owners.length &&
          !runIndexes.has(undefined)

        if (nearDuplicate) {
          findings.duplicateRecords.push({
            key, topic: owners.join(' | '),
            detail: `code ${code} carries the same topic spelled two ways — likely one row ingested twice`,
          })
          continue
        }

        if (isComponentLayout) {
          findings.componentSections.push({
            key, topic: owners.join(' | '),
            detail: `code ${code} repeats across ${owners.length} components of ` +
              `${Array.from(docs)[0]} — integrated subject, each component numbers from scratch`,
          })
          continue
        }

        const cause = docs.size > 1
          ? `two syllabi share this subject key (${Array.from(docs).sort().join(' + ')}) — a subject-mapping decision, like the Commerce / Principles of Accounts split`
          : 'within one syllabus — the source document has to be read'
        findings.conflictingRecords.push({
          key, topic: owners.join(' | '),
          detail: `code ${code} claimed by ${owners.length} different topics; ${cause}`,
          sharedSubjectKey: docs.size > 1,
          documents: Array.from(docs).sort(),
        })
      }
    }

    // A sub-topic whose parent code is claimed by more than one topic. The
    // hierarchy repair deliberately refuses to pick one, so the node stays at
    // the top level until a human resolves the conflicting parent above.
    const { ambiguous } = normalizeTopicTree(inner)
    for (const a of ambiguous) {
      findings.ambiguousParents.push({
        key, topic: a.topic,
        detail: `parent code ${a.parentKey} is claimed by ${a.owners.length} topics ` +
          `(${a.owners.join(' | ')}) — left unparented rather than guessed`,
      })
    }

    const { demoted } = normalizeTopicTree(inner)
    for (const d of demoted) {
      findings.pageBreakDamage.push({
        key, topic: d.topic, detail: `sub-topic promoted to a topic (belongs under "${d.parent}")`,
      })
    }

    const realTopics = normalizeTopicTree(inner).topics.size
    if (realTopics < THIN_COVERAGE_TOPICS) {
      findings.thinCoverage.push({ key, topic: '', detail: `${realTopics} topic(s) only` })
    }
  }

  // ── Legitimate identical codes across SEPARATE subjects ─────────────────
  // "1.1" appearing in both Commerce and Principles of Accounts is correct: a
  // code is only ever unique within one curriculum + grade + subject. This used
  // to be counted as 124 duplicate-code findings because the two syllabi shared
  // a subject key. It is now reported as what it is — confirmation the split
  // holds — and is NOT a problem to fix.
  const codesByGradeCode = new Map() // "GRADE|code" → Set<subject>
  for (const [key, inner] of lookup) {
    const { gradeId, subjectKey } = parseLookupKey(key)
    for (const topic of inner.keys()) {
      const parsed = parseTopicCode(topic)
      if (!parsed) continue
      const k = `${gradeId}|${parsed.code}`
      if (!codesByGradeCode.has(k)) codesByGradeCode.set(k, new Set())
      codesByGradeCode.get(k).add(subjectKey)
    }
  }
  for (const [k, subjects] of codesByGradeCode) {
    if (subjects.size < 2) continue
    const [gradeId, code] = k.split('|')
    findings.sharedCodesAcrossSubjects.push({
      key: gradeId, topic: '',
      detail: `code ${code} used by ${subjects.size} separate subjects ` +
        `(${Array.from(subjects).sort().join(', ')}) — correct, each numbers from scratch`,
    })
  }

  return { framework, findings }
}

/* ── reporting ───────────────────────────────────────────────────────────── */

// Ordered worst-first. The last entry is deliberately NOT a problem — see
// PROBLEM_SECTIONS below, which is what --strict and the totals count.
const SECTIONS = [
  ['conflictingRecords', 'CONFLICTING records — one code, different topics (needs the syllabus read)'],
  ['duplicateRecords', 'Duplicate records — one code, identical content (a double ingest)'],
  ['ambiguousParents', 'Unparented sub-topics — their parent code is claimed twice'],
  ['splitWords', 'Malformed titles — a word split across a space'],
  ['spacing', 'Suspicious internal spacing'],
  ['orphans', 'Orphaned nodes — a sub-topic whose parent topic is missing'],
  ['thinCoverage', 'Implausibly few topics for a grade+subject'],
  ['pageBreakDamage', 'Page-break damage the topic-tree repair absorbs'],
  ['sharedCodesAcrossSubjects', 'Identical codes across SEPARATE subjects — legitimate, no action'],
  ['componentSections', 'Repeated codes across COMPONENTS of one integrated subject — legitimate, no action'],
]

// Everything except the legitimate-sharing section. A code shared by two
// different subjects is correct numbering, so counting it as a finding would
// make the report permanently red for no reason.
const PROBLEM_SECTIONS = SECTIONS
    .map(([id]) => id)
    .filter((id) => id !== 'sharedCodesAcrossSubjects' && id !== 'componentSections')

function printReport(report) {
  console.log(`\n══ ${report.framework} curriculum ══`)
  for (const [id, heading] of SECTIONS) {
    const rows = report.findings[id]
    console.log(`\n  ${heading}: ${rows.length}`)
    if (SUMMARY_ONLY || rows.length === 0) continue
    for (const r of rows) {
      console.log(`    ${r.key.padEnd(30)} ${r.topic ? `“${r.topic}” ` : ''}— ${r.detail}`)
    }
  }
}

/**
 * "GRADE|subject|topic" → the syllabus DOCUMENTS that topic came from.
 *
 * Without this, a conflicting code reads as a flaw in one syllabus when it is
 * often two syllabi sharing a subject key — the same fault the Commerce /
 * Principles of Accounts split fixed. Naming the documents is the difference
 * between "someone must read the syllabus" and "someone must decide a subject
 * mapping", which are very different jobs.
 */
function buildSourceIndex() {
  const index = new Map()
  const add = (grade, subject, topic, doc) => {
    const key = `${String(grade).toUpperCase()}|${String(subject).toLowerCase()}|${String(topic).trim().toLowerCase()}`
    if (!index.has(key)) index.set(key, new Set())
    index.get(key).add(doc)
  }

  const raw2023 = JSON.parse(readFileSync(path.join(ROOT, 'public/syllabi/curriculum-data.json'), 'utf8'))
  for (const [docTitle, sheets] of Object.entries(raw2023)) {
    for (const topic of syllabiToKbTopics({ [docTitle]: sheets })) {
      add(topic.grade, topic.subject, topic.topic, docTitle)
    }
  }
  const raw2013 = JSON.parse(readFileSync(path.join(ROOT, 'public/syllabi/curriculum-data-2013.json'), 'utf8'))
  for (const [docTitle, sheets] of Object.entries(raw2013)) {
    for (const [key, inner] of extract2013TopicLookupRaw({ [docTitle]: sheets })) {
      const [grade, subject] = String(key).split('|')
      for (const topic of inner.keys()) add(grade, subject, topic, docTitle)
    }
  }
  return index
}

/** Short document label for a report line ("Mathematics II"). */
function shortDoc(title) {
  return String(title).replace(/\s*Syllab(?:us|i)\s*\([^)]*\)\s*$/i, '').trim()
}

function build2013Lookup() {
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'public/syllabi/curriculum-data-2013.json'), 'utf8'))
  return extract2013TopicLookupRaw(raw)
}

function build2023Lookup() {
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'public/syllabi/curriculum-data.json'), 'utf8'))
  const byKey = new Map()
  for (const t of syllabiToKbTopics(raw)) {
    const grade = String(t.grade || '').toUpperCase()
    const subject = String(t.subject || '').toLowerCase()
    const topic = String(t.topic || '').trim()
    if (!grade || !subject || !topic) continue
    const key = `${grade}|${subject}`
    if (!byKey.has(key)) byKey.set(key, new Map())
    const inner = byKey.get(key)
    if (!inner.has(topic)) inner.set(topic, new Set())
    for (const s of (t.subtopics || [])) {
      const name = typeof s === 'string' ? s : (s && s.name) || ''
      if (String(name).trim()) inner.get(topic).add(String(name).trim())
    }
  }
  return byKey
}

const sourceIndex = buildSourceIndex()
const reports = [
  auditLookup('2023 CBC', build2023Lookup(), sourceIndex),
  auditLookup('2013 previous', build2013Lookup(), sourceIndex),
]

console.log('Syllabus catalogue validation — report only, nothing is modified.')
for (const report of reports) printReport(report)

const total = reports.reduce(
  (sum, r) => sum + PROBLEM_SECTIONS.reduce((n, id) => n + r.findings[id].length, 0), 0,
)
const legitimate = reports.reduce(
  (sum, r) => sum + r.findings.sharedCodesAcrossSubjects.length, 0,
)
const components = reports.reduce(
  (sum, r) => sum + r.findings.componentSections.length, 0,
)
console.log(`\nTotal findings: ${total}`)
console.log(
  `Plus ${legitimate} identical-code groups across separate subjects and ` +
  `${components} across components of one integrated subject — both correct ` +
  'numbering, counted as findings by neither the total nor --strict.',
)
console.log(
  'Nothing here has been changed. Topic-hierarchy damage is repaired at read ' +
  'time by src/utils/syllabusTopicTree.js; the rest needs a human to correct ' +
  'the syllabus in the Syllabi Studio.\n',
)

if (STRICT && total > 0) process.exitCode = 1
