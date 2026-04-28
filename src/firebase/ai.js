import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai'
import app from './config'

const DEFAULT_MODEL = import.meta.env.VITE_FIREBASE_AI_MODEL || 'gemini-2.5-flash'

// Firebase AI Logic uses the Gemini Developer (GoogleAI) backend by default.
// Switch to VertexAIBackend in src/firebase/ai.js if the project moves to
// Vertex (also requires enabling the Vertex backend in the Firebase console).
const ai = getAI(app, { backend: new GoogleAIBackend() })

const modelCache = new Map()

export function getAIModel(options = {}) {
  const { model = DEFAULT_MODEL, ...rest } = options
  const cacheKey = JSON.stringify({ model, ...rest })
  if (!modelCache.has(cacheKey)) {
    modelCache.set(cacheKey, getGenerativeModel(ai, { model, ...rest }))
  }
  return modelCache.get(cacheKey)
}

export { ai }
export default ai
