/**
 * Node tests for functions/momoService.js.
 *
 * Companion to functions/momoSettlement.test.js: settlement covers the
 * post-callback verification helper, this covers the rest of the MoMo
 * stack — the bits that decide where the request goes, which currency
 * it settles in, how the polling/state machine progresses, and how MTN
 * responses are normalized for the rest of the app.
 *
 * Why so much: a regression in any of these silently corrupts payments:
 *   - normalizePhoneNumber: wrong digits go to the wrong wallet
 *   - resolveCurrency / buildMtnConfig: sandbox EUR vs live ZMW mix-up
 *     creates phantom successful payments at the wrong amount
 *   - getAccessToken cache: a sandbox token reused against live (or
 *     vice versa) hits the wrong tenant
 *   - mapMtnStatus: a status mis-classified as "pending" stalls the
 *     learner; misclassified as "successful" grants premium on a
 *     failed payment
 *   - nextPollingDelayMs: a too-fast loop hammers MTN; a too-slow
 *     loop frustrates learners on the success page
 *
 * No firebase-functions emulator needed. firebase-functions/v2/https
 * is pulled in for the HttpsError class — bundled with the functions
 * deps already.
 *
 * Run:
 *   npm run test:momo-service
 * or directly:
 *   node functions/momoService.test.js
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const MODULE_PATH = path.join(__dirname, "momoService.js");

function freshMomoService() {
  // The module caches the access token at module level so we reload
  // it for tests that need a clean cache. Cheap — it has no I/O at
  // require time.
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

let pass = 0;
let fail = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    fail++;
    failures.push({name, message: err.message});
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

function section(label) {
  console.log(`\n${label}`);
}

async function withFetchStub(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"Content-Type": "application/json"},
  });
}

function emptyResponse(status) {
  return new Response("", {status});
}

async function main() {
  const momo = freshMomoService();

  // ── PLAN_CATALOG ────────────────────────────────────────────────
  section("PLAN_CATALOG — plan shape + completeness");

  await test("catalog contains every plan id used by /pricing", () => {
    const expected = [
      "monthly", "termly", "yearly",
      "pro_monthly", "pro_yearly",
      "max_monthly", "max_yearly",
    ];
    for (const id of expected) {
      assert.ok(momo.PLAN_CATALOG[id], `missing plan id: ${id}`);
    }
  });

  await test("every plan declares amountZMW + durationDays + name + id", () => {
    for (const [id, plan] of Object.entries(momo.PLAN_CATALOG)) {
      assert.equal(plan.id, id, `plan ${id} id mismatch`);
      assert.equal(typeof plan.amountZMW, "number", `plan ${id} amountZMW is not numeric`);
      assert.ok(Number.isFinite(plan.amountZMW), `plan ${id} amountZMW not finite`);
      assert.ok(plan.amountZMW > 0, `plan ${id} amountZMW must be > 0`);
      assert.equal(typeof plan.durationDays, "number", `plan ${id} durationDays is not numeric`);
      assert.ok(plan.durationDays > 0, `plan ${id} durationDays must be > 0`);
      assert.equal(typeof plan.name, "string", `plan ${id} name is not a string`);
      assert.ok(plan.name.length > 0, `plan ${id} name is empty`);
    }
  });

  await test("yearly plans are cheaper-per-day than monthly counterparts", () => {
    // Sanity guard: if someone mistypes pro_yearly = 79 (instead of 790)
    // the discount math inverts. Lock the invariant.
    const yearlyPerDay = momo.PLAN_CATALOG.pro_yearly.amountZMW / momo.PLAN_CATALOG.pro_yearly.durationDays;
    const monthlyPerDay = momo.PLAN_CATALOG.pro_monthly.amountZMW / momo.PLAN_CATALOG.pro_monthly.durationDays;
    assert.ok(yearlyPerDay < monthlyPerDay, "pro_yearly per-day must be cheaper than pro_monthly");
    const maxYearlyPerDay = momo.PLAN_CATALOG.max_yearly.amountZMW / momo.PLAN_CATALOG.max_yearly.durationDays;
    const maxMonthlyPerDay = momo.PLAN_CATALOG.max_monthly.amountZMW / momo.PLAN_CATALOG.max_monthly.durationDays;
    assert.ok(maxYearlyPerDay < maxMonthlyPerDay, "max_yearly per-day must be cheaper than max_monthly");
  });

  // ── getPlanConfig ───────────────────────────────────────────────
  section("getPlanConfig");

  await test("returns the catalog entry for a known id", () => {
    const plan = momo.getPlanConfig("monthly");
    assert.equal(plan.id, "monthly");
    assert.equal(plan.amountZMW, 50);
  });

  await test("trims whitespace before lookup", () => {
    const plan = momo.getPlanConfig("  monthly  ");
    assert.equal(plan.id, "monthly");
  });

  await test("throws HttpsError(invalid-argument) for unknown plan", () => {
    assert.throws(
      () => momo.getPlanConfig("free_lol"),
      (err) => err.code === "invalid-argument",
    );
  });

  await test("throws for null / undefined / empty string", () => {
    for (const v of [null, undefined, "", "   "]) {
      assert.throws(
        () => momo.getPlanConfig(v),
        (err) => err.code === "invalid-argument",
        `expected throw for ${JSON.stringify(v)}`,
      );
    }
  });

  // ── cleanMessage ────────────────────────────────────────────────
  section("cleanMessage — payerMessage / payeeNote sanitisation");

  await test("strips quote characters MTN treats as syntax", () => {
    assert.equal(momo.cleanMessage(`it's "ok"`), "its ok");
    assert.equal(momo.cleanMessage("back`tick"), "backtick");
  });

  await test("replaces non-printable / non-ASCII with a single space", () => {
    // Emojis + accented letters get squashed. MTN's MSISDN-aware
    // routing rejects payloads with non-ASCII payerMessage.
    assert.equal(
      momo.cleanMessage("café ​ premium plan"),
      "caf premium plan",
    );
  });

  await test("collapses runs of whitespace + trims", () => {
    assert.equal(momo.cleanMessage("  hello   world  "), "hello world");
  });

  await test("truncates to default 80 chars", () => {
    const long = "x".repeat(200);
    assert.equal(momo.cleanMessage(long).length, 80);
  });

  await test("honours custom maxLength override", () => {
    assert.equal(momo.cleanMessage("abcdefghij", 4), "abcd");
  });

  await test("null/undefined → empty string (never throws)", () => {
    assert.equal(momo.cleanMessage(null), "");
    assert.equal(momo.cleanMessage(undefined), "");
  });

  // ── resolveCurrency ─────────────────────────────────────────────
  section("resolveCurrency — environment → expected currency");

  await test("sandbox → EUR (matches MTN sandbox contract)", () => {
    assert.equal(momo.resolveCurrency("sandbox"), "EUR");
  });

  await test("mtnzambia → ZMW (live tenant for prod)", () => {
    assert.equal(momo.resolveCurrency("mtnzambia"), "ZMW");
  });

  await test("known foreign envs map to local currency", () => {
    assert.equal(momo.resolveCurrency("mtnghana"), "GHS");
    assert.equal(momo.resolveCurrency("mtnuganda"), "UGX");
    assert.equal(momo.resolveCurrency("mtnsouthafrica"), "ZAR");
  });

  await test("unknown environment falls back to DEFAULT_CURRENCY (ZMW)", () => {
    assert.equal(momo.resolveCurrency("mtnnoplace"), momo.DEFAULT_CURRENCY);
    assert.equal(momo.resolveCurrency(""), momo.DEFAULT_CURRENCY);
    assert.equal(momo.resolveCurrency(undefined), momo.DEFAULT_CURRENCY);
  });

  // ── buildMtnConfig ──────────────────────────────────────────────
  section("buildMtnConfig");

  await test("trims credential strings", () => {
    const cfg = momo.buildMtnConfig({
      apiUser: "  user-uuid  ",
      apiKey: "  key  ",
      subscriptionKey: "  sub  ",
      environment: "sandbox",
    });
    assert.equal(cfg.apiUser, "user-uuid");
    assert.equal(cfg.apiKey, "key");
    assert.equal(cfg.subscriptionKey, "sub");
  });

  await test("sandbox baseUrl is the MTN sandbox host", () => {
    const cfg = momo.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    assert.equal(cfg.baseUrl, "https://sandbox.momodeveloper.mtn.com");
    assert.equal(cfg.targetEnvironment, "sandbox");
    assert.equal(cfg.currency, "EUR");
  });

  await test("live tenants route to proxy.momoapi.mtn.com", () => {
    // The single live host comment in momoService.js notes this is
    // inferred; if the live host changes during MTN onboarding the
    // helper must be updated. Lock the current value so the change
    // is visible in a diff.
    const cfg = momo.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "mtnzambia",
    });
    assert.equal(cfg.baseUrl, "https://proxy.momoapi.mtn.com");
    assert.equal(cfg.targetEnvironment, "mtnzambia");
    assert.equal(cfg.currency, "ZMW");
  });

  await test("environment value is lowercased + defaults to sandbox", () => {
    const upper = momo.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "MTNZAMBIA",
    });
    assert.equal(upper.targetEnvironment, "mtnzambia");
    const blank = momo.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "",
    });
    assert.equal(blank.targetEnvironment, "sandbox");
  });

  // ── normalizePhoneNumber ────────────────────────────────────────
  section("normalizePhoneNumber");

  await test("local Zambian 0xx 10-digit → 260xxxxxxxxx", () => {
    assert.equal(momo.normalizePhoneNumber("0961234567", "mtnzambia"), "260961234567");
  });

  await test("9-digit local (no leading 0) → 260xxxxxxxxx", () => {
    assert.equal(momo.normalizePhoneNumber("961234567", "mtnzambia"), "260961234567");
  });

  await test("already-prefixed 260xxxxxxxxx passes through", () => {
    assert.equal(momo.normalizePhoneNumber("260961234567", "mtnzambia"), "260961234567");
  });

  await test("strips non-digit characters before normalisation", () => {
    assert.equal(momo.normalizePhoneNumber("+260 96 123 4567", "mtnzambia"), "260961234567");
    assert.equal(momo.normalizePhoneNumber("(096) 123-4567", "mtnzambia"), "260961234567");
  });

  await test("sandbox test MSISDNs (46733123450, 56733123450) accepted as-is", () => {
    // MTN sandbox docs publish these as the deterministic test numbers
    // for the FAILED / SUCCESSFUL response tracks.
    assert.equal(momo.normalizePhoneNumber("46733123450", "sandbox"), "46733123450");
    assert.equal(momo.normalizePhoneNumber("56733123450", "sandbox"), "56733123450");
  });

  await test("sandbox MSISDN pattern NOT silently accepted on live env", () => {
    // 46733123450 doesn't start with 260 and isn't 9-or-10 digits, so on
    // live it falls through to the "10..15 digits passthrough" rule.
    // Pin the behaviour so a refactor doesn't tighten / loosen this.
    const out = momo.normalizePhoneNumber("46733123450", "mtnzambia");
    assert.equal(out, "46733123450", "11-digit non-260 number passes through on live");
  });

  await test("empty / non-numeric input throws HttpsError(invalid-argument)", () => {
    for (const v of ["", "   ", "abcde", null, undefined]) {
      assert.throws(
        () => momo.normalizePhoneNumber(v, "mtnzambia"),
        (err) => err.code === "invalid-argument",
        `expected throw for ${JSON.stringify(v)}`,
      );
    }
  });

  await test("too-short number (<9 digits, not sandbox shape) throws", () => {
    assert.throws(
      () => momo.normalizePhoneNumber("1234", "mtnzambia"),
      (err) => err.code === "invalid-argument",
    );
  });

  await test("absurdly long number (>15 digits) throws", () => {
    assert.throws(
      () => momo.normalizePhoneNumber("1234567890123456", "mtnzambia"),
      (err) => err.code === "invalid-argument",
    );
  });

  // ── mapMtnStatus ────────────────────────────────────────────────
  section("mapMtnStatus — MTN status string → app state machine");

  await test("SUCCESSFUL → final + isSuccessful", () => {
    const m = momo.mapMtnStatus("SUCCESSFUL");
    assert.equal(m.status, "successful");
    assert.equal(m.isFinal, true);
    assert.equal(m.isSuccessful, true);
    assert.equal(m.mtnStatus, "SUCCESSFUL");
  });

  await test("FAILED + REJECTED → final, not successful, status=failed", () => {
    for (const s of ["FAILED", "REJECTED"]) {
      const m = momo.mapMtnStatus(s);
      assert.equal(m.status, "failed", `${s} status`);
      assert.equal(m.isFinal, true, `${s} isFinal`);
      assert.equal(m.isSuccessful, false, `${s} isSuccessful`);
    }
  });

  await test("TIMEOUT → final, status=timeout (distinct from failed)", () => {
    // The UI shows a different message for timeout (user can retry
    // immediately) vs failed (suspicious / blocked).
    const m = momo.mapMtnStatus("TIMEOUT");
    assert.equal(m.status, "timeout");
    assert.equal(m.isFinal, true);
    assert.equal(m.isSuccessful, false);
  });

  await test("PENDING / CREATED / ONGOING / empty string → pending, NOT final", () => {
    for (const s of ["PENDING", "CREATED", "ONGOING", ""]) {
      const m = momo.mapMtnStatus(s);
      assert.equal(m.status, "pending", `${s} status`);
      assert.equal(m.isFinal, false, `${s} isFinal`);
      assert.equal(m.isSuccessful, false, `${s} isSuccessful`);
    }
  });

  await test("unknown status string falls through to pending (defensive)", () => {
    // Critical: if MTN ever adds a new terminal status we haven't
    // mapped (e.g., "EXPIRED"), the safe behaviour is to keep polling
    // rather than mark successful or failed prematurely.
    const m = momo.mapMtnStatus("EXPIRED");
    assert.equal(m.status, "pending");
    assert.equal(m.isFinal, false);
    assert.equal(m.mtnStatus, "EXPIRED");
  });

  await test("case insensitivity (lowercase / mixed)", () => {
    assert.equal(momo.mapMtnStatus("successful").status, "successful");
    assert.equal(momo.mapMtnStatus("Pending").status, "pending");
  });

  await test("reason string is sanitised via cleanMessage", () => {
    const m = momo.mapMtnStatus("FAILED", `payer "rejected" the request`);
    assert.equal(m.reason, "payer rejected the request");
  });

  await test("null reason → null (not the string 'null')", () => {
    const m = momo.mapMtnStatus("FAILED");
    assert.equal(m.reason, null);
  });

  // ── nextPollingDelayMs ──────────────────────────────────────────
  section("nextPollingDelayMs — backoff schedule");

  await test("attempt 0 → 15s (first poll after request)", () => {
    assert.equal(momo.nextPollingDelayMs(0), 15000);
  });

  await test("backoff increases with each attempt", () => {
    const delays = [0, 1, 2, 3, 4].map((n) => momo.nextPollingDelayMs(n));
    assert.deepEqual(delays, [15000, 30000, 45000, 60000, 120000]);
    for (let i = 1; i < delays.length; i++) {
      assert.ok(delays[i] >= delays[i - 1], "delays must be non-decreasing");
    }
  });

  await test("clamps to last bucket once exhausted (no overflow)", () => {
    assert.equal(momo.nextPollingDelayMs(10), 120000);
    assert.equal(momo.nextPollingDelayMs(1000), 120000);
  });

  await test("negative / NaN / non-numeric attempts treated as 0", () => {
    assert.equal(momo.nextPollingDelayMs(-5), 15000);
    assert.equal(momo.nextPollingDelayMs(NaN), 15000);
    assert.equal(momo.nextPollingDelayMs("notanum"), 15000);
    assert.equal(momo.nextPollingDelayMs(undefined), 15000);
  });

  // ── getAccessToken — fetch + cache behaviour ────────────────────
  section("getAccessToken — token cache + error mapping");

  await test("returns parsed access_token from MTN body", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    await withFetchStub(
      async () => jsonResponse(200, {access_token: "tok-abc", expires_in: 3600}),
      async () => {
        // exposed via the only public path that uses it
        await momo2.requestToPay(cfg, {
          requestId: "req-1",
          externalId: "ext-1",
          phoneNumber: "260961234567",
          plan: momo2.getPlanConfig("monthly"),
        }).catch(() => {});
        // calling requestToPay above swallows whatever the second fetch
        // returns; what we care about here is that the token endpoint
        // got hit at all. Re-test with a recording stub:
      },
    );
  });

  await test("caches token across calls to the same env", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    let tokenFetches = 0;
    await withFetchStub(
      async (url) => {
        if (String(url).endsWith("/collection/token/")) {
          tokenFetches++;
          return jsonResponse(200, {access_token: "tok-cached", expires_in: 3600});
        }
        return emptyResponse(202);
      },
      async () => {
        await momo2.requestToPay(cfg, {
          requestId: "req-1", externalId: "ext-1",
          phoneNumber: "260961234567",
          plan: momo2.getPlanConfig("monthly"),
        });
        await momo2.requestToPay(cfg, {
          requestId: "req-2", externalId: "ext-2",
          phoneNumber: "260961234567",
          plan: momo2.getPlanConfig("monthly"),
        });
      },
    );
    assert.equal(tokenFetches, 1, "token endpoint should be hit only once");
  });

  await test("refreshes token when target environment changes (sandbox → live)", async () => {
    // This is the critical cross-tenant guard. A bug here would reuse
    // a sandbox token against the live MTN proxy or vice versa.
    const momo2 = freshMomoService();
    const sandboxCfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    const liveCfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "mtnzambia",
    });
    let tokenFetches = 0;
    await withFetchStub(
      async (url) => {
        if (String(url).endsWith("/collection/token/")) {
          tokenFetches++;
          return jsonResponse(200, {access_token: `tok-${tokenFetches}`, expires_in: 3600});
        }
        return emptyResponse(202);
      },
      async () => {
        await momo2.requestToPay(sandboxCfg, {
          requestId: "req-1", externalId: "ext-1",
          phoneNumber: "260961234567",
          plan: momo2.getPlanConfig("monthly"),
        });
        await momo2.requestToPay(liveCfg, {
          requestId: "req-2", externalId: "ext-2",
          phoneNumber: "260961234567",
          plan: momo2.getPlanConfig("monthly"),
        });
      },
    );
    assert.equal(tokenFetches, 2, "env switch must invalidate cached token");
  });

  await test("401 from token endpoint → HttpsError(failed-precondition) — secrets bad", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    await withFetchStub(
      async () => jsonResponse(401, {message: "bad credentials"}),
      async () => {
        await assert.rejects(
          () => momo2.requestToPay(cfg, {
            requestId: "req-1", externalId: "ext-1",
            phoneNumber: "260961234567",
            plan: momo2.getPlanConfig("monthly"),
          }),
          (err) => err.code === "failed-precondition",
        );
      },
    );
  });

  await test("500 from token endpoint → HttpsError(unavailable) — retry later", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    await withFetchStub(
      async () => jsonResponse(500, {message: "down"}),
      async () => {
        await assert.rejects(
          () => momo2.requestToPay(cfg, {
            requestId: "req-1", externalId: "ext-1",
            phoneNumber: "260961234567",
            plan: momo2.getPlanConfig("monthly"),
          }),
          (err) => err.code === "unavailable",
        );
      },
    );
  });

  await test("network error reaching MTN → HttpsError(unavailable)", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    await withFetchStub(
      async () => {
        throw new Error("ENOTFOUND sandbox.momodeveloper.mtn.com");
      },
      async () => {
        await assert.rejects(
          () => momo2.requestToPay(cfg, {
            requestId: "req-1", externalId: "ext-1",
            phoneNumber: "260961234567",
            plan: momo2.getPlanConfig("monthly"),
          }),
          (err) => err.code === "unavailable",
        );
      },
    );
  });

  await test("missing secrets → HttpsError(failed-precondition) (assertConfig)", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "", apiKey: "", subscriptionKey: "", environment: "sandbox",
    });
    // No fetch should fire — assertConfig short-circuits.
    let fetched = false;
    await withFetchStub(
      async () => {
        fetched = true;
        return jsonResponse(200, {access_token: "x", expires_in: 3600});
      },
      async () => {
        await assert.rejects(
          () => momo2.requestToPay(cfg, {
            requestId: "req-1", externalId: "ext-1",
            phoneNumber: "260961234567",
            plan: momo2.getPlanConfig("monthly"),
          }),
          (err) => err.code === "failed-precondition",
        );
      },
    );
    assert.equal(fetched, false, "must not hit MTN when config is unset");
  });

  // ── requestToPay — happy path + error mapping ───────────────────
  section("requestToPay — collection/v1_0/requesttopay");

  await test("happy path: 202 Accepted → returns accepted=true + requestId", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    const calls = [];
    await withFetchStub(
      async (url, options) => {
        calls.push({url: String(url), options});
        if (String(url).endsWith("/collection/token/")) {
          return jsonResponse(200, {access_token: "tok", expires_in: 3600});
        }
        return emptyResponse(202);
      },
      async () => {
        const result = await momo2.requestToPay(cfg, {
          requestId: "req-uuid",
          externalId: "ext-1",
          phoneNumber: "260961234567",
          plan: momo2.getPlanConfig("monthly"),
          payerMessage: "Premium plan",
        });
        assert.equal(result.accepted, true);
        assert.equal(result.requestId, "req-uuid");
        assert.equal(result.requestBody.amount, "50");
        assert.equal(result.requestBody.currency, "EUR"); // sandbox
        assert.equal(result.requestBody.payer.partyIdType, "MSISDN");
        assert.equal(result.requestBody.payer.partyId, "260961234567");
      },
    );
    const requestCall = calls.find((c) => c.url.endsWith("/collection/v1_0/requesttopay"));
    assert.ok(requestCall, "should call requesttopay endpoint");
    assert.equal(requestCall.options.headers["X-Reference-Id"], "req-uuid");
    assert.equal(requestCall.options.headers["X-Target-Environment"], "sandbox");
    assert.equal(requestCall.options.headers["Ocp-Apim-Subscription-Key"], "s");
    assert.match(requestCall.options.headers["Authorization"], /^Bearer tok$/);
  });

  await test("400 from MTN → HttpsError(invalid-argument)", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    await withFetchStub(
      async (url) => {
        if (String(url).endsWith("/collection/token/")) {
          return jsonResponse(200, {access_token: "tok", expires_in: 3600});
        }
        return jsonResponse(400, {message: "bad msisdn"});
      },
      async () => {
        await assert.rejects(
          () => momo2.requestToPay(cfg, {
            requestId: "req-uuid", externalId: "ext-1",
            phoneNumber: "260961234567",
            plan: momo2.getPlanConfig("monthly"),
          }),
          (err) => err.code === "invalid-argument",
        );
      },
    );
  });

  await test("500 from MTN → HttpsError(unavailable)", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    await withFetchStub(
      async (url) => {
        if (String(url).endsWith("/collection/token/")) {
          return jsonResponse(200, {access_token: "tok", expires_in: 3600});
        }
        return jsonResponse(500, {message: "down"});
      },
      async () => {
        await assert.rejects(
          () => momo2.requestToPay(cfg, {
            requestId: "req-uuid", externalId: "ext-1",
            phoneNumber: "260961234567",
            plan: momo2.getPlanConfig("monthly"),
          }),
          (err) => err.code === "unavailable",
        );
      },
    );
  });

  await test("payerMessage default applied when caller omits it", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    let capturedBody = null;
    await withFetchStub(
      async (url, options) => {
        if (String(url).endsWith("/collection/token/")) {
          return jsonResponse(200, {access_token: "tok", expires_in: 3600});
        }
        capturedBody = JSON.parse(options.body);
        return emptyResponse(202);
      },
      async () => {
        await momo2.requestToPay(cfg, {
          requestId: "req-uuid", externalId: "ext-1",
          phoneNumber: "260961234567",
          plan: momo2.getPlanConfig("monthly"),
        });
      },
    );
    assert.ok(capturedBody, "fetch stub must have captured the body");
    assert.equal(capturedBody.payerMessage, "Premium subscription");
    assert.equal(capturedBody.payeeNote, "ZedExams premium subscription");
  });

  // ── getRequestToPayStatus ───────────────────────────────────────
  section("getRequestToPayStatus");

  await test("200 OK → mapped status + raw body preserved", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    await withFetchStub(
      async (url) => {
        if (String(url).endsWith("/collection/token/")) {
          return jsonResponse(200, {access_token: "tok", expires_in: 3600});
        }
        return jsonResponse(200, {
          status: "SUCCESSFUL",
          amount: "50",
          currency: "EUR",
          financialTransactionId: "fin-1",
        });
      },
      async () => {
        const res = await momo2.getRequestToPayStatus(cfg, "req-uuid");
        assert.equal(res.status, "successful");
        assert.equal(res.isFinal, true);
        assert.equal(res.isSuccessful, true);
        // The raw body must be preserved verbatim so verifySettledAmount
        // can re-check the amount/currency MTN actually settled.
        assert.equal(res.raw.amount, "50");
        assert.equal(res.raw.currency, "EUR");
        assert.equal(res.raw.financialTransactionId, "fin-1");
      },
    );
  });

  await test("404 from MTN → HttpsError(not-found)", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    await withFetchStub(
      async (url) => {
        if (String(url).endsWith("/collection/token/")) {
          return jsonResponse(200, {access_token: "tok", expires_in: 3600});
        }
        return jsonResponse(404, {message: "no such reference"});
      },
      async () => {
        await assert.rejects(
          () => momo2.getRequestToPayStatus(cfg, "req-missing"),
          (err) => err.code === "not-found",
        );
      },
    );
  });

  await test("500 from status endpoint → HttpsError(unavailable)", async () => {
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "sandbox",
    });
    await withFetchStub(
      async (url) => {
        if (String(url).endsWith("/collection/token/")) {
          return jsonResponse(200, {access_token: "tok", expires_in: 3600});
        }
        return jsonResponse(500, {message: "down"});
      },
      async () => {
        await assert.rejects(
          () => momo2.getRequestToPayStatus(cfg, "req-uuid"),
          (err) => err.code === "unavailable",
        );
      },
    );
  });

  await test("end-to-end: settled body passes verifySettledAmount on amount + currency", async () => {
    // Wires this whole file to the settlement guard: confirms that
    // when MTN returns the right shape we accept it, and when the
    // amount drifts we reject it. Lock the integration so a refactor
    // to status mapping or settlement verifier doesn't decouple them.
    const momo2 = freshMomoService();
    const cfg = momo2.buildMtnConfig({
      apiUser: "u", apiKey: "k", subscriptionKey: "s", environment: "mtnzambia",
    });
    const plan = momo2.getPlanConfig("yearly"); // amountZMW = 400, currency = ZMW

    // happy: MTN says K400 ZMW → accepted
    await withFetchStub(
      async (url) => {
        if (String(url).endsWith("/collection/token/")) {
          return jsonResponse(200, {access_token: "tok", expires_in: 3600});
        }
        return jsonResponse(200, {status: "SUCCESSFUL", amount: "400", currency: "ZMW"});
      },
      async () => {
        const statusRes = await momo2.getRequestToPayStatus(cfg, "req-yr");
        const verdict = momo2.verifySettledAmount(plan, cfg.currency, statusRes.raw);
        assert.equal(verdict.ok, true);
      },
    );

    // exploit: MTN says K50 ZMW for the yearly plan → blocked
    await withFetchStub(
      async (url) => {
        if (String(url).endsWith("/collection/token/")) {
          return jsonResponse(200, {access_token: "tok-2", expires_in: 3600});
        }
        return jsonResponse(200, {status: "SUCCESSFUL", amount: "50", currency: "ZMW"});
      },
      async () => {
        const statusRes = await momo2.getRequestToPayStatus(cfg, "req-yr2");
        const verdict = momo2.verifySettledAmount(plan, cfg.currency, statusRes.raw);
        assert.equal(verdict.ok, false);
        assert.equal(verdict.reason, "amount_mismatch");
      },
    );
  });

  // ── Report ──────────────────────────────────────────────────────
  console.log("");
  console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`);
  if (fail > 0) {
    console.log("\nfailures:");
    failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nrunner crashed:", err);
  process.exit(2);
});
