export const FIRESTORE_READ_TIMEOUT_MS = 2500

export function withFirestoreReadTimeout(promise, label, timeoutMs = FIRESTORE_READ_TIMEOUT_MS) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`)
      error.code = 'client/read-timeout'
      reject(error)
    }, timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

export function isFirestoreReadTimeout(error) {
  return error?.code === 'client/read-timeout'
}

export function describeFirestoreReadError(error) {
  if (isFirestoreReadTimeout(error)) return error.message
  return error?.code || error?.message || 'unknown Firestore read error'
}
