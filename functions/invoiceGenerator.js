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
 *
 * Pure formatting/numbering/template logic lives in
 * invoiceGeneratorCore.js (plain-node tested); this module keeps the
 * PDF rendering, Storage, Firestore and SMTP effects.
 */

const admin = require("firebase-admin");
const PDFDocument = require("pdfkit");
// nodemailer is required lazily in getTransporter() — see the note there.
const crypto = require("node:crypto");

const {
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
} = require("./invoiceGeneratorCore");

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
    const descLines = invoiceDescriptionLines({plan, invoice});
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
  // Lazy require, matching opsAlert.js: nodemailer costs 17.8 MiB of RSS and
  // ~47 ms, charged to all 196 exports through functions/index.js. It is
  // required only once SMTP is confirmed configured, so an instance that never
  // sends an invoice never loads it.
  const nodemailer = require("nodemailer");
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

    const storagePath = invoiceStoragePath(user.uid, payment.id);
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
        const senderDomain = senderDomainOf(senderEmail);
        const content = buildReceiptEmailContent({user, plan, payment, number});
        await transporter.sendMail({
          from: `${COMPANY_NAME} <${senderEmail}>`,
          sender: senderEmail,
          to: user.email,
          replyTo: senderEmail,
          subject: content.subject,
          text: content.text,
          html: content.html,
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

/**
 * Re-send a previously-generated invoice email. Used by the
 * /admin/payments → "Resend invoice" support action (audit D3
 * follow-up). Pulls the existing PDF from Storage rather than
 * regenerating, so the receipt the parent receives matches the
 * original invoice number + total exactly.
 *
 * Returns:
 *   { ok: true, emailedTo } on success
 *   { ok: false, reason }   on graceful skip (no invoice doc, no
 *                            user email, SMTP unconfigured)
 *
 * Throws on hard infrastructure failures so the caller can surface
 * a clear error.
 */
async function resendInvoiceEmail({invoiceId, senderEmail, senderPassword, requestedByUid}) {
  if (!invoiceId) return {ok: false, reason: "Missing invoiceId"};
  const db = admin.firestore();
  const invoiceSnap = await db.collection("invoices").doc(invoiceId).get();
  if (!invoiceSnap.exists) {
    return {ok: false, reason: "Invoice not found"};
  }
  const invoice = invoiceSnap.data() || {};
  const userSnap = await db.collection("users").doc(invoice.userId).get();
  if (!userSnap.exists) return {ok: false, reason: "Buyer profile missing"};
  const user = {uid: userSnap.id, ...(userSnap.data() || {})};
  if (!user.email) return {ok: false, reason: "Buyer has no email on file"};

  const transporter = getTransporter(senderEmail, senderPassword);
  if (!transporter) return {ok: false, reason: "SMTP not configured"};

  // Fetch the original PDF from Storage. If it's missing (rare —
  // would mean a Storage cleanup hit it), regenerate from the
  // doc's recorded amount + plan.
  let pdfBuffer = null;
  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(invoice.storagePath);
    const [exists] = await file.exists();
    if (exists) {
      const [data] = await file.download();
      pdfBuffer = data;
    }
  } catch (err) {
    console.warn("[invoiceGenerator] resend: storage fetch failed", err);
  }

  if (!pdfBuffer) {
    // Regenerate. Best-effort; loses any subtle formatting the
    // original might have had if PDFKit changed since.
    const plan = {
      id: invoice.planId,
      name: invoice.planName || invoice.planId || "Subscription",
      durationDays: 30,
    };
    const issuedAtMs = invoice.issuedAt?.toMillis ? invoice.issuedAt.toMillis() : Date.now();
    pdfBuffer = await buildInvoicePdf({
      invoice: {number: invoice.number, issuedAtMs},
      plan,
      payment: {
        id: invoice.paymentId,
        amount: invoice.amount,
        currency: invoice.currency,
        phoneNumber: invoice.phoneNumber || null,
        provider: invoice.provider || "mtn_momo",
      },
      user,
    });
  }

  const senderDomain = senderDomainOf(senderEmail);
  const content = buildResendReceiptEmailContent({user, invoice});
  await transporter.sendMail({
    from: `${COMPANY_NAME} <${senderEmail}>`,
    sender: senderEmail,
    to: user.email,
    replyTo: senderEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: [{
      filename: `${invoice.number}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    }],
    messageId: `<invoice-resend-${invoice.paymentId}-${crypto.randomUUID()}@${senderDomain}>`,
    headers: {"X-Auto-Response-Suppress": "All"},
  });

  await invoiceSnap.ref.update({
    emailedTo: user.email,
    emailedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastResentAt: admin.firestore.FieldValue.serverTimestamp(),
    lastResentBy: requestedByUid || null,
  }).catch((err) => console.warn("[invoiceGenerator] resend stamp failed", err));

  return {ok: true, emailedTo: user.email};
}

module.exports = {emitInvoice, buildInvoicePdf, shortInvoiceNumber, resendInvoiceEmail};
