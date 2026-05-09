import { initializeApp } from 'firebase/app'
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  GoogleAuthProvider,
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getMessaging } from 'firebase/messaging'
import { getStorage } from 'firebase/storage'
import { isNativePlatform } from '../utils/runtime'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const app = initializeApp(firebaseConfig)

export const auth    = getAuth(app)
export const db      = getFirestore(app)
export const storage = getStorage(app)

export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

// Web default is session-only persistence — closing the last tab/window
// ends the session. Combined with the idle timeout in AuthContext, this
// protects accounts on shared or stolen devices. When the user ticks
// "Remember me" on the login form we switch to browserLocalPersistence
// for that sign-in so the session survives a browser restart.
//
// Native (Capacitor): every relaunch of the wrapper destroys the WebView,
// which would log session-only users out every time they open the app.
// Always use IndexedDB-backed persistence there; the "Remember me" choice
// is irrelevant.
export function applyAuthPersistence(remember) {
  const persistence = isNativePlatform()
    ? indexedDBLocalPersistence
    : remember ? browserLocalPersistence : browserSessionPersistence
  return setPersistence(auth, persistence).catch((e) => {
    console.error('Failed to set auth persistence:', e)
  })
}

applyAuthPersistence(false)

// Firebase Cloud Messaging — initialised only when the browser actually
// supports web push (Service Worker + PushManager APIs) and we're not
// inside the Capacitor wrapper. The wrapper uses the native push plugin
// in a separate code path. `messaging` stays null on iOS Safari < 16.4,
// private-mode browsers, and Capacitor — callers in src/utils/fcm.js
// guard on the null and degrade gracefully (the permission prompt
// simply never renders).
let messagingInstance = null
try {
  if (
    typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && !isNativePlatform()
  ) {
    messagingInstance = getMessaging(app)
  }
} catch (err) {
  console.warn('Firebase Messaging init failed:', err)
}
export const messaging = messagingInstance

export default app
