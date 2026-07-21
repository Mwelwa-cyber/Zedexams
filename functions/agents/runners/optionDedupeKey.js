/**
 * optionDedupeKey — canonical key for deciding whether two MCQ options are the
 * SAME option. Shared by the duplicate-option checks in Vex (pre-publish
 * blocker, vex.js) and Vigil (hourly monitor, monitor.js) so they agree.
 *
 * Why this exists separately from extractPlainText: extractPlainText answers
 * "what does a learner READ", so it deliberately flattens rich text, and the
 * dedup check layered on top also lowercased. That erased the two things that
 * make otherwise-identical options genuinely DIFFERENT answers on an English
 * Language paper, producing false "duplicate options" reports:
 *
 *   - letter case — a capitalisation question ("My name is John" vs
 *     "my name is john") has options that read differently; lowercasing
 *     collapses the distinct options into one false duplicate.
 *   - formatting marks (bold / italic / underline / super- / subscript) — an
 *     underline question ("the dog ran" with vs without "ran" underlined) has
 *     options whose only difference is a mark; dropping marks collapses them.
 *
 * This key PRESERVES case and folds each text run's marks into the key, so two
 * options collide ONLY when their text, case, AND marks all match. It still
 * flattens JSON-encoded / object Tiptap docs and maths leaf nodes (mirroring
 * the extractors) so a doc object never compares as the literal
 * "[object Object]" — which would make every distinct option look identical.
 * Adjacent runs that share the same marks are merged before comparison, so the
 * same visible option split across different text nodes still dedupes.
 *
 * Pure, no firebase deps — unit tested by scripts/test-option-dedupe-key.mjs.
 */

/** Stable, order-independent signature of a text node's marks (types only). */
function markSig(marks) {
  if (!Array.isArray(marks) || marks.length === 0) return "";
  return marks
      .map((m) => (m && typeof m === "object" ? m.type : m))
      .filter((t) => typeof t === "string" && t)
      .sort()
      .join(",");
}

/**
 * Render an editor leaf node whose value lives in attrs, not a child text node.
 * Kept in sync with extractPlainText in monitor.js / richPlainText.js. Returns
 * a string for a recognised leaf, or null when the node is not one.
 */
function renderLeaf(node) {
  const type = node.type;
  const attrs = node.attrs || {};
  if (type === "math" || type === "inlineMath" || type === "mathBlock" || type === "mathInline") {
    return attrs.latex || attrs["data-latex"] || "";
  }
  if (type === "mathFraction") {
    const w = attrs.whole || "";
    const n = attrs.num || "";
    const d = attrs.den || "";
    return `${w ? `${w} ` : ""}${n}/${d}`.trim();
  }
  if (type === "numberBase") {
    const n = attrs.number || "";
    const b = attrs.base || "";
    return b ? `${n}_${b}` : n;
  }
  if (type === "verticalArithmetic") {
    const op = attrs.operator || "+";
    const lines = Array.isArray(attrs.lines) ? attrs.lines : [];
    const ans = attrs.answer || "";
    return `${lines.join(` ${op} `)} = ${ans || "___"}`;
  }
  return null;
}

/** Flatten a doc/node into an ordered list of { sig, text } runs. */
function collectRuns(node, runs) {
  if (!node || typeof node !== "object") return;
  if (node.type === "text") {
    if (typeof node.text === "string" && node.text) {
      runs.push({sig: markSig(node.marks), text: node.text});
    }
    return;
  }
  const leaf = renderLeaf(node);
  if (leaf !== null) {
    if (leaf) runs.push({sig: "", text: leaf});
    return;
  }
  (node.content || []).forEach((child) => collectRuns(child, runs));
}

/** Collapse ordinary whitespace and trim. */
function normalize(s) {
  return String(s || "").replace(/[ \t\r\n]+/g, " ").trim();
}

/**
 * Turn a list of runs into the canonical key. Adjacent runs sharing a mark
 * signature are merged (so tokenisation differences don't hide a true
 * duplicate); each merged run is normalised; empty runs are dropped. Returns
 * "" when nothing but whitespace remains — callers treat that as an EMPTY
 * option, never a duplicate.
 */
function runsToKey(runs) {
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.sig === run.sig) {
      last.text += ` ${run.text}`;
    } else {
      merged.push({sig: run.sig, text: run.text});
    }
  }
  const tokens = merged
      .map((r) => [r.sig, normalize(r.text)])
      .filter(([, text]) => text !== "");
  if (tokens.length === 0) return "";
  return JSON.stringify(tokens);
}

/**
 * Canonical dedup key for one MCQ option. Empty / whitespace-only options
 * return "" (callers skip those — they are an "empty option", not a duplicate).
 */
function optionDedupeKey(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.includes("\"type\"") && trimmed.includes("\"doc\"")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.type === "doc") {
          const runs = [];
          (parsed.content || []).forEach((child) => collectRuns(child, runs));
          return runsToKey(runs);
        }
      } catch (err) {
        /* not valid JSON — fall through to the raw string */
      }
    }
    const text = normalize(trimmed);
    return text ? JSON.stringify([["", text]]) : "";
  }
  if (typeof value === "object") {
    if (value.type === "doc") {
      const runs = [];
      (value.content || []).forEach((child) => collectRuns(child, runs));
      return runsToKey(runs);
    }
    try {
      const text = normalize(JSON.stringify(value));
      return text ? JSON.stringify([["", text]]) : "";
    } catch (err) {
      return "";
    }
  }
  return "";
}

module.exports = {optionDedupeKey};
