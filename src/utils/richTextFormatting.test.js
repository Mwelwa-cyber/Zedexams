/**
 * Tests for richTextHasFormatting — the guard the Assessment Studio uses to
 * decide whether a quick-textarea edit would destroy formatting (in which
 * case the card shows a read-only view + "edit in detail" instead).
 *
 * Run: node src/utils/richTextFormatting.test.js
 */

import { richTextHasFormatting } from './quizRichText.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

const plainDoc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const boldDoc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }] })
const fracDoc = () => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mathFraction', attrs: { num: '1', den: '2' } }] }] })

console.log('plain content → no formatting')
{
  assert(richTextHasFormatting('') === false, 'empty string')
  assert(richTextHasFormatting(null) === false, 'null')
  assert(richTextHasFormatting('What is the capital of Zambia?') === false, 'plain text')
  assert(richTextHasFormatting(plainDoc('Hello')) === false, 'plain Tiptap object')
  assert(richTextHasFormatting(JSON.stringify(plainDoc('Hello'))) === false, 'plain Tiptap JSON string')
  assert(richTextHasFormatting('<p>Hello world</p>') === false, 'HTML with only paragraphs')
  assert(richTextHasFormatting('<p>Line one</p><p>Line two<br>more</p>') === false, 'paragraphs + line breaks only')
}

console.log('\nformatted content → has formatting')
{
  assert(richTextHasFormatting(boldDoc('Hi')) === true, 'bold mark (object)')
  assert(richTextHasFormatting(JSON.stringify(boldDoc('Hi'))) === true, 'bold mark (JSON string)')
  assert(richTextHasFormatting(fracDoc()) === true, 'special math node')
  assert(richTextHasFormatting('<p>H<sub>2</sub>O</p>') === true, 'HTML with a subscript tag')
  assert(richTextHasFormatting('<p>See <strong>this</strong></p>') === true, 'HTML with bold tag')
  assert(richTextHasFormatting('<table><tr><td>x</td></tr></table>') === true, 'HTML table')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll richTextHasFormatting tests passed.')
