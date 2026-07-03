/**
 * Public surface of the offline-first layer. Import from here rather than the
 * individual modules so the internal layout can change without churn.
 *
 * Layers (bottom-up):
 *   • *Core.js          — pure, node-tested logic (policy, cache maths, sync
 *                         queue, storage stats, connectivity state machine)
 *   • offlineStore.js   — IndexedDB persistence (content + outbox + meta)
 *   • syncEngine.js     — connectivity-aware outbox flush with retry/dedup
 *   • contentCache.js   — cache-first get/fetch + pinning + maintenance
 *   • OfflineContext    — React provider + useOffline()
 *   • hooks/components   — useOfflineContent, useOfflineQuiz, OfflineIndicator,
 *                          StorageSettingsPanel
 */

// Policy + pure cores
export * from './offlineSecurity.js'
export * from './contentCacheCore.js'
export * from './syncQueueCore.js'
export * from './storageStatsCore.js'
export * from './connectivityCore.js'

// Runtime
export {
  getOrFetch,
  downloadForOffline,
  unpin,
  runMaintenance,
  scheduleMaintenance,
  approxSize,
} from './contentCache.js'
export {
  registerHandler,
  enqueueAction,
  subscribe as subscribeSync,
  start as startSyncEngine,
  flush as flushSync,
} from './syncEngine.js'

// React
export { OfflineProvider, useOffline } from './OfflineContext.jsx'
export { useOfflineContent } from './useOfflineContent.js'
export { useOfflineQuiz, registerQuizResultHandler } from './useOfflineQuiz.js'
export { default as OfflineIndicator } from './OfflineIndicator.jsx'
export { default as StorageSettingsPanel } from './StorageSettingsPanel.jsx'
