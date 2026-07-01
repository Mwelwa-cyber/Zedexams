/**
 * Node tests for the pure notification gating logic (notificationPrefsCore.js).
 * No firebase deps — runs under plain `node`.
 *
 * Run: node functions/notifications/notificationPrefsCore.test.js
 */

const assert = require("node:assert");
const {
  normalizeServerPrefs,
  shouldWriteInApp,
  isWithinQuietHours,
  isMuted,
  shouldSendPush,
  buildFcmPayload,
  resolveActionLink,
  defaultIconFor,
  isCriticalCategory,
  parseHhmm,
  lusakaMinutesOfDay,
} = require("./notificationPrefsCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// A Date whose UTC time corresponds to a given Lusaka (UTC+2) HH:MM.
function lusakaTime(hh, mm = 0) {
  // Lusaka = UTC + 2, so UTC hour = hh - 2 (mod 24).
  const utcH = ((hh - 2) % 24 + 24) % 24;
  return new Date(Date.UTC(2026, 5, 30, utcH, mm, 0));
}

(async () => {
  console.log("notificationPrefsCore — defaults & normalization");

  // Empty / undefined input → everything on.
  const d = normalizeServerPrefs(undefined);
  ok("default master on", d.master === true);
  ok("default all categories on", Object.values(d.categories).every((v) => v === true));
  ok("default channels on", d.channels.push && d.channels.inApp);
  ok("default quiet hours off", d.quietHours.enabled === false);
  ok("default muteUntil null", d.muteUntil === null);

  // Legacy flat booleans are honoured where they map to a category.
  const legacy = normalizeServerPrefs({ resultsReleased: false, announcements: false });
  ok("legacy resultsReleased:false → assessments off", legacy.categories.assessments === false);
  ok("legacy announcements:false → announcements off", legacy.categories.announcements === false);
  ok("legacy leaves payments on", legacy.categories.payments === true);

  // New keys win over legacy.
  const both = normalizeServerPrefs({
    announcements: false,
    categories: { announcements: true },
  });
  ok("new category key overrides legacy", both.categories.announcements === true);

  console.log("\nnotificationPrefsCore — in-app gating");

  // Critical categories always write in-app, even master off.
  const allOff = { master: false, channels: { inApp: false } };
  ok("payments in-app forced on", shouldWriteInApp(allOff, "payments") === true);
  ok("account in-app forced on", shouldWriteInApp(allOff, "account") === true);
  ok("system in-app forced on", shouldWriteInApp(allOff, "system") === true);
  ok("isCriticalCategory(payments)", isCriticalCategory("payments"));
  ok("isCriticalCategory(learning) false", !isCriticalCategory("learning"));

  // Optional category respects master + category + channel.
  ok("learning in-app on by default", shouldWriteInApp(undefined, "learning") === true);
  ok("learning suppressed by master off",
      shouldWriteInApp({ master: false }, "learning") === false);
  ok("learning suppressed by category off",
      shouldWriteInApp({ categories: { learning: false } }, "learning") === false);
  ok("learning suppressed by inApp channel off",
      shouldWriteInApp({ channels: { inApp: false } }, "learning") === false);

  console.log("\nnotificationPrefsCore — quiet hours (Africa/Lusaka)");

  ok("parseHhmm valid", parseHhmm("22:00") === 1320);
  ok("parseHhmm invalid → null", parseHhmm("bad") === null);
  ok("parseHhmm out-of-range → null", parseHhmm("24:00") === null);
  ok("lusakaMinutesOfDay maps UTC+2", lusakaMinutesOfDay(lusakaTime(6, 30)) === 390);

  const qhDisabled = { quietHours: { enabled: false, start: "22:00", end: "06:00" } };
  ok("quiet hours off → never within", isWithinQuietHours(qhDisabled, lusakaTime(23)) === false);

  const qhWrap = { quietHours: { enabled: true, start: "22:00", end: "06:00" } };
  ok("23:00 inside wrap window", isWithinQuietHours(qhWrap, lusakaTime(23)) === true);
  ok("02:00 inside wrap window", isWithinQuietHours(qhWrap, lusakaTime(2)) === true);
  ok("12:00 outside wrap window", isWithinQuietHours(qhWrap, lusakaTime(12)) === false);
  ok("06:00 (end, exclusive) outside", isWithinQuietHours(qhWrap, lusakaTime(6)) === false);
  ok("22:00 (start, inclusive) inside", isWithinQuietHours(qhWrap, lusakaTime(22)) === true);

  const qhSameDay = { quietHours: { enabled: true, start: "09:00", end: "17:00" } };
  ok("13:00 inside same-day window", isWithinQuietHours(qhSameDay, lusakaTime(13)) === true);
  ok("20:00 outside same-day window", isWithinQuietHours(qhSameDay, lusakaTime(20)) === false);

  const qhEqual = { quietHours: { enabled: true, start: "08:00", end: "08:00" } };
  ok("start==end window → never within (avoids all-day mute)",
      isWithinQuietHours(qhEqual, lusakaTime(8)) === false);

  console.log("\nnotificationPrefsCore — mute");

  const future = Date.now() + 60_000;
  const past = Date.now() - 60_000;
  ok("muteUntil in future → muted", isMuted({ muteUntil: future }) === true);
  ok("muteUntil in past → not muted", isMuted({ muteUntil: past }) === false);
  ok("no muteUntil → not muted", isMuted({}) === false);

  console.log("\nnotificationPrefsCore — push gating");

  ok("push on by default", shouldSendPush(undefined, "learning", lusakaTime(12)) === true);
  ok("push off when master off",
      shouldSendPush({ master: false }, "learning", lusakaTime(12)) === false);
  ok("push off when push channel off",
      shouldSendPush({ channels: { push: false } }, "learning", lusakaTime(12)) === false);
  ok("push off when category off",
      shouldSendPush({ categories: { learning: false } }, "learning", lusakaTime(12)) === false);
  ok("push off during quiet hours",
      shouldSendPush(qhWrap, "learning", lusakaTime(23)) === false);
  ok("push off while muted",
      shouldSendPush({ muteUntil: future }, "learning", new Date()) === false);
  // Critical category push still respects the category toggle.
  ok("payments push suppressible by its category toggle",
      shouldSendPush({ categories: { payments: false } }, "payments", lusakaTime(12)) === false);

  console.log("\nnotificationPrefsCore — payload");

  ok("defaultIconFor known category", defaultIconFor("payments") === "credit-card");
  ok("defaultIconFor unknown → bell", defaultIconFor("nope") === "bell");

  const rel = resolveActionLink({ url: "/exams" });
  ok("relative action url → absolute", rel === "https://zedexams.com/exams");
  const abs = resolveActionLink({ url: "https://x.com/y" });
  ok("absolute action url passes through", abs === "https://x.com/y");
  const none = resolveActionLink(null);
  ok("no action → dashboard fallback", none === "https://zedexams.com/dashboard");

  const payload = buildFcmPayload({ title: "Hi", body: "There", action: { url: "/dashboard" } });
  ok("payload notification title", payload.notification.title === "Hi");
  ok("payload webpush link", payload.webpush.fcmOptions.link === "https://zedexams.com/dashboard");
  ok("payload webpush icon", payload.webpush.notification.icon.startsWith("/zedexams-logo"));

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
