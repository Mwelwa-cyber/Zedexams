/**
 * Download tickets are single-use (SECURITY_ENDPOINT_AUDIT.md §4.4).
 *
 * The ticket id is a bearer credential carried in a URL — the GET cannot hold a
 * Firebase ID token — so it leaks the ways URLs leak. It was owner-scoped at
 * mint and expired in five minutes, but within those five minutes it was
 * replayable without limit.
 *
 * The property being tested is CONSUMED-BEFORE-RENDER, not consumed-eventually.
 * A ticket deleted after a successful stream is still not single-use: the .docx
 * regeneration takes real time, and two requests inside that window would both
 * read a live ticket and both render. The concurrency case below is the one
 * that distinguishes the two designs, so it is the point of this file.
 */
"use strict";

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(label, cond) {
  assert.ok(cond, label);
  console.log("  ok  " + label);
  passed++;
}

// firebase-admin is only needed for Timestamp in the module under test.
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") {
    return {
      firestore: Object.assign(() => ({}), {
        Timestamp: {fromMillis: (ms) => ({toMillis: () => ms})},
        FieldValue: {serverTimestamp: () => ({__ts: true})},
      }),
    };
  }
  return origLoad.call(this, request, ...rest);
};
delete require.cache[require.resolve("./libraryDownload")];
const {claimDownloadTicket} = require("./libraryDownload");

// A fake Firestore with SERIALISED transactions, which is what Firestore gives
// for contending writes to one document — the behaviour the claim relies on.
function fakeDb(initial) {
  const docs = new Map(Object.entries(initial || {}));
  let chain = Promise.resolve();
  return {
    docs,
    collection: () => ({doc: (id) => ({__id: id})}),
    runTransaction(fn) {
      const run = () => fn({
        get: async (ref) => {
          const data = docs.get(ref.__id);
          return {exists: data !== undefined, data: () => data};
        },
        delete: (ref) => { docs.delete(ref.__id); },
      });
      chain = chain.then(run, run);
      return chain;
    },
  };
}

const future = (ms) => ({toMillis: () => ms});

(async () => {
  console.log("libraryDownload — download tickets are single-use");

  {
    const db = fakeDb({t1: {uid: "u1", generationId: "g1", expiresAt: future(10_000)}});
    const first = await claimDownloadTicket({db, ticketId: "t1", now: 1_000});
    ok("a valid ticket is claimed", first.ok && first.reason === "claimed");
    ok("the claim returns the ticket for the render", first.ticket && first.ticket.generationId === "g1");
    ok("the ticket is CONSUMED by the claim", !db.docs.has("t1"));

    const second = await claimDownloadTicket({db, ticketId: "t1", now: 1_100});
    ok("replaying the same ticket fails", !second.ok && second.reason === "missing");
    ok("a replay yields no ticket data", second.ticket === null);
  }

  {
    // THE case that separates claim-before-render from delete-after-stream.
    // Both requests arrive while the ticket is live; only one may win.
    const db = fakeDb({t2: {uid: "u1", generationId: "g1", expiresAt: future(10_000)}});
    const [a, b] = await Promise.all([
      claimDownloadTicket({db, ticketId: "t2", now: 1_000}),
      claimDownloadTicket({db, ticketId: "t2", now: 1_000}),
    ]);
    const winners = [a, b].filter((r) => r.ok);
    ok("two concurrent requests produce exactly ONE winner", winners.length === 1);
    ok("the loser is told the link is gone", [a, b].some((r) => !r.ok && r.reason === "missing"));
  }

  {
    const db = fakeDb({t3: {uid: "u1", generationId: "g1", expiresAt: future(500)}});
    const r = await claimDownloadTicket({db, ticketId: "t3", now: 1_000});
    ok("an expired ticket is refused", !r.ok && r.reason === "expired");
    ok("an expired ticket is deleted rather than left for the daily reaper",
        !db.docs.has("t3"));
  }

  {
    const db = fakeDb({});
    const r = await claimDownloadTicket({db, ticketId: "nope", now: 1_000});
    ok("an unknown ticket is refused", !r.ok && r.reason === "missing");
  }

  {
    // A ticket with no usable expiry is junk, not a licence.
    const db = fakeDb({t4: {uid: "u1", generationId: "g1"}});
    const r = await claimDownloadTicket({db, ticketId: "t4", now: 1_000});
    ok("a ticket with no expiresAt is refused, not treated as never-expiring",
        !r.ok && r.reason === "expired");
  }

  Module._load = origLoad;
  console.log("\n" + passed + " passed");
})().catch((err) => {
  Module._load = origLoad;
  console.error(err);
  process.exit(1);
});
