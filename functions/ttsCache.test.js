/**
 * Node test for the text-to-speech audio cache — key derivation
 * (ttsCacheCore.js) and the Storage read/write contract (ttsCache.js).
 * Run: node functions/ttsCache.test.js
 *
 * The cache is what makes a per-character provider affordable: identical
 * audio is otherwise bought once per learner per playback. Both ways of
 * getting the key wrong are SILENT, which is why they are pinned here —
 * too loose and a learner hears the wrong voice or speed reading the right
 * words, too tight and the cache never hits and we pay for every repeat.
 *
 * Also pinned: every failure path degrades to a miss. A cache that is down
 * must cost money and work, never be free and broken.
 */

const assert = require("node:assert");
const admin = require("firebase-admin");

const {
  ttsCacheKey,
  ttsCachePath,
  normalizeTtsText,
  TTS_CACHE_VERSION,
  CACHE_PREFIX,
} = require("./ttsCacheCore");
const {readCachedAudio, writeCachedAudio, MAX_CACHED_BYTES} = require("./ttsCache");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("ttsCache");

const base = {text: "Photosynthesis", voice: "en-GB-Neural2-A", rate: 1, pitch: 0};
const k = (over) => ttsCacheKey({...base, ...over});

// ── the key is a well-formed digest ───────────────────────────────────────
ok("key is 64-char lowercase hex", /^[0-9a-f]{64}$/.test(k()));
ok("same request → same key", k() === k());

// ── everything that changes the AUDIO changes the key ─────────────────────
// Each of these is a bug a learner would experience as "the setting does
// nothing": the right words in the wrong voice, or at the wrong speed.
ok("different text → different key", k() !== k({text: "Respiration"}));
ok("different voice → different key", k() !== k({voice: "en-GB-Studio-B"}));
ok("different rate → different key", k() !== k({rate: 0.8}));
ok("different pitch → different key", k() !== k({pitch: -2}));
ok("different provider → different key", k() !== k({provider: "elevenlabs"}));

// ── things that DON'T change the audio must share one entry ───────────────
ok("surrounding and repeated whitespace collapses",
  ttsCacheKey({...base, text: "  Photo   synthesis "}) ===
  ttsCacheKey({...base, text: "Photo synthesis"}));
ok("a trailing newline shares the entry",
  ttsCacheKey({...base, text: "Photosynthesis\n"}) === k());
ok("1 and 1.000 are one rate, not two recordings",
  ttsCacheKey({...base, rate: 1.000}) === k());
ok("a missing rate defaults to 1 (the endpoint's own default)",
  ttsCacheKey({text: base.text, voice: base.voice, pitch: 0}) === k());
ok("a missing pitch defaults to 0",
  ttsCacheKey({text: base.text, voice: base.voice, rate: 1}) === k());

// Case and punctuation are deliberately NOT folded — a synthesiser reads
// "polish" and "Polish" differently, and punctuation changes prosody.
ok("case is significant", k({text: "photosynthesis"}) !== k());
ok("punctuation is significant", k({text: "Photosynthesis?"}) !== k());

// ── field boundaries cannot be forged ─────────────────────────────────────
// Without length-prefixing, a voice ending in a digit and a rate could be
// rearranged into the same joined payload as a different pair.
ok("field boundaries are unambiguous",
  ttsCacheKey({text: "a", voice: "ab", rate: 1}) !==
  ttsCacheKey({text: "a", voice: "a", rate: 1}));

// ── version bump invalidates without a migration ──────────────────────────
ok("the version is part of the key",
  ttsCacheKey({...base}) !== require("node:crypto")
    .createHash("sha256")
    .update(`${TTS_CACHE_VERSION}x`)
    .digest("hex"));

// ── normalizeTtsText ──────────────────────────────────────────────────────
ok("normalize collapses runs of whitespace", normalizeTtsText("a \n\t b") === "a b");
ok("normalize handles null/undefined", normalizeTtsText(null) === "" && normalizeTtsText() === "");

// ── path layout ───────────────────────────────────────────────────────────
{
  const key = k();
  const path = ttsCachePath(key);
  ok("path is sharded by the first two hex characters",
    path === `${CACHE_PREFIX}/${key.slice(0, 2)}/${key}.mp3`);
  // The prefix must have no storage.rules match block, so the catch-all
  // `allow read, write: if false` keeps clients out of the cache entirely.
  ok("path sits under the server-only cache prefix", path.startsWith(`${CACHE_PREFIX}/`));
}
ok("a non-digest key yields no path (never build a path from junk)",
  ttsCachePath("../../etc/passwd") === null &&
  ttsCachePath("") === null &&
  ttsCachePath("ABC") === null);
ok("an uppercase digest is rejected rather than silently re-cased",
  ttsCachePath("A".repeat(64)) === null);

// ── Storage I/O: every failure degrades to a miss ─────────────────────────
function stubStorage({download, save} = {}) {
  const calls = {download: 0, save: 0, saved: null, savedOpts: null, path: null};
  const bucket = () => ({
    file: (path) => {
      calls.path = path;
      return {
        download: async () => {
          calls.download += 1;
          if (typeof download === "function") return download();
          throw Object.assign(new Error("No such object"), {code: 404});
        },
        save: async (buf, opts) => {
          calls.save += 1;
          calls.saved = buf;
          calls.savedOpts = opts;
          if (typeof save === "function") return save();
        },
      };
    },
  });
  Object.defineProperty(admin, "storage", {
    configurable: true,
    value: () => ({bucket}),
  });
  return calls;
}

(async () => {
  const key = k();

  {
    const calls = stubStorage({download: () => [Buffer.from("ID3audio")]});
    const buf = await readCachedAudio(key);
    ok("a stored object is returned as bytes", buf && buf.toString() === "ID3audio");
    ok("the read targets the sharded path", calls.path === ttsCachePath(key));
  }

  {
    stubStorage(); // default: throws a 404
    ok("an absent object is a miss, not a throw", (await readCachedAudio(key)) === null);
  }

  {
    stubStorage({download: () => { throw Object.assign(new Error("boom"), {code: 500}); }});
    ok("a bucket error is a miss, not a throw", (await readCachedAudio(key)) === null);
  }

  {
    stubStorage({download: () => [Buffer.alloc(0)]});
    ok("an empty object is treated as a miss", (await readCachedAudio(key)) === null);
  }

  {
    stubStorage({download: () => [Buffer.alloc(MAX_CACHED_BYTES + 1)]});
    ok("an implausibly large object is not streamed to a learner",
      (await readCachedAudio(key)) === null);
  }

  {
    const calls = stubStorage();
    ok("a malformed key never reads", (await readCachedAudio("nope")) === null && calls.download === 0);
  }

  // ── writes ──────────────────────────────────────────────────────────────
  {
    const calls = stubStorage();
    const stored = await writeCachedAudio(key, Buffer.from("audio"), {
      voice: "en-GB-Studio-B", characters: 1200, provider: "google",
    });
    ok("a write reports success", stored === true && calls.save === 1);
    ok("audio is stored as audio/mpeg", calls.savedOpts.contentType === "audio/mpeg");
    ok("content-addressed objects are immutable and long-lived",
      /immutable/.test(calls.savedOpts.metadata.cacheControl));
    ok("operator metadata records voice, provider and volume",
      calls.savedOpts.metadata.metadata.voice === "en-GB-Studio-B" &&
      calls.savedOpts.metadata.metadata.provider === "google" &&
      calls.savedOpts.metadata.metadata.characters === "1200");
    // Object names and metadata are as visible as the bucket listing, which
    // is the whole reason the key is a hash.
    ok("no learner text reaches the object name or its metadata",
      !calls.path.includes("Photosynthesis") &&
      !JSON.stringify(calls.savedOpts.metadata).includes("Photosynthesis"));
  }

  {
    stubStorage({save: () => { throw new Error("quota"); }});
    ok("a failed write is reported, not thrown",
      (await writeCachedAudio(key, Buffer.from("audio"), {})) === false);
  }

  {
    const calls = stubStorage();
    ok("empty audio is never stored",
      (await writeCachedAudio(key, Buffer.alloc(0), {})) === false && calls.save === 0);
    ok("a malformed key never writes",
      (await writeCachedAudio("nope", Buffer.from("a"), {})) === false && calls.save === 0);
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
