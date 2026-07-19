/**
 * Server-side PDF renderer for an assessment paper / marking scheme, via
 * pdfkit. Consumes the same rendering-agnostic model as renderDocx.js so the
 * two formats stay structurally aligned. Returns a Node Buffer.
 *
 * Images are passed in already-fetched ({ url -> { buffer } }); a missing image
 * draws a dashed placeholder box rather than a silent gap. No firebase / DOM
 * imports — only `pdfkit`.
 */

const PDFDocument = require("pdfkit");
const {buildServerPaperModel} = require("./renderModel");

const PAGE_MARGIN = 54;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2; // A4 width in pt minus margins

/** Collect a pdfkit document into a single Buffer. */
function docToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/** Draw a horizontal ruled answer line at the current y. */
function drawAnswerLines(doc, count) {
  for (let i = 0; i < count; i += 1) {
    doc.moveDown(0.9);
    const y = doc.y;
    doc.save().strokeColor("#999999").lineWidth(0.5)
      .moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + CONTENT_WIDTH, y).stroke().restore();
  }
  doc.moveDown(0.4);
}

function placeholderBox(doc) {
  const y = doc.y + 4;
  doc.save().dash(3, {space: 2}).strokeColor("#CC0000").lineWidth(1)
    .rect(PAGE_MARGIN + 40, y, CONTENT_WIDTH - 80, 40).stroke().undash().restore();
  doc.fillColor("#CC0000").fontSize(9).text("[Figure could not be loaded]",
    PAGE_MARGIN + 40, y + 15, {width: CONTENT_WIDTH - 80, align: "center"});
  doc.fillColor("#000000").y = y + 48;
}

function drawImage(doc, ref, images) {
  const img = ref && images && images[ref.url];
  if (img && img.buffer && img.buffer.length) {
    try {
      const w = Math.min(260, CONTENT_WIDTH);
      doc.moveDown(0.3);
      doc.image(img.buffer, {fit: [w, 200], align: "center"});
      doc.moveDown(0.3);
      return;
    } catch { /* placeholder below */ }
  }
  placeholderBox(doc);
}

function renderQuestion(doc, b, images) {
  doc.moveDown(0.6);
  const marks = b.marks ? `   [${b.marks}]` : "";
  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(11)
    .text(`${b.n}. `, {continued: true})
    .font("Helvetica").text(b.text || "", {continued: Boolean(marks)});
  if (marks) doc.font("Helvetica-Bold").fillColor("#555555").text(marks).fillColor("#000000");

  if (b.imageUrl) drawImage(doc, {url: b.imageUrl}, images);

  if (b.type === "mcq" && b.options.length) {
    doc.font("Helvetica").fontSize(11);
    b.options.forEach((opt, i) => {
      doc.text(`     ${b.optionLetters[i]}. ${opt}`);
    });
  } else if (b.type === "true_false") {
    doc.font("Helvetica").fontSize(11).text("     True  /  False");
  } else if (b.type !== "mcq") {
    drawAnswerLines(doc, b.answerLines);
  }

  if (b.isScheme && b.answer) {
    doc.font("Helvetica-Bold").fillColor("#006600").fontSize(11)
      .text("     Answer: ", {continued: true})
      .font("Helvetica").text(b.answer).fillColor("#000000");
  }
}

/**
 * Render the assessment as a PDF Buffer.
 * @returns {Promise<Buffer>}
 */
async function buildAssessmentPdfBuffer(assessment, questions, opts = {}) {
  const mode = opts.mode === "scheme" ? "scheme" : "paper";
  const model = buildServerPaperModel(assessment, questions, mode);
  const doc = new PDFDocument({size: "A4", margin: PAGE_MARGIN, bufferPages: true,
    info: {Title: model.title, Author: "ZedExams"}});

  // Header identity
  model.headerLines.forEach((line, i) => {
    doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(i === 0 ? 14 : 10)
      .fillColor("#000000").text(line, {align: "center"});
  });
  doc.moveDown(0.4).font("Helvetica-Bold").fontSize(15).text(model.title, {align: "center"});
  const subtitle = [model.subject, model.paperName].filter(Boolean).join(" — ");
  if (subtitle) doc.moveDown(0.2).fontSize(12).text(subtitle, {align: "center"});

  // Learner fields
  const lf = model.learnerFields;
  const infoBits = [];
  if (lf.name) infoBits.push("Name: ______________________");
  if (lf.className) infoBits.push("Class: __________");
  if (lf.date) infoBits.push("Date: __________");
  doc.moveDown(0.6).font("Helvetica").fontSize(10).fillColor("#000000");
  if (infoBits.length) doc.text(infoBits.join("      "));
  const marksBits = [];
  if (lf.duration) marksBits.push(`Time: ${lf.duration}`);
  if (lf.marks) marksBits.push(`Total marks: ${lf.totalMarks}`);
  if (marksBits.length) doc.font("Helvetica-Bold").text(marksBits.join("      "));

  for (const b of model.blocks) {
    if (b.kind === "instructions") {
      doc.moveDown(0.5).font("Helvetica-Bold").fontSize(11).text("Instructions");
      doc.font("Helvetica").fontSize(11).text(b.text);
    } else if (b.kind === "schemeBanner") {
      doc.moveDown(0.4).font("Helvetica-Bold").fontSize(12).fillColor("#CC0000")
        .text("MARKING KEY — TEACHER COPY", {align: "center"}).fillColor("#000000");
    } else if (b.kind === "sectionHeader") {
      const label = [b.letter ? `SECTION ${b.letter}` : "", b.title].filter(Boolean).join(": ");
      const marks = b.marks ? `   [${b.marks} marks]` : "";
      doc.moveDown(0.7).font("Helvetica-Bold").fontSize(12).text(`${label || "SECTION"}${marks}`);
      if (b.instructions) doc.font("Helvetica-Oblique").fontSize(10).text(b.instructions);
    } else if (b.kind === "passage") {
      if (b.title) doc.moveDown(0.5).font("Helvetica-Bold").fontSize(11).text(b.title);
      doc.font("Helvetica").fontSize(11).text(b.text);
    } else if (b.kind === "question") {
      renderQuestion(doc, b, opts.images || {});
    }
  }

  // Attribution footer on every page.
  if (opts.attribution) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const bottom = doc.page.height - PAGE_MARGIN + 6;
      doc.font("Helvetica").fontSize(7).fillColor("#888888")
        .text("Made with ZedExams — free CBC teacher tools at zedexams.com/teachers",
          PAGE_MARGIN, bottom, {width: CONTENT_WIDTH, align: "center", lineBreak: false});
    }
  }

  return docToBuffer(doc);
}

module.exports = {buildAssessmentPdfBuffer};
