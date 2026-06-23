/**
 * functions/visitorTracking.js
 *
 * Website visitor tracker — a first-party, cookieless-by-default page-view
 * counter so the admin team can see site traffic inside /admin/visitors
 * without depending on an external analytics vendor (PostHog stays a
 * silent no-op unless a key is configured + consent is granted).
 *
 * Why a Cloud Function instead of letting the client write to Firestore
 * directly: a public `visits` write rule would be an open door to billing
 * abuse + spoofed data. Routing through an unauthenticated endpoint lets us
 * derive trustworthy fields server-side (UA classification, the request
 * IP/country we never expose to the client) and rate-shape if needed, while
 * Firestore rules keep the collections admin-read / client-write-blocked.
 *
 * Privacy posture (mirrors the PostHog wiring in src/utils/analytics.js):
 *   • No PII. We store path, referrer host, coarse device/browser/OS, and
 *     an opaque random visitorId/sessionId the client only sends after the
 *     user accepts the cookie-consent banner.
 *   • The raw IP is used transiently to read the edge country header and is
 *     never persisted.
 *
 * Writes:
 *   visits/{autoId}             — one doc per pageview (the live feed)
 *   visitorStats/{YYYY-MM-DD}   — daily rollup: pageviews + uniqueVisitors
 *                                 + sessions (accurate uniques via per-day
 *                                 marker subcollections, updated in a txn)
 */

const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {applyCors} = require("./cors");
const {
  dayKeyFor,
  parseUserAgent,
  normalizeBeacon,
} = require("./visitorTrackingCore");

// Edge/CDN country headers, in order of preference. Firebase Hosting and
// the underlying Google front-end populate some of these; we read whichever
// is present and fall back to "" (unknown). Two-letter ISO code, uppercased.
const COUNTRY_HEADERS = [
  "x-country-code",
  "x-appengine-country",
  "cf-ipcountry",
  "x-vercel-ip-country",
];

function countryFrom(req) {
  for (const h of COUNTRY_HEADERS) {
    const v = req.get(h);
    if (v && /^[A-Za-z]{2}$/.test(v) && v.toUpperCase() !== "ZZ") {
      return v.toUpperCase();
    }
  }
  return "";
}

/**
 * Update the daily rollup. Pageviews always increment; uniqueVisitors /
 * sessions only increment the first time we see a given id on that Lusaka
 * day, tracked with tiny marker docs under the day's subcollections. Runs
 * in a transaction so concurrent pageviews can't double-count or clobber.
 */
async function updateDailyRollup(db, {dayKey, visitorId, sessionId, isBot}) {
  const statRef = db.collection("visitorStats").doc(dayKey);
  const visitorMarker = visitorId ?
    statRef.collection("visitors").doc(visitorId) : null;
  const sessionMarker = sessionId ?
    statRef.collection("sessions").doc(sessionId) : null;

  await db.runTransaction(async (tx) => {
    const [visitorSnap, sessionSnap] = await Promise.all([
      visitorMarker ? tx.get(visitorMarker) : Promise.resolve(null),
      sessionMarker ? tx.get(sessionMarker) : Promise.resolve(null),
    ]);

    const inc = admin.firestore.FieldValue.increment(1);
    const update = {
      date: dayKey,
      pageviews: inc,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (isBot) update.botPageviews = inc;
    if (visitorMarker && (!visitorSnap || !visitorSnap.exists)) {
      update.uniqueVisitors = inc;
    }
    if (sessionMarker && (!sessionSnap || !sessionSnap.exists)) {
      update.sessions = inc;
    }

    tx.set(statRef, update, {merge: true});
    if (visitorMarker && (!visitorSnap || !visitorSnap.exists)) {
      tx.set(visitorMarker, {
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    if (sessionMarker && (!sessionSnap || !sessionSnap.exists)) {
      tx.set(sessionMarker, {
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });
}

exports.apiTrackVisit = onRequest(
    {region: "us-central1", timeoutSeconds: 15, memory: "128MiB"},
    async (req, res) => {
      // Same shared origin allow-list as the other /api/* endpoints. This
      // is an unauthenticated beacon, so CORS is the main browser guard.
      applyCors(req, res);

      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (req.method !== "POST") {
        res.status(405).json({error: "Use POST."});
        return;
      }

      // Never let a tracking failure surface to the visitor or retry —
      // analytics is strictly best-effort. We always answer 204.
      try {
        const beacon = normalizeBeacon(req.body || {});
        if (!beacon) {
          res.status(204).send("");
          return;
        }

        const ua = parseUserAgent(req.get("user-agent") || "");
        const now = new Date();
        const dayKey = dayKeyFor(now);
        const db = admin.firestore();

        const visitDoc = {
          path: beacon.path,
          title: beacon.title || null,
          referrerHost: beacon.referrerHost || null,
          visitorId: beacon.visitorId || null,
          sessionId: beacon.sessionId || null,
          device: ua.device,
          browser: ua.browser,
          os: ua.os,
          isBot: ua.bot,
          country: countryFrom(req) || null,
          day: dayKey,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection("visits").add(visitDoc);
        await updateDailyRollup(db, {
          dayKey,
          visitorId: beacon.visitorId,
          sessionId: beacon.sessionId,
          isBot: ua.bot,
        });

        res.status(204).send("");
      } catch (err) {
        console.error("[apiTrackVisit] failed", err);
        // Still 204 — the client doesn't retry and shouldn't see an error.
        res.status(204).send("");
      }
    },
);
