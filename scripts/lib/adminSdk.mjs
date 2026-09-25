// The one way a root script loads the Firebase Admin SDK.
//
// firebase-admin 14 deletes the namespace API these scripts were written
// against — `admin.firestore()`, `admin.auth()`, `admin.storage()`,
// `admin.firestore.FieldValue`, `admin.apps`, `admin.credential` — leaving only
// the app functions on the root export. Calling any of them on 14 is
// `undefined is not a function` at RUNTIME, which for an operations script
// means the moment someone runs it against production.
//
// This returns the MODULAR entry points merged into one flat object, so a
// script reads `sdk.getFirestore()`, `sdk.FieldValue`, `sdk.getApps()`,
// `sdk.getAuth()`, `sdk.getStorage()` — the real 14 API, not a recreation of
// the removed one. The four modules export no overlapping names (checked when
// this was written), so the spread loses nothing.
//
// It stays a DYNAMIC import on purpose: most scripts' dry runs and fixture
// modes are meant to work on a machine with no credentials and, for some, no
// firebase-admin installed at all. Nothing is loaded until a script asks.
//
// scripts/test-firebase-admin-modular.mjs fails on any namespace use in
// scripts/ as well as functions/.

export async function loadAdminSdk() {
  const [app, firestore, auth, storage] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
    import('firebase-admin/auth'),
    import('firebase-admin/storage'),
  ])
  return { ...app, ...firestore, ...auth, ...storage }
}
