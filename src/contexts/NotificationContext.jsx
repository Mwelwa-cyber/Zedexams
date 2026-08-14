import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from './AuthContext'
import { useToast } from '../shared/components/Toast'
import { onForegroundMessage } from '../utils/fcm'

/**
 * NotificationContext — the client side of the Smart Notification System.
 *
 * Subscribes (live) to the newest page of the signed-in user's notification
 * feed at notifications/{uid}/feed, exposes an exact unread count, pagination
 * for older notifications, and the read / delete mutations the Notification
 * Center calls. Notifications themselves are written server-side by the
 * createNotification Cloud Function — the client only ever flips read/readAt or
 * deletes (matching firestore.rules), it never creates.
 *
 * Mounted in src/main.jsx inside AuthProvider + ToastProvider.
 */

const PAGE_SIZE = 20
// Cap bulk mark-all / delete-all so a single op stays inside one Firestore
// batch. The archival cron keeps per-user volume well under this.
const BULK_CAP = 450

const NotificationContext = createContext(null)

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    throw new Error('useNotifications must be used within a <NotificationProvider> (src/main.jsx)')
  }
  return ctx
}

function dedupeById(list) {
  const seen = new Set()
  const out = []
  for (const n of list) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
  }
  return out
}

export function NotificationProvider({ children }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const uid = currentUser?.uid || null

  // The live first page (newest PAGE_SIZE) and any older pages appended via
  // loadMore. Kept separate so a live update to the first page never wipes the
  // older docs the user already scrolled into.
  const [livePage, setLivePage] = useState([])
  const [olderPages, setOlderPages] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [open, setOpen] = useState(false)

  const liveCursorRef = useRef(null) // last QueryDocumentSnapshot of live page
  const olderCursorRef = useRef(null) // last QueryDocumentSnapshot loaded so far
  const unreadTimerRef = useRef(null)

  // Live subscription to the newest page.
  useEffect(() => {
    if (!uid) {
      setLivePage([])
      setOlderPages([])
      setUnreadCount(0)
      setLoading(false)
      setHasMore(false)
      liveCursorRef.current = null
      olderCursorRef.current = null
      return undefined
    }
    setLoading(true)
    const q = query(
      collection(db, 'notifications', uid, 'feed'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLivePage(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        liveCursorRef.current = snap.docs[snap.docs.length - 1] || null
        // Only the first page can grow the "load more" affordance until the
        // user paginates; once they do, olderCursorRef drives it.
        if (!olderCursorRef.current) setHasMore(snap.size === PAGE_SIZE)
        setLoading(false)
      },
      (err) => {
        console.warn('[notifications] feed subscribe failed:', err)
        setLoading(false)
      },
    )
    return () => unsub()
  }, [uid])

  const notifications = useMemo(
    () => dedupeById([...livePage, ...olderPages]),
    [livePage, olderPages],
  )

  // Exact unread count via a server-side aggregation, debounced and refreshed
  // whenever the live page moves (a cheap signal that something changed).
  const refreshUnread = useCallback(() => {
    if (!uid) return
    if (unreadTimerRef.current) clearTimeout(unreadTimerRef.current)
    unreadTimerRef.current = setTimeout(async () => {
      try {
        const snap = await getCountFromServer(
          query(collection(db, 'notifications', uid, 'feed'), where('read', '==', false)),
        )
        setUnreadCount(snap.data().count)
      } catch (err) {
        // Aggregation can fail offline / before the index warms — fall back to
        // counting what we have loaded.
        setUnreadCount((prev) => {
          const loaded = dedupeById([...livePage, ...olderPages]).filter((n) => !n.read).length
          return loaded || prev
        })
      }
    }, 500)
  }, [uid, livePage, olderPages])

  useEffect(() => {
    refreshUnread()
    return () => {
      if (unreadTimerRef.current) clearTimeout(unreadTimerRef.current)
    }
  }, [refreshUnread])

  // Foreground FCM → toast. The in-app doc is already written server-side, so
  // the live listener updates the bell/list; the toast is just the in-focus
  // surface (the OS won't render a notification while the tab is focused).
  useEffect(() => {
    if (!uid) return undefined
    const unsub = onForegroundMessage((payload) => {
      const n = (payload && (payload.notification || payload.data)) || {}
      const title = n.title || ''
      const body = n.body || ''
      if (title || body) toast(title && body ? `${title} — ${body}` : title || body)
    })
    return () => {
      try {
        if (typeof unsub === 'function') unsub()
      } catch {
        /* no-op */
      }
    }
  }, [uid, toast])

  const loadMore = useCallback(async () => {
    if (!uid || !hasMore) return
    const cursor = olderCursorRef.current || liveCursorRef.current
    if (!cursor) return
    try {
      const snap = await getDocs(
        query(
          collection(db, 'notifications', uid, 'feed'),
          orderBy('createdAt', 'desc'),
          startAfter(cursor),
          limit(PAGE_SIZE),
        ),
      )
      setOlderPages((prev) =>
        dedupeById([...prev, ...snap.docs.map((d) => ({ id: d.id, ...d.data() }))]),
      )
      const newCursor = snap.docs[snap.docs.length - 1]
      // loadMore is serialised by the hasMore guard + single trigger, so this
      // ref assignment after the await is safe.
      // eslint-disable-next-line require-atomic-updates
      if (newCursor) olderCursorRef.current = newCursor
      setHasMore(snap.size === PAGE_SIZE)
    } catch (err) {
      console.warn('[notifications] loadMore failed:', err)
    }
  }, [uid, hasMore])

  const markRead = useCallback(
    async (id) => {
      if (!uid || !id) return
      const target = notifications.find((n) => n.id === id)
      if (!target || target.read) return
      // Optimistic.
      setLivePage((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
      setOlderPages((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
      setUnreadCount((c) => Math.max(0, c - 1))
      try {
        await updateDoc(doc(db, 'notifications', uid, 'feed', id), {
          read: true,
          readAt: serverTimestamp(),
        })
      } catch (err) {
        console.warn('[notifications] markRead failed:', err)
      }
      // Reconcile against the server either way (corrects any optimistic drift).
      refreshUnread()
    },
    [uid, notifications, refreshUnread],
  )

  const markAllRead = useCallback(async () => {
    if (!uid) return
    try {
      const snap = await getDocs(
        query(
          collection(db, 'notifications', uid, 'feed'),
          where('read', '==', false),
          limit(BULK_CAP),
        ),
      )
      if (snap.empty) return
      const batch = writeBatch(db)
      snap.docs.forEach((d) => batch.update(d.ref, { read: true, readAt: serverTimestamp() }))
      await batch.commit()
      setLivePage((prev) => prev.map((n) => ({ ...n, read: true })))
      setOlderPages((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch (err) {
      console.warn('[notifications] markAllRead failed:', err)
      toast.error('Could not mark all as read. Please try again.')
    }
  }, [uid, toast])

  const remove = useCallback(
    async (id) => {
      if (!uid || !id) return
      setLivePage((prev) => prev.filter((n) => n.id !== id))
      setOlderPages((prev) => prev.filter((n) => n.id !== id))
      try {
        await deleteDoc(doc(db, 'notifications', uid, 'feed', id))
        refreshUnread()
      } catch (err) {
        console.warn('[notifications] remove failed:', err)
        toast.error('Could not delete that notification.')
      }
    },
    [uid, refreshUnread, toast],
  )

  const removeAll = useCallback(async () => {
    if (!uid) return
    try {
      const snap = await getDocs(
        query(collection(db, 'notifications', uid, 'feed'), limit(BULK_CAP)),
      )
      if (snap.empty) return
      const batch = writeBatch(db)
      snap.docs.forEach((d) => batch.delete(d.ref))
      await batch.commit()
      setLivePage([])
      setOlderPages([])
      setUnreadCount(0)
      olderCursorRef.current = null
      setHasMore(false)
    } catch (err) {
      console.warn('[notifications] removeAll failed:', err)
      toast.error('Could not clear notifications. Please try again.')
    }
  }, [uid, toast])

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      hasMore,
      open,
      setOpen,
      loadMore,
      markRead,
      markAllRead,
      remove,
      removeAll,
    }),
    [notifications, unreadCount, loading, hasMore, open, loadMore, markRead, markAllRead, remove, removeAll],
  )

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}
