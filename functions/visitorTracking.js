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
 *   visits/{autoId}                    — one doc per pageview (the live feed)
 *   visitorStats/{day}/shards/{0..N}   — sharded daily counters. Each pageview
 *                                        increments a RANDOM shard rather than a
 *                                        single hot doc, so the write ceiling is
 *                                        ~N/sec instead of ~1/sec. Uniques /
 *                                        sessions stay accurate via per-day
 *                                        marker subcollections, updated in a txn.
 *   visitorStats/{YYYY-MM-DD}          — the day rollup the admin dashboard
 *                                        reads. NOT written on the pageview path
 *                                        (that would reinstate the hot doc); the
 *                                        aggregateVisitorStats cron sums the
 *                                        shards into it every few minutes.
 */

const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {applyCors} = require("./cors");
const {enforceRateLimit, standardBuckets, resolveClientIp} = require("./rateLimit");
const {
  dayKeyFor,
  pickShardId,
  sumShards,
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
 * Update the daily rollup by incrementing ONE of N shard docs
 * (visitorStats/{day}/shards/{id}) rather than the single day doc — that
 * spreads write load so concurrent pageviews don't serialise on one hot
 * document. Pageviews always increment the chosen shard; uniqueVisitors /
 * sessions only increment it the first time we see a given id on that Lusaka
 * day, tracked with tiny marker docs under the day's subcollections. The
 * marker read + shard write run in a transaction so concurrent pageviews for
 * the same visitor can't double-count. The day doc itself is written only by
 * aggregateVisitorStats (below), never here.
 */
async function updateDailyRollup(db, {dayKey, visitorId, sessionId, isBot}) {
  const statRef = db.collection("visitorStats").doc(dayKey);
  const shardRef = statRef.collection("shards").doc(String(pickShardId()));
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
    const shardUpdate = {pageviews: inc};
    if (isBot) shardUpdate.botPageviews = inc;
    if (visitorMarker && (!visitorSnap || !visitorSnap.exists)) {
      shardUpdate.uniqueVisitors = inc;
    }
    if (sessionMarker && (!sessionSnap || !sessionSnap.exists)) {
      shardUpdate.sessions = inc;
    }

    tx.set(shardRef, shardUpdate, {merge: true});
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

/**
 * Sum a day's shards into visitorStats/{day} — the doc the /admin/visitors
 * dashboard reads. Writes ABSOLUTE totals (not increments), so it's idempotent
 * and self-healing: a missed run just leaves slightly stale numbers that the
 * next run corrects. Skips a day with no shards so we never create an empty
 * rollup doc.
 */
async function rollUpDay(db, dayKey) {
  const statRef = db.collection("visitorStats").doc(dayKey);
  const shardSnap = await statRef.collection("shards").get();
  if (shardSnap.empty) return;
  const totals = sumShards(shardSnap.docs.map((d) => d.data()));
  await statRef.set({
    date: dayKey,
    pageviews: totals.pageviews,
    botPageviews: totals.botPageviews,
    uniqueVisitors: totals.uniqueVisitors,
    sessions: totals.sessions,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
}

// Cap the Firestore work well under the 15s function timeout. Even with the
// sharded counter, a slow or contended Firestore (or a transaction retrying on
// shard contention) can make the write crawl. If we let that ride the full
// timeout, the platform kills the instance and returns a 500 to the browser
// (the catch below never runs) — the exact thing this best-effort beacon must
// never do. Past this budget we abandon the write and still 204.
const WRITE_BUDGET_MS = 9000;

// Resolve after `ms`, so a hung/slow write can't outlast the budget. Clears its
// own timer when the work settles first so we don't leak a handle per request.
function withBudget(promise, ms) {
  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    budget,
  ]);
}

exports.apiTrackVisit = onRequest(
    {region: "us-central1", timeoutSeconds: 15, memory: "128MiB"},
    async (req, res) => {
      // Best-effort beacon: it must NEVER surface an error — or a 500 — to the
      // visitor (analytics is not worth a console error or a client retry). So
      // the WHOLE handler, including CORS + method handling, lives inside one
      // try/catch, and the Firestore work is time-boxed under the function
      // timeout so a slow backend returns 204 rather than a platform 500.
      try {
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

        const beacon = normalizeBeacon(req.body || {});
        if (!beacon) {
          res.status(204).send("");
          return;
        }

        // IP-scoped fixed-window cap (fail-open) before any Firestore write:
        // this is an unauthenticated write endpoint (one `visits/{autoId}` doc
        // + a counter txn per hit), so an unthrottled loop is a billing-abuse
        // and data-poisoning (spoofed pageviews) surface. A blocked beacon is
        // dropped SILENTLY with 204 to preserve the never-surface-an-error
        // contract — a real page emits far fewer hits than the cap. A school
        // computer-lab NAT stays well under the generous per-IP limit.
        const ip = resolveClientIp(req);
        const rl = await enforceRateLimit(
            admin.firestore(),
            standardBuckets({action: "track-visit", ip, ipPerMin: 300}),
        );
        if (!rl.allowed) {
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

        // `.catch` on the work itself so that, if the budget wins the race and
        // we move on, a later write rejection can't become an unhandled
        // rejection that crashes the instance.
        const work = Promise.all([
          db.collection("visits").add(visitDoc),
          updateDailyRollup(db, {
            dayKey,
            visitorId: beacon.visitorId,
            sessionId: beacon.sessionId,
            isBot: ua.bot,
          }),
        ]).catch((err) => {
          console.error("[apiTrackVisit] write failed", err);
        });

        await withBudget(work, WRITE_BUDGET_MS);

        res.status(204).send("");
      } catch (err) {
        console.error("[apiTrackVisit] failed", err);
        // Still 204 — the client doesn't retry and shouldn't see an error.
        // Guard against a double-send if a response already went out.
        try {
          if (!res.headersSent) res.status(204).send("");
        } catch (_e) { /* response already closed — nothing to do */ }
      }
    },
);

// Fold the sharded per-pageview counters into the day doc the dashboard reads.
// Runs every few minutes over TODAY and YESTERDAY (Lusaka) so late writes near
// midnight still land and the previous day is finalised once traffic stops.
// Absolute-total writes keep it idempotent, so a missed tick self-heals on the
// next one — the dashboard is at worst a few minutes stale, never wrong. Stays
// in us-central1: it's a scheduler (not a Firestore trigger), so it doesn't
// need the africa-south1 pinning that Eventarc triggers do.
exports.aggregateVisitorStats = onSchedule(
    {
      schedule: "every 5 minutes",
      timeZone: "Africa/Lusaka",
      region: "us-central1",
      timeoutSeconds: 120,
      memory: "256MiB",
    },
    async () => {
      const db = admin.firestore();
      const now = Date.now();
      const days = [dayKeyFor(now), dayKeyFor(now - 86400000)];
      for (const dayKey of days) {
        try {
          await rollUpDay(db, dayKey);
        } catch (err) {
          console.error("[aggregateVisitorStats] failed for", dayKey, err);
        }
      }
    },
);
