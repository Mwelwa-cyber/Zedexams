import { getAIModel } from '../firebase/ai'

const TEXT_TIMEOUT_MS = 15000

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(Object.assign(new Error('AI_TIMEOUT'), { code: 'timeout' })),
        timeoutMs,
      )
    }),
  ])
}

function buildContents(prompt) {
  if (typeof prompt === 'string') {
    return [{ role: 'user', parts: [{ text: prompt }] }]
  }
  if (Array.isArray(prompt)) return prompt
  if (prompt && typeof prompt === 'object' && Array.isArray(prompt.parts)) {
    return [{ role: prompt.role || 'user', parts: prompt.parts }]
  }
  throw new Error('aiLogic: prompt must be a string, parts object, or contents array')
}

/**
 * Generate text with Gemini via Firebase AI Logic.
 * Returns the plain text response. Pass `model`, `systemInstruction`, or
 * `generationConfig` to override defaults.
 */
export async function generateText(prompt, options = {}) {
  const { timeoutMs = TEXT_TIMEOUT_MS, ...modelOptions } = options
  const model = getAIModel(modelOptions)
  const contents = buildContents(prompt)
  const result = await withTimeout(model.generateContent({ contents }), timeoutMs)
  return result.response.text()
}

/**
 * Stream text from Gemini. `onChunk(textChunk)` fires for each delta;
 * resolves with the full concatenated text when the stream finishes.
 */
export async function streamText(prompt, onChunk, options = {}) {
  const model = getAIModel(options)
  const contents = buildContents(prompt)
  const { stream, response } = await model.generateContentStream({ contents })
  let full = ''
  for await (const chunk of stream) {
    const text = chunk.text()
    if (text) {
      full += text
      if (typeof onChunk === 'function') onChunk(text)
    }
  }
  await response
  return full
}

/**
 * Generate a structured JSON response. Returns a parsed object — throws if
 * the model produces invalid JSON. Supply `responseSchema` to constrain shape.
 */
export async function generateJSON(prompt, options = {}) {
  const { responseSchema, generationConfig, timeoutMs = TEXT_TIMEOUT_MS, ...rest } = options
  const text = await generateText(prompt, {
    ...rest,
    timeoutMs,
    generationConfig: {
      ...generationConfig,
      responseMimeType: 'application/json',
      ...(responseSchema ? { responseSchema } : {}),
    },
  })
  return JSON.parse(text)
}
