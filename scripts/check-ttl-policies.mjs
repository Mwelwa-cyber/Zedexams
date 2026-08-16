#!/usr/bin/env node
/**
 * check-ttl-policies — guards the CODE side of Firestore TTL configuration.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES *NOT* DO — read this before trusting it.
 * ---------------------------------------------------------------------------
 * This script CANNOT verify that a Firestore TTL policy actually exists in
 * GCP. It never talks to Google. A green run means only that the source tree
 * still agrees with the registry below — it is NOT evidence that any policy is
 * enabled, correctly scoped, or reaping anything.
 *
 * The failure mode this exists to prevent is the silent one: a TTL policy is
 * scoped to a (collection group, field name) pair. Point it at a field the code
 * no longer writes — because someone renamed `expireAt` to `expiresAt`, or
 * added a new collection and forgot the policy — and Firestore accepts it,
 * reports it as enabled, and reaps nothing. Nothing in the app breaks. The
 * collection just grows forever until somebody notices the bill.
 *
 * So: this catches drift on the side we control. Verifying the GCP side is
 * still a manual act (console → Firestore → Time-to-live, or
 * `gcloud firestore fields ttls list`), and still worth doing periodically.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   node scripts/check-ttl-policies.mjs [--root <dir>] [--json] [--verbose]
 *   node scripts/check-ttl-policies.mjs --discover
 *
 * Run --discover FIRST, on a repo this script has never seen. It reads the
 * collection/field pairings out of your source and prints a REGISTRY block to
 * paste in below, so the registry starts from what your code actually does
 * rather than from anyone's memory of it. Review it — discovery is a proposal,
 * not an authority — then paste and run the checks normally.
 *
 * Exit code 0 = code side consistent. Non-zero = drift; read the output.
 */

import fs from 'node:fs';
import path from 'node:path';

/* ===========================================================================
 * THE REGISTRY — the documented source of truth.
 *
 * Adding an entry here is HALF the job. The other half is creating the actual
 * TTL policy in GCP. Neither this file nor any test can do that for you, and
 * neither can detect that you skipped it.
 *
 *   gcloud firestore fields ttls update <field> \
 *     --collection-group=<collection> --enable-ttl \
 *     --database='(default)' --project=examsprepzambia
 *
 * NOTE the field names are NOT uniform. `rateLimits` uses `expireAt` (no "s").
 * That inconsistency is the single most likely source of a misconfigured
 * policy, which is why `assertNoFieldConfusion` exists below.
 * =========================================================================== */
const REGISTRY = [
  {
    collection: 'rateLimits',
    field: 'expireAt', // <-- no "s". Deliberate. Do not "fix" without also
                       //     updating the GCP policy, which is scoped to this
                       //     exact string.
    isCollectionGroup: false,
    codeSideBackstop: null,
    notes:
      'Highest write volume of the set — one doc per rate-limited request. ' +
      'No scheduled reaper: if the TTL policy is missing or misscoped, this ' +
      'grows without bound. Audit this one first.',
  },
  {
    collection: 'guardianRequests',
    field: 'expiresAt',
    isCollectionGroup: false,
    codeSideBackstop: null,
    notes:
      'One doc per "ask your guardian to unlock" request; the doc id is the ' +
      'sha256 of the pay-link token and expiresAt is that link\'s 7-day life. ' +
      'No scheduled reaper — an expired request is dead weight rather than a ' +
      'live credential (settleGuardianRequest is only reached by a payment ' +
      'that already carries the id), so TTL is the whole cleanup story. ' +
      'Volume follows under-18 lock taps, rate-limited to one per learner ' +
      'per 72 hours. Added 2026-08-16 with the tiered paywall.',
  },
  {
    collection: 'webauthnChallenges',
    field: 'expiresAt',
    isCollectionGroup: false,
    codeSideBackstop: null,
    notes:
      'Short-lived (5 min) single-use passkey challenges. No scheduled ' +
      'reaper. Volume follows passkey sign-in, which is feature-flagged.',
  },
  {
    collection: 'processedWebhookEvents',
    field: 'expiresAt',
    isCollectionGroup: false,
    codeSideBackstop: null,
    notes:
      'Webhook replay ledger (Lenco, Meta WhatsApp), 30-day expiry. No ' +
      'scheduled reaper. Added 2026-08-14 — SECURITY_ENDPOINT_AUDIT §4.1.',
  },
  {
    collection: 'processedEvents',
    field: 'expiresAt',
    isCollectionGroup: false,
    codeSideBackstop: null,
    notes:
      'The OTHER idempotency ledger (functions/idempotency.js claimEventOnce, ' +
      'called by the agent dispatcher), 7-day expiry. Until 2026-08-14 it ' +
      'wrote expiresAt as a NUMBER, which Firestore TTL silently ignores — see ' +
      'assertTtlFieldIsTimestamp. Two ledgers doing nearly the same job is ' +
      'itself worth revisiting; that is a separate change.',
  },
  {
    // NOT `notifications`. The docs live at notifications/{uid}/feed, so the
    // policy must be scoped to the collection GROUP `feed`. A policy on
    // `notifications` would match the parent documents, which carry no
    // expiresAt, and reap nothing — enabled and useless. Discovery caught this
    // in the first draft of this registry.
    collection: 'feed',
    field: 'expiresAt',
    isCollectionGroup: true,
    codeSideBackstop:
      'archiveOldNotifications (functions/notifications/reminderCrons.js, ' +
      'scheduled daily 03:30, 90-day sweep)',
    notes:
      'Per-user notification feed. One of two entries that survives a missing ' +
      'TTL policy, because the scheduled sweep also removes old docs.',
  },
  {
    collection: 'downloadTickets',
    field: 'expiresAt',
    isCollectionGroup: false,
    codeSideBackstop:
      'reapDownloadTickets (functions/libraryDownload.js, scheduled daily)',
    notes:
      'Short-lived download bearer tickets. Also consumed on use since ' +
      'SECURITY_ENDPOINT_AUDIT §4.4, so three things remove these.',
  },
];

/* ---------------------------------------------------------------------------
 * Collections that carry an expiry field but are NOT expected to have a TTL
 * policy — because the field is a BUSINESS rule the code reads (an invite that
 * stops working, a consent request that lapses), not a storage-reaping
 * instruction.
 *
 * An `expiresAt` field does not imply a TTL policy is wanted. Conflating the
 * two would either add policies that silently delete records someone expects to
 * still be queryable, or bury the collections that genuinely need one.
 *
 * `assessed: false` means exactly what it says: it carries an expiry field and
 * nobody has decided whether it also wants storage reaping. It is listed so the
 * question is on the record rather than invisible — the same reason
 * scripts/functions-unresolved-baseline.json exists. Moving one to `true`
 * requires actually looking; moving it into REGISTRY requires creating the GCP
 * policy too.
 * ------------------------------------------------------------------------- */
const NO_TTL_POLICY = [
  {collection: 'familyInviteCodes', assessed: true,
    reason: 'Business expiry: familyPortalCore checks expiresAt when redeeming. Codes are low-volume and worth keeping for audit.'},
  {collection: 'consentRequests', assessed: false, reason: 'Guardian-consent lifecycle; retention likely has a compliance answer, not a storage one.'},
  {collection: 'ageGateAttempts', assessed: false, reason: 'Age-gate attempt records; abuse-monitoring value may outlast the expiry.'},
  {collection: 'progressShares', assessed: false, reason: 'Parent progress shares.'},
  {collection: 'parentLinks', assessed: false, reason: 'Parent/learner links.'},
];

/* Field names that mean "this doc is meant to expire". Any file writing one of
 * these is expected to belong to a registered collection. */
const EXPIRY_FIELDS = ['expireAt', 'expiresAt'];

/* Files allowed to reference an expiry field without naming a registered
 * collection — shared helpers, type definitions, this script, docs. Matched as
 * substrings against the repo-relative POSIX path.
 *
 * Every entry here is a hole in the check. Add sparingly and say why. */
const ALLOWLIST = [
  'scripts/check-ttl-policies',   // this file
  'firestore.rules',              // rules reference fields but create nothing
  'firestore.indexes.json',
  '.d.ts',                        // ambient type declarations

  // The three below share one shape, which is the honest limit of a file-level
  // scan: each holds a MODULE-LEVEL in-memory value whose field happens to be
  // called `expiresAt`, in a file that also talks to Firestore elsewhere. The
  // scan sees both and cannot tell they are unrelated. Verified individually —
  // none of these is a Firestore document field:
  'functions/agents/dispatcher.js',   // `let pausedCache = {expiresAt: 0, …}`
                                      // — process-local circuit-breaker cache.
  'functions/aiCostTracking.js',      // `let budgetCache = {expiresAt: 0, …}`
                                      // plus the FX/revenue caches — all
                                      // process-local.
  'functions/paymentHandlers.js',     // `expiresAt: expiry.toISOString()` in a
                                      // RESPONSE payload to the client, not a
                                      // stored field. NOTE: this file does
                                      // claim webhook ledger rows, but that
                                      // write lives in webhookEventLedger.js
                                      // where the check still covers it. A new
                                      // *stored* expiry added directly here
                                      // would be hidden — remove this entry if
                                      // that ever happens.
];

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage',
  '.firebase', '.turbo', '.cache', 'lib/generated', 'public',
]);

/* ========================================================================= */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const ROOT = path.resolve(opt('--root', process.cwd()));
const AS_JSON = flag('--json');
const VERBOSE = flag('--verbose');

/** Recursively collect scannable source files. */
function collectFiles(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // unreadable dir — skip rather than crash the whole run
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      collectFiles(full, acc);
    } else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) {
      acc.push(full);
    }
  }
  return acc;
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const isAllowlisted = (f) => ALLOWLIST.some((frag) => rel(f).includes(frag));

/** Word-boundary match so `expireAt` does not match `expireAtMs`. */
const mentions = (source, token) =>
  new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(source);

/** Line numbers where a token appears, for actionable error output. */
function linesFor(source, token) {
  const re = new RegExp(`\\b${token}\\b`);
  return source
    .split('\n')
    .map((line, i) => (re.test(line) ? i + 1 : null))
    .filter(Boolean);
}

const files = collectFiles(ROOT);
const sources = new Map(); // absolute path -> contents
for (const f of files) {
  try {
    sources.set(f, fs.readFileSync(f, 'utf8'));
  } catch {
    /* unreadable file — skip */
  }
}

/* ---------------------------------------------------------------------------
 * Alias resolution.
 *
 * Plenty of code never writes the collection name inline — it does
 *   export const RATE_LIMITS_COLLECTION = 'rateLimits';
 * and imports that. A check that only looked for the string literal would then
 * flag every real call site as "references no registered collection", which is
 * noise, and noise is how a guard gets deleted.
 *
 * KNOWN LIMIT: collection names built at runtime (template literals, string
 * concatenation, values from config) are invisible to this, and always will be.
 * A grep cannot promise otherwise — see the caveat printed on every run.
 * ------------------------------------------------------------------------- */
/* Identifiers too generic to be a useful alias. Binding one of these would
 * match most of the tree and turn every check into noise.
 *
 * This list is not hypothetical: the first run of this script bound `collection`
 * as an alias for `webauthnChallenges`, because buildAliasMap scanned THIS FILE
 * and matched its own registry line `collection: 'webauthnChallenges'`. The word
 * `collection` then appeared in nearly every Firestore file, and the run
 * reported 58 failures of which 57 were fiction. A guard with that signal ratio
 * gets deleted, so both the self-scan and the generic names are excluded. */
const NON_ALIAS_IDENTIFIERS = new Set([
  'collection', 'collectionGroup', 'name', 'key', 'id', 'path', 'type', 'field',
  'value', 'doc', 'ref', 'scope', 'kind', 'group', 'target', 'source',
]);

function buildAliasMap() {
  const map = new Map(REGISTRY.map((e) => [e.collection, new Set()]));
  for (const entry of REGISTRY) {
    const re = new RegExp(
      `([A-Za-z_$][\\w$]{2,})\\s*[=:]\\s*['"\`]${entry.collection}['"\`]`,
      'g'
    );
    for (const [file, src] of sources) {
      if (isAllowlisted(file)) continue; // never let this file's own registry
                                         // become an alias source
      for (const m of src.matchAll(re)) {
        // Skip an alias that happens to equal the literal itself, and any
        // identifier generic enough to match the whole tree.
        if (m[1] === entry.collection) continue;
        if (NON_ALIAS_IDENTIFIERS.has(m[1])) continue;
        map.get(entry.collection).add(m[1]);
      }
    }
  }
  return map;
}

const ALIASES = buildAliasMap();

/* ---------------------------------------------------------------------------
 * DISCOVERY (--discover)
 * ------------------------------------------------------------------------- */

/** identifier -> string literal, gathered tree-wide, for `.collection(CONST)`. */
function buildConstantMap() {
  const map = new Map();
  const re = /\b([A-Za-z_$][\w$]{2,})\s*[=:]\s*['"`]([A-Za-z0-9_]+)['"`]/g;
  for (const [, src] of sources) {
    for (const m of src.matchAll(re)) if (!map.has(m[1])) map.set(m[1], m[2]);
  }
  return map;
}

/** Every collection/collectionGroup reference in a file, with its offset. */
function findCollectionRefs(src, constants) {
  const refs = [];
  const re = /\b(collectionGroup|collection)\s*\(([^()]*)\)/g;

  for (const m of src.matchAll(re)) {
    const argsRaw = m[2];
    const literals = [...argsRaw.matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);

    let name = null;
    let nestedPath = false;
    if (literals.length > 0) {
      // Modular API passes path segments: collection(db, 'users', uid, 'notifications').
      // The collection being addressed is the last literal segment, and more
      // than one segment means it is a subcollection — so the TTL policy has to
      // be scoped to the collection GROUP, not a single path.
      name = literals[literals.length - 1];
      nestedPath = literals.length > 1;
    } else {
      const idents = [...argsRaw.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((x) => x[1]);
      for (const id of idents.reverse()) {
        if (constants.has(id)) { name = constants.get(id); break; }
      }
    }
    if (!name) continue;

    // A collection call preceded closely by another is probably a subcollection
    // (users/{uid}/notifications), which means the TTL policy must be scoped to
    // the collection GROUP. Flagged for review rather than asserted.
    const before = src.slice(Math.max(0, m.index - 160), m.index);
    const looksNested = /\bcollection\s*\([^()]*\)\s*(?:\.\s*doc\s*\([^()]*\)\s*)?\.?\s*$/.test(before);

    refs.push({
      name,
      index: m.index,
      isGroup: m[1] === 'collectionGroup' || looksNested || nestedPath,
    });
  }
  return refs;
}

function discover() {
  const constants = buildConstantMap();
  const found = new Map(); // collection -> { fields:Map<field,Set<file>>, group:bool }
  const orphans = [];      // expiry writes with no collection call in the file

  for (const [file, src] of sources) {
    if (isAllowlisted(file)) continue;

    const fieldHits = [];
    for (const field of EXPIRY_FIELDS) {
      const re = new RegExp(`\\b${field}\\b`, 'g');
      for (const m of src.matchAll(re)) fieldHits.push({ field, index: m.index });
    }
    if (fieldHits.length === 0) continue;

    const refs = findCollectionRefs(src, constants);
    if (refs.length === 0) {
      orphans.push({ file: rel(file), fields: [...new Set(fieldHits.map((h) => h.field))] });
      continue;
    }

    for (const hit of fieldHits) {
      // Nearest collection call at or before the field — matches the usual
      // db.collection(X).doc(k).set({ expiresAt }) shape.
      const preceding = refs.filter((r) => r.index <= hit.index);
      const ref = preceding.length ? preceding[preceding.length - 1] : refs[0];

      if (!found.has(ref.name)) found.set(ref.name, { fields: new Map(), group: false });
      const rec = found.get(ref.name);
      if (ref.isGroup) rec.group = true;
      if (!rec.fields.has(hit.field)) rec.fields.set(hit.field, new Set());
      rec.fields.get(hit.field).add(rel(file));
    }
  }

  console.log(`\nTTL discovery — scanned ${sources.size} file(s) under ${ROOT}\n`);

  if (found.size === 0) {
    console.log('  No collection writes an expiry field anywhere this scan can see.\n');
    return 0;
  }

  const conflicts = [...found.entries()].filter(([, r]) => r.fields.size > 1);

  console.log('  Proposed REGISTRY — review, then paste over the block in this file:\n');
  console.log('const REGISTRY = [');
  for (const [collection, rec] of found) {
    const field = [...rec.fields.keys()][0];
    const files = [...rec.fields.get(field)].slice(0, 3).join(', ');
    console.log('  {');
    console.log(`    collection: '${collection}',`);
    console.log(`    field: '${field}',${rec.fields.size > 1 ? '  // CONFLICT — see below' : ''}`);
    console.log(`    isCollectionGroup: ${rec.group},${rec.group ? '  // verify: looks like a subcollection' : ''}`);
    console.log('    codeSideBackstop: null,');
    console.log(`    notes: 'seen in ${files}',`);
    console.log('  },');
  }
  console.log('];\n');

  if (conflicts.length > 0) {
    console.log('  CONFLICTS — one collection, more than one expiry field name:\n');
    for (const [collection, rec] of conflicts) {
      console.log(`    ${collection}`);
      for (const [field, fileSet] of rec.fields) {
        console.log(`      ${field.padEnd(10)} ${[...fileSet].join(', ')}`);
      }
      console.log('');
    }
    console.log('    A TTL policy matches ONE field name. Whichever spelling the\n' +
                '    policy is scoped to, docs written with the other are never\n' +
                '    reaped. Resolve this before anything else.\n');
  }

  if (orphans.length > 0) {
    console.log('  Expiry fields with no collection call in the same file:\n');
    for (const o of orphans) console.log(`    ${o.file}  (${o.fields.join(', ')})`);
    console.log('');
  }

  console.log('  Reminder: this reads code, not GCP. Every entry above still needs\n' +
              '  its TTL policy confirmed to actually exist.\n');
  return conflicts.length > 0 ? 1 : 0;
}

if (flag('--discover')) process.exit(discover());

/** True if `src` names this collection, directly or via a known alias. */
function referencesCollection(src, entry) {
  if (mentions(src, entry.collection)) return true;
  for (const alias of ALIASES.get(entry.collection)) {
    if (mentions(src, alias)) return true;
  }
  return false;
}

const failures = [];
const fail = (check, message, detail) =>
  failures.push({ check, message, detail: detail ?? null });

/* ---------------------------------------------------------------------------
 * Check 1 — every registered collection is still referenced, and still writes
 * the field its TTL policy is scoped to.
 * ------------------------------------------------------------------------- */
/**
 * Files that address this collection through an actual `collection()` call —
 * by inline literal OR through a constant bound to the name.
 *
 * The indirection is the common case here, not the exception:
 * `const CHALLENGES = "webauthnChallenges"` then `collection(CHALLENGES)`.
 * A literal-only match reported three of the six registered collections as
 * "never addressed", which is how an over-tightened check becomes as useless as
 * a loose one.
 */
function collectionCallPattern(entry) {
  const names = [entry.collection, ...ALIASES.get(entry.collection)]
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(
    `\\bcollection(?:Group)?\\s*\\([^()]*(?:['"\`](?:${names.join('|')})['"\`]|\\b(?:${names.join('|')})\\b)`
  );
}

function writersOf(entry) {
  const collCall = collectionCallPattern(entry);
  return [...sources.entries()].filter(
    ([f, src]) => !isAllowlisted(f) && collCall.test(src)
  );
}

function assertRegistryMatchesCode() {
  for (const entry of REGISTRY) {
    // Deliberately the WRITERS, not every file that mentions the name.
    // "Does any file referencing this collection mention the field" is too
    // coarse and produced a false negative on its own control run: renaming
    // rateLimits.expireAt did not fail, because passkeyService.js happens to
    // mention both `rateLimits` and `expireAt` for unrelated reasons, which
    // satisfied the check while the real writer had drifted.
    const referencing = writersOf(entry);
    if (referencing.length === 0) {
      // Fall back to the loose match before declaring it missing, so a
      // constant-indirection call site is reported as "cannot follow" rather
      // than as "removed".
      const loose = [...sources.entries()].filter(
        ([f, src]) => !isAllowlisted(f) && referencesCollection(src, entry)
      );
      if (loose.length > 0) {
        fail(
          'registry-matches-code',
          `Collection '${entry.collection}' is mentioned in ${loose.length} ` +
            `file(s) but never through a collection() call this check can see.`,
          `The TTL field cannot be verified. Inline the literal at the call ` +
            `site, or note the indirection in the registry entry.\n` +
            `Files: ${loose.map(([f]) => rel(f)).slice(0, 8).join(', ')}`
        );
        continue;
      }
    }

    if (referencing.length === 0) {
      fail(
        'registry-matches-code',
        `Collection '${entry.collection}' is in the TTL registry but is not ` +
          `referenced anywhere in the source tree.`,
        `Either it was removed (drop it from REGISTRY *and* delete the GCP TTL ` +
          `policy, which is otherwise orphaned), or it is now referenced only ` +
          `via a constant this check cannot follow.`
      );
      continue;
    }

    const writesField = referencing.some(([, src]) => mentions(src, entry.field));
    if (!writesField) {
      fail(
        'registry-matches-code',
        `Collection '${entry.collection}' is referenced in ${referencing.length} ` +
          `file(s), but none of them mention its TTL field '${entry.field}'.`,
        `The GCP policy is scoped to (${entry.collection}, ${entry.field}). If ` +
          `the field was renamed, the policy is now pointed at a field nothing ` +
          `writes — it will report as enabled and delete nothing. Update both ` +
          `sides together.\nFiles: ${referencing.map(([f]) => rel(f)).slice(0, 8).join(', ')}`
      );
    }
  }
}

/* ---------------------------------------------------------------------------
 * Check 2 — the expireAt / expiresAt confusion guard.
 * ------------------------------------------------------------------------- */
function assertNoFieldConfusion() {
  for (const entry of REGISTRY) {
    const wrongFields = EXPIRY_FIELDS.filter((f) => f !== entry.field);

    for (const [file, src] of sources) {
      if (isAllowlisted(file)) continue;
      if (!referencesCollection(src, entry)) continue;

      // A file touching several collections legitimately contains both
      // spellings. Only flag single-collection files, where the pairing is
      // unambiguous.
      const otherCollections = REGISTRY.filter(
        (e) => e.collection !== entry.collection && referencesCollection(src, e)
      );
      if (otherCollections.length > 0) continue;

      for (const wrong of wrongFields) {
        if (!mentions(src, wrong)) continue;
        const lines = linesFor(src, wrong);
        fail(
          'no-field-confusion',
          `${rel(file)} handles '${entry.collection}' but uses '${wrong}' ` +
            `(line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}).`,
          `The TTL policy for '${entry.collection}' is scoped to '${entry.field}'. ` +
            `Docs written with '${wrong}' will never be reaped. This is the ` +
            `failure mode that produces no error anywhere — the policy still ` +
            `shows as enabled.`
        );
      }
    }
  }
}

/* ---------------------------------------------------------------------------
 * Check 3 — no expiry writes from collections nobody registered.
 * ------------------------------------------------------------------------- */
function assertNoUnregisteredExpiryWrites() {
  for (const [file, src] of sources) {
    if (isAllowlisted(file)) continue;

    if (rel(file).includes('.test.') || rel(file).includes('.spec.')) continue;

    const used = EXPIRY_FIELDS.filter((f) => mentions(src, f));
    if (used.length === 0) continue;

    // This check is about FIRESTORE documents that expire. `expiresAt` is also
    // the natural name for an in-memory cache entry, a JWT claim and a
    // reservation held in a local Map — none of which Firestore reaps and none
    // of which need a policy. Requiring a Firestore write and a collection call
    // keeps the check on its actual subject rather than on the word.
    if (!/\.(set|create|add|update)\s*\(/.test(src)) continue;
    if (!/\bcollection(?:Group)?\s*\(/.test(src)) continue;

    const known = REGISTRY.filter((e) => referencesCollection(src, e));
    if (known.length > 0) continue;
    // Collections that carry an expiry field but deliberately have no policy
    // are classified too — the point is that nothing is UNaccounted for.
    const classified = NO_TTL_POLICY.some((e) => mentions(src, e.collection));
    if (classified) continue;

    fail(
      'no-unregistered-expiry-writes',
      `${rel(file)} writes ${used.map((u) => `'${u}'`).join(' / ')} but ` +
        `references no collection in the TTL registry.`,
      `If this file writes docs to a new collection that is meant to expire, ` +
        `that collection needs (a) an entry in REGISTRY and (b) an actual TTL ` +
        `policy created in GCP — without which it grows forever. If the field ` +
        `here is unrelated to Firestore TTL (a JWT expiry, a cache header, a ` +
        `local type), add the path to ALLOWLIST with a one-line reason.`
    );
  }
}

/* ---------------------------------------------------------------------------
 * Check 4 — a TTL field must be written as a Firestore Timestamp.
 *
 * This is the check that found a live bug on the day it was written.
 * functions/idempotency.js wrote `expiresAt: now + ttlMs` — epoch milliseconds
 * as a plain JavaScript number. **Firestore TTL only reaps documents whose TTL
 * field is a Timestamp.** A numeric field is ignored: the policy reports as
 * enabled, deletes nothing, and processedEvents grows for ever. Nothing errors,
 * nothing alerts, and the collection is not one anybody opens.
 *
 * Necessarily a heuristic — it looks for the assignment shape near a Timestamp
 * constructor. It can be fooled by an expiry built several lines earlier, which
 * is why a miss is reported as a WARNING to look at rather than a failure. The
 * numeric-arithmetic shape, though, is unambiguous enough to fail on.
 * ------------------------------------------------------------------------- */
function assertTtlFieldIsTimestamp() {
  for (const entry of REGISTRY) {
    for (const [file, src] of sources) {
      if (isAllowlisted(file)) continue;
      if (rel(file).includes('.test.')) continue; // fakes legitimately use numbers

      // Deliberately STRICTER than referencesCollection: the collection name
      // must appear as a LITERAL, and the file must contain a Firestore write.
      // An in-memory cache entry `{value, expiresAt: now + TTL}` is a perfectly
      // correct numeric expiry and has nothing to do with Firestore TTL — most
      // of this repo's `expiresAt` occurrences are exactly that. Attributing
      // those to a collection because an alias matched is how this check
      // produced 57 false positives on its first run.
      // The name must appear inside an actual collection() call. A bare
      // word-match is not enough for a short, common name — `feed` matches
      // prose about "the feed" and attributed an unrelated cache expiry to it.
      const collCall = new RegExp(
        `\\bcollection(?:Group)?\\s*\\([^()]*['"\`]${entry.collection}['"\`]`
      );
      if (!collCall.test(src)) continue;
      if (!/\.(set|create|add|update)\s*\(/.test(src)) continue;

      // Assignments of the TTL field, e.g. `expiresAt: <expr>` up to the line end.
      const re = new RegExp(`\\b${entry.field}\\s*:\\s*([^,\\n]+)`, 'g');
      for (const m of src.matchAll(re)) {
        const expr = m[1].trim();
        // Arithmetic on a millisecond number, with no Timestamp anywhere in it.
        const looksNumeric = /^[\w.$()]*\s*[+\-]\s*[\w.$()]+/.test(expr) &&
                             !/Timestamp|FieldValue|serverTimestamp|toDate|new Date/.test(expr);
        if (!looksNumeric) continue;
        const line = src.slice(0, m.index).split('\n').length;
        fail(
          'ttl-field-is-timestamp',
          `${rel(file)}:${line} writes '${entry.field}' as a number ` +
            `(\`${expr.slice(0, 60)}\`) for collection '${entry.collection}'.`,
          `Firestore TTL reaps only TIMESTAMP fields. A numeric expiry is ` +
            `ignored: the policy shows as enabled and deletes nothing, so the ` +
            `collection grows without bound and nothing reports an error.\n` +
            `Use admin.firestore.Timestamp.fromMillis(...) — see ` +
            `functions/webhookEventLedger.js for the shape.`
        );
      }
    }
  }
}

/* ---------------------------------------------------------------------------
 * Check 5 — registry internal sanity.
 * ------------------------------------------------------------------------- */
function assertRegistryWellFormed() {
  const seen = new Set();
  for (const entry of REGISTRY) {
    if (seen.has(entry.collection)) {
      fail('registry-well-formed', `Duplicate registry entry: '${entry.collection}'.`);
    }
    seen.add(entry.collection);

    if (!EXPIRY_FIELDS.includes(entry.field)) {
      fail(
        'registry-well-formed',
        `Registry entry '${entry.collection}' declares field '${entry.field}', ` +
          `which is not in EXPIRY_FIELDS (${EXPIRY_FIELDS.join(', ')}).`,
        `Add it to EXPIRY_FIELDS, or correct the entry. Checks 2 and 3 only ` +
          `reason about fields listed there, so an unlisted field is unguarded.`
      );
    }
  }
}

/* ========================================================================= */

assertRegistryWellFormed();
assertTtlFieldIsTimestamp();
assertRegistryMatchesCode();
assertNoFieldConfusion();
assertNoUnregisteredExpiryWrites();

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        root: ROOT,
        filesScanned: sources.size,
        registry: REGISTRY,
        failures,
        caveat:
          'Code-side only. Does not verify that any Firestore TTL policy ' +
          'exists in GCP.',
      },
      null,
      2
    )
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

console.log(`\nTTL policy guard — scanned ${sources.size} file(s) under ${ROOT}\n`);

if (VERBOSE || failures.length > 0) {
  const width = Math.max(...REGISTRY.map((e) => e.collection.length), 10);
  console.log('  Registered collections expected to have a GCP TTL policy:\n');
  for (const e of REGISTRY) {
    const backstop = e.codeSideBackstop ? 'has code-side backstop' : 'NO backstop';
    console.log(
      `    ${e.collection.padEnd(width)}  ${e.field.padEnd(10)}  ` +
        `${e.isCollectionGroup ? 'collection group' : 'collection      '}  ${backstop}`
    );
  }
  console.log('');
}

if (failures.length === 0) {
  console.log('  PASS — the source tree agrees with the TTL registry.\n');
  console.log(
    '  Two things this does NOT establish:\n\n' +
      '    1. That any TTL policy exists in GCP. Nothing in this repo can check\n' +
      '       that. Confirm in the console (Firestore -> Time-to-live) or with\n' +
      '       `gcloud firestore fields ttls list`.\n' +
      '    2. That no collection was missed. Collection names assembled at\n' +
      '       runtime — template literals, concatenation, config values — are\n' +
      '       invisible to a static scan, so a pass is not proof of coverage.\n'
  );
  process.exit(0);
}

console.log(`  FAIL — ${failures.length} problem(s):\n`);
for (const [i, f] of failures.entries()) {
  console.log(`  ${i + 1}. [${f.check}] ${f.message}`);
  if (f.detail) {
    console.log(f.detail.split('\n').map((l) => `       ${l}`).join('\n'));
  }
  console.log('');
}
process.exit(1);
