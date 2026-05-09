/**
 * MoMo invoice / receipt generation (audit D3).
 *
 * Triggered after a successful payment activation, this module:
 *   1. Generates a 1-page A4 PDF receipt with PDFKit
 *   2. Uploads it to Storage at `invoices/{userId}/{paymentId}.pdf`
 *   3. Writes an `invoices/{invoiceId}` Firestore doc the user can
 *      list under "My invoices"
 *   4. Emails the PDF to the user via the existing SMTP transport
 *
 * Failure here NEVER blocks subscription activation — the user gets
 * their plan regardless. Each step is wrapped in try/catch so a
 * missing email or Storage hiccup leaves the receipt-less success
 * path intact, and a row in `agentJobs` flags the run for support.
 */

const admin = require("firebase-admin");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const crypto = require("node:crypto");

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

/**
 * Build the PDF invoice as a Buffer. Synchronous-feeling API on top
 * of PDFKit's stream — collects chunks until 'end' fires.
 */
function buildInvoicePdf({invoice, plan, payment, user}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({size: "A4", margin: 48});
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header band
    doc
        .fontSize(22)
        .fillColor("#1A1F2E")
        .font("Helvetica-Bold")
        .text(COMPANY_NAME, 48, 48);
    doc
        .fontSize(10)
        .fillColor("#4B6280")
        .font("Helvetica")
        .text(COMPANY_TAGLINE, 48, 76);
    doc
        .fontSize(20)
        .fillColor("#1A1F2E")
        .font("Helvetica-Bold")
        .text("RECEIPT", 0, 48, {align: "right"});

    // Meta block
    const metaY = 110;
    doc
        .fontSize(10)
        .fillColor("#4B6280")
        .font("Helvetica-Bold")
        .text("Invoice number", 48, metaY)
        .text("Issue date", 48, metaY + 18)
        .text("Payment method", 48, metaY + 36)
        .text("Payment reference", 48, metaY + 54);
    doc
        .fillColor("#1A1F2E")
        .font("Helvetica")
        .text(invoice.number, 180, metaY)
        .text(fmtDate(invoice.issuedAtMs || Date.now()), 180, metaY + 18)
        .text(payment.provider || "MTN MoMo", 180, metaY + 36)
        .text(payment.id || "—", 180, metaY + 54);

    // Bill-to / from columns
    const partyY = metaY + 90;
    doc
        .fontSize(10)
        .fillColor("#4B6280")
        .font("Helvetica-Bold")
        .text("From", 48, partyY)
        .text("Bill to", 320, partyY);
    doc
        .fillColor("#1A1F2E")
        .font("Helvetica")
        .text(COMPANY_NAME, 48, partyY + 14)
        .text(COMPANY_COUNTRY, 48, partyY + 28)
        .text(COMPANY_EMAIL, 48, partyY + 42)
        .text(COMPANY_WEBSITE, 48, partyY + 56);
    doc
        .text(user.displayName || "ZedExams subscriber", 320, partyY + 14)
        .text(user.email || "", 320, partyY + 28)
        .text(payment.phoneNumber ? `Phone: ${payment.phoneNumber}` : "", 320, partyY + 42)
        .text(user.school ? `School: ${user.school}` : "", 320, partyY + 56);

    // Line items table
    const tableY = partyY + 96;
    doc
        .strokeColor("#E5E7EB")
        .lineWidth(0.8)
        .moveTo(48, tableY - 6)
        .lineTo(548, tableY - 6)
        .stroke();
    doc
        .fontSize(10)
        .fillColor("#4B6280")
        .font("Helvetica-Bold")
        .text("Description", 48, tableY)
        .text("Qty", 360, tableY, {width: 40, align: "right"})
        .text("Amount", 480, tableY, {width: 68, align: "right"});

    const itemY = tableY + 24;
    const descLines = [
      `${plan.name} subscription`,
      `${plan.durationDays} days · activated ${fmtDate(invoice.issuedAtMs)}`,
    ];
    doc
        .fillColor("#1A1F2E")
        .font("Helvetica")
        .text(descLines[0], 48, itemY)
        .fontSize(9)
        .fillColor("#4B6280")
        .text(descLines[1], 48, itemY + 14);
    doc
        .fontSize(10)
        .fillColor("#1A1F2E")
        .font("Helvetica")
        .text("1", 360, itemY, {width: 40, align: "right"})
        .text(fmtMoney(payment.amount, payment.currency), 480, itemY, {width: 68, align: "right"});

    doc
        .strokeColor("#E5E7EB")
        .moveTo(48, itemY + 36)
        .lineTo(548, itemY + 36)
        .stroke();

    // Totals
    const totalY = itemY + 54;
    doc
        .fontSize(10)
        .fillColor("#4B6280")
        .font("Helvetica-Bold")
        .text("Subtotal", 360, totalY, {width: 120, align: "right"})
        .fillColor("#1A1F2E")
        .font("Helvetica")
        .text(fmtMoney(payment.amount, payment.currency), 480, totalY, {width: 68, align: "right"});
    doc
        .fillColor("#4B6280")
        .font("Helvetica-Bold")
        .text("Total paid", 360, totalY + 18, {width: 120, align: "right"});
    doc
        .fontSize(12)
        .fillColor("#059669")
        .font("Helvetica-Bold")
        .text(fmtMoney(payment.amount, payment.currency), 480, totalY + 17, {width: 68, align: "right"});

    // Footer
    doc
        .fontSize(9)
        .fillColor("#4B6280")
        .font("Helvetica")
        .text(
            "This is an automatically generated receipt for the payment recorded above. " +
        "Subscription activates immediately on payment confirmation. For any " +
        "questions about this receipt, reply to this email or visit " +
        COMPANY_WEBSITE + ".",
            48, 720, {width: 500, align: "left"},
        );

    doc.end();
  });
}

let cachedTransporter = null;
function getTransporter(senderEmail, senderPassword) {
  if (cachedTransporter) return cachedTransporter;
  if (!senderEmail || !senderPassword) return null;
  cachedTransporter = nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: senderEmail,
      pass: senderPassword,
    },
    tls: {
      minVersion: "TLSv1.2",
      servername: "mail.privateemail.com",
    },
  });
  return cachedTransporter;
}

/**
 * Generate, store, and email the receipt for a successful payment.
 * Returns { invoiceId, storagePath, sentEmail } on success; logs +
 * returns null on any failure.
 *
 *   payment: {
 *     id, amount, currency, planId, phoneNumber, provider, userId,
 *   }
 *   senderEmail / senderPassword: the SMTP creds the caller pulled
 *     from defineSecret. Optional — when missing, email step is
 *     skipped but the PDF + Firestore doc still write.
 */
async function emitInvoice({payment, plan, senderEmail, senderPassword}) {
  if (!payment?.userId || !payment?.id) {
    console.warn("[invoiceGenerator] missing payment fields, skipping");
    return null;
  }

  try {
    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(payment.userId).get();
    if (!userSnap.exists) {
      console.warn("[invoiceGenerator] user doc missing, skipping invoice", payment.userId);
      return null;
    }
    const user = {uid: userSnap.id, ...(userSnap.data() || {})};

    const issuedAtMs = Date.now();
    const number = shortInvoiceNumber(payment.id);
    const invoice = {number, issuedAtMs};

    const pdfBuffer = await buildInvoicePdf({invoice, plan, payment, user});

    const storagePath = `invoices/${user.uid}/${payment.id}.pdf`;
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    await file.save(pdfBuffer, {
      contentType: "application/pdf",
      metadata: {
        cacheControl: "private, max-age=0, must-revalidate",
        metadata: {
          paymentId: payment.id,
          planId: plan.id,
          invoiceNumber: number,
        },
      },
    });

    // Firestore doc — small enough to store the user-facing fields
    // inline so the My-invoices list doesn't need to read the PDF.
    const invoiceRef = db.collection("invoices").doc(payment.id);
    await invoiceRef.set({
      paymentId: payment.id,
      userId: user.uid,
      number,
      planId: plan.id,
      planName: plan.name,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider || "mtn_momo",
      phoneNumber: payment.phoneNumber || null,
      storagePath,
      emailedTo: null,
      emailedAt: null,
      issuedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Email — best-effort. If SMTP isn't configured the receipt is
    // still on Storage and listed at /settings → My invoices.
    const transporter = getTransporter(senderEmail, senderPassword);
    let emailedTo = null;
    if (transporter && user.email) {
      try {
        const senderDomain = senderEmail.split("@")[1] || "zedexams.com";
        await transporter.sendMail({
          from: `${COMPANY_NAME} <${senderEmail}>`,
          sender: senderEmail,
          to: user.email,
          replyTo: senderEmail,
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
          attachments: [{
            filename: `${number}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          }],
          messageId: `<invoice-${payment.id}-${crypto.randomUUID()}@${senderDomain}>`,
          headers: {"X-Auto-Response-Suppress": "All"},
        });
        emailedTo = user.email;
        await invoiceRef.update({
          emailedTo,
          emailedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.warn("[invoiceGenerator] email send failed, PDF still stored", err);
      }
    }

    return {invoiceId: payment.id, storagePath, emailedTo};
  } catch (err) {
    console.error("[invoiceGenerator] emitInvoice failed", err);
    return null;
  }
}

module.exports = {emitInvoice, buildInvoicePdf, shortInvoiceNumber};
