/**
 * Node test for functions/invoiceGeneratorCore.js — the pure
 * formatting/numbering/template logic behind the MoMo receipt
 * generator. No firebase-admin / pdfkit / nodemailer dependency, so
 * this runs under plain `node` with only the repo-root node_modules
 * present (repo convention, same as aiOperationsCore.test.js).
 *
 * Run: node functions/invoiceGeneratorCore.test.js
 */

const assert = require("node:assert");
const {
  COMPANY_NAME,
  fmtMoney,
  fmtDate,
  shortInvoiceNumber,
  invoiceStoragePath,
  invoiceDescriptionLines,
  senderDomainOf,
  buildReceiptEmailContent,
  buildResendReceiptEmailContent,
} = require("./invoiceGeneratorCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── fmtMoney: the amount a paying user reads ────────────────────────────────
ok("formats a whole ZMW amount with two decimals", fmtMoney(150, "ZMW") === "ZMW 150.00");
ok("keeps cents", fmtMoney(99.5, "ZMW") === "ZMW 99.50");
ok("rounds beyond two decimals (toFixed)", fmtMoney(10.005, "ZMW") === `ZMW ${(10.005).toFixed(2)}`);
ok("zero renders as 0.00, not blank", fmtMoney(0, "ZMW") === "ZMW 0.00");
ok("numeric string amounts coerce", fmtMoney("150", "ZMW") === "ZMW 150.00");
ok("undefined amount falls back to 0.00 (never NaN)", fmtMoney(undefined, "ZMW") === "ZMW 0.00");
ok("null amount falls back to 0.00", fmtMoney(null, "ZMW") === "ZMW 0.00");
ok("non-numeric amount falls back to 0.00", fmtMoney("abc", "ZMW") === "ZMW 0.00");
ok("currency code is printed verbatim", fmtMoney(5, "USD") === "USD 5.00");
ok("negative amounts keep their sign (refund-shaped input)", fmtMoney(-10, "ZMW") === "ZMW -10.00");

// ── fmtDate ─────────────────────────────────────────────────────────────────
ok("falsy date renders empty string", fmtDate(null) === "" && fmtDate(undefined) === "" && fmtDate(0) === "");
{
  // en-GB long format: "DD Month YYYY". Assert shape, not a fixed date.
  const sample = fmtDate(Date.UTC(2000, 0, 15));
  ok("timestamp renders as DD Month YYYY", /^\d{2} [A-Za-z]+ \d{4}$/.test(sample));
  ok("same instant renders identically twice", fmtDate(Date.UTC(2000, 0, 15)) === sample);
}

// ── shortInvoiceNumber ──────────────────────────────────────────────────────
{
  // Compute the expected UTC date stamp before AND after the call so the
  // test cannot flake across a UTC midnight boundary.
  const stamp = (dt) =>
    `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
  const before = stamp(new Date());
  const n = shortInvoiceNumber("3fa85f64-5717-4562-b3fc-2c963f66afa6");
  const after = stamp(new Date());
  ok("shape is ZE-YYYYMMDD-XXXXXX", /^ZE-\d{8}-[0-9A-Z]{6}$/.test(n));
  const datePart = n.slice(3, 11);
  ok("date part is today's UTC date", datePart === before || datePart === after);
  ok("tail is first 6 hex of the payment id, dashes stripped, uppercased", n.endsWith("-3FA85F"));
}
{
  const a = shortInvoiceNumber("3fa85f64-5717-4562-b3fc-2c963f66afa6");
  const b = shortInvoiceNumber("3fa85f64-5717-4562-b3fc-2c963f66afa6");
  ok("same payment id on the same day → same number (stable)", a === b);
}
ok("different payment ids → different tails",
    shortInvoiceNumber("aaaaaa-1").slice(-6) !== shortInvoiceNumber("bbbbbb-1").slice(-6));
ok("missing payment id degrades to an empty tail, never throws",
    /^ZE-\d{8}-$/.test(shortInvoiceNumber(undefined)));
ok("short payment id keeps whatever is there",
    shortInvoiceNumber("ab-c").endsWith("-ABC"));

// ── invoiceStoragePath ──────────────────────────────────────────────────────
ok("storage path matches the invoices/{uid}/{paymentId}.pdf contract",
    invoiceStoragePath("user1", "pay1") === "invoices/user1/pay1.pdf");

// ── invoiceDescriptionLines ─────────────────────────────────────────────────
{
  const issuedAtMs = Date.UTC(2000, 5, 1);
  const lines = invoiceDescriptionLines({
    plan: {name: "Premium", durationDays: 30},
    invoice: {issuedAtMs},
  });
  ok("two description lines", lines.length === 2);
  ok("line 1 names the plan", lines[0] === "Premium subscription");
  ok("line 2 carries duration + activation date",
      lines[1] === `30 days · activated ${fmtDate(issuedAtMs)}`);
}

// ── senderDomainOf ──────────────────────────────────────────────────────────
ok("extracts the sender's domain", senderDomainOf("noreply@example.org") === "example.org");
ok("falls back to the company domain for a malformed sender", senderDomainOf("no-at-sign") === "zedexams.com");

// ── buildReceiptEmailContent ────────────────────────────────────────────────
{
  const content = buildReceiptEmailContent({
    user: {displayName: "Chanda"},
    plan: {name: "Premium", durationDays: 30},
    payment: {amount: 150, currency: "ZMW"},
    number: "ZE-XXXXXXXX-ABC123",
  });
  ok("subject carries company + invoice number",
      content.subject === `Your ${COMPANY_NAME} receipt — ZE-XXXXXXXX-ABC123`);
  ok("text greets by display name", content.text.startsWith("Hi Chanda,"));
  ok("text carries the exact formatted amount", content.text.includes("Amount:  ZMW 150.00"));
  ok("text carries the invoice number", content.text.includes("Invoice: ZE-XXXXXXXX-ABC123"));
  ok("html carries the plan name and duration",
      content.html.includes("<strong>Premium</strong>") && content.html.includes("<strong>30 days</strong>"));
  ok("html carries the exact formatted amount", content.html.includes("ZMW 150.00"));
}
{
  const content = buildReceiptEmailContent({
    user: {},
    plan: {name: "Basic", durationDays: 7},
    payment: {amount: 0, currency: "ZMW"},
    number: "ZE-XXXXXXXX-",
  });
  ok("no display name → bare greeting, no dangling space",
      content.text.startsWith("Hi,") && content.html.startsWith("<p>Hi,</p>"));
  ok("zero amount still prints 0.00", content.text.includes("ZMW 0.00"));
}

// ── buildResendReceiptEmailContent ──────────────────────────────────────────
{
  const content = buildResendReceiptEmailContent({
    user: {displayName: "Chanda"},
    invoice: {number: "ZE-XXXXXXXX-ABC123", amount: 99.5, currency: "ZMW"},
  });
  ok("resend subject marks the copy as resent",
      content.subject === `Your ${COMPANY_NAME} receipt — ZE-XXXXXXXX-ABC123 (resent)`);
  ok("resend text uses the STORED amount, formatted", content.text.includes("Amount:  ZMW 99.50"));
  ok("resend text carries the original invoice number", content.text.includes("Invoice: ZE-XXXXXXXX-ABC123"));
  ok("resend html carries the amount", content.html.includes("ZMW 99.50"));
}
{
  const content = buildResendReceiptEmailContent({
    user: {},
    invoice: {number: "ZE-XXXXXXXX-", amount: undefined, currency: "ZMW"},
  });
  ok("resend with malformed stored amount never prints NaN",
      !content.text.includes("NaN") && content.text.includes("ZMW 0.00"));
}

console.log(`\ninvoiceGeneratorCore.test.js: all ${passed} assertions passed`);
