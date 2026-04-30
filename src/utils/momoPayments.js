import { auth } from '../firebase/config'

const POLL_INTERVAL_MS = 5000
const FINAL_STATES = new Set(['successful', 'failed', 'timeout'])

const ENDPOINTS = {
  initiate: {
    path: '/api/payments/momo/initiate',
    functionName: 'apiCreateMomoPayment',
  },
  status: {
    path: '/api/payments/momo/status',
    functionName: 'apiMomoPaymentStatus',
  },
}

function directFunctionUrl(functionName) {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  if (!projectId) return null
  return `https://us-central1-${projectId}.cloudfunctions.net/${functionName}`
}

function endpointUrl(key) {
  const entry = ENDPOINTS[key]
  if (!entry) throw new Error(`Unknown payment endpoint: ${key}`)

  return directFunctionUrl(entry.functionName) || entry.path
}

async function parseApiResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  const rawText = await response.text()

  if (!rawText) return {}

  if (!/application\/json/i.test(contentType)) {
    throw new Error(
      response.ok
        ? 'Payment service is not configured correctly. Please refresh or contact support.'
        : 'Payment service returned an unexpected response.',
    )
  }

  try {
    return JSON.parse(rawText)
  } catch {
    throw new Error('Payment service returned invalid JSON. Please try again.')
  }
}

async function authorizedFetch(url, options = {}) {
  const token = await auth.currentUser?.getIdToken()
  if (!token) {
    throw new Error('Please sign in before making a payment.')
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })

  const data = await parseApiResponse(response)
  if (!response.ok) {
    throw new Error(data.error || 'Payment request failed.')
  }
  return data
}

export async function initiateMomoPayment({ phoneNumber, planId, portal }) {
  return authorizedFetch(endpointUrl('initiate'), {
    method: 'POST',
    body: JSON.stringify({ phoneNumber, planId, portal }),
  })
}

export async function getMomoPaymentStatus(paymentId) {
  const url = `${endpointUrl('status')}?paymentId=${encodeURIComponent(paymentId)}`
  return authorizedFetch(url, { method: 'GET' })
}

export async function pollMomoPayment(paymentId, { onUpdate, timeoutMs = 180000 } = {}) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const update = await getMomoPaymentStatus(paymentId)
    onUpdate?.(update)

    if (FINAL_STATES.has(update.status)) {
      return update
    }

    const delay = Math.max(
      2000,
      Math.min(Number(update.nextCheckInMs) || POLL_INTERVAL_MS, 10000),
    )
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  return {
    status: 'pending',
    reason: 'The payment is still pending. You can close this window and check again shortly.',
    message: 'Still waiting for MTN. You can close this window while the server keeps checking.',
    nextCheckInMs: POLL_INTERVAL_MS,
  }
}
