/**
 * Node test for functions/guardianBillingAuth.js — the ONE server-side
 * lookup that answers "may this adult buy for this child?".
 *
 * It exists as its own suite because the module's whole purpose is that
 * two payment rails share one answer. The properties below are therefore
 * stated about the AUTHORISER rather than about either rail: whatever the
 * Lenco initiate and the Play verifier do with the verdict, they cannot
 * disagree about what the verdict IS.
 *
 * Plain `node` script (repo convention). Run:
 *   node functions/guardianBillingAuth.test.js
 */

const assert = require("node:assert");

const {authoriseGuardianPurchase} = require("./guardianBillingAuth");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/**
 * Smallest Firestore stand-in that answers the three reads the module
 * makes: a parentLinks query by learnerUid, a users doc get, and a
 * guardianRequests doc get.
 */
function fakeDb({links = [], users = {}, requests = {}} = {}) {
  return {
    collection(name) {
      if (name === "parentLinks") {
        return {
          where(field, _op, value) {
            assert.strictEqual(field, "learnerUid", "links are queried by learnerUid");
            return {
              async get() {
                return {docs: links.filter((l) => l.learnerUid === value).map((l) => ({data: () => l}))};
              },
            };
          },
        };
      }
      const store = name === "users" ? users : requests;
      return {
        doc(id) {
          return {
            async get() {
              const data = store[id];
              return {exists: data !== undefined, data: () => data};
            },
          };
        },
      };
    },
  };
}

const PARENT = "parent-1";
const CHILD = "child-1";
const OTHER_CHILD = "child-2";

const ownerLink = {learnerUid: CHILD, parentUid: PARENT, role: "owner", consent: {state: "approved"}};
const coGuardianLink = {
  learnerUid: CHILD, parentUid: "parent-2", role: "co_guardian", consent: {state: "approved"},
};
const childUser = {displayName: "Mutinta Banda"};

async function main() {
  console.log("\nguardianBillingAuth\n");

  // ── The ordinary case ───────────────────────────────────────────────
  // Most payments name no beneficiary at all. This has to be cheap and
  // unremarkable, because every caller runs it on every payment.
  {
    const r = await authoriseGuardianPurchase({db: fakeDb(), payerUid: PARENT});
    ok("no beneficiary → allowed, credits the payer",
        r.ok === true && r.beneficiaryUid === null && r.beneficiary === null);
  }
  {
    const r = await authoriseGuardianPurchase({
      db: fakeDb(), payerUid: PARENT, beneficiaryUid: PARENT,
    });
    ok("beneficiary === payer → normalised away, not a guardian payment",
        r.ok === true && r.beneficiaryUid === null);
  }
  {
    const r = await authoriseGuardianPurchase({
      db: fakeDb(), payerUid: PARENT, beneficiaryUid: "   ",
    });
    ok("blank beneficiary → treated as absent, not as a lookup",
        r.ok === true && r.beneficiaryUid === null);
  }

  // ── The link decides, and it fails closed ───────────────────────────
  {
    const db = fakeDb({links: [ownerLink], users: {[CHILD]: childUser}});
    const r = await authoriseGuardianPurchase({db, payerUid: PARENT, beneficiaryUid: CHILD});
    ok("owner buying for their linked child → allowed",
        r.ok === true && r.beneficiaryUid === CHILD && r.beneficiary.displayName === "Mutinta Banda");
  }
  {
    const db = fakeDb({links: [], users: {[CHILD]: childUser}});
    const r = await authoriseGuardianPurchase({db, payerUid: PARENT, beneficiaryUid: CHILD});
    ok("no link at all → refused as not-linked",
        r.ok === false && r.code === "permission-denied" && r.reason === "not-linked");
  }
  {
    // A co-guardian may approve and control, but moving money is the
    // owner's — one of the two things a co-guardian cannot undo.
    const db = fakeDb({links: [ownerLink, coGuardianLink], users: {[CHILD]: childUser}});
    const r = await authoriseGuardianPurchase({db, payerUid: "parent-2", beneficiaryUid: CHILD});
    ok("co-guardian → refused as not-owner",
        r.ok === false && r.code === "permission-denied" && r.reason === "not-owner");
  }
  {
    // The link is real but the account behind it is gone. Refusing here is
    // what stops a payment being taken for an account that cannot receive it.
    const db = fakeDb({links: [ownerLink], users: {}});
    const r = await authoriseGuardianPurchase({db, payerUid: PARENT, beneficiaryUid: CHILD});
    ok("linked but no child account → refused as not-found",
        r.ok === false && r.code === "not-found");
  }
  {
    // A link naming a DIFFERENT child must not authorise this one.
    const db = fakeDb({
      links: [{...ownerLink, learnerUid: OTHER_CHILD}],
      users: {[CHILD]: childUser},
    });
    const r = await authoriseGuardianPurchase({db, payerUid: PARENT, beneficiaryUid: CHILD});
    ok("link to another child does not authorise this child", r.ok === false);
  }

  // ── The request id is dropped, never refused ────────────────────────
  // It arrives from a URL in an email. Settling it tells a child their
  // guardian unlocked what they asked for; a stale link must not block a
  // legitimate payment, so every rejection below still returns ok: true.
  {
    const db = fakeDb({
      links: [ownerLink], users: {[CHILD]: childUser},
      requests: {"req-1": {uid: CHILD, status: "sent"}},
    });
    const r = await authoriseGuardianPurchase({
      db, payerUid: PARENT, beneficiaryUid: CHILD, guardianRequestId: "req-1",
    });
    ok("outstanding request for this child → settled", r.ok === true && r.guardianRequestId === "req-1");
  }
  {
    const db = fakeDb({
      links: [ownerLink], users: {[CHILD]: childUser},
      requests: {"req-2": {uid: OTHER_CHILD, status: "sent"}},
    });
    const r = await authoriseGuardianPurchase({
      db, payerUid: PARENT, beneficiaryUid: CHILD, guardianRequestId: "req-2",
    });
    ok("request naming another child → dropped, payment still allowed",
        r.ok === true && r.guardianRequestId === null);
  }
  {
    const db = fakeDb({
      links: [ownerLink], users: {[CHILD]: childUser},
      requests: {"req-3": {uid: CHILD, status: "paid"}},
    });
    const r = await authoriseGuardianPurchase({
      db, payerUid: PARENT, beneficiaryUid: CHILD, guardianRequestId: "req-3",
    });
    ok("already-paid request → dropped, payment still allowed",
        r.ok === true && r.guardianRequestId === null);
  }
  {
    const db = fakeDb({links: [ownerLink], users: {[CHILD]: childUser}, requests: {}});
    const r = await authoriseGuardianPurchase({
      db, payerUid: PARENT, beneficiaryUid: CHILD, guardianRequestId: "missing",
    });
    ok("unknown request id → dropped, payment still allowed",
        r.ok === true && r.guardianRequestId === null);
  }
  {
    const db = fakeDb({links: [ownerLink], users: {[CHILD]: childUser}});
    const r = await authoriseGuardianPurchase({
      db, payerUid: PARENT, beneficiaryUid: CHILD, guardianRequestId: {evil: true},
    });
    ok("non-string request id → ignored rather than coerced",
        r.ok === true && r.guardianRequestId === null);
  }

  console.log(`\n${passed} passed`);

}

main().catch((err) => { console.error(err); process.exit(1); });
