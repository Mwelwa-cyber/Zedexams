import { createBlankSlide, ensureEndSlide } from './lessonConstants'

const BULLET_RE = /^(\s*[-*•]\s+|\s*\d+[.)]\s+)/
const QUESTION_RE = /^(question|activity|exercise|practice|try it|quick check)\b/i
const SUMMARY_RE = /^(summary|conclusion|in summary|to sum up|remember)\b/i

function stripMarker(line) {
  return line.replace(BULLET_RE, '').replace(/^#+\s*/, '').trim()
}

function isHeading(line) {
  const clean = line.trim()
  if (!clean) return false
  if (clean.startsWith('#')) return true
  if (clean.endsWith(':') && clean.length <= 70) return true
  return clean.length <= 58 && /^[A-Z0-9][A-Za-z0-9\s,'-]+$/.test(clean) && !clean.endsWith('.')
}

function splitWords(text, size = 62) {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= size) return [text.trim()]
  const chunks = []
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(' '))
  }
  return chunks
}

function classifyBlock(block) {
  const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) return null

  let heading = ''
  let bodyLines = lines
  if (lines.length > 1 && isHeading(lines[0])) {
    heading = stripMarker(lines[0]).replace(/:$/, '')
    bodyLines = lines.slice(1)
  }

  const allBullets = bodyLines.length > 0 && bodyLines.every(line => BULLET_RE.test(line))
  const body = bodyLines.join('\n').trim()
  const first = bodyLines[0] || lines[0]

  if (allBullets) {
    return {
      kind: 'bullets',
      title: heading || 'Key Points',
      bullets: bodyLines.map(stripMarker),
    }
  }

  if (SUMMARY_RE.test(first) || SUMMARY_RE.test(heading)) {
    return {
      kind: 'summary',
      title: heading || 'Summary',
      body: body.replace(SUMMARY_RE, '').replace(/^[:\s-]+/, '').trim() || body,
    }
  }

  if (QUESTION_RE.test(first) || first.endsWith('?') || body.includes('?')) {
    const questionText = body.replace(QUESTION_RE, '').replace(/^[:\s-]+/, '').trim() || body
    return {
      kind: 'question',
      title: heading || 'Activity',
      prompt: questionText,
    }
  }

  return {
    kind: 'text',
    title: heading || '',
    body,
  }
}

export function convertQuickLessonToSlides({ title, topic, content }) {
  const safeTitle = title?.trim() || topic?.trim() || 'Quick Lesson'
  const safeTopic = topic?.trim() || 'Lesson Topic'
  const blocks = String(content ?? '')
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)

  const slides = [
    createBlankSlide('title', {
      title: safeTitle,
      subtitle: safeTopic,
      body: 'Read each slide carefully, then try the activity at the end.',
    }),
  ]

  blocks.forEach((block, blockIndex) => {
    const classified = classifyBlock(block)
    if (!classified) return

    if (classified.kind === 'bullets') {
      slides.push(createBlankSlide('bullets', {
        title: classified.title,
        bullets: classified.bullets,
      }))
      return
    }

    if (classified.kind === 'summary') {
      const summaryBullets = classified.body
        .split(/[.;]\s+/)
        .map(item => item.trim().replace(/\.$/, ''))
        .filter(item => item.length > 8)
        .slice(0, 5)

      slides.push(createBlankSlide('summary', {
        title: classified.title,
        body: classified.body,
        bullets: summaryBullets.length ? summaryBullets : ['Review the main ideas', 'Practise with the activity', 'Ask for help if something is unclear'],
      }))
      return
    }

    if (classified.kind === 'question') {
      slides.push(createBlankSlide('question', {
        title: classified.title,
        prompt: classified.prompt,
        answer: 'Teacher answer to be added.',
        explanation: 'Add a short explanation so learners can check their understanding.',
      }))
      return
    }

    splitWords(classified.body).forEach((chunk, chunkIndex) => {
      slides.push(createBlankSlide('text', {
        title: classified.title || (chunkIndex === 0 ? `Idea ${blockIndex + 1}` : 'More Detail'),
        body: chunk,
      }))
    })
  })

  if (!slides.some(slide => slide.type === 'question')) {
    slides.push(createBlankSlide('question', {
      title: 'Quick Check',
      prompt: `What is one important thing you learned about ${safeTopic}?`,
      answer: `Learners should mention one correct fact about ${safeTopic}.`,
      explanation: 'This checks that learners can recall the lesson in their own words.',
    }))
  }

  if (!slides.some(slide => slide.type === 'summary')) {
    slides.push(createBlankSlide('summary', {
      title: 'Summary',
      bullets: [
        `The lesson was about ${safeTopic}.`,
        'Each slide explained one important idea.',
        'The activity helps you practise before the quiz.',
      ],
      body: 'Review the key points before taking the quiz.',
    }))
  }

  return ensureEndSlide(slides)
}
