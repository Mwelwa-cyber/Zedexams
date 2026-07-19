/**
 * Server-side DOCX renderer for an assessment paper / marking scheme.
 *
 * Consumes the rendering-agnostic model from renderModel.js and produces a Node
 * Buffer via docx's Packer. Images (question diagrams) are passed in already
 * fetched as { url -> { buffer, width, height } } so this stays synchronous and
 * unit-testable; a missing image renders a visible "[Figure could not be
 * loaded]" placeholder rather than a silent gap.
 *
 * No firebase / DOM imports — only `docx`.
 */

const {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun,
  Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} = require("docx");
const {sanitizeXmlText} = require("../teacherTools/xmlText");
const {buildServerPaperModel} = require("./renderModel");

const S = (t) => sanitizeXmlText(String(t == null ? "" : t));

function attributionFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: "Made with ZedExams — free CBC teacher tools at zedexams.com/teachers",
        size: 14, color: "888888",
      })],
    })],
  });
}

/** Split plain text into paragraphs on blank lines, each a docx Paragraph. */
function textParagraphs(text, opts = {}) {
  const chunks = String(text || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (!chunks.length) return [];
  return chunks.map((chunk) => new Paragraph({
    spacing: {after: 80},
    children: chunk.split("\n").flatMap((line, i) => {
      const run = new TextRun({text: S(line), size: opts.size || 22, bold: opts.bold, italics: opts.italics});
      return i === 0 ? [run] : [new TextRun({text: S(line), size: opts.size || 22, break: 1})];
    }),
  }));
}

/** Ruled answer lines (underscored rows) for written questions. */
function answerLineParagraphs(count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(new Paragraph({
      spacing: {after: 60},
      border: {bottom: {style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1}},
      children: [new TextRun({text: "", size: 22})],
    }));
  }
  return out;
}

/** Detect the image kind docx's ImageRun needs ('png'|'jpg'|'gif'|'bmp'), or null. */
function detectDocxImageType(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf[0] === 0xFF && buf[1] === 0xD8) return "jpg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "gif";
  if (buf[0] === 0x42 && buf[1] === 0x4D) return "bmp";
  return null;
}

function imageParagraph(ref, images) {
  const img = ref && images && images[ref.url];
  const type = img && img.buffer ? detectDocxImageType(img.buffer) : null;
  if (type && img.buffer.length) {
    const w = Math.min(360, img.width || 360);
    const h = Math.min(360, img.height || Math.round(w * 0.66));
    try {
      return new Paragraph({
        alignment: AlignmentType.CENTER, spacing: {before: 60, after: 60},
        children: [new ImageRun({type, data: img.buffer, transformation: {width: w, height: h}})],
      });
    } catch { /* fall through to placeholder */ }
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: {before: 60, after: 60},
    border: {top: {style: BorderStyle.DASHED, size: 6, color: "CC0000"},
      bottom: {style: BorderStyle.DASHED, size: 6, color: "CC0000"},
      left: {style: BorderStyle.DASHED, size: 6, color: "CC0000"},
      right: {style: BorderStyle.DASHED, size: 6, color: "CC0000"}},
    children: [new TextRun({text: "[Figure could not be loaded]", italics: true, color: "CC0000", size: 18})],
  });
}

/** The learner-info + total-marks banner as a bordered table. */
function learnerFieldsTable(lf) {
  const cells = [];
  if (lf.name) cells.push("Name: ______________________________");
  if (lf.className) cells.push("Class: ____________");
  if (lf.date) cells.push("Date: ____________");
  const rows = [];
  if (cells.length) {
    rows.push(new TableRow({children: [new TableCell({
      columnSpan: 2, borders: noBorders(),
      children: [new Paragraph({children: [new TextRun({text: S(cells.join("     ")), size: 22})]})],
    })]}));
  }
  const marksBits = [];
  if (lf.duration) marksBits.push(`Time: ${lf.duration}`);
  if (lf.marks) marksBits.push(`Total marks: ${lf.totalMarks}`);
  if (marksBits.length) {
    rows.push(new TableRow({children: [new TableCell({
      columnSpan: 2, borders: noBorders(),
      children: [new Paragraph({children: [new TextRun({text: S(marksBits.join("     ")), size: 22, bold: true})]})],
    })]}));
  }
  if (!rows.length) return null;
  return new Table({width: {size: 100, type: WidthType.PERCENTAGE}, rows});
}

function noBorders() {
  const none = {style: BorderStyle.NONE, size: 0, color: "FFFFFF"};
  return {top: none, bottom: none, left: none, right: none};
}

/** Render one question block → array of Paragraphs. */
function renderQuestion(b, images) {
  const out = [];
  const stemRuns = [
    new TextRun({text: `${b.n}. `, bold: true, size: 22}),
    new TextRun({text: S(b.text), size: 22}),
  ];
  if (b.marks) stemRuns.push(new TextRun({text: `   [${b.marks}]`, bold: true, size: 20, color: "555555"}));
  out.push(new Paragraph({spacing: {before: 120, after: 60}, children: stemRuns}));

  if (b.imageUrl) out.push(imageParagraph({url: b.imageUrl}, images));

  if (b.type === "mcq" && b.options.length) {
    b.options.forEach((opt, i) => {
      out.push(new Paragraph({
        indent: {left: 360}, spacing: {after: 30},
        children: [new TextRun({text: `${b.optionLetters[i]}. ${S(opt)}`, size: 22})],
      }));
    });
  } else if (b.type === "true_false") {
    out.push(new Paragraph({indent: {left: 360},
      children: [new TextRun({text: "True  /  False", size: 22})]}));
  } else if (b.type !== "mcq") {
    out.push(...answerLineParagraphs(b.answerLines));
  }

  if (b.isScheme && b.answer) {
    out.push(new Paragraph({
      spacing: {after: 60}, indent: {left: 360},
      children: [
        new TextRun({text: "Answer: ", bold: true, size: 22, color: "006600"}),
        new TextRun({text: S(b.answer), size: 22, color: "006600"}),
      ],
    }));
  }
  return out;
}

/** Build the full paragraph list for the paper body. */
function buildBodyChildren(model, images) {
  const children = [];
  // Header identity
  model.headerLines.forEach((line, i) => {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: {after: 20},
      children: [new TextRun({text: S(line), bold: i === 0, size: i === 0 ? 26 : 20})],
    }));
  });
  // Title
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, spacing: {before: 120, after: 40},
    children: [new TextRun({text: S(model.title), bold: true, size: 30})],
  }));
  const subtitle = [model.subject, model.paperName].filter(Boolean).join(" — ");
  if (subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: {after: 120},
      children: [new TextRun({text: S(subtitle), size: 24, bold: true})],
    }));
  }
  const lf = learnerFieldsTable(model.learnerFields);
  if (lf) { children.push(lf); children.push(new Paragraph({spacing: {after: 60}, children: []})); }

  for (const b of model.blocks) {
    if (b.kind === "instructions") {
      children.push(new Paragraph({spacing: {before: 80, after: 40},
        children: [new TextRun({text: "Instructions", bold: true, size: 22})]}));
      children.push(...textParagraphs(b.text));
    } else if (b.kind === "schemeBanner") {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER, spacing: {after: 80},
        children: [new TextRun({text: "MARKING KEY — TEACHER COPY", bold: true, color: "CC0000", size: 24})],
      }));
    } else if (b.kind === "sectionHeader") {
      const label = [b.letter ? `SECTION ${b.letter}` : "", b.title].filter(Boolean).join(": ");
      children.push(new Paragraph({
        spacing: {before: 160, after: 40}, heading: HeadingLevel.HEADING_2,
        children: [new TextRun({text: S(label || "SECTION"), bold: true, size: 24}),
          ...(b.marks ? [new TextRun({text: `   [${b.marks} marks]`, size: 20, color: "555555"})] : [])],
      }));
      if (b.instructions) children.push(...textParagraphs(b.instructions, {italics: true, size: 20}));
    } else if (b.kind === "passage") {
      if (b.title) children.push(new Paragraph({spacing: {before: 100, after: 20},
        children: [new TextRun({text: S(b.title), bold: true, size: 22})]}));
      children.push(...textParagraphs(b.text));
    } else if (b.kind === "question") {
      children.push(...renderQuestion(b, images));
    }
  }
  return children;
}

/**
 * Render the assessment as a DOCX Buffer.
 * @param {object} assessment
 * @param {Array} questions
 * @param {object} opts { mode, attribution, images }
 * @returns {Promise<Buffer>}
 */
async function buildAssessmentDocxBuffer(assessment, questions, opts = {}) {
  const mode = opts.mode === "scheme" ? "scheme" : "paper";
  const model = buildServerPaperModel(assessment, questions, mode);
  const children = buildBodyChildren(model, opts.images || {});
  const doc = new Document({
    creator: "ZedExams",
    title: model.title,
    sections: [{
      properties: {page: {margin: {top: 720, bottom: 720, left: 720, right: 720}}},
      footers: opts.attribution ? {default: attributionFooter()} : undefined,
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = {buildAssessmentDocxBuffer, buildBodyChildren, learnerFieldsTable};
