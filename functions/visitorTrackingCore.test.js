/**
 * Node test for the visitor-tracker pure helpers.
 * Run: node functions/visitorTrackingCore.test.js
 */

const assert = require("node:assert");
const {
  dayKeyFor,
  sanitizeText,
  sanitizePath,
  referrerHost,
  parseUserAgent,
  normalizeBeacon,
} = require("./visitorTrackingCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("visitorTrackingCore");

// ── dayKeyFor: buckets into Lusaka (UTC+2) days ──────────────────────────
ok("midday UTC → same date",
    dayKeyFor(new Date("2026-06-23T12:00:00Z")) === "2026-06-23");
ok("23:30 UTC rolls to next Lusaka day",
    dayKeyFor(new Date("2026-06-23T23:30:00Z")) === "2026-06-24");
ok("01:00 UTC still previous-ish — stays same date in Lusaka",
    dayKeyFor(new Date("2026-06-23T01:00:00Z")) === "2026-06-23");
ok("accepts epoch millis", dayKeyFor(Date.parse("2026-01-01T00:00:00Z")) === "2026-01-01");
ok("rejects junk date", dayKeyFor("not a date") === null);

// ── sanitizeText: strips control chars, trims, caps ──────────────────────
ok("strips control characters",
    sanitizeText("a\u0000b\u001Fc") === "abc");
ok("trims whitespace", sanitizeText("  hi  ") === "hi");
ok("caps length", sanitizeText("xxxxxxxxxx", 4) === "xxxx");
ok("non-string → empty", sanitizeText(42) === "" && sanitizeText(null) === "");

// ── sanitizePath: drops query/hash, forces leading slash ─────────────────
ok("drops query string", sanitizePath("/papers?subject=maths") === "/papers");
ok("drops hash", sanitizePath("/lessons#top") === "/lessons");
ok("adds leading slash", sanitizePath("dashboard") === "/dashboard");
ok("collapses double slashes", sanitizePath("//admin//visitors") === "/admin/visitors");
ok("junk → root", sanitizePath(null) === "/" && sanitizePath("") === "/");

// ── referrerHost: host only, www stripped ────────────────────────────────
ok("extracts host", referrerHost("https://www.google.com/search?q=zedexams") === "google.com");
ok("keeps subdomain", referrerHost("https://m.facebook.com/") === "m.facebook.com");
ok("unparseable → empty", referrerHost("not a url") === "");
ok("empty → empty", referrerHost("") === "");

// ── parseUserAgent: coarse device/browser/OS classification ──────────────
const android = parseUserAgent(
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36");
ok("android phone → mobile", android.device === "mobile");
ok("android phone → Chrome", android.browser === "Chrome");
ok("android phone → Android", android.os === "Android");
ok("android phone not a bot", android.bot === false);

const iphone = parseUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
ok("iphone → mobile", iphone.device === "mobile");
ok("iphone → Safari", iphone.browser === "Safari");
ok("iphone → iOS", iphone.os === "iOS");

const desktop = parseUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36");
ok("windows chrome → desktop", desktop.device === "desktop");
ok("windows chrome → Windows", desktop.os === "Windows");

const bot = parseUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
ok("googlebot flagged as bot", bot.bot === true && bot.device === "bot");
ok("whatsapp preview flagged as bot", parseUserAgent("WhatsApp/2.23").bot === true);

// ── normalizeBeacon: validates + cleans the posted payload ───────────────
const good = normalizeBeacon({
  path: "/papers?x=1#a",
  visitorId: "abc123def456",
  sessionId: "sess-7890abcd",
  referrer: "https://www.google.com/q",
  title: "Past Papers",
});
ok("normalizes path", good.path === "/papers");
ok("keeps valid visitorId", good.visitorId === "abc123def456");
ok("keeps valid sessionId", good.sessionId === "sess-7890abcd");
ok("reduces referrer to host", good.referrerHost === "google.com");

ok("rejects short/garbage ids",
    normalizeBeacon({path: "/", visitorId: "ab", sessionId: "<script>"}).visitorId === "" &&
    normalizeBeacon({path: "/", visitorId: "ab", sessionId: "<script>"}).sessionId === "");
ok("missing ids are allowed (anonymous pageview)",
    normalizeBeacon({path: "/pricing"}).path === "/pricing");
ok("no body → null", normalizeBeacon(null) === null && normalizeBeacon("x") === null);

console.log(`\n${passed} assertions passed.`);
