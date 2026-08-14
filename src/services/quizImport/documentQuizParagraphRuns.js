// Post-pass over DOCX extraction blocks that rewrites non-table per-option
// image patterns into a synthesised image-options block.
//
// Phase 4 of the quiz-import hardening plan. Phase 3 handled the table-cell
// case ("| A. <img> | B. <img> | C. <img> | D. <img> |"); this module covers
// the linear-paragraph case where teachers lay out image options as separate
// paragraphs:
//
//   1. Which is the elephant?
//   A.
//   [image]
//   B.
//   [image]
//   C.
//   [image]
//   D.
//   [image]
//
// or
//
//   1. Which is the elephant?
//   A. [image]
//   B. [image]
//   C. [image]
//   D. [image]
//
// Without this pass, every image lands on the question stem and the per-option
// attribution is lost. The consolidator walks the linear block stream
// produced by extractDocx, recognises runs of option-letter-only paragraphs
// (with their image source either inline or in the immediately-following
// paragraph), and merges them into the most recent question stem with an
// `optionAssetsByLetter` map.
//
// The synthesised block is identical in shape to what
// documentQuizTableBlocks.tryImageOptionsRow emits, so the downstream parser
// (which already knows how to read optionAssetsByLetter, set by Phase 3)
// handles both paths without further changes.

// Matches a paragraph whose entire text is an option letter prefix.
// Accepts: "A", "A.", "A)", "(A)", "A:", "A-" and the same with lowercase.
const PARAGRAPH_OPTION_LABEL_RE = /^\(?([A-Da-d])\)?[.):-]?\s*$/

export function detectParagraphOptionLetter(text) {
  const match = String(text || '').trim().match(PARAGRAPH_OPTION_LABEL_RE)
  return match ? match[1].toUpperCase() : ''
}

// Matches a paragraph that LOOKS like a question stem — leading "1.", "1)",
// "Q1.", "Question 1.", etc. Used to find the question block a per-option
// image run attaches to.
const QUESTION_STEM_RE = /^(?:q(?:uestion)?\s*)?\d{1,3}\s*[.).:-]/i

export function looksLikeQuestionStem(text) {
  return QUESTION_STEM_RE.test(String(text || '').trim())
}

const PLACEHOLDER_LETTERS = ['A', 'B', 'C', 'D']

export function consolidateOptionImageRuns(blocks) {
  const consumed = new Set()
  // questionBlockIdx -> Map<letter, asset> the question should claim.
  const augmentations = new Map()

  let i = 0
  while (i < blocks.length) {
    if (consumed.has(i) || !detectParagraphOptionLetter(blocks[i].text)) {
      i += 1
      continue
    }

    // Walk forwards consuming consecutive option-letter blocks. For each
    // one, the image source is either the block itself (text "A." + inline
    // image) or its image-only successor paragraph ("A.", then a paragraph
    // with text="" + a single image).
    const optionAssetsByLetter = {}
    const runIndices = []
    let j = i

    while (j < blocks.length) {
      if (consumed.has(j)) break
      const candidate = blocks[j]
      const letter = detectParagraphOptionLetter(candidate.text)
      if (!letter || !PLACEHOLDER_LETTERS.includes(letter)) break
      if (optionAssetsByLetter[letter]) break

      let assetSource = candidate
      let lastIdx = j
      if (
        (!candidate.assets || candidate.assets.length === 0)
        && j + 1 < blocks.length
        && !consumed.has(j + 1)
        && !String(blocks[j + 1].text || '').trim()
        && Array.isArray(blocks[j + 1].assets) && blocks[j + 1].assets.length > 0
      ) {
        assetSource = blocks[j + 1]
        lastIdx = j + 1
      }
      if (!assetSource.assets || assetSource.assets.length === 0) break

      optionAssetsByLetter[letter] = assetSource.assets[0]
      runIndices.push(j)
      if (lastIdx !== j) runIndices.push(lastIdx)
      j = lastIdx + 1
    }

    // Need at least two letters with images for this to be a real run — a
    // single "A. <img>" line is too noisy a signal on its own (could be a
    // heading, a label, or just a typo).
    if (Object.keys(optionAssetsByLetter).length < 2) {
      i = j > i ? j : i + 1
      continue
    }

    // Walk backwards to find the question block this run belongs to. Skip
    // over image-only blocks in case the question has its own stem image
    // between itself and the option run. Any other text content breaks the
    // chain so we don't claim a run that sits between two unrelated
    // paragraphs.
    let questionIdx = -1
    for (let k = i - 1; k >= 0; k -= 1) {
      if (consumed.has(k)) continue
      const text = String(blocks[k].text || '').trim()
      if (looksLikeQuestionStem(text)) {
        questionIdx = k
        break
      }
      if (!text && Array.isArray(blocks[k].assets) && blocks[k].assets.length > 0) {
        continue
      }
      break
    }

    if (questionIdx < 0) {
      i = j > i ? j : i + 1
      continue
    }

    const existing = augmentations.get(questionIdx) || {}
    Object.entries(optionAssetsByLetter).forEach(([letter, asset]) => {
      if (!existing[letter]) existing[letter] = asset
    })
    augmentations.set(questionIdx, existing)
    runIndices.forEach(idx => consumed.add(idx))

    i = j > i ? j : i + 1
  }

  if (!consumed.size && !augmentations.size) return blocks

  const result = []
  blocks.forEach((block, idx) => {
    if (consumed.has(idx)) return
    if (augmentations.has(idx)) {
      const claimed = augmentations.get(idx)
      const placeholderLines = PLACEHOLDER_LETTERS
        .filter(letter => claimed[letter])
        .map(letter => `${letter}. (image)`)
      result.push({
        ...block,
        text: [block.text, ...placeholderLines].filter(Boolean).join('\n'),
        // Merge with any existing optionAssetsByLetter (e.g. a table row
        // contributed). Explicit run takes precedence because it matches the
        // exact paragraph the teacher wrote.
        optionAssetsByLetter: { ...(block.optionAssetsByLetter || {}), ...claimed },
      })
    } else {
      result.push(block)
    }
  })

  return result
}
