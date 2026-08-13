/**
 * Server-side (Cloud Functions, CJS) port of src/engines/export-engine/lessonPlanToDocx.js.
 *
 * Builds a Word (.docx) lesson plan from a validated lesson-plan JSON object,
 * matching the browser version's document structure byte-for-byte in behaviour
 * (same v1/v2/v3 schema detection, same sections, same formatting).
 *
 * Differences from the browser version, both required by Node:
 *   - returns a Node Buffer via Packer.toBuffer() instead of a Blob.
 *   - fetches the lesson illustration bytes with global fetch() (Node 22) inside
 *     the async entry point, then hands them to the same synchronous builder.
 *
 * No browser/DOM and no firebase imports — only `docx` and global `fetch`.
 */

const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  ImportedXmlComponent,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require("docx");
const { sanitizeXmlText } = require("./xmlText");

/* ────────────────────────────────────────────────────────────────────
 * Attribution (ported verbatim from src/utils/docxAttribution.js).
 * ─────────────────────────────────────────────────────────────────── */

// Short brand text for the diagonal watermark — keep it terse so the WordArt
// path stays legible when rotated across the page.
const WATERMARK_TEXT = "ZedExams.com";

function attributionFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: "Made with ZedExams — free CBC teacher tools at zedexams.com/teachers",
            size: 14,
            color: "888888",
          }),
        ],
      }),
    ],
  });
}

// Canonical WordArt text-effect shape (`_x0000_t136`) — the same shape Word
// itself writes for a text watermark. Declared once inside the <w:pict> so the
// <v:shape> below can reference it via `type="#_x0000_t136"`.
const WATERMARK_SHAPETYPE =
  "<v:shapetype id=\"_x0000_t136\" coordsize=\"21600,21600\" o:spt=\"136\" adj=\"10800\" path=\"m@7,l@8,xe\">" +
  "<v:formulas><v:f eqn=\"sum #0 0 10800\"/><v:f eqn=\"prod #0 2 1\"/><v:f eqn=\"sum 21600 0 @1\"/>" +
  "<v:f eqn=\"sum 0 0 @2\"/><v:f eqn=\"sum 21600 0 @3\"/><v:f eqn=\"if @0 @3 0\"/><v:f eqn=\"if @0 21600 @1\"/>" +
  "<v:f eqn=\"if @0 0 @2\"/><v:f eqn=\"if @0 @4 21600\"/><v:f eqn=\"mid @5 @6\"/><v:f eqn=\"mid @8 @5\"/>" +
  "<v:f eqn=\"mid @7 @8\"/><v:f eqn=\"mid @6 @7\"/><v:f eqn=\"sum @6 0 @5\"/></v:formulas>" +
  "<v:path textpathok=\"t\" o:connecttype=\"custom\" o:connectlocs=\"@9,0;@10,10800;@11,21600;@12,10800\" " +
  "o:connectangles=\"270,180,90,0\"/><v:textpath on=\"t\" fitshape=\"t\"/>" +
  "<v:handles><v:h position=\"#0,bottomRight\" xrange=\"6629,14971\"/></v:handles>" +
  "<o:lock v:ext=\"edit\" text=\"t\" shapetype=\"t\"/></v:shapetype>";

function watermarkRunXml(text) {
  const safe = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return (
    "<w:r xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" " +
    "xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" " +
    "xmlns:w10=\"urn:schemas-microsoft-com:office:word\">" +
    "<w:rPr><w:noProof/></w:rPr><w:pict>" +
    WATERMARK_SHAPETYPE +
    "<v:shape id=\"ZedExamsWatermark\" o:spid=\"_x0000_s2049\" type=\"#_x0000_t136\" " +
    "style=\"position:absolute;margin-left:0;margin-top:0;width:450pt;height:112.5pt;rotation:315;" +
    "z-index:-251654144;mso-position-horizontal:center;mso-position-horizontal-relative:margin;" +
    "mso-position-vertical:center;mso-position-vertical-relative:margin\" fillcolor=\"#d9d9d9\" stroked=\"f\">" +
    "<v:fill opacity=\".55\"/>" +
    `<v:textpath style="font-family:&quot;Calibri&quot;,sans-serif;font-size:1pt" string="${safe}"/>` +
    "</v:shape></w:pict></w:r>"
  );
}

// The watermark lives in the page header so it repeats on every page and sits
// behind the body text. A header paragraph is the standard host for a Word
// text watermark.
function attributionWatermarkHeader() {
  return new Header({
    children: [
      new Paragraph({ children: [ImportedXmlComponent.fromXmlString(watermarkRunXml(WATERMARK_TEXT))] }),
    ],
  });
}

/**
 * Spread into a section literal: `...attributionSection(opts)` adds the diagonal
 * watermark header AND the page footer when opts.attribution is true, and
 * nothing otherwise (so paid/admin exports stay completely clean).
 */
function attributionSection(opts) {
  if (!opts || !opts.attribution) return {};
  return {
    headers: { default: attributionWatermarkHeader() },
    footers: { default: attributionFooter() },
  };
}

/* ────────────────────────────────────────────────────────────────────
 * Lesson illustration (black-and-white drawing) embedding.
 * ─────────────────────────────────────────────────────────────────── */

// docx v9 requires ImageRun.type; sniff it from the leading magic bytes.
// generateDiagram always saves PNG, so png is the safe default.
function detectDocxImageType(bytes) {
  if (!bytes || bytes.length < 4) return "png";
  const [b0, b1, b2, b3] = bytes;
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return "png";
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return "jpg";
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return "gif";
  if (b0 === 0x42 && b1 === 0x4d) return "bmp";
  return "png";
}

// Aspect-fit the drawing into a printable box (pixels, for the docx
// transformation). Derives the ratio from the generated size string so a
// portrait/landscape diagram isn't squashed.
function illustrationBox(size) {
  const m = /^(\d+)x(\d+)$/.exec(String(size || "1365x1024"));
  const w = m ? Number(m[1]) : 1365;
  const h = m ? Number(m[2]) : 1024;
  const maxW = 440;
  return { width: maxW, height: Math.max(1, Math.round(maxW * (h / w))) };
}

// Fetch the PNG bytes so the (sync) document builder can embed them. Returns
// `{ bytes, type }` on success, `{ failed: true }` so the builder can drop in
// a visible note, or null when there's nothing to embed.
async function fetchLessonDiagramImage(diagram) {
  if (!diagram || !diagram.url) return null;
  try {
    const res = await fetch(diagram.url);
    if (!res.ok) return { failed: true };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) return { failed: true };
    return { bytes, type: detectDocxImageType(bytes) };
  } catch {
    return { failed: true };
  }
}

// Paragraphs for the lesson illustration: a CAPS label, the centred image (or
// a red note when the bytes couldn't be read cross-origin), and the prompt as
// an italic caption. Returns [] when the plan has no drawing.
function lessonIllustrationParagraphs(plan, opts) {
  const diagram = plan && plan.lessonDiagram;
  if (!diagram || !diagram.url) return [];
  const img = opts && opts.diagramImage;
  const alt = String(diagram.prompt || "").trim();
  const out = [
    new Paragraph({
      children: [text("TEACHING ILLUSTRATION", { bold: true, size: 20 })],
      spacing: { before: 160, after: 80 },
    }),
  ];
  if (img && img.bytes) {
    const { width, height } = illustrationBox(diagram.size);
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new ImageRun({
        type: img.type || "png",
        data: img.bytes,
        transformation: { width, height },
        ...(alt ? { altText: { name: alt, title: alt, description: alt } } : {}),
      })],
    }));
    if (alt) {
      out.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [text(alt, { italics: true, size: 16, color: "6b7280" })],
      }));
    }
  } else {
    out.push(new Paragraph({
      spacing: { after: 120 },
      children: [text(
        "Illustration could not be embedded — open the plan in the studio and download again.",
        { italics: true, size: 16, color: "b91c1c" },
      )],
    }));
  }
  return out;
}

const CELL_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "888888" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "888888" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "888888" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "888888" },
};

function text(str, opts = {}) {
  // Sanitize at this single funnel — every run's text passes through here, so
  // stripping XML-illegal characters once keeps Word from rejecting the whole
  // download as "unreadable content" / "alternate formats".
  return new TextRun({ text: sanitizeXmlText(str), ...opts });
}

function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 120 },
    ...opts,
  });
}

function h1(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 32 })],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  });
}

function h2(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 24, color: "1f2937" })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 120 },
  });
}

function labelCell(label, widthPct = 30) {
  return new TableCell({
    children: [para(text(label, { bold: true, size: 20 }))],
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: CELL_BORDER,
    shading: { fill: "f3f4f6" },
  });
}

function valueCell(value, widthPct = 70) {
  return new TableCell({
    children: [para(text(value, { size: 20 }))],
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: CELL_BORDER,
  });
}

function bulletList(items = []) {
  if (!items || !items.length) return [para(text("—", { italics: true, color: "9ca3af" }))];
  return items.map((line) =>
    new Paragraph({
      children: [text(line, { size: 20 })],
      bullet: { level: 0 },
      spacing: { after: 60 },
    }),
  );
}

function numberedList(items = []) {
  if (!items || !items.length) return [para(text("—", { italics: true, color: "9ca3af" }))];
  return items.map((line, i) =>
    new Paragraph({
      children: [text(`${i + 1}. `, { bold: true, size: 20 }), text(line, { size: 20 })],
      spacing: { after: 60 },
    }),
  );
}

function headerTable(header = {}) {
  const hasAttendance =
    header.boysPresent != null || header.girlsPresent != null || header.totalPupils != null;
  const attendance = hasAttendance
    ? `${header.boysPresent ?? "—"} boys · ${header.girlsPresent ?? "—"} girls · Total: ${header.totalPupils ?? header.numberOfPupils ?? "—"}`
    : header.numberOfPupils;
  const rows = [
    ["School", header.school],
    ["Teacher", header.teacherName],
    ["Date", header.date],
    ["Time", header.time],
    ["Duration", header.durationMinutes ? `${header.durationMinutes} minutes` : ""],
    ["Class", header.class],
    ["Subject", header.subject],
    ["Topic", header.topic],
    ["Sub-topic", header.subtopic],
    ["Term & Week", header.termAndWeek],
    ["Attendance", attendance],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({
      children: [labelCell(k), valueCell(String(v))],
    })),
  });
}

function phaseTableV2(phase, minutes, teacher = [], learners = [], criteria = []) {
  const title = minutes != null ? `${phase} (${minutes} minutes)` : phase;
  const titleRow = new TableRow({
    children: [
      new TableCell({
        children: [para(text(title, { bold: true, size: 22 }))],
        columnSpan: 2,
        borders: CELL_BORDER,
        shading: { fill: "e0e7ff" },
      }),
    ],
  });
  const headersRow = new TableRow({
    children: [
      new TableCell({
        children: [para(text("Teacher Activities", { bold: true, size: 20 }))],
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: "f9fafb" },
      }),
      new TableCell({
        children: [para(text("Learner Activities", { bold: true, size: 20 }))],
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: "f9fafb" },
      }),
    ],
  });
  const contentRow = new TableRow({
    children: [
      new TableCell({ children: bulletList(teacher), borders: CELL_BORDER }),
      new TableCell({ children: bulletList(learners), borders: CELL_BORDER }),
    ],
  });
  const criteriaRow = criteria && criteria.length > 0 ? new TableRow({
    children: [
      new TableCell({
        children: [
          para(text("Assessment Criteria:", { bold: true, size: 20 })),
          ...bulletList(criteria),
        ],
        columnSpan: 2,
        borders: CELL_BORDER,
        shading: { fill: "fef3c7" },
      }),
    ],
  }) : null;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: criteriaRow ? [titleRow, headersRow, contentRow, criteriaRow] : [titleRow, headersRow, contentRow],
  });
}

function interdisciplinaryTable(connections = []) {
  if (!connections.length) return null;
  const headerRow = new TableRow({
    children: [
      new TableCell({
        children: [para(text("Subject", { bold: true, size: 20 }))],
        width: { size: 30, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: "f3f4f6" },
      }),
      new TableCell({
        children: [para(text("How the concept connects", { bold: true, size: 20 }))],
        width: { size: 70, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: "f3f4f6" },
      }),
    ],
  });
  const bodyRows = connections.map((c) => new TableRow({
    children: [
      new TableCell({ children: [para(text(c.subject || "", { bold: true, size: 20 }))], borders: CELL_BORDER }),
      new TableCell({ children: [para(text(c.connection || "", { size: 20 }))], borders: CELL_BORDER }),
    ],
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });
}

function phaseTable(phase, minutes, teacher = [], pupils = []) {
  const title = minutes != null ? `${phase} (${minutes} minutes)` : phase;

  const titleRow = new TableRow({
    children: [
      new TableCell({
        children: [para(text(title, { bold: true, size: 22 }))],
        columnSpan: 2,
        borders: CELL_BORDER,
        shading: { fill: "e0e7ff" },
      }),
    ],
  });

  const headersRow = new TableRow({
    children: [
      new TableCell({
        children: [para(text("Teacher's Activities", { bold: true, size: 20 }))],
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: "f9fafb" },
      }),
      new TableCell({
        children: [para(text("Pupils' Activities", { bold: true, size: 20 }))],
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: CELL_BORDER,
        shading: { fill: "f9fafb" },
      }),
    ],
  });

  const contentRow = new TableRow({
    children: [
      new TableCell({ children: bulletList(teacher), borders: CELL_BORDER }),
      new TableCell({ children: bulletList(pupils), borders: CELL_BORDER }),
    ],
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [titleRow, headersRow, contentRow],
  });
}

function referencesBlock(refs = []) {
  if (!refs.length) return bulletList([]);
  return refs.map((r) => new Paragraph({
    children: [
      text(r.title || "", { bold: true, size: 20 }),
      text(r.publisher ? ` — ${r.publisher}` : "", { size: 20 }),
      text(r.pages ? ` (pp. ${r.pages})` : "", { size: 20, italics: true, color: "6b7280" }),
    ],
    bullet: { level: 0 },
    spacing: { after: 60 },
  }));
}

function buildV2Body(plan, opts = {}) {
  const children = [];
  children.push(headerTable(plan.header || {}));
  children.push(...lessonIllustrationParagraphs(plan, opts));

  if (plan.lessonGoal) {
    children.push(h2("Lesson Goal (SMART)"));
    children.push(para(text(plan.lessonGoal, { size: 20 })));
  }

  children.push(h2("Competences"));
  if (plan.broadCompetences?.length) {
    children.push(para(text("Broad Competences:", { bold: true, size: 20 })));
    children.push(...bulletList(plan.broadCompetences));
  }
  if (plan.expectedTargetCompetence) {
    children.push(para(text("Expected Target Competence:", { bold: true, size: 20 })));
    children.push(para(text(plan.expectedTargetCompetence, { size: 20 })));
  }
  const lc = plan.lessonCompetencies || {};
  if (lc.competency1 || lc.competency2 || lc.competency3) {
    children.push(para(text("Lesson Competencies:", { bold: true, size: 20 })));
    const lcItems = [
      lc.competency1 && `Higher-order thinking — ${lc.competency1}`,
      lc.competency2 && `Thinking process — ${lc.competency2}`,
      lc.competency3 && `Tangible output — ${lc.competency3}`,
    ].filter(Boolean);
    children.push(...numberedList(lcItems));
  }

  const m = plan.methodology || {};
  if (m.approach || m.strategies?.length) {
    children.push(h2("Methodology and Strategies"));
    if (m.approach) {
      children.push(para([
        text("Approach: ", { bold: true, size: 20 }),
        text(m.approach, { size: 20 }),
      ]));
    }
    if (m.strategies?.length) {
      children.push(para(text("Strategies:", { bold: true, size: 20 })));
      children.push(...bulletList(m.strategies));
    }
  }

  const le = plan.learningEnvironment || {};
  if (le.category || le.specific || le.rationale) {
    children.push(h2("Learning Environment"));
    const catLine = [le.category ? le.category.charAt(0).toUpperCase() + le.category.slice(1) : "", le.specific].filter(Boolean).join(" — ");
    if (catLine) children.push(para(text(catLine, { bold: true, size: 20 })));
    if (le.rationale) children.push(para(text(le.rationale, { size: 20, italics: true, color: "6b7280" })));
  }

  if (plan.teachingLearningMaterials?.length) {
    children.push(h2("Teaching / Learning Materials"));
    children.push(...bulletList(plan.teachingLearningMaterials));
  }
  if (plan.prerequisiteKnowledge?.length) {
    children.push(h2("Prior Knowledge"));
    children.push(...bulletList(plan.prerequisiteKnowledge));
  }
  if (plan.interdisciplinaryConnections?.length) {
    children.push(h2("Interdisciplinary Connections"));
    const tbl = interdisciplinaryTable(plan.interdisciplinaryConnections);
    if (tbl) children.push(tbl);
    children.push(para([]));
  }

  children.push(h2("Lesson Progression (5E)"));
  const lp = plan.lessonProgression || {};
  const phaseSpecs = [
    ["1. Engagement — Introduction", lp.engagement],
    ["2. Exploration — Development", lp.exploration],
    ["3. Explanation — Conceptualization", lp.explanation],
    ["4. Synthesis — Continuity & Extension", lp.synthesis],
    ["5. Evaluation & Reflection — Conclusion", lp.evaluation],
  ];
  for (const [title, phase] of phaseSpecs) {
    const p = phase || {};
    children.push(phaseTableV2(
      title,
      p.durationMinutes,
      p.teacherActivities || [],
      p.learnerActivities || [],
      p.assessmentCriteria || [],
    ));
    children.push(para([]));
  }
  return children;
}

function buildV1Body(plan, opts = {}) {
  const children = [];
  children.push(headerTable(plan.header || {}));
  children.push(...lessonIllustrationParagraphs(plan, opts));

  children.push(h2("Specific Outcomes"));
  children.push(...numberedList(plan.specificOutcomes));

  children.push(h2("Key Competencies"));
  children.push(...bulletList(plan.keyCompetencies));

  children.push(h2("Values"));
  children.push(...bulletList(plan.values));

  children.push(h2("Prerequisite Knowledge"));
  children.push(...bulletList(plan.prerequisiteKnowledge));

  children.push(h2("Teaching / Learning Materials"));
  children.push(...bulletList(plan.teachingLearningMaterials));

  if (plan.references?.length) {
    children.push(h2("References"));
    children.push(...referencesBlock(plan.references));
  }

  children.push(h2("Lesson Development"));

  const intro = plan.lessonDevelopment?.introduction || {};
  children.push(phaseTable(
    "Introduction",
    intro.durationMinutes,
    intro.teacherActivities,
    intro.pupilActivities,
  ));
  children.push(para([]));

  for (const step of plan.lessonDevelopment?.development || []) {
    children.push(phaseTable(
      `Development — Step ${step.stepNumber}: ${step.title}`,
      step.durationMinutes,
      step.teacherActivities,
      step.pupilActivities,
    ));
    children.push(para([]));
  }

  const concl = plan.lessonDevelopment?.conclusion || {};
  children.push(phaseTable(
    "Conclusion",
    concl.durationMinutes,
    concl.teacherActivities,
    concl.pupilActivities,
  ));
  return children;
}

/* ────────────────────────────────────────────────────────────────────
 * v3 — official CDC teaching-module layout: CAPS labels, black ruled
 * LESSON PROGRESSION table, REMEDIAL WORK / EXTENSION ACTIVITY and a
 * blank LESSON EVALUATION the teacher fills in after teaching.
 * ─────────────────────────────────────────────────────────────────── */

const BLACK_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
};

function fieldLine(label, value) {
  return new Paragraph({
    children: [
      text(`${label}: `, { bold: true, size: 20 }),
      text(value == null ? "" : String(value), { size: 20 }),
    ],
    spacing: { after: 80 },
  });
}

function v3HeaderCell(label, widthPct) {
  return new TableCell({
    children: [para(text(label, { bold: true, size: 20 }), { spacing: { after: 0 } })],
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: BLACK_BORDER,
  });
}

function v3StageCell(children, widthPct) {
  return new TableCell({
    children,
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: BLACK_BORDER,
  });
}

function buildV3Body(plan, opts = {}) {
  const h = plan.header || {};
  const le = plan.learningEnvironment || {};
  const children = [];

  // Header block — official CAPS label lines.
  if (h.school) children.push(fieldLine("SCHOOL", h.school));
  children.push(fieldLine("NAME OF TEACHER", h.teacherName || ""));
  children.push(fieldLine("DATE", h.date || ""));
  if (h.time) children.push(fieldLine("TIME", h.time));
  children.push(fieldLine("CLASS", h.class || ""));
  children.push(fieldLine("DURATION", h.durationMinutes ? `${h.durationMinutes} minutes` : ""));
  if (h.termAndWeek) children.push(fieldLine("TERM & WEEK", h.termAndWeek));
  const hasAttendance = h.boysPresent != null || h.girlsPresent != null || h.totalPupils != null;
  if (hasAttendance) {
    children.push(fieldLine(
      "TOTAL ATTENDANCE",
      `Boys: ${h.boysPresent ?? "____"}   Girls: ${h.girlsPresent ?? "____"}   Total: ${h.totalPupils ?? h.numberOfPupils ?? "____"}`,
    ));
  }
  children.push(fieldLine("SUBJECT", h.subject || ""));
  children.push(fieldLine("TOPIC", h.topic || ""));
  children.push(fieldLine("SUB-TOPIC", h.subtopic || ""));

  // Official field sections.
  children.push(fieldLine("GENERAL COMPETENCES", (plan.generalCompetences || []).join(", ")));
  children.push(fieldLine("SPECIFIC COMPETENCE", plan.specificCompetence || ""));
  children.push(fieldLine("LESSON GOAL", plan.lessonGoal || ""));
  children.push(fieldLine("RATIONALE", plan.rationale || ""));
  children.push(fieldLine("PRIOR KNOWLEDGE", plan.priorKnowledge || ""));
  if (plan.references?.length) {
    children.push(para(text("REFERENCES:", { bold: true, size: 20 })));
    children.push(...bulletList(plan.references));
  }
  children.push(para(text("LEARNING ENVIRONMENT:", { bold: true, size: 20 })));
  children.push(fieldLine("I. Natural", le.natural || ""));
  children.push(fieldLine("II. Artificial", le.artificial || ""));
  children.push(fieldLine("III. Technological", le.technological || ""));
  if (plan.materials?.length) {
    children.push(para(text("TEACHING AND LEARNING MATERIALS/RESOURCES:", { bold: true, size: 20 })));
    children.push(...bulletList(plan.materials));
  }
  children.push(fieldLine("EXPECTED STANDARD", plan.expectedStandard || ""));

  children.push(...lessonIllustrationParagraphs(plan, opts));

  // LESSON PROGRESSION — one black ruled table, exactly like the modules.
  children.push(new Paragraph({
    children: [text("LESSON PROGRESSION", { bold: true, size: 22 })],
    spacing: { before: 160, after: 120 },
  }));
  const headerRow = new TableRow({
    children: [
      v3HeaderCell("STAGES", 15),
      v3HeaderCell("TEACHER'S ACTIVITIES", 31),
      v3HeaderCell("LEARNERS' ACTIVITIES", 30),
      v3HeaderCell("ASSESSMENT CRITERIA", 24),
    ],
  });
  const stageRows = (plan.stages || []).map((s) => new TableRow({
    children: [
      v3StageCell([
        para(text(s.name || "", { bold: true, size: 18 }), { spacing: { after: 40 } }),
        ...(s.durationMinutes > 0
          ? [para(text(`(${s.durationMinutes} min)`, { italics: true, size: 16 }), { spacing: { after: 0 } })]
          : []),
      ], 15),
      v3StageCell(bulletList(s.teacherActivities), 31),
      v3StageCell(bulletList(s.learnerActivities), 30),
      v3StageCell(bulletList(s.assessmentCriteria), 24),
    ],
  }));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...stageRows],
  }));
  children.push(para([]));

  // Closing block.
  if (plan.remedialWork) children.push(fieldLine("REMEDIAL WORK", plan.remedialWork));
  if (plan.extensionActivity) children.push(fieldLine("EXTENSION ACTIVITY", plan.extensionActivity));
  children.push(new Paragraph({
    children: [text("LESSON EVALUATION:", { bold: true, size: 20 })],
    spacing: { before: 160, after: 80 },
  }));
  const blank = "_".repeat(60);
  children.push(fieldLine("Successes (competences achieved)", "_".repeat(18)));
  children.push(para(text(blank, { size: 20 })));
  children.push(fieldLine("Challenges (competences not achieved and why)", "_".repeat(18)));
  children.push(para(text(blank, { size: 20 })));
  children.push(fieldLine("Way forward (including remedial work if applicable)", "_".repeat(18)));
  children.push(para(text(blank, { size: 20 })));
  return children;
}

/**
 * Build a docx Document from a lesson plan JSON object.
 * Detects schema version by field presence so older saved plans still export.
 */
function buildLessonPlanDocument(plan, opts = {}) {
  const isV3 = Array.isArray(plan.stages) || plan.schemaVersion === "3.0";
  if (isV3) {
    return new Document({
      creator: "zedexams.com",
      title: sanitizeXmlText(`Lesson Plan — ${plan.header?.subject || ""} — ${plan.header?.topic || ""}`),
      description: "Generated by ZedExams Teacher Tools",
      styles: {
        default: {
          document: { run: { font: "Calibri", size: 20 } },
        },
      },
      sections: [{ ...attributionSection(opts), children: [h1("LESSON PLAN"), ...buildV3Body(plan, opts)] }],
    });
  }
  const isV2 = !!plan.lessonProgression || !!plan.lessonCompetencies || plan.schemaVersion === "2.0";

  const children = [];
  children.push(h1("LESSON PLAN"));

  const bodyChildren = isV2 ? buildV2Body(plan, opts) : buildV1Body(plan, opts);
  children.push(...bodyChildren);

  children.push(h2("Assessment"));
  children.push(para(text("Formative:", { bold: true, size: 20 })));
  children.push(...bulletList(plan.assessment?.formative));
  if (plan.assessment?.summative?.description) {
    children.push(para(text("Summative:", { bold: true, size: 20 })));
    children.push(para(text(plan.assessment.summative.description, { size: 20 })));
    if (plan.assessment.summative.successCriteria) {
      children.push(para([
        text("Success criteria: ", { bold: true, size: 20 }),
        text(plan.assessment.summative.successCriteria, { size: 20 }),
      ]));
    }
  }

  children.push(h2("Differentiation"));
  children.push(para(text("For struggling pupils:", { bold: true, size: 20 })));
  children.push(...bulletList(plan.differentiation?.forStruggling));
  children.push(para(text("For advanced pupils:", { bold: true, size: 20 })));
  children.push(...bulletList(plan.differentiation?.forAdvanced));

  if (plan.homework?.description) {
    children.push(h2("Homework"));
    children.push(para(text(plan.homework.description, { size: 20 })));
    if (plan.homework.estimatedMinutes > 0) {
      children.push(para(text(
        `Estimated time: ${plan.homework.estimatedMinutes} minutes`,
        { size: 18, italics: true, color: "6b7280" },
      )));
    }
  }

  // v2-only: Competence Continuity (Section 3 of CBC template)
  if (isV2) {
    const cc = plan.competenceContinuity || {};
    const hasCC = (cc.longTermProjects?.length || 0) + (cc.homeworkExtensions?.length || 0) +
      (cc.upcomingConnections?.length || 0) + (cc.teacherActions?.length || 0) > 0;
    if (hasCC) {
      children.push(h2("Competence Continuity and Strategy"));
      if (cc.longTermProjects?.length) {
        children.push(para(text("Long-term projects:", { bold: true, size: 20 })));
        children.push(...bulletList(cc.longTermProjects));
      }
      if (cc.homeworkExtensions?.length) {
        children.push(para(text("Homework extensions:", { bold: true, size: 20 })));
        children.push(...bulletList(cc.homeworkExtensions));
      }
      if (cc.upcomingConnections?.length) {
        children.push(para(text("Upcoming connections:", { bold: true, size: 20 })));
        children.push(...bulletList(cc.upcomingConnections));
      }
      if (cc.teacherActions?.length) {
        children.push(para(text("Teacher actions:", { bold: true, size: 20 })));
        children.push(...bulletList(cc.teacherActions));
      }
    }
    // v2 places References near the bottom as a formal block
    if (plan.references?.length) {
      children.push(h2("References"));
      children.push(...referencesBlock(plan.references));
    }
  }

  children.push(h2("Teacher's Reflection"));
  children.push(para(text("What went well?", { bold: true, size: 20 })));
  children.push(para(text("__________________________________________________", { size: 20 })));
  children.push(para(text("What to improve next time?", { bold: true, size: 20 })));
  children.push(para(text("__________________________________________________", { size: 20 })));
  children.push(para(text("Pupils who need follow-up:", { bold: true, size: 20 })));
  children.push(para(text("__________________________________________________", { size: 20 })));

  return new Document({
    creator: "zedexams.com",
    title: sanitizeXmlText(`Lesson Plan — ${plan.header?.subject || ""} — ${plan.header?.topic || ""}`),
    description: "Generated by ZedExams Teacher Tools",
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 20 } },
      },
    },
    sections: [{ ...attributionSection(opts), children }],
  });
}

/**
 * Generate a .docx Buffer for a lesson plan, server-side.
 *
 * If plan.lessonDiagram.url is present, the illustration bytes are fetched with
 * the global fetch() and embedded; any fetch error is swallowed so the document
 * still generates (with the "could not be embedded" note).
 *
 * @param {object} plan The validated lesson-plan JSON object.
 * @param {object} [opts] Options (attribution flag, pre-fetched diagramImage).
 * @return {Promise<Buffer>} The .docx file bytes.
 */
async function generateLessonPlanDocxBuffer(plan, opts = {}) {
  let buildOpts = opts;
  if (plan?.lessonDiagram?.url && !opts.diagramImage) {
    buildOpts = { ...opts, diagramImage: await fetchLessonDiagramImage(plan.lessonDiagram) };
  }
  const doc = buildLessonPlanDocument(plan, buildOpts);
  return Packer.toBuffer(doc);
}

module.exports = {
  generateLessonPlanDocxBuffer,
  buildLessonPlanDocument,
  detectDocxImageType,
  illustrationBox,
  attributionSection,
};
