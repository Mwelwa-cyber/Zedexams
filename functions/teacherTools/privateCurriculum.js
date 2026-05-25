/**
 * Private curriculum retrieval for teacher tools.
 *
 * This module reads the server-only `curriculum/*` and `rag_chunks/*`
 * collections that are populated from the CBC curriculum bundle. It never
 * exposes raw documents to the browser; it only returns a compact grounding
 * block for prompt construction inside Cloud Functions.
 */

const admin = require("firebase-admin");

const PRIVATE_CURRICULUM_VERSION = "private-cbc-rag.v1";
const CACHE_TTL_MS = 60_000;
const MAX_QUERY_DOCS = 600;
const MAX_MATCHES = 5;
const MIN_CONFIDENT_SCORE = 12;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "in", "into", "is", "it", "its", "of", "on", "or", "that", "the",
  "their", "this", "to", "with",
]);

const SUBJECT_PROFILES = {
  mathematics: {
    labels: [
      "mathematics",
      "mathematics i",
      "mathematics ii",
      "maths",
      "numbers",
      "algebra",
      "geometry",
      "fractions",
    ],
    syllabi: {
      ece: ["ece_syllabus", "sow_premaths_ece"],
      lower_primary: ["lower_primary"],
      upper_primary: ["maths_up"],
      o_level: ["maths1", "maths2_o"],
    },
  },
  english: {
    labels: [
      "english",
      "english language",
      "literacy",
      "pre-literacy",
      "language",
      "reading",
      "writing",
    ],
    syllabi: {
      ece: ["ece_syllabus", "sow_english_ece"],
      lower_primary: ["lower_primary"],
      upper_primary: [],
      o_level: ["english_o"],
    },
  },
  integrated_science: {
    labels: [
      "science",
      "integrated science",
      "pre-mathematics and science",
      "human body",
      "nutrition",
      "plants",
      "animals",
    ],
    syllabi: {
      ece: ["ece_syllabus", "sow_premaths_ece"],
      lower_primary: ["lower_primary"],
      upper_primary: ["science_up"],
      o_level: [],
    },
  },
  social_studies: {
    labels: [
      "social studies",
      "environment",
      "citizenship",
      "community",
      "civic",
      "history",
      "geography",
    ],
    syllabi: {
      ece: ["ece_syllabus"],
      lower_primary: ["lower_primary"],
      upper_primary: ["social_up"],
      o_level: [],
    },
  },
  literacy: {
    labels: [
      "literacy",
      "pre-literacy",
      "conversation",
      "reading",
      "writing",
      "listening",
      "speaking",
    ],
    syllabi: {
      ece: ["ece_syllabus", "sow_english_ece"],
      lower_primary: ["lower_primary"],
      upper_primary: [],
      o_level: [],
    },
  },
  zambian_language: {
    labels: [
      "zambian language",
      "zambian languages",
      "language",
      "bemba",
      "nyanja",
      "tonga",
      "lozi",
      "kaonde",
      "lunda",
      "luvale",
    ],
    syllabi: {
      ece: ["ece_syllabus"],
      lower_primary: ["lower_primary"],
      upper_primary: [],
      o_level: ["zam_lang_o"],
    },
  },
  creative_and_technology_studies: {
    labels: [
      "creative and technology studies",
      "technology studies",
      "creative",
      "technology",
      "arts",
      "craft",
      "computer",
    ],
    syllabi: {
      ece: ["ece_syllabus", "sow_cts_ece"],
      lower_primary: ["lower_primary"],
      upper_primary: ["tech_up"],
      o_level: [],
    },
  },
  physical_education: {
    labels: [
      "physical education",
      "sport",
      "fitness",
      "movement",
      "games",
    ],
    syllabi: {
      ece: ["ece_syllabus"],
      lower_primary: ["lower_primary"],
      upper_primary: [],
      o_level: ["pe_o"],
    },
  },
  religious_education: {
    labels: [
      "religious education",
      "religion",
      "belief",
      "faith",
      "christian",
      "moral",
    ],
    syllabi: {
      ece: ["ece_syllabus"],
      lower_primary: ["lower_primary"],
      upper_primary: [],
      o_level: ["re_o"],
    },
  },
  civic_education: {
    labels: [
      "civic education",
      "civic",
      "citizenship",
      "governance",
      "constitution",
      "rights",
    ],
    syllabi: {
      ece: ["ece_syllabus"],
      lower_primary: ["lower_primary"],
      upper_primary: [],
      o_level: ["civic_o"],
    },
  },
  biology: {
    labels: ["biology", "cells", "plants", "animals", "organisms"],
    syllabi: {ece: [], lower_primary: [], upper_primary: [], o_level: ["biology_o"]},
  },
  chemistry: {
    labels: ["chemistry", "matter", "atoms", "reactions", "acids", "bases"],
    syllabi: {ece: [], lower_primary: [], upper_primary: [], o_level: ["chemistry_o"]},
  },
  physics: {
    labels: ["physics", "energy", "forces", "motion", "electricity"],
    syllabi: {ece: [], lower_primary: [], upper_primary: [], o_level: ["physics_o"]},
  },
  geography: {
    labels: ["geography", "environment", "climate", "maps", "landforms"],
    syllabi: {ece: [], lower_primary: [], upper_primary: [], o_level: ["geography_o"]},
  },
  history: {
    labels: ["history", "heritage", "past", "independence", "colonial"],
    syllabi: {ece: [], lower_primary: [], upper_primary: [], o_level: ["history_o"]},
  },
};

let _curriculumCache = null;
let _curriculumCacheAt = 0;

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normaliseText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function dedupe(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function cleanSnippet(value, max = 240) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function inferGradeProfile(grade) {
  const raw = String(grade || "").trim().toUpperCase();
  if (!raw) {
    return {
      raw: "",
      band: null,
      gradeNumber: null,
      formNumber: null,
      levelLabel: "",
      mappingNote: "",
    };
  }
  if (raw === "ECE") {
    return {
      raw,
      band: "ece",
      gradeNumber: null,
      formNumber: null,
      levelLabel: "ECE",
      mappingNote: "",
    };
  }

  const gradeMatch = raw.match(/^G(?:RADE)?\s*(\d{1,2})$/);
  if (gradeMatch) {
    const gradeNumber = Number(gradeMatch[1]);
    if (gradeNumber >= 1 && gradeNumber <= 3) {
      return {
        raw,
        band: "lower_primary",
        gradeNumber,
        formNumber: null,
        levelLabel: "Lower Primary",
        mappingNote: "",
      };
    }
    if (gradeNumber >= 4 && gradeNumber <= 6) {
      return {
        raw,
        band: "upper_primary",
        gradeNumber,
        formNumber: null,
        levelLabel: "Upper Primary",
        mappingNote: "",
      };
    }
    if (gradeNumber >= 8 && gradeNumber <= 11) {
      const formNumber = gradeNumber - 7;
      return {
        raw,
        band: "o_level",
        gradeNumber,
        formNumber,
        levelLabel: "O-Level",
        mappingNote: `Mapped ${raw} to O-Level Form ${formNumber}.`,
      };
    }
    return {
      raw,
      band: null,
      gradeNumber,
      formNumber: null,
      levelLabel: "",
      mappingNote: "",
    };
  }

  const formMatch = raw.match(/^F(?:ORM)?\s*(\d)$/);
  if (formMatch) {
    const formNumber = Number(formMatch[1]);
    if (formNumber >= 1 && formNumber <= 4) {
      return {
        raw,
        band: "o_level",
        gradeNumber: formNumber + 7,
        formNumber,
        levelLabel: "O-Level",
        mappingNote: "",
      };
    }
  }

  return {
    raw,
    band: null,
    gradeNumber: null,
    formNumber: null,
    levelLabel: "",
    mappingNote: "",
  };
}

function buildRequestMeta({grade, subject, topic, subtopic}) {
  const gradeProfile = inferGradeProfile(grade);
  const subjectId = String(subject || "")
    .toLowerCase()
    .replace(/[^a-z_]/g, "_");
  const subjectProfile = SUBJECT_PROFILES[subjectId] || {
    labels: [subjectId.replace(/_/g, " ")],
    syllabi: {},
  };
  const queryTags = dedupe(subjectProfile.syllabi[gradeProfile.band] || []);
  return {
    gradeProfile,
    subjectId,
    subjectProfile,
    topicText: String(topic || "").trim(),
    subtopicText: String(subtopic || "").trim(),
    topicPhrase: normaliseText(topic),
    subtopicPhrase: normaliseText(subtopic),
    topicTokens: tokenize(topic),
    subtopicTokens: tokenize(subtopic),
    subjectTokens: tokenize(subjectProfile.labels.join(" ")),
    queryTags,
  };
}

async function getCurriculumDocs() {
  const now = Date.now();
  if (_curriculumCache && (now - _curriculumCacheAt) < CACHE_TTL_MS) {
    return _curriculumCache;
  }

  try {
    const snap = await admin.firestore().collection("curriculum").get();
    const docs = new Map();
    snap.docs.forEach((doc) => docs.set(doc.id, {id: doc.id, ...doc.data()}));
    _curriculumCache = docs;
    _curriculumCacheAt = now;
    return docs;
  } catch (error) {
    console.error("getCurriculumDocs failed", error);
    _curriculumCache = new Map();
    _curriculumCacheAt = now;
    return _curriculumCache;
  }
}

function invalidatePrivateCurriculumCache() {
  _curriculumCache = null;
  _curriculumCacheAt = 0;
}

async function fetchCandidateChunks(requestMeta) {
  const tags = requestMeta.queryTags.slice(0, 10);
  if (tags.length === 0) return [];

  try {
    const snap = await admin.firestore()
      .collection("rag_chunks")
      .where("tags", "array-contains-any", tags)
      .limit(MAX_QUERY_DOCS)
      .get();
    return snap.docs.map((doc) => ({id: doc.id, ...doc.data()}));
  } catch (error) {
    console.error("fetchCandidateChunks failed", error);
    return [];
  }
}

function chunkMatchesGrade(chunk, gradeProfile) {
  if (!gradeProfile.band) return true;
  if (gradeProfile.band === "lower_primary" || gradeProfile.band === "upper_primary") {
    return Number(chunk.grade || 0) === Number(gradeProfile.gradeNumber || 0);
  }
  if (gradeProfile.band === "o_level") {
    return Number(chunk.form || 0) === Number(gradeProfile.formNumber || 0);
  }
  if (gradeProfile.band === "ece") {
    const tags = Array.isArray(chunk.tags) ? chunk.tags : [];
    return tags.includes("ece") || String(chunk.level || "").toLowerCase().includes("ece");
  }
  return true;
}

function countTokenMatches(tokens, haystackTokens) {
  if (!tokens.length || !haystackTokens.size) return 0;
  let matches = 0;
  for (const token of tokens) {
    if (haystackTokens.has(token)) matches += 1;
  }
  return matches;
}

function scoreChunk(chunk, requestMeta) {
  const title = normaliseText(chunk.title);
  const subject = normaliseText(chunk.subject);
  const topicTitle = normaliseText(chunk.topic_title);
  const subtopicTitle = normaliseText(chunk.subtopic_title);
  const text = normaliseText(String(chunk.text || "").slice(0, 3000));
  const combined = [title, subject, topicTitle, subtopicTitle, text]
    .filter(Boolean)
    .join(" ");
  const haystackTokens = new Set(tokenize(combined));

  let score = 0;
  if (chunkMatchesGrade(chunk, requestMeta.gradeProfile)) score += 10;

  if (requestMeta.topicPhrase) {
    if (topicTitle && topicTitle.includes(requestMeta.topicPhrase)) score += 36;
    if (subtopicTitle && subtopicTitle.includes(requestMeta.topicPhrase)) score += 18;
    if (title.includes(requestMeta.topicPhrase)) score += 18;
    if (text.includes(requestMeta.topicPhrase)) score += 20;
  }

  if (requestMeta.subtopicPhrase) {
    if (subtopicTitle && subtopicTitle.includes(requestMeta.subtopicPhrase)) score += 24;
    if (title.includes(requestMeta.subtopicPhrase)) score += 10;
    if (text.includes(requestMeta.subtopicPhrase)) score += 12;
  }

  const topicTokenHits = countTokenMatches(requestMeta.topicTokens, haystackTokens);
  const subtopicTokenHits = countTokenMatches(requestMeta.subtopicTokens, haystackTokens);
  const subjectTokenHits = countTokenMatches(requestMeta.subjectTokens, haystackTokens);
  score += Math.min(topicTokenHits * 6, 24);
  score += Math.min(subtopicTokenHits * 5, 15);
  score += Math.min(subjectTokenHits * 4, 12);

  const tags = Array.isArray(chunk.tags) ? chunk.tags : [];
  const tagHits = requestMeta.queryTags.filter((tag) => tags.includes(tag)).length;
  score += Math.min(tagHits * 4, 12);

  // Admin-uploaded modules beat general syllabus chunks when an admin
  // has uploaded a topic-specific resource for the same grade + subject.
  // The retrieval still falls back to the syllabus if no module ranks
  // above the confidence threshold — the boost only changes ordering,
  // not eligibility.
  const documentType = typeof chunk.documentType === "string" ?
    chunk.documentType : "";
  if (documentType === "module") score += 8;
  else if (documentType === "learners_book" || documentType === "teachers_guide" ||
           documentType === "scheme_of_work" || documentType === "lesson_plan") score += 6;
  else if (documentType === "syllabus") score += 3;

  return score;
}

function extractChunkCompetence(chunk) {
  const direct = cleanSnippet(chunk.competence || chunk.specificCompetence || "", 260);
  if (direct) return direct;
  const text = String(chunk.text || "");
  const match = text.match(
    /Specific Competence:\s*([\s\S]*?)(?:\n\s*Suggested Learning Activities:|$)/i,
  );
  return cleanSnippet(match ? match[1] : "", 260);
}

function extractChunkActivities(chunk) {
  const text = String(chunk.text || "");
  const match = text.match(/Suggested Learning Activities:\s*([\s\S]*)$/i);
  return cleanSnippet(match ? match[1] : "", 220);
}

function buildOutcomeLabel(chunk) {
  const parts = [];
  if (chunk.topic_code || chunk.topic_title) {
    parts.push(
      [chunk.topic_code, cleanSnippet(chunk.topic_title, 80)].filter(Boolean).join(" "),
    );
  }
  if (chunk.subtopic_code || chunk.subtopic_title) {
    parts.push(
      [chunk.subtopic_code, cleanSnippet(chunk.subtopic_title, 80)].filter(Boolean).join(" "),
    );
  }
  return parts.filter(Boolean).join(" > ");
}

function pickFrameworkLists(curriculumDocs) {
  const framework = curriculumDocs.get("framework");
  return {
    coreCompetences: Array.isArray(framework?.core_competences) ?
      framework.core_competences
        .map((item) => cleanSnippet(item?.name || item, 80))
        .filter(Boolean)
        .slice(0, 8) :
      [],
    nationalValues: Array.isArray(framework?.national_values_and_principles) ?
      framework.national_values_and_principles
        .map((item) => cleanSnippet(item, 90))
        .filter(Boolean)
        .slice(0, 6) :
      [],
    crossCutting: Array.isArray(framework?.cross_cutting_issues) ?
      framework.cross_cutting_issues
        .map((item) => cleanSnippet(item?.name || item, 90))
        .filter(Boolean)
        .slice(0, 6) :
      [],
  };
}

function buildPrivateContextBlock({requestMeta, matches, curriculumDocs}) {
  const lists = pickFrameworkLists(curriculumDocs);
  const syllabusTitles = dedupe(matches.map((match) => {
    const syllabusId = match.syllabus_id;
    return syllabusId && curriculumDocs.has(syllabusId) ?
      curriculumDocs.get(syllabusId).title :
      match.subject;
  }));

  const lines = [
    "<cbc_context>",
    "INTERNAL GROUNDING ONLY: The following CBC curriculum notes are private",
    "server-side context for the assistant. Use them to guide the response,",
    "but do not reproduce long verbatim excerpts or raw curriculum dumps.",
    "",
    `Requested grade/class: ${requestMeta.gradeProfile.raw || "Unknown"}`,
    `Requested subject: ${requestMeta.subjectId.replace(/_/g, " ") || "Unknown"}`,
    `Requested topic: ${requestMeta.topicText || "Unknown"}`,
    requestMeta.subtopicText ? `Requested sub-topic: ${requestMeta.subtopicText}` : "",
    requestMeta.gradeProfile.levelLabel ?
      `Curriculum band: ${requestMeta.gradeProfile.levelLabel}` : "",
    requestMeta.gradeProfile.mappingNote || "",
    syllabusTitles.length ?
      `Matched syllabus sources: ${syllabusTitles.join("; ")}` :
      "",
    "",
    "Best-matching verified curriculum outcomes:",
  ];

  matches.forEach((chunk, index) => {
    const competence = extractChunkCompetence(chunk);
    const activityHints = extractChunkActivities(chunk);
    lines.push(
      `- Match ${index + 1}: ${chunk.competence_code || "Outcome"} | ` +
      `${buildOutcomeLabel(chunk) || cleanSnippet(chunk.title, 120)}`,
    );
    if (competence) lines.push(`  Specific competence: ${competence}`);
    if (activityHints) lines.push(`  Activity hints: ${activityHints}`);
  });

  if (lists.coreCompetences.length) {
    lines.push("", "Framework-aligned core competences to consider where natural:");
    lines.push(`- ${lists.coreCompetences.join("; ")}`);
  }
  if (lists.nationalValues.length) {
    lines.push("", "National values and principles to weave in where natural:");
    lines.push(`- ${lists.nationalValues.join("; ")}`);
  }
  if (lists.crossCutting.length) {
    lines.push("", "Cross-cutting issues worth integrating where appropriate:");
    lines.push(`- ${lists.crossCutting.join("; ")}`);
  }

  lines.push("</cbc_context>");
  return lines.filter(Boolean).join("\n");
}

async function resolvePrivateCurriculumContext(request) {
  const requestMeta = buildRequestMeta(request);
  if (requestMeta.queryTags.length === 0) return null;

  const [curriculumDocs, candidateChunks] = await Promise.all([
    getCurriculumDocs(),
    fetchCandidateChunks(requestMeta),
  ]);
  if (!curriculumDocs.size || candidateChunks.length === 0) return null;

  const scored = candidateChunks
    .map((chunk) => ({chunk, score: scoreChunk(chunk, requestMeta)}))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < MIN_CONFIDENT_SCORE) return null;

  const matches = scored.slice(0, MAX_MATCHES).map((item) => item.chunk);
  return {
    contextBlock: buildPrivateContextBlock({
      requestMeta,
      matches,
      curriculumDocs,
    }),
    match: {
      source: "private_curriculum",
      hits: matches.map((chunk) => ({
        id: chunk.id,
        competenceCode: chunk.competence_code || "",
        subject: chunk.subject || "",
        syllabusId: chunk.syllabus_id || "",
      })),
    },
  };
}

/**
 * Build the `tags` array to attach to an admin-uploaded curriculum chunk
 * so it surfaces in `fetchCandidateChunks` for matching teacher-tool
 * requests. The retrieval query is `tags array-contains-any [...queryTags]`
 * where queryTags is `SUBJECT_PROFILES[subject].syllabi[band]`. Returning
 * the same tag set on the chunk guarantees it shows up alongside the
 * syllabus rows scoped by the same grade + subject.
 *
 * Returns at minimum a band tag (e.g. "upper_primary") so even unrecognised
 * subjects still surface for grade-only queries.
 */
function buildIngestTagsFor(grade, subject) {
  const gradeProfile = inferGradeProfile(grade);
  const subjectId = String(subject || "")
      .toLowerCase()
      .replace(/[^a-z_]/g, "_");
  const subjectProfile = SUBJECT_PROFILES[subjectId];
  const tags = [];
  if (subjectProfile && gradeProfile.band) {
    const syllabusTags = subjectProfile.syllabi[gradeProfile.band] || [];
    for (const tag of syllabusTags) {
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  if (gradeProfile.band && !tags.includes(gradeProfile.band)) {
    tags.push(gradeProfile.band);
  }
  return tags;
}

module.exports = {
  PRIVATE_CURRICULUM_VERSION,
  invalidatePrivateCurriculumCache,
  resolvePrivateCurriculumContext,
  buildIngestTagsFor,
  scoreChunk,
};
