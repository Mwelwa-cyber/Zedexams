/**
 * Node test for the offered-voices config — the /api/tts allow-list as
 * chosen from /admin/voice. Run: node functions/ttsVoiceConfig.test.js
 *
 * The allow-list is a FINANCIAL control (an open endpoint at Studio or
 * ElevenLabs rates is a money printer), so what is pinned here is the
 * direction of every failure: no config, an unreadable config, an empty
 * list and an invalid entry must all resolve toward the built-in Google
 * defaults — never toward "allow anything", and never toward a product
 * with a read-aloud button and no voice behind it.
 */

const assert = require("node:assert");
const admin = require("firebase-admin");

const {
  normalizeOfferedVoice,
  normalizeOfferedList,
  effectiveVoiceList,
  findOfferedVoice,
} = require("./ttsVoiceConfigCore");
const {GOOGLE_VOICES} = require("./ttsAdminCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("ttsVoiceConfig");

// ── normalizeOfferedVoice ─────────────────────────────────────────────────
ok("a Google voice entry validates",
  normalizeOfferedVoice({id: "en-GB-Neural2-A", provider: "google", label: "British", lang: "en-GB"})
      ?.provider === "google");
ok("an ElevenLabs opaque id validates",
  normalizeOfferedVoice({id: "21m00Tcm4TlvDq8ikWAM", provider: "elevenlabs"})?.id ===
  "21m00Tcm4TlvDq8ikWAM");
ok("an unknown provider is dropped, not guessed",
  normalizeOfferedVoice({id: "abc", provider: "azure"}) === null);
ok("a voice id with path characters is refused",
  normalizeOfferedVoice({id: "../etc/passwd", provider: "google"}) === null);
ok("a missing id is refused", normalizeOfferedVoice({provider: "google"}) === null);
ok("labels are bounded, not trusted",
  normalizeOfferedVoice({id: "a", provider: "google", label: "x".repeat(500)}).label.length === 80);

// ── normalizeOfferedList ──────────────────────────────────────────────────
{
  const r = normalizeOfferedList([
    {id: "v1", provider: "google"},
    {id: "v1", provider: "google"},          // duplicate
    {id: "bad id", provider: "google"},      // invalid
    {id: "v2", provider: "elevenlabs"},
  ]);
  ok("duplicates and invalid entries are DROPPED and the drop is REPORTED",
    r.offered.length === 2 && r.dropped === 2);
}
ok("a non-array offered list is empty, never a throw",
  normalizeOfferedList("nope").offered.length === 0);
{
  const many = Array.from({length: 50}, (_, i) => ({id: `v${i}`, provider: "google"}));
  ok("the list is capped so a runaway write cannot balloon the doc",
    normalizeOfferedList(many).offered.length === 30);
}

// ── effectiveVoiceList: every failure resolves to the defaults ────────────
const DEFAULT_IDS = GOOGLE_VOICES.map((v) => v.id);
ok("no config doc → the built-in Google defaults",
  effectiveVoiceList(null, GOOGLE_VOICES).map((v) => v.id).join() === DEFAULT_IDS.join());
ok("an empty offered list → defaults (zero voices is not a reachable state)",
  effectiveVoiceList({offered: []}, GOOGLE_VOICES).length === GOOGLE_VOICES.length);
ok("a config of ONLY invalid entries → defaults, not an empty allow-list",
  effectiveVoiceList({offered: [{id: "bad id", provider: "x"}]}, GOOGLE_VOICES).length ===
  GOOGLE_VOICES.length);
{
  const list = effectiveVoiceList(
      {offered: [{id: "21m00Tcm4TlvDq8ikWAM", provider: "elevenlabs", label: "Rachel"}]},
      GOOGLE_VOICES);
  ok("a valid config REPLACES the defaults rather than extending them",
    list.length === 1 && list[0].provider === "elevenlabs");
  ok("...so a default Google voice is then genuinely not offered",
    findOfferedVoice(list, "en-GB-Neural2-A") === null);
}
ok("defaults are stamped with their provider",
  effectiveVoiceList(null, GOOGLE_VOICES).every((v) => v.provider === "google"));

// ── findOfferedVoice ──────────────────────────────────────────────────────
const LIST = effectiveVoiceList(null, GOOGLE_VOICES);
ok("an offered id resolves to its entry",
  findOfferedVoice(LIST, "en-GB-Studio-B")?.provider === "google");
ok("an unknown id is refused", findOfferedVoice(LIST, "nope") === null);
ok("empty and non-string ids are refused",
  findOfferedVoice(LIST, "") === null && findOfferedVoice(LIST, null) === null);

// ── the cached reader: fail-open to defaults, one read per TTL ────────────
function stubFirestore({data, throwOn = false} = {}) {
  const calls = {reads: 0};
  const fs = () => ({
    doc: () => ({
      get: async () => {
        calls.reads += 1;
        if (throwOn) throw new Error("unavailable");
        return {exists: data !== null, data: () => data};
      },
    }),
  });
  fs.FieldValue = {serverTimestamp: () => ({__ts: true})};
  Object.defineProperty(admin, "firestore", {configurable: true, value: fs});
  return calls;
}

(async () => {
  const {getEffectiveVoices, _resetVoiceConfigCache} = require("./ttsVoiceConfig");

  {
    _resetVoiceConfigCache();
    const calls = stubFirestore({data: {offered: [{id: "elv1", provider: "elevenlabs"}]}});
    const list = await getEffectiveVoices();
    ok("the reader serves the stored config", list.length === 1 && list[0].id === "elv1");
    await getEffectiveVoices();
    await getEffectiveVoices();
    ok("three resolutions inside the TTL cost ONE Firestore read", calls.reads === 1);
  }

  {
    _resetVoiceConfigCache();
    stubFirestore({throwOn: true});
    const list = await getEffectiveVoices();
    ok("a read FAILURE serves the safe defaults, never an empty or open list",
      list.length === GOOGLE_VOICES.length && list.every((v) => v.provider === "google"));
  }

  {
    _resetVoiceConfigCache();
    stubFirestore({data: null});
    const list = await getEffectiveVoices();
    ok("an absent doc serves the defaults", list.length === GOOGLE_VOICES.length);
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
