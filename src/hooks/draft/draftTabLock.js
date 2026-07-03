/**
 * draftTabLock — cross-tab coordination for the Universal Draft Manager.
 *
 * Two tabs editing the same draft would race the `savedAt` transaction and
 * flip-flop the cloud copy. This uses a BroadcastChannel so tabs can agree on a
 * single "owner" per `(studioId, draftId)`: the newest claimant owns it, any
 * older tab becomes a "shadow" and suppresses its OWN cloud writes (local saves
 * continue, so nothing is lost). Ownership is announced with a heartbeat; if the
 * owner goes quiet (closed tab, crash) a shadow promotes itself after a timeout.
 *
 * Degrades to a permanent 'owner' no-op where BroadcastChannel is unavailable
 * (older WebViews) — in that case the `savedAt` transaction guard in
 * draftCloudSync is the safety net that still prevents a stale clobber.
 *
 * The pure decision (who owns it given the peers we've heard from) lives in
 * `resolveTabStatus` so it can be unit tested without a real BroadcastChannel.
 */

const CHANNEL = 'zedexams-draft-lock'
const HEARTBEAT_MS = 3000
const STALE_MS = 8000 // ~2.5 missed heartbeats → assume the peer is gone

/**
 * Pure owner resolution. Given my claim time and the peers I've heard from for
 * the same draft, decide whether I'm the owner. Lower `claimedAt` wins (the tab
 * that started editing first keeps ownership); ties break on `tabId` for
 * determinism. Stale peers (last heartbeat older than `staleMs`) are ignored.
 */
export function resolveTabStatus({ myTabId, myClaimedAt, peers, now, staleMs = STALE_MS }) {
  const live = (peers || []).filter((p) => p && now - p.lastSeen <= staleMs)
  for (const p of live) {
    if (p.tabId === myTabId) continue
    if (p.claimedAt < myClaimedAt) return 'shadow'
    if (p.claimedAt === myClaimedAt && p.tabId < myTabId) return 'shadow'
  }
  return 'owner'
}

function newTabId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    // fall through
  }
  return `tab-${Math.floor(performance.now())}-${Math.floor(performance.timeOrigin || 0)}`
}

/**
 * Start coordinating a draft across tabs.
 *
 * @param {{studioId:string, draftId:string, onChange:(status:'owner'|'shadow')=>void}} opts
 * @returns {{ stop:()=>void, getStatus:()=>string }}
 */
export function createTabLock({ studioId, draftId, onChange }) {
  const key = `${studioId}:${draftId}`
  const tabId = newTabId()
  const claimedAt = Date.now()
  let status = 'owner'
  const peers = new Map() // tabId -> { tabId, claimedAt, lastSeen }

  if (typeof BroadcastChannel === 'undefined') {
    // No coordination available — behave as sole owner. The cloud transaction
    // guard remains the backstop against a stale clobber.
    return { stop() {}, getStatus: () => 'owner' }
  }

  const channel = new BroadcastChannel(CHANNEL)

  function recompute() {
    const now = Date.now()
    const next = resolveTabStatus({
      myTabId: tabId,
      myClaimedAt: claimedAt,
      peers: Array.from(peers.values()),
      now,
    })
    if (next !== status) {
      status = next
      try { onChange?.(status) } catch { /* listener guard */ }
    }
  }

  function announce(type) {
    try {
      channel.postMessage({ type, key, tabId, claimedAt, ts: Date.now() })
    } catch {
      // channel closed mid-teardown — ignore
    }
  }

  channel.onmessage = (event) => {
    const msg = event?.data
    if (!msg || msg.key !== key || msg.tabId === tabId) return
    if (msg.type === 'bye') {
      peers.delete(msg.tabId)
    } else {
      peers.set(msg.tabId, { tabId: msg.tabId, claimedAt: msg.claimedAt, lastSeen: Date.now() })
      // A newcomer needs to learn we exist so it can defer to us if we're older.
      if (msg.type === 'hello') announce('heartbeat')
    }
    recompute()
  }

  announce('hello')
  const beat = setInterval(() => {
    announce('heartbeat')
    // Expire peers we haven't heard from — a closed tab stops sending.
    const now = Date.now()
    let changed = false
    for (const [id, p] of peers) {
      if (now - p.lastSeen > STALE_MS) { peers.delete(id); changed = true }
    }
    if (changed) recompute()
  }, HEARTBEAT_MS)

  return {
    stop() {
      clearInterval(beat)
      announce('bye')
      try { channel.close() } catch { /* already closed */ }
    },
    getStatus: () => status,
  }
}
