/**
 * Which in-app notifications this learner has already seen, per device.
 *
 * Read by GradeHub on mount and written when the panel is opened or dismissed;
 * `NotificationPanel` itself is stateless about it. Storage failures are the
 * adapter's problem — a forgotten read receipt is never worth a broken
 * dashboard.
 */
import { readArray, writeJson } from '../../../../shared/utils/safeStorage'

const NOTIFICATION_STORAGE_PREFIX = 'zedexams:notifications:seen:v1'
// Dashboard character art. WebP ships as both the <source> and the <img>
// fallback — every browser the app supports (Android Chrome 32+, iOS 14+)

function getNotificationStorageKey(userId) {
  return `${NOTIFICATION_STORAGE_PREFIX}:${userId || 'guest'}`
}

export function readSeenNotificationIds(userId) {
  return readArray(getNotificationStorageKey(userId))
}

export function writeSeenNotificationIds(userId, ids) {
  writeJson(getNotificationStorageKey(userId), ids)
}
