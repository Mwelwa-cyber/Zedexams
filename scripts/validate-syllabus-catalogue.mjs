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
 *   3. duplicate codes           — one code used by two topics in a subject
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

function auditLookup(framework, lookup) {
  const findings = {
    splitWords: [], spacing: [], duplicateCodes: [], orphans: [],
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

    for (const [code, owners] of codeOwners) {
      if (owners.length > 1) {
        findings.duplicateCodes.push({ key, topic: owners.join(' | '), detail: `code ${code} used ${owners.length}×` })
      }
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

  return { framework, findings }
}

/* ── reporting ───────────────────────────────────────────────────────────── */

const SECTIONS = [
  ['splitWords', 'Malformed titles — a word split across a space'],
  ['spacing', 'Suspicious internal spacing'],
  ['duplicateCodes', 'Duplicate topic codes within one grade+subject'],
  ['orphans', 'Orphaned nodes — a sub-topic whose parent topic is missing'],
  ['thinCoverage', 'Implausibly few topics for a grade+subject'],
  ['pageBreakDamage', 'Page-break damage the topic-tree repair absorbs'],
]

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

const reports = [
  auditLookup('2023 CBC', build2023Lookup()),
  auditLookup('2013 previous', build2013Lookup()),
]

console.log('Syllabus catalogue validation — report only, nothing is modified.')
for (const report of reports) printReport(report)

const total = reports.reduce(
  (sum, r) => sum + SECTIONS.reduce((n, [id]) => n + r.findings[id].length, 0), 0,
)
console.log(`\nTotal findings: ${total}`)
console.log(
  'Nothing here has been changed. Topic-hierarchy damage is repaired at read ' +
  'time by src/utils/syllabusTopicTree.js; the rest needs a human to correct ' +
  'the syllabus in the Syllabi Studio.\n',
)

if (STRICT && total > 0) process.exitCode = 1
