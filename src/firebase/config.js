import { initializeApp } from 'firebase/app'
import {
  getAuth,
  setPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
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

// Web: session-only persistence — closing the last tab/window ends the
// session. Combined with the idle timeout in AuthContext, this protects
// accounts on shared or stolen devices (a refresh in the same tab still
// keeps the user in).
//
// Native (Capacitor): every relaunch of the wrapper destroys the WebView,
// which would log session-only users out every time they open the app.
// Use IndexedDB-backed persistence so the user stays signed in between
// launches; the idle timeout still kicks in after inactivity.
const persistence = isNativePlatform()
  ? indexedDBLocalPersistence
  : browserSessionPersistence
setPersistence(auth, persistence).catch((e) => {
  console.error('Failed to set auth persistence:', e)
})

export default app
