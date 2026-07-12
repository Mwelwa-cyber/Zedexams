/**
 * pastPaperImportReconcile — declared-range reconciliation for the SERVER-side
 * Past Paper Studio importer (functions/teacherTools/pastPaperImport.js).
 *
 * Mirrors the client scanned-import reconciler (src/components/quiz/
 * pastPaperParts.js) so both import routes behave the same, but adapted to this
 * pipeline's flat question shape ({ prompt, sourceNumber, sectionLabel,
 * options, confidence, … }) and hardened for the papers this importer must also
 * handle: those that RESTART numbering in each section.
 *
 * ECZ / PSLE papers declare their structure — each Part prints its question
 * range ("Part 4: Questions 31 – 38") and shared instruction — so we use the
 * ranges as ground truth to:
 *   1. drop questions numbered OUTSIDE every declared range (the phantom
 *      over-count: 60 → 65),
 *   2. dedupe same-number reads, keeping the most complete,
 *   3. snap mis-read numbers back to the declared sequence when the surviving
 *      count matches the declared total,
 *   4. turn a stem-less spelling / punctuation item (the four choices ARE the
 *      question) into a real question whose prompt is the Part instruction.
 *
 * SAFETY: the number reconcile (1-3) runs ONLY when the declared ranges do not
 * overlap — i.e. the paper is continuously numbered (Q1..N across the whole
 * paper, like PSLE English). If two ranges overlap in number space the paper
 * restarts numbering per section, so a global reconcile would wrongly treat
 * "Section B Q1" as a duplicate of "Section A Q1"; we skip the number reconcile
 * entirely in that case and only apply the safe, section-scoped stem-fill (4).
 * A paper that declares no ranges is returned untouched.
 *
 * Pure + dependency-free so it loads in the root-only CI test env and the node
 * tests exercise it with plain fixtures.
 */

const RANGE_RE = /questions?\s*\(?\s*(\d{1,3})\s*(?:[-–—]|to)\s*(\d{1,3})/gi;
const PART_LABEL_RE = /\b(part\s+[0-9ivx]+|section\s+[a-z0-9]+)\b/i;

function str(v) {
  return v == null ? "" : String(v);
}

/** Extract every "Questions X–Y" range from a list of strings. */
function parseDeclaredRanges(texts) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(texts) ? texts : []) {
    const text = str(raw);
    if (!text) continue;
    RANGE_RE.lastIndex = 0;
    let m;
    while ((m = RANGE_RE.exec(text)) !== null) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
      if (start < 1 || end < start || end - start > 200) continue;
      const key = `${start}-${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const labelMatch = text.match(PART_LABEL_RE);
      out.push({start, end, label: labelMatch ? labelMatch[1] : ""});
    }
  }
  return out;
}

/**
 * Build the canonical declared-range list from the model's `parts` array plus a
 * regex scan of every question's sectionLabel + prompt. Each entry:
 * `{ start, end, label, sectionLabel, instruction }`, sorted by start.
 */
function collectDeclaredRanges(parts, questions) {
  const ranges = [];
  // Section-aware dedup: two ranges with the SAME numbers but DIFFERENT sections
  // are kept distinct — that is exactly the restart-numbering signal (Section A
  // 1-20 + Section B 1-20). A covering/duplicate range only suppresses a new one
  // when their sections are compatible (same, or the existing one is
  // section-less), so a weaker regex range can't shadow a real cross-section one.
  const sameSection = (a, b) => str(a.sectionLabel).trim().toLowerCase() === str(b.sectionLabel).trim().toLowerCase();
  const compatible = (existing, r) => !str(existing.sectionLabel).trim() || sameSection(existing, r);
  const addRange = (r) => {
    if (!r || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.end < r.start) return;
    const dup = ranges.some((e) =>
      compatible(e, r) && e.start <= r.start && e.end >= r.end,
    );
    if (dup) return;
    ranges.push({
      start: r.start,
      end: r.end,
      label: str(r.label).trim(),
      sectionLabel: str(r.sectionLabel).trim(),
      instruction: str(r.instruction).trim(),
    });
  };

  (Array.isArray(parts) ? parts : []).forEach((p) => {
    const start = Number(p && p.firstNumber);
    const end = Number(p && p.lastNumber);
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start) {
      addRange({
        start,
        end,
        label: str(p && p.label).trim(),
        sectionLabel: str(p && p.sectionLabel).trim(),
        instruction: str(p && p.instruction).trim(),
      });
    }
  });

  const texts = [];
  (Array.isArray(questions) ? questions : []).forEach((q) => {
    if (q && str(q.sectionLabel).trim()) texts.push(str(q.sectionLabel));
    if (q && str(q.prompt).trim()) texts.push(str(q.prompt));
  });
  parseDeclaredRanges(texts).forEach((r) => addRange(r));

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  return ranges;
}

/** True when any two ranges overlap in number space (⇒ restart-numbering). */
function rangesOverlap(ranges) {
  const sorted = [...(Array.isArray(ranges) ? ranges : [])].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start <= sorted[i - 1].end) return true;
  }
  return false;
}

function declaredNumbers(ranges) {
  const set = new Set();
  (Array.isArray(ranges) ? ranges : []).forEach((r) => {
    if (!Number.isInteger(r && r.start) || !Number.isInteger(r && r.end)) return;
    for (let n = r.start; n <= r.end; n += 1) set.add(n);
  });
  return [...set].sort((a, b) => a - b);
}

function toInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
}

// Completeness score for choosing between two same-number reads: confidence,
// then option count, then prompt length.
function completenessScore(q) {
  const conf = Number(q && q.confidence);
  const options = Array.isArray(q && q.options) ? q.options.filter((o) => str(o).trim()).length : 0;
  const promptLen = str(q && q.prompt).trim().length;
  return (Number.isFinite(conf) ? conf : 0.5) * 100 + options * 5 + Math.min(promptLen, 200) / 100;
}

/**
 * Reconcile a flat question list against its declared ranges. Returns a NEW
 * `{ questions, droppedOutOfRange, droppedDuplicate, missing, snapped,
 * declaredTotal, stemsFilled, skippedRestartNumbering }`. Never mutates input.
 *
 * When ranges are absent / too few, or the paper restarts numbering (overlapping
 * ranges), the number reconcile is skipped; the stem-fill still runs when it's
 * safe (a range with an instruction and a matching stem-less item).
 */
function reconcilePastPaper(questions, parts) {
  const list = Array.isArray(questions) ? questions.map((q) => ({...q})) : [];
  const ranges = collectDeclaredRanges(parts, list);
  const base = {
    questions: list,
    droppedOutOfRange: 0,
    droppedDuplicate: 0,
    missing: [],
    snapped: false,
    declaredTotal: 0,
    stemsFilled: 0,
    skippedRestartNumbering: false,
  };
  if (!ranges.length) return base;

  const overlap = rangesOverlap(ranges);
  const declared = declaredNumbers(ranges);
  base.declaredTotal = declared.length;

  let kept = list;
  let droppedOutOfRange = 0;
  let droppedDuplicate = 0;
  let snapped = false;
  let missing = [];

  // ── Number reconcile — only when continuously numbered (non-overlapping). ──
  if (!overlap && declared.length >= 3) {
    const declaredSet = new Set(declared);
    const refs = list.map((q) => ({q, drop: false}));

    refs.forEach((ref) => {
      const n = toInt(ref.q.sourceNumber);
      if (Number.isInteger(n) && n > 0 && !declaredSet.has(n)) {
        ref.drop = true;
        droppedOutOfRange += 1;
      }
    });

    const bestByNumber = new Map();
    refs.forEach((ref) => {
      if (ref.drop) return;
      const n = toInt(ref.q.sourceNumber);
      if (!Number.isInteger(n) || n <= 0) return;
      const current = bestByNumber.get(n);
      if (!current) { bestByNumber.set(n, ref); return; }
      if (completenessScore(ref.q) > completenessScore(current.q)) {
        current.drop = true;
        bestByNumber.set(n, ref);
      } else {
        ref.drop = true;
      }
    });
    droppedDuplicate = refs.filter((r) => r.drop).length - droppedOutOfRange;

    const keptRefs = refs.filter((r) => !r.drop);
    const allNumbered = keptRefs.every((r) => {
      const n = toInt(r.q.sourceNumber);
      return Number.isInteger(n) && n > 0;
    });
    if (keptRefs.length === declared.length && allNumbered) {
      keptRefs.forEach((ref, i) => { ref.q.sourceNumber = declared[i]; });
      snapped = true;
    }

    kept = keptRefs.map((r) => r.q);
    const present = new Set(kept.map((q) => toInt(q.sourceNumber)).filter(Number.isInteger));
    missing = snapped ? [] : declared.filter((n) => !present.has(n));
  }

  // ── Stem-fill (safe regardless of overlap): a spelling / punctuation item
  //    with no prompt of its own gets the matching Part instruction as prompt. ──
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const instructionCache = new Map();
  const resolveInstruction = (range) => {
    if (instructionCache.has(range)) return instructionCache.get(range);
    let instruction = str(range.instruction).trim();
    if (!instruction) {
      // Derive from the most common shared lead-in among the range's items —
      // this importer has no per-question instruction field, so fall back to a
      // prompt shared verbatim across the range's members (rare, but cheap).
      const counts = new Map();
      kept.forEach((q) => {
        const n = toInt(q.sourceNumber);
        if (!Number.isInteger(n) || n < range.start || n > range.end) return;
        const s = str(q.prompt).trim();
        if (s) counts.set(s, (counts.get(s) || 0) + 1);
      });
      let best = "";
      let bestCount = 1; // need at least two identical stems to treat as shared
      counts.forEach((count, s) => { if (count > bestCount) { best = s; bestCount = count; } });
      instruction = best;
    }
    instructionCache.set(range, instruction);
    return instruction;
  };
  const rangeFor = (n, sectionLabel) => {
    // Prefer a range whose section matches (restart-numbering safety); else any
    // range containing the number.
    const inNumber = sorted.filter((r) => n >= r.start && n <= r.end);
    if (inNumber.length <= 1) return inNumber[0] || null;
    const sec = str(sectionLabel).trim().toLowerCase();
    return inNumber.find((r) => str(r.sectionLabel).trim().toLowerCase() === sec) || inNumber[0];
  };

  let stemsFilled = 0;
  kept = kept.map((q) => {
    const n = toInt(q.sourceNumber);
    if (!Number.isInteger(n)) return q;
    const range = rangeFor(n, q.sectionLabel);
    if (!range) return q;
    const hasStem = str(q.prompt).replace(/<[^>]*>/g, "").trim().length > 0;
    if (hasStem) return q;
    const instruction = resolveInstruction(range);
    if (!instruction) return q;
    stemsFilled += 1;
    return {...q, prompt: instruction};
  });

  return {
    questions: kept,
    droppedOutOfRange,
    droppedDuplicate: Math.max(0, droppedDuplicate),
    missing,
    snapped,
    declaredTotal: declared.length,
    stemsFilled,
    skippedRestartNumbering: overlap,
  };
}

module.exports = {
  parseDeclaredRanges,
  collectDeclaredRanges,
  rangesOverlap,
  declaredNumbers,
  reconcilePastPaper,
};
