/**
 * Shared free-plan branding for teacher-tool DOCX exports — a diagonal page
 * watermark plus the "Made with ZedExams" footer line.
 *
 * Free-plan teachers export real documents from the studios every day
 * (the library's download buttons are already paid-only), and those
 * documents travel — WhatsApp groups, staffrooms, head teachers' desks.
 * The watermark + footer are the document's only attribution on that
 * journey, and the watermark is the nudge to upgrade for a clean copy.
 * Pro/Max (and admin) exports stay clean: studios resolve the flag with
 * isFreePlanTeacher() from teacherLibraryService and pass it down as
 * opts.attribution.
 *
 * Pure docx helpers — no app imports — so every exporter chunk stays
 * dependency-light.
 */

import { AlignmentType, Footer, Header, ImportedXmlComponent, Paragraph, TextRun } from 'docx'

// Short brand text for the diagonal watermark — keep it terse so the WordArt
// path stays legible when rotated across the page.
export const WATERMARK_TEXT = 'ZedExams.com'

// The attribution line as a bare Paragraph — exported so exporters that build
// their own footer (e.g. to add page numbers) can include the same line
// instead of duplicating the marketing string.
export function attributionFooterParagraph() {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: 'Made with ZedExams — free CBC teacher tools at zedexams.com/teachers',
        size: 14,
        color: '888888',
      }),
    ],
  })
}

export function attributionFooter() {
  return new Footer({ children: [attributionFooterParagraph()] })
}

// Canonical WordArt text-effect shape (`_x0000_t136`) — the same shape Word
// itself writes for a text watermark. Declared once inside the <w:pict> so the
// <v:shape> below can reference it via `type="#_x0000_t136"`.
const WATERMARK_SHAPETYPE =
  '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,xe">' +
  '<v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/>' +
  '<v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/>' +
  '<v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/>' +
  '<v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas>' +
  '<v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" ' +
  'o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/>' +
  '<v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles>' +
  '<o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>'

function watermarkRunXml(text) {
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return (
    '<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:w10="urn:schemas-microsoft-com:office:word">' +
    '<w:rPr><w:noProof/></w:rPr><w:pict>' +
    WATERMARK_SHAPETYPE +
    '<v:shape id="ZedExamsWatermark" o:spid="_x0000_s2049" type="#_x0000_t136" ' +
    'style="position:absolute;margin-left:0;margin-top:0;width:450pt;height:112.5pt;rotation:315;' +
    'z-index:-251654144;mso-position-horizontal:center;mso-position-horizontal-relative:margin;' +
    'mso-position-vertical:center;mso-position-vertical-relative:margin" fillcolor="#d9d9d9" stroked="f">' +
    '<v:fill opacity=".55"/>' +
    `<v:textpath style="font-family:&quot;Calibri&quot;,sans-serif;font-size:1pt" string="${safe}"/>` +
    '</v:shape></w:pict></w:r>'
  )
}

// The watermark as a single header paragraph. Exposed on its own so paper
// exports (which build their OWN first-page/running headers for the title
// banner) can compose the watermark INTO those headers — a Word section has
// only one header per type, so the banner and the watermark must share it.
export function attributionWatermarkParagraph() {
  return new Paragraph({ children: [ImportedXmlComponent.fromXmlString(watermarkRunXml(WATERMARK_TEXT))] })
}

// The watermark lives in the page header so it repeats on every page and sits
// behind the body text. A header paragraph is the standard host for a Word
// text watermark.
export function attributionWatermarkHeader() {
  return new Header({ children: [attributionWatermarkParagraph()] })
}

/**
 * Spread into a section literal: `...attributionSection(opts)` adds the diagonal
 * watermark header AND the page footer when opts.attribution is true, and
 * nothing otherwise (so paid/admin exports stay completely clean).
 */
export function attributionSection(opts) {
  if (!opts?.attribution) return {}
  return {
    headers: { default: attributionWatermarkHeader() },
    footers: { default: attributionFooter() },
  }
}
