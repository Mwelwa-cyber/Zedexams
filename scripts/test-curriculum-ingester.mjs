#!/usr/bin/env node
/**
 * Curriculum Ingester — unit tests.
 *
 * Covers the pure helpers in functions/agents/learnerAi/runners/curriculumIngester.js
 *   - discoverModuleLinks: extracts hrefs, normalises to absolute,
 *     classifies kind, dedupes by URL minus fragment
 *   - parseHtml: strips script/style, preserves headings
 *   - classifyModule: grade + subject + confidence
 *   - chunkText: sliding-window chunker honours overlap + caps
 *   - embedChunks: graceful fallback when no API key
 *   - buildCurriculumDoc / buildRagChunkDocs: shapes match the
 *     manual cbc:ingest script, deterministic ids
 *
 * Run: npm run test:curriculum-ingester
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const INGESTER = join(ROOT, 'functions/agents/learnerAi/runners/curriculumIngester.js')

// The ingester lazy-requires pdf-parse + mammoth inside parseDocument().
// We don't exercise those paths here (they need real binary fixtures
// and the install footprint is non-trivial in CI). Tests below cover
// the pure HTML + classification + chunking + embedding paths.
const ing = await import(INGESTER)

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { pass++; console.log(`  ok  ${name}`) })
    .catch(err => { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) })
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'expected equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
}

console.log('\ndiscoverModuleLinks')

await test('extracts an absolute PDF link from a relative href', () => {
  const html = `<html><a href="/files/grade-7-maths.pdf">Grade 7 Mathematics</a></html>`
  const links = ing.discoverModuleLinks(html, 'https://library.cdcrepository.info/index.html')
  assertEq(links.length, 1, 'one link')
  assertEq(links[0].url, 'https://library.cdcrepository.info/files/grade-7-maths.pdf')
  assertEq(links[0].kind, 'pdf')
  assertEq(links[0].anchorText, 'Grade 7 Mathematics')
})

await test('handles multiple link kinds in one page', () => {
  const html = `
    <a href="/a.pdf">PDF</a>
    <a href="/b.docx">DOCX</a>
    <a href="/c.html">HTML</a>
    <a href="/d">extensionless</a>
  `
  const links = ing.discoverModuleLinks(html, 'https://www.edu.gov.zm/')
  const kinds = links.map(l => l.kind)
  assert(kinds.includes('pdf'))
  assert(kinds.includes('docx'))
  assert(kinds.includes('html'))
  assert(kinds.filter(k => k === 'html').length === 2, 'extensionless treated as html')
})

await test('drops mailto:, javascript:, # anchors', () => {
  const html = `
    <a href="mailto:foo@bar.com">mail</a>
    <a href="javascript:void(0)">js</a>
    <a href="#section">hash</a>
    <a href="/keep.pdf">real</a>
  `
  const links = ing.discoverModuleLinks(html, 'https://www.edu.gov.zm/')
  assertEq(links.length, 1)
  assertEq(links[0].kind, 'pdf')
})

await test('dedupes same URL with different fragments', () => {
  const html = `
    <a href="/page.html#top">Top</a>
    <a href="/page.html#bottom">Bottom</a>
    <a href="/page.html">Bare</a>
  `
  const links = ing.discoverModuleLinks(html, 'https://www.edu.gov.zm/')
  assertEq(links.length, 1)
})

await test('caps results at MAX_LINKS_PER_PAGE', () => {
  let html = ''
  for (let i = 0; i < ing.MAX_LINKS_PER_PAGE + 50; i++) {
    html += `<a href="/file-${i}.pdf">file ${i}</a>\n`
  }
  const links = ing.discoverModuleLinks(html, 'https://www.edu.gov.zm/')
  assert(links.length <= ing.MAX_LINKS_PER_PAGE,
    `must cap, got ${links.length}`)
})

await test('returns [] on invalid base URL', () => {
  const links = ing.discoverModuleLinks('<a href="x">x</a>', 'not-a-url')
  assertEq(links.length, 0)
})

console.log('\nparseHtml')

await test('strips script and style content', () => {
  const html = '<html><script>alert(1)</script><style>.x{}</style><p>hi</p></html>'
  const {text} = ing.parseHtml(html)
  assert(!/alert/.test(text), 'script body must be gone')
  assert(!/\.x\{/.test(text), 'style body must be gone')
  assert(/hi/.test(text), 'visible text must remain')
})

await test('extracts h1..h4 as headings', () => {
  const html = '<h1>Topic A</h1><p>body</p><h2>Sub</h2><h3>Deep</h3>'
  const {headings} = ing.parseHtml(html)
  assert(headings.includes('Topic A'), `got ${JSON.stringify(headings)}`)
  assert(headings.includes('Sub'))
  assert(headings.includes('Deep'))
})

console.log('\nclassifyModule')

await test('detects grade + subject from anchor text', () => {
  const c = ing.classifyModule({
    url: 'https://x/y.pdf',
    anchorText: 'Grade 7 Mathematics Syllabus',
    headings: [], firstChars: '',
  })
  assertEq(c.grade, 7)
  assertEq(c.subject, 'mathematics')
  assertEq(c.confidence, 'high')
})

await test('falls back to URL path when anchor is generic', () => {
  const c = ing.classifyModule({
    url: 'https://x/grade-5-english.pdf',
    anchorText: 'Download',
    headings: [], firstChars: '',
  })
  assertEq(c.grade, 5)
  assertEq(c.subject, 'english')
})

await test('low confidence when no signals', () => {
  const c = ing.classifyModule({
    url: 'https://x/doc.pdf',
    anchorText: 'Document',
    headings: [], firstChars: 'irrelevant body text',
  })
  assertEq(c.confidence, 'low')
  assertEq(c.grade, null)
  assertEq(c.subject, null)
})

await test('captures term when stated', () => {
  const c = ing.classifyModule({
    url: 'https://x/y.pdf',
    anchorText: 'Grade 6 Science Term 2',
    headings: [], firstChars: '',
  })
  assertEq(c.grade, 6)
  assertEq(c.subject, 'science')
  assertEq(c.term, 2)
})

console.log('\nchunkText')

await test('produces sliding-window chunks with overlap', () => {
  const text = 'a'.repeat(2500)
  const chunks = ing.chunkText(text)
  assert(chunks.length >= 2, `expected >=2 chunks, got ${chunks.length}`)
  assertEq(chunks[0].length, ing.CHUNK_SIZE)
})

await test('empty / whitespace text → empty array', () => {
  assertEq(ing.chunkText('').length, 0)
  assertEq(ing.chunkText('   ').length, 0)
  assertEq(ing.chunkText(null).length, 0)
})

await test('caps chunks at MAX_CHUNKS_PER_MODULE', () => {
  // 500 KB of distinct characters → way more than 200 chunks normally.
  const text = 'x'.repeat(ing.CHUNK_SIZE * (ing.MAX_CHUNKS_PER_MODULE + 50))
  const chunks = ing.chunkText(text)
  assert(chunks.length <= ing.MAX_CHUNKS_PER_MODULE,
    `must cap at ${ing.MAX_CHUNKS_PER_MODULE}, got ${chunks.length}`)
})

console.log('\nembedChunks (no API key → graceful fallback)')

await test('returns chunks with null embeddings when apiKey missing', async () => {
  const r = await ing.embedChunks(['hello', 'world'], null)
  assertEq(r.length, 2)
  assertEq(r[0].embedding, null)
  assertEq(r[0].text, 'hello')
})

await test('empty input → empty output', async () => {
  const r = await ing.embedChunks([], 'sk-fake')
  assertEq(r.length, 0)
})

console.log('\nbuildCurriculumDoc + buildRagChunkDocs')

await test('curriculumDocId is deterministic + 32 chars', () => {
  const a = ing.curriculumDocId({sourceUrl: 'https://x/y.pdf'})
  const b = ing.curriculumDocId({sourceUrl: 'https://x/y.pdf'})
  assertEq(a, b, 'must be deterministic for same input')
  assertEq(a.length, 32)
  const c = ing.curriculumDocId({sourceUrl: 'https://x/other.pdf'})
  assert(a !== c, 'different inputs → different ids')
})

await test('buildCurriculumDoc produces the expected shape', () => {
  const doc = ing.buildCurriculumDoc({
    sourceId: 'cdc-repository',
    sourceName: 'CDC Repository',
    sourceUrl: 'https://x/grade-7-maths.pdf',
    kind: 'pdf',
    anchorText: 'Grade 7 Maths',
    grade: 7, subject: 'mathematics', term: null,
    topic: 'Number Operations', confidence: 'high',
    byteLength: 12345, chunkCount: 4,
  })
  assert(typeof doc.id === 'string')
  assertEq(doc.data.source, 'cdc-repository')
  assertEq(doc.data.grade, 7)
  assertEq(doc.data.subject, 'mathematics')
  assertEq(doc.data.parsedFrom, 'pdf')
  assertEq(doc.data.importedBy, 'curriculumWatcher')
  assertEq(doc.data.reviewStatus, 'needs_check')
})

await test('buildRagChunkDocs ids are deterministic + namespaced', () => {
  const embedded = [
    {text: 'chunk one', embedding: [0.1, 0.2]},
    {text: 'chunk two', embedding: [0.3, 0.4]},
  ]
  const meta = {sourceId: 'cdc-repository', sourceUrl: 'https://x/y.pdf',
    grade: 7, subject: 'mathematics', term: null, topic: 'Topic',
    anchorText: 'X'}
  const cid = ing.curriculumDocId({sourceUrl: meta.sourceUrl})
  const rag = ing.buildRagChunkDocs(cid, embedded, meta)
  assertEq(rag.length, 2)
  assertEq(rag[0].id, `${cid}_0000`)
  assertEq(rag[1].id, `${cid}_0001`)
  assertEq(rag[0].data.curriculum_doc_id, cid)
  assertEq(rag[0].data.text, 'chunk one')
  assert(Array.isArray(rag[0].data.embedding))
  assertEq(rag[0].data.embedding_model, ing.EMBED_MODEL)
})

await test('null embeddings flow through without embedding_model', () => {
  const cid = ing.curriculumDocId({sourceUrl: 'https://x/y.pdf'})
  const rag = ing.buildRagChunkDocs(cid, [{text: 't', embedding: null}], {sourceId: 'x'})
  assertEq(rag.length, 1)
  assertEq(rag[0].data.embedding, null)
  assertEq(rag[0].data.embedding_model, null)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
