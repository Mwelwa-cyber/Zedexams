#!/usr/bin/env node
/**
 * audit-syllabus-word-breaks.mjs
 * ==============================
 * "Flag, don't guess" auditor for OCR word damage in the curriculum data.
 *
 * It builds a SELF-DICTIONARY from the curriculum itself — the set of tokens
 * that already appear (with their frequency). The correct spelling of a broken
 * word almost always occurs elsewhere in the same data ("matrices" appears
 * dozens of times, so "matric es" is obviously a broken "matrices"), and the
 * corpus knows the domain vocabulary a generic dictionary wouldn't (Cartesian,
 * Pythagoras, eigenvalue…). This makes the safe class evidence-based, not a guess.
 *
 * It classifies suspicious text into three buckets:
 *
 *   AUTO   — a single space INSIDE a word, where deleting it yields a token that
 *            already exists in the corpus AND at least one shard is a non-word
 *            fragment. Deterministic (only one way to rejoin) → SAFE to apply.
 *            Emitted as ready-to-paste CORRECTIONS pairs for fix-syllabus-
 *            word-spacing.mjs. Genuine two-word phrases ("in formation") are
 *            NOT proposed, because both parts are real corpus words.
 *
 *   FUSED  — a single unknown token that splits into two corpus words. The split
 *            point is a GUESS (many are ambiguous), so these are REVIEW-ONLY.
 *
 *   SPELL  — an unknown, rare token that is edit-distance 1 from a corpus word.
 *            A possible misspelling — REVIEW-ONLY (the corpus can't prove intent;
 *            only the source PDF can).
 *
 * Only AUTO is safe to apply. FUSED/SPELL are surfaced for a human (or a
 * source-PDF check) — never auto-changed, so official wording is never fabricated.
 *
 * Read-only. Writes a JSON review report to the scratch path if given, else stdout.
 *   node scripts/audit-syllabus-word-breaks.mjs [--json out.json] [--subject "Mathematics…"]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CORRECTIONS, fixSpacing } from './fix-syllabus-word-spacing.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const argVal = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null }
const JSON_OUT = argVal('--json')
const ONLY_SUBJECT = argVal('--subject')

const data = JSON.parse(readFileSync(join(ROOT, 'public/syllabi/curriculum-data.json'), 'utf8'))

// ── 1. Build the self-dictionary (token → frequency) ─────────────────────────
const freq = new Map()
const tokenize = (s) => String(s || '').split(/[^A-Za-z]+/).filter((t) => t.length >= 2)
function walkStrings(node, fn) {
  if (typeof node === 'string') return fn(node)
  if (Array.isArray(node)) return node.forEach((v) => walkStrings(v, fn))
  if (node && typeof node === 'object') for (const k of Object.keys(node)) walkStrings(node[k], fn)
}
walkStrings(data, (s) => { for (const t of tokenize(s)) freq.set(t.toLowerCase(), (freq.get(t.toLowerCase()) || 0) + 1) })

// A token counts as a real corpus WORD when it appears at least twice (genuine
// repeated vocabulary) — a broken form is almost always a one-off.
const isWord = (t) => (freq.get(String(t).toLowerCase()) || 0) >= 2
const wordFreq = (t) => freq.get(String(t).toLowerCase()) || 0

// ── 2. Scan cells, classify ──────────────────────────────────────────────────
const auto = new Map()   // "broken form" -> {fixed, freq, where}
const fused = new Map()  // token -> {split, where}
const spell = new Map()  // token -> {near, where}

function editDistance1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0; let j = 0; let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (a.length < b.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

// A token is a benign morphological variant of a corpus word when stripping a
// common suffix leaves a real word ("volumes"→"volume", "enlarged"→"enlarge").
// Such tokens are NOT misspellings and must not be flagged.
function isInflection(l) {
  for (const suf of ['s', 'es', 'ing', 'ed', 'd', 'ly', 'ies']) {
    if (l.endsWith(suf)) {
      const stem = l.slice(0, -suf.length)
      if (isWord(stem) || isWord(stem + 'e') || isWord(stem + 'y')) return true
    }
  }
  return false
}

// Candidate misspelling correction: a frequent corpus word (freq>=6) that is
// edit-distance 1 from a RARE token, excluding a mere plural/inflection
// difference (those are valid, not errors). Still low-confidence by nature.
function nearestWord(tok) {
  const l = tok.toLowerCase()
  if (isInflection(l)) return null
  let best = null; let bestF = 0
  for (const [w, f] of freq) {
    if (f < 6 || w[0] !== l[0] || Math.abs(w.length - l.length) > 1 || w === l) continue
    // Skip a plain plural/singular pairing (volume/volumes) — not a misspelling.
    if (w === l + 's' || l === w + 's' || w === l + 'es' || l === w + 'es') continue
    if (editDistance1(l, w) && f > bestF) { best = w; bestF = f }
  }
  return best
}

const SUBJECTS = ONLY_SUBJECT ? [ONLY_SUBJECT] : Object.keys(data)
for (const subject of SUBJECTS) {
  const sheets = data[subject]; if (!sheets) continue
  for (const [sheetName, sheet] of Object.entries(sheets)) {
    for (const row of sheet.rows || []) {
      if (row.type !== 'data') continue
      for (const [col, raw] of Object.entries(row.cells || {})) {
        const v = String(raw || '')
        if (!v) continue
        const where = `${subject} / ${sheetName} / ${col}`

        // (A) AUTO: adjacent letter-runs split by one space, join is a corpus word.
        const RUN = /([A-Za-z]{2,})\s([A-Za-z]{1,5})(?![A-Za-z])/g
        let m
        while ((m = RUN.exec(v)) !== null) {
          const a = m[1]; const b = m[2]
          const joined = a + b
          const brokenSpan = `${a} ${b}`
          if (fixSpacing(brokenSpan) !== brokenSpan) continue        // already handled
          if (!isWord(joined) || wordFreq(joined) < 2) continue      // join must be real vocabulary
          // The trailing shard must be a genuine NON-WORD fragment of length ≥2.
          // A single-letter shard ("the y", "are a", "to o") or a real word
          // ("in come", "are as") signals a legitimate phrase — never merge it.
          if (b.length < 2) continue
          if (isWord(b) || b.toLowerCase() === 'a' || b.toLowerCase() === 'i') continue
          if (!auto.has(brokenSpan)) auto.set(brokenSpan, { fixed: joined, freq: wordFreq(joined), where })
        }

        // (B/C): single unknown tokens.
        for (const tok of tokenize(v)) {
          const l = tok.toLowerCase()
          if (isWord(l) || wordFreq(l) >= 2 || tok.length < 5) continue
          if (tok === tok.toUpperCase()) continue                    // ALL-CAPS heading token — skip
          if (fused.has(tok) || spell.has(tok) || auto.has(tok)) continue
          // FUSED: unique split into two corpus words.
          let splits = 0; let split = null
          for (let i = 3; i <= tok.length - 3; i++) {
            const l1 = l.slice(0, i); const r1 = l.slice(i)
            if (isWord(l1) && isWord(r1) && wordFreq(l1) >= 3 && wordFreq(r1) >= 3) { splits++; split = `${tok.slice(0, i)} ${tok.slice(i)}` }
          }
          if (splits === 1) { fused.set(tok, { split, where }); continue }
          // SPELL: rare token near a frequent corpus word.
          const near = nearestWord(tok)
          if (near) spell.set(tok, { near, where })
        }
      }
    }
  }
}

// ── 3. Report ────────────────────────────────────────────────────────────────
const report = {
  corpusWords: [...freq.values()].filter((f) => f >= 2).length,
  auto: [...auto.entries()].map(([broken, x]) => ({ broken, fixed: x.fixed, joinedFreq: x.freq, where: x.where }))
    .sort((a, b) => b.joinedFreq - a.joinedFreq),
  fused: [...fused.entries()].map(([tok, x]) => ({ token: tok, suggestedSplit: x.split, where: x.where })),
  spell: [...spell.entries()].map(([tok, x]) => ({ token: tok, nearestWord: x.near, where: x.where })),
}

console.log(`\n=== Syllabus word-break audit ${ONLY_SUBJECT ? `(${ONLY_SUBJECT})` : '(all subjects)'} ===`)
console.log(`corpus vocabulary: ${report.corpusWords} words`)
console.log(`\nAUTO (safe deterministic rejoins — ${report.auto.length}) — add to CORRECTIONS:`)
for (const a of report.auto.slice(0, 60)) console.log(`  "${a.broken}": "${a.fixed}",   // ×${a.joinedFreq}  [${a.where.split(' / ')[0]}]`)
if (report.auto.length > 60) console.log(`  … and ${report.auto.length - 60} more`)
console.log(`\nFUSED (review-only, split is a guess — ${report.fused.length}):`)
for (const f of report.fused.slice(0, 25)) console.log(`  "${f.token}" → "${f.suggestedSplit}"?  [${f.where.split(' / ')[0]}]`)
if (report.fused.length > 25) console.log(`  … and ${report.fused.length - 25} more`)
console.log(`\nSPELL (review-only, possible misspelling — ${report.spell.length}):`)
for (const s of report.spell.slice(0, 25)) console.log(`  "${s.token}" ~ "${s.nearestWord}"?  [${s.where.split(' / ')[0]}]`)
if (report.spell.length > 25) console.log(`  … and ${report.spell.length - 25} more`)

if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(report, null, 2)); console.log(`\nFull report → ${JSON_OUT}`) }
console.log('\nOnly AUTO is safe to apply. FUSED/SPELL need a human or source-PDF check.')
