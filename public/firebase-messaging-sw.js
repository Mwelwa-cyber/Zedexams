// firebase-messaging-sw.js — background push handler (audit A5.3).
//
// FCM auto-registers this file at the origin root when the Messaging
// SDK initialises in the page. It runs in a Service Worker context with
// no DOM, no localStorage, no React. Its job: render the OS notification
// when a push arrives and the page is in the background or closed, and
// route the user to the right URL when they tap it.
//
// Config injection: this file contains __FIREBASE_*__ tokens that are
// substituted at build time by vite.config.js (see the
// firebaseMessagingSwConfig plugin). The substituted values are PUBLIC
// Firebase web-app identifiers — apiKey is not a secret per Firebase
// docs (security comes from rules, App Check, and OAuth). They mirror
// the values already inlined in the bundled JS the page serves.
//
// Co-existence with /sw.js (Workbox): both service workers are
// registered at scope `/`. They don't share state and have well-defined
// lifecycles — Workbox owns offline + asset caching, this SW owns push.
// Don't try to merge them; the two libraries fight over events.
//
// IMPORTANT: cannot use ES modules here (Firebase compat builds are
// required for SW context), and cannot reference import.meta.env.

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: '__FIREBASE_API_KEY__',
  authDomain: '__FIREBASE_AUTH_DOMAIN__',
  projectId: '__FIREBASE_PROJECT_ID__',
  storageBucket: '__FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
  appId: '__FIREBASE_APP_ID__',
})

const messaging = firebase.messaging()

// Background message handler. Fires when a push arrives and the tab is
// not in focus. The Cloud Function (A5.2) sends `notification` payload
// alongside `webpush` config, which the browser auto-renders for us —
// but Chrome on Android specifically REQUIRES a service-worker
// onBackgroundMessage handler to be registered (otherwise the push
// silently fails to render). For data-only payloads we render the
// notification ourselves so they still surface.
messaging.onBackgroundMessage((payload) => {
  if (!payload) return
  // Skip if the notification payload is set — the browser already
  // auto-rendered it. Just log for debugging.
  if (payload.notification) return
  const data = payload.data || {}
  const title = data.title || 'ZedExams'
  const body = data.body || "Time for today's quiz!"
  const link = data.link || '/dashboard'
  self.registration.showNotification(title, {
    body,
    icon: '/zedexams-logo.png?v=4',
    badge: '/zedexams-logo.png?v=4',
    data: { link },
  })
})

// Tap-to-open: focus an existing tab if one is open at our origin,
// otherwise launch a fresh one at the link the cron sent. The default
// FCM behaviour just opens a new tab every time, which clutters the
// browser; this is the polite version.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification && event.notification.data && event.notification.data.link) || '/dashboard'
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })
    for (const client of allClients) {
      const url = new URL(client.url)
      if (url.origin === self.location.origin && 'focus' in client) {
        try { await client.navigate(link) } catch (_) { /* same-origin nav can fail */ }
        return client.focus()
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(link)
  })())
})

// Standard SW lifecycle: take control on first install so a returning
// user doesn't have to refresh twice for the new handler to bind.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
