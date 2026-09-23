/**
 * Test helper: serve the firebase-admin MODULAR entry points from a stub
 * written in the legacy namespace shape.
 *
 * Most backend tests fake the SDK with one object shaped like the old
 * `require("firebase-admin")` — `{firestore: fn, auth: fn, …}`, with
 * `FieldValue` / `Timestamp` hung off `firestore`. Production code is moving
 * to `require("firebase-admin/firestore")` and friends, because firebase-admin
 * 14 deletes the namespace API. This maps the one stub onto the modular paths
 * so a test keeps a single fake — and so the fake the old path returns and
 * the fake the new path returns cannot disagree.
 *
 * Usage, inside a Module._load hook:
 *   const modular = modularAdminModules(adminStub);
 *   if (modular[request]) return modular[request];
 */

function modularAdminModules(adminStub = {}) {
  const fs = adminStub.firestore || {};
  const call = (fn) => () => {
    if (typeof fn !== "function") {
      throw new Error("modularAdminStub: the legacy stub does not provide this service");
    }
    return fn();
  };
  return {
    "firebase-admin/firestore": {
      getFirestore: call(adminStub.firestore),
      FieldValue: fs.FieldValue,
      Timestamp: fs.Timestamp,
      FieldPath: fs.FieldPath,
      AggregateField: fs.AggregateField,
      GeoPoint: fs.GeoPoint,
    },
    "firebase-admin/auth": {getAuth: call(adminStub.auth)},
    "firebase-admin/storage": {getStorage: call(adminStub.storage)},
    "firebase-admin/messaging": {getMessaging: call(adminStub.messaging)},
    "firebase-admin/app-check": {getAppCheck: call(adminStub.appCheck)},
  };
}

module.exports = {modularAdminModules};
