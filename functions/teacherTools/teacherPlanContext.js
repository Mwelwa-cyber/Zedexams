/**
 * Teacher Plan Context — grounds the Lesson Plan Studio on the teacher's
 * OWN saved Schemes of Work and Weekly Forecasts.
 *
 * The studio sends its own system + user prompts (it owns the output
 * format), so unlike generateLessonPlan it never went through the CBC KB
 * resolver. That meant a teacher who had carefully built a Scheme of Work
 * for the term got lesson plans that ignored their pacing entirely.
 *
 * This resolver looks up the teacher's most recent completed Scheme of
 * Work (and Weekly Forecast, if one exists) for the lesson's
 * grade + subject + term, picks the week the lesson falls in, and renders
 * a <teacher_plans> block. It is injected as a cached system block via
 * callClaude's `cbcContextBlock` param.
 *
 * Index-free: reuses the existing (ownerUid, createdAt) index — same
 * pattern as resolvePriorCoverage in cbcKnowledge.js — and filters the
 * rest in memory, so no new composite index is needed.
 *
 * Fail-open: any error returns "" so a lookup problem never blocks a
 * generation.
 */

const admin = require("firebase-admin");

const MAX_DOCS = 300;
const MAX_BLOCK_CHARS = 6000;
const MAX_SEQUENCE_WEEKS = 15;

function gradeDigits(v) {
  const m = String(v == null ? "" : v).match(/\d+/);
  return m ? m[0] : "";
}

function termDigit(v) {
  const m = String(v == null ? "" : v).match(/\d/);
  return m ? m[0] : "";
}

function normSubject(v) {
  return String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function norm(v) {
  return String(v == null ? "" : v).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Does a saved generation doc cover the same grade + subject + term as the
 * lesson being generated? Prefers the canonical `library` coords (academic
 * form, e.g. "Grade 5" / "Mathematics" / "Term 1") and falls back to the
 * raw `inputs` shorthand (e.g. "G5" / "mathematics" / 1) for rows whose
 * library map was never backfilled.
 */
function docMatches(d, want) {
  const lib = (d && d.library) || {};
  const inp = (d && d.inputs) || {};

  if (want.grade) {
    const docGrade = gradeDigits(lib.gradeForm || inp.grade);
    if (docGrade && docGrade !== want.grade) return false;
  }
  if (want.term) {
    const docTerm = termDigit(lib.term || inp.term);
    if (docTerm && docTerm !== want.term) return false;
  }
  if (want.subject) {
    const candidates = [lib.subject, inp.subject]
        .filter(Boolean)
        .map(normSubject)
        .filter(Boolean);
    if (candidates.length) {
      const ok = candidates.some((c) =>
        c === want.subject ||
        c.includes(want.subject) ||
        want.subject.includes(c),
      );
      if (!ok) return false;
    }
  }
  return true;
}

/**
 * Pick the scheme/forecast week the lesson falls in. Priority:
 *   1. exact weekNumber match (the teacher's pacing for that week)
 *   2. best topic / sub-topic overlap
 *   3. null — caller still renders the term sequence so Claude knows
 *      where the lesson sits.
 */
function pickWeek(weeks, want) {
  if (!Array.isArray(weeks) || weeks.length === 0) return null;

  if (want.week) {
    const byNum = weeks.find((w) => Number(w && w.weekNumber) === want.week);
    if (byNum) return byNum;
  }

  const tp = norm(want.topic);
  const st = norm(want.subtopic);
  if (tp || st) {
    let best = null;
    let bestScore = 0;
    for (const w of weeks) {
      if (!w || typeof w !== "object") continue;
      const wTopic = norm(w.topic);
      const hay = norm([w.topic, ...(Array.isArray(w.subtopics) ?
        w.subtopics : [])].join(" "));
      let score = 0;
      if (tp && wTopic && (hay.includes(tp) || tp.includes(wTopic))) score += 2;
      if (st && hay.includes(st)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    }
    if (best) return best;
  }
  return null;
}

function bullets(arr, max) {
  const list = (Array.isArray(arr) ? arr : [])
      .filter((s) => typeof s === "string" && s.trim())
      .slice(0, max || 12)
      .map((s) => `- ${s.trim()}`);
  return list.join("\n");
}

function renderWeek(label, w) {
  const lines = [`${label} — Week ${w.weekNumber}`];
  if (w.topic) lines.push(`Topic: ${w.topic}`);
  const sub = bullets(w.subtopics, 12);
  if (sub) lines.push("Sub-topics:", sub);
  const so = bullets(w.specificOutcomes, 10);
  if (so) lines.push("Specific outcomes:", so);
  const kc = bullets(w.keyCompetencies, 8);
  if (kc) lines.push("Key competencies:", kc);
  const vals = bullets(w.values, 8);
  if (vals) lines.push("Values:", vals);
  const acts = bullets(w.teachingLearningActivities, 10);
  if (acts) lines.push("Teaching/learning activities:", acts);
  const mats = bullets(w.materials, 10);
  if (mats) lines.push("Materials:", mats);
  if (typeof w.assessment === "string" && w.assessment.trim()) {
    lines.push(`Assessment: ${w.assessment.trim()}`);
  }
  if (typeof w.references === "string" && w.references.trim()) {
    lines.push(`References: ${w.references.trim()}`);
  }
  return lines.join("\n");
}

function renderSequence(weeks) {
  const rows = (Array.isArray(weeks) ? weeks : [])
      .filter((w) => w && (w.topic || w.weekNumber))
      .slice(0, MAX_SEQUENCE_WEEKS)
      .map((w) => {
        const t = String(w.topic || "").trim().slice(0, 80);
        return `  Week ${w.weekNumber}: ${t || "(no topic)"}`;
      });
  return rows.join("\n");
}

function renderBlock({scheme, schemeWeek, forecast, forecastWeek}) {
  const lines = [
    "<teacher_plans>",
    "This teacher has their OWN saved planning documents for this class,",
    "subject and term. They are the teacher's source of truth. Align this",
    "lesson plan to them: follow the same topic sequence, pacing, materials",
    "and assessment focus. Do NOT contradict the teacher's plan or run",
    "ahead of where their scheme places this week.",
  ];

  if (scheme) {
    const h = scheme.header || {};
    const o = scheme.overview || {};
    lines.push(
        "",
        `SCHEME OF WORK — ${h.class || ""} ${h.subject || ""} ` +
        `Term ${h.term || ""} (${h.numberOfWeeks ||
          (scheme.weeks || []).length} weeks)`.replace(/\s+/g, " ").trim(),
    );
    if (o.termTheme) lines.push(`Term theme: ${o.termTheme}`);
    const oc = bullets(o.overallCompetencies, 6);
    if (oc) lines.push("Term competencies:", oc);
    const ov = bullets(o.overallValues, 6);
    if (ov) lines.push("Term values:", ov);

    if (schemeWeek) {
      lines.push("", "THIS LESSON FALLS IN THIS WEEK OF THE SCHEME:");
      lines.push(renderWeek("Scheme week", schemeWeek));
    }
    const seq = renderSequence(scheme.weeks);
    if (seq) {
      lines.push(
          "",
          "Term sequence (for context — keep this lesson within its week, " +
          "do not pre-empt later weeks):",
          seq,
      );
    }
  }

  if (forecast) {
    lines.push("", "WEEKLY FORECAST (teacher's plan for the week ahead):");
    if (forecastWeek) {
      lines.push(renderWeek("Forecast week", forecastWeek));
    } else if (typeof forecast.outputText === "string" &&
               forecast.outputText.trim()) {
      lines.push(forecast.outputText.trim().slice(0, 1500));
    }
  }

  lines.push("</teacher_plans>");
  return lines.join("\n").slice(0, MAX_BLOCK_CHARS);
}

/**
 * Resolve a <teacher_plans> context block from the teacher's own saved
 * Scheme of Work / Weekly Forecast. Returns "" when nothing relevant is
 * found (no behaviour change) or on any error (fail-open).
 *
 * @param {object} args
 *   ownerUid (required) — the teacher generating the lesson
 *   grade, subject, term, week, topic, subtopic — the lesson coords
 */
async function resolveTeacherPlanContext({
  ownerUid, grade, subject, term, week, topic, subtopic,
} = {}) {
  if (!ownerUid) return "";

  const want = {
    grade: gradeDigits(grade),
    subject: normSubject(subject),
    term: termDigit(term),
    week: Number(week) > 0 ? Number(week) : null,
    topic: topic || "",
    subtopic: subtopic || "",
  };

  try {
    const db = admin.firestore();
    const snap = await db.collection("aiGenerations")
        .where("ownerUid", "==", ownerUid)
        .orderBy("createdAt", "desc")
        .limit(MAX_DOCS)
        .get();

    let scheme = null;
    let forecast = null;
    for (const doc of snap.docs) {
      if (scheme && forecast) break;
      const d = doc.data() || {};
      if (d.status !== "complete") continue;
      const tool = d.tool;
      if (tool !== "scheme_of_work" && tool !== "weekly_forecast") continue;
      if (!d.output && !d.outputText) continue;
      if (!docMatches(d, want)) continue;
      // snap is newest-first → keep the first (most recent) of each kind.
      if (tool === "scheme_of_work" && !scheme) scheme = d;
      if (tool === "weekly_forecast" && !forecast) forecast = d;
    }

    if (!scheme && !forecast) return "";

    const schemeOut = scheme && scheme.output;
    const forecastOut = forecast && forecast.output;
    return renderBlock({
      scheme: schemeOut || null,
      schemeWeek: schemeOut ?
        pickWeek(schemeOut.weeks, want) : null,
      forecast: forecast || null,
      forecastWeek: forecastOut ?
        pickWeek(forecastOut.weeks, want) : null,
    });
  } catch (err) {
    console.error("resolveTeacherPlanContext failed", err);
    return "";
  }
}

module.exports = {resolveTeacherPlanContext};
