/**
 * Minimal, dependency-free plain-text extraction for the server export
 * renderers. Question/instruction content is stored as Tiptap JSON
 * (contentVersion 3) but may also arrive as a legacy HTML string or a plain
 * string. This turns any of those into readable plain text with paragraph
 * breaks preserved.
 *
 * Pure — no firebase / no DOM — so it runs under plain `node` and inside a
 * Cloud Function alike.
 */

/** Tiptap block-level node types that should force a line break after them. */
const BLOCK_TYPES = new Set([
  "paragraph", "heading", "listItem", "blockquote", "codeBlock",
  "tableRow", "horizontalRule",
]);

/** Walk a Tiptap JSON node tree, collecting text with block breaks. */
function tiptapToText(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) tiptapToText(n, out);
    return;
  }
  if (typeof node.text === "string") {
    out.push(node.text);
  }
  if (node.type === "hardBreak") out.push("\n");
  if (Array.isArray(node.content)) {
    for (const child of node.content) tiptapToText(child, out);
  }
  if (BLOCK_TYPES.has(node.type)) out.push("\n");
}

/** Strip HTML tags, decode a handful of common entities, collapse whitespace. */
function htmlToText(html) {
  let out = String(html)
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n");
  // Strip remaining tags to a fixpoint so removals can't reassemble a tag
  // (e.g. "<scr<x>ipt>").
  let prev;
  do {
    prev = out;
    out = out.replace(/<[^>]+>/g, "");
  } while (out !== prev);
  // Decode entities in one pass ("&amp;" handled together with the rest) so a
  // double-encoded "&amp;lt;" can never decode all the way to "<".
  const entities = {
    "nbsp": " ", "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "#39": "'",
  };
  return out.replace(/&(nbsp|amp|lt|gt|quot|#39);/gi,
      (m, name) => entities[name.toLowerCase()]);
}

/** Collapse runs of blank lines / trailing spaces into tidy paragraphs. */
function tidy(text) {
  return String(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Convert a rich-text value (Tiptap JSON object, HTML string, or plain string)
 * to plain text. Returns "" for null/empty.
 */
function plainText(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";
    // Looks like HTML? strip tags. Otherwise it's already plain.
    return /<[a-z][\s\S]*>/i.test(s) ? tidy(htmlToText(s)) : tidy(s);
  }
  if (typeof value === "object") {
    const out = [];
    tiptapToText(value, out);
    return tidy(out.join(""));
  }
  return "";
}

/** First non-empty line of a rich value (used for short labels). */
function firstLine(value) {
  const t = plainText(value);
  const nl = t.indexOf("\n");
  return nl === -1 ? t : t.slice(0, nl);
}

module.exports = {plainText, firstLine, tiptapToText, htmlToText};
