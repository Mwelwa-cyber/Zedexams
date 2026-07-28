/**
 * functions/invoiceGeneratorCore.js
 *
 * Pure decision/formatting logic behind the MoMo invoice generator — no
 * firebase-admin, pdfkit or nodemailer imports, so it runs under plain
 * `node functions/invoiceGeneratorCore.test.js` (same *Core.js split as
 * aiOperationsCore.js / googlePlayBillingCore.js). The effectful half
 * (PDF rendering, Storage upload, Firestore writes, SMTP send) stays in
 * invoiceGenerator.js, which delegates here.
 *
 * MONEY-ADJACENT: these functions decide the amounts and invoice numbers
 * a paying user reads on their receipt. Behaviour must match what
 * invoiceGenerator.js printed before the split — do not "improve"
 * formatting here without an owner decision.
 */

const COMPANY_NAME = "ZedExams";
const COMPANY_TAGLINE = "Zambian CBC exam prep";
const COMPANY_EMAIL = "support@zedexams.com";
const COMPANY_WEBSITE = "https://zedexams.com";
const COMPANY_COUNTRY = "Zambia";

function fmtMoney(amount, currency) {
  return `${currency} ${(Number(amount) || 0).toFixed(2)}`;
}

function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function shortInvoiceNumber(paymentId) {
  // Friendly invoice number: ZE-YYYYMMDD-{first 6 of payment id}.
  // The payment id alone is 36 chars (uuid) which looks ugly on a
  // PDF; this preserves a one-to-one mapping while reading better
  // for humans.
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  const tail = String(paymentId || "").replace(/-/g, "").slice(0, 6).toUpperCase();
  return `ZE-${y}${m}${d}-${tail}`;
}

/** Storage location of the generated receipt PDF. */
function invoiceStoragePath(userId, paymentId) {
  return `invoices/${userId}/${paymentId}.pdf`;
}

/** The two description lines printed in the PDF's line-items table. */
function invoiceDescriptionLines({plan, invoice}) {
  return [
    `${plan.name} subscription`,
    `${plan.durationDays} days · activated ${fmtDate(invoice.issuedAtMs)}`,
  ];
}

/** Domain used in the RFC 5322 Message-ID; falls back to the company domain. */
function senderDomainOf(senderEmail) {
  return senderEmail.split("@")[1] || "zedexams.com";
}

/**
 * Subject + text + html bodies for the first-send receipt email.
 * The PDF attachment / SMTP envelope stay with the caller.
 */
function buildReceiptEmailContent({user, plan, payment, number}) {
  return {
    subject: `Your ${COMPANY_NAME} receipt — ${number}`,
    text: [
      `Hi${user.displayName ? ` ${user.displayName}` : ""},`,
      "",
      `Thanks for your payment. Your ${plan.name} subscription is active for ${plan.durationDays} days.`,
      "",
      `Invoice: ${number}`,
      `Amount:  ${fmtMoney(payment.amount, payment.currency)}`,
      "",
      "Your receipt is attached as a PDF.",
      "",
      "— ZedExams",
    ].join("\n"),
    html: `<p>Hi${user.displayName ? ` ${user.displayName}` : ""},</p>
<p>Thanks for your payment. Your <strong>${plan.name}</strong> subscription is active for <strong>${plan.durationDays} days</strong>.</p>
<p><strong>Invoice:</strong> ${number}<br />
<strong>Amount:</strong> ${fmtMoney(payment.amount, payment.currency)}</p>
<p>Your receipt is attached as a PDF.</p>
<p>— ZedExams</p>`,
  };
}

/**
 * Subject + text + html bodies for the admin "Resend invoice" email.
 * Amounts come from the stored invoice doc, never recomputed.
 */
function buildResendReceiptEmailContent({user, invoice}) {
  return {
    subject: `Your ${COMPANY_NAME} receipt — ${invoice.number} (resent)`,
    text: [
      `Hi${user.displayName ? ` ${user.displayName}` : ""},`,
      "",
      `As requested, here's a fresh copy of your receipt.`,
      "",
      `Invoice: ${invoice.number}`,
      `Amount:  ${fmtMoney(invoice.amount, invoice.currency)}`,
      "",
      "Your receipt is attached as a PDF.",
      "",
      "— ZedExams",
    ].join("\n"),
    html: `<p>Hi${user.displayName ? ` ${user.displayName}` : ""},</p>
<p>As requested, here&rsquo;s a fresh copy of your receipt.</p>
<p><strong>Invoice:</strong> ${invoice.number}<br />
<strong>Amount:</strong> ${fmtMoney(invoice.amount, invoice.currency)}</p>
<p>Your receipt is attached as a PDF.</p>
<p>— ZedExams</p>`,
  };
}

module.exports = {
  COMPANY_NAME,
  COMPANY_TAGLINE,
  COMPANY_EMAIL,
  COMPANY_WEBSITE,
  COMPANY_COUNTRY,
  fmtMoney,
  fmtDate,
  shortInvoiceNumber,
  invoiceStoragePath,
  invoiceDescriptionLines,
  senderDomainOf,
  buildReceiptEmailContent,
  buildResendReceiptEmailContent,
};
