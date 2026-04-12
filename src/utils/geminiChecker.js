/**
 * geminiChecker.js
 *
 * Uses Google Gemini 1.5 Flash (free tier) to evaluate a student's
 * short-answer response against the expected correct answer.
 *
 * Requires:  VITE_GEMINI_API_KEY in your .env file
 * Get a free key at: https://aistudio.google.com/app/apikey
 */

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'

/**
 * Ask Gemini whether a student's answer is correct.
 *
 * @param {object} opts
 * @param {string} opts.question       - The question text
 * @param {string} opts.correctAnswer  - The expected correct answer (set by teacher)
 * @param {string} opts.studentAnswer  - What the student typed
 * @param {string} [opts.subject]      - Subject (for context)
 * @param {string} [opts.grade]        - Grade level (for context)
 *
 * @returns {Promise<{correct: boolean, feedback: string}>}
 */
export async function checkAnswerWithAI({ question, correctAnswer, studentAnswer, subject = '', grade = '' }) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY

  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY is not set. Add it to your .env file.')
  }

  if (!studentAnswer?.trim()) {
    return { correct: false, feedback: 'You did not enter an answer.' }
  }

  const prompt = `You are a helpful exam marker for Zambian primary school students${grade ? ` (Grade ${grade}` : ''}${subject ? `, ${subject})` : ')'}.

Question: "${question}"
Expected answer: "${correctAnswer}"
Student's answer: "${studentAnswer.trim()}"

Mark the student's answer as correct if it:
- Matches the expected answer (even with minor spelling mistakes)
- Uses a valid synonym or equivalent term
- Is phrased differently but conveys the same correct meaning
- Uses a correct abbreviation

Respond ONLY with valid JSON — no extra text, no markdown, just the JSON object:
{"correct": true, "feedback": "Short encouraging message (max 15 words)"}
or
{"correct": false, "feedback": "Short explanation of the correct answer (max 15 words)"}`

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature:     0.1,  // low temperature = consistent marking
        maxOutputTokens: 120,
      },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Gemini API error ${res.status}`)
  }

  const data = await res.json()
  const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''

  // Extract the JSON object from the response (strips any accidental surrounding text)
  const match = raw.match(/\{[\s\S]*?\}/)
  if (!match) throw new Error('Unexpected AI response format')

  try {
    const result = JSON.parse(match[0])
    return {
      correct:  Boolean(result.correct),
      feedback: String(result.feedback || ''),
    }
  } catch {
    throw new Error('Could not parse AI response')
  }
}
