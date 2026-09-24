/**
 * Test helper: serve the firebase-admin MODULAR entry points from a stub
 * written in the legacy namespace shape.
 *
 * Most backend tests fake the SDK with one object shaped like the old
 * `require("firebase-admin")` — `{firestore: fn, auth: fn, …}`, with
 * `FieldValue` / `Timestamp` hung off `firestore`. Production code uses
 * `require("firebase-admin/firestore")` and friends, because firebase-admin
 * 14 deletes the namespace API. This maps the one stub onto the modular paths
 * so a test keeps a single fake — and so the fake the old path returns and
 * the fake the new path returns cannot disagree.
 *
 * Everything is resolved at CALL time, not when this is built. Some tests
 * patch the stub (even the real `firebase-admin` object) after the module
 * under test has loaded and captured `getFirestore`; a lookup frozen at build
 * time would hand that module the pre-patch service.
 *
 * Usage, inside a Module._load hook:
 *   const modular = modularAdminModules(adminStub);
 *   if (modular[request]) return modular[request];
 */

function modularAdminModules(adminStub = {}) {
  const service = (name) => () => {
    const fn = adminStub[name];
    if (typeof fn !== "function") {
      throw new Error(`modularAdminStub: the legacy stub does not provide ${name}()`);
    }
    return fn();
  };
  // Statics are FORWARDING proxies, not values. Production code destructures
  // `const {FieldValue} = require("firebase-admin/firestore")` at load, and a
  // test may swap `adminStub.firestore.FieldValue` per case afterwards; a
  // proxy is the one thing the module can capture early that still reaches
  // the swapped-in fake when `FieldValue.increment(1)` actually runs.
  // (No production code in functions/ uses `instanceof` on these classes,
  // which is the one thing a proxy cannot honour.)
  const current = (name) => (adminStub.firestore || {})[name];
  const forward = (name) => new Proxy(function forwardedStatic() {}, {
    get: (_target, prop) => {
      const real = current(name);
      if (real == null) return undefined;
      const value = real[prop];
      return typeof value === "function" ? value.bind(real) : value;
    },
    has: (_target, prop) => {
      const real = current(name);
      return real != null && prop in real;
    },
    apply: (_target, self, args) => current(name).apply(self, args),
    construct: (_target, args) => new (current(name))(...args),
  });
  const firestoreStatic = (name) => ({enumerable: true, value: forward(name)});
  const firestore = Object.defineProperties({getFirestore: service("firestore")}, {
    FieldValue: firestoreStatic("FieldValue"),
    Timestamp: firestoreStatic("Timestamp"),
    FieldPath: firestoreStatic("FieldPath"),
    AggregateField: firestoreStatic("AggregateField"),
    GeoPoint: firestoreStatic("GeoPoint"),
  });
  return {
    "firebase-admin/firestore": firestore,
    "firebase-admin/auth": {getAuth: service("auth")},
    "firebase-admin/storage": {getStorage: service("storage")},
    "firebase-admin/messaging": {getMessaging: service("messaging")},
    "firebase-admin/app-check": {getAppCheck: service("appCheck")},
  };
}

module.exports = {modularAdminModules};
