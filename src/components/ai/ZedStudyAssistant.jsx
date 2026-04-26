import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Mic,
  X,
  RotateCcw,
  Play,
  Square,
  Copy,
  Settings,
  Plus,
  BookOpen,
  PencilLine,
  FileText,
  Layers,
  Award,
  ChevronRight,
} from "../ui/icons";
import { sendAIChatStream } from "../../utils/aiAssistant";
import { useSpeech } from "./useSpeech";
import MobileBottomNav from "../layout/MobileBottomNav";

// ═══════════════════════════════════════════════════════════════════
// THEME — light cream + cobalt blue + orange accents (HTML mini-app)
// ═══════════════════════════════════════════════════════════════════
const TOKENS = {
  light: {
    cream: "#F4F1EA",
    paper: "#FBF8F1",
    paper2: "#FFFFFF",
    ink: "#142036",
    inkSoft: "#3A4660",
    inkMuted: "#6B7689",
    cobalt: "#0C67B0",
    cobalt2: "#1B83CC",
    cobaltGlow: "rgba(12, 103, 176, 0.14)",
    navy: "#183D6E",
    orange: "#F06121",
    orange2: "#F5814E",
    line: "#DCE2EB",
    lineSoft: "#E9EEF5",
    bubbleBot: "#FFFFFF",
    bubbleUser: "#0C67B0",
    bubbleUserText: "#FAF7F0",
    shadowSm: "0 1px 2px rgba(20, 32, 54, 0.04), 0 1px 1px rgba(20, 32, 54, 0.02)",
    shadowMd: "0 4px 16px -4px rgba(20, 32, 54, 0.08), 0 2px 6px -2px rgba(20, 32, 54, 0.04)",
    shadowLg: "0 12px 32px -8px rgba(20, 32, 54, 0.18), 0 4px 12px -4px rgba(20, 32, 54, 0.08)",
  },
  dark: {
    cream: "#0B1424",
    paper: "#11192C",
    paper2: "#18223A",
    ink: "#EAF0F9",
    inkSoft: "#B7C2D6",
    inkMuted: "#7A8AA5",
    cobalt: "#5AA8E0",
    cobalt2: "#7DBEEC",
    cobaltGlow: "rgba(90, 168, 224, 0.20)",
    navy: "#C7D6EC",
    orange: "#F5814E",
    orange2: "#FA9B6F",
    line: "#1F2C45",
    lineSoft: "#182238",
    bubbleBot: "#18223A",
    bubbleUser: "#1B5C99",
    bubbleUserText: "#FFFFFF",
    shadowSm: "0 1px 2px rgba(0,0,0,0.4)",
    shadowMd: "0 4px 16px -4px rgba(0,0,0,0.5)",
    shadowLg: "0 12px 32px -8px rgba(0,0,0,0.7)",
  },
};

// ═══════════════════════════════════════════════════════════════════
// 2023 ZECF — Zambia Education Curriculum Framework (3-6-4-2)
// ECE (3y) → Primary G1-6 (6y) → O-Level F1-4 (4y) → A-Level F5-6 (2y)
// ═══════════════════════════════════════════════════════════════════
const GRADE_SECTIONS = [
  { label: "Early Childhood Education", short: "ECE", grades: ["ECE Level 1", "ECE Level 2", "ECE Level 3"] },
  { label: "Primary", short: "Primary", grades: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"] },
  { label: "Ordinary Secondary", short: "O-Level", grades: ["Form 1", "Form 2", "Form 3", "Form 4"] },
  { label: "Advanced Secondary", short: "A-Level", grades: ["Form 5", "Form 6"] },
];
const EXAM_GRADES = new Set(["Grade 6", "Form 4", "Form 6"]);
const SUBJECTS = [
  "Mathematics", "English",
  "Zambian Lang.", "Literature",
  "Biology", "Chemistry",
  "Physics", "Geography",
  "History", "Civic Edu.",
  "Religious Edu.", "Creative & Tech.",
];

function levelOf(grade) {
  if (!grade) return { name: "Secondary", band: "o-level" };
  if (grade.startsWith("ECE")) return { name: "Early Childhood Education", band: "ece" };
  if (grade.startsWith("Grade")) {
    const n = parseInt(grade.replace(/\D/g, ""), 10);
    return n <= 3
      ? { name: "Lower Primary", band: "lower-primary" }
      : { name: "Upper Primary", band: "upper-primary" };
  }
  if (grade.startsWith("Form")) {
    const n = parseInt(grade.replace(/\D/g, ""), 10);
    return n <= 4
      ? { name: "Ordinary Secondary (O-Level)", band: "o-level" }
      : { name: "Advanced Secondary (A-Level)", band: "a-level" };
  }
  return { name: "Secondary", band: "o-level" };
}

// ═══════════════════════════════════════════════════════════════════
// TOPIC SEEDS — for greeting starter cards (band-aware)
// ═══════════════════════════════════════════════════════════════════
const SEEDS = {
  "Mathematics": {
    "ece": ["counting from 1 to 10", "shapes around us"],
    "lower-primary": ["adding two-digit numbers", "telling the time"],
    "upper-primary": ["fractions and decimals", "finding the perimeter of a rectangle"],
    "o-level": ["solving linear equations", "Pythagoras' theorem"],
    "a-level": ["differentiation from first principles", "integration techniques"],
  },
  "English": {
    "ece": ["naming common things", "simple sentences"],
    "lower-primary": ["nouns and verbs", "writing a friendly letter"],
    "upper-primary": ["summary writing", "comprehension techniques"],
    "o-level": ["active vs passive voice", "figures of speech"],
    "a-level": ["critical analysis of unseen prose", "rhetorical devices in argument"],
  },
  "Zambian Lang.": {
    "ece": ["greetings in Bemba", "family words in Nyanja"],
    "lower-primary": ["common Bemba greetings", "simple Nyanja sentences"],
    "upper-primary": ["Zambian proverbs and meanings", "narrative writing in Bemba"],
    "o-level": ["noun classes in Bantu languages", "translating between English and Nyanja"],
    "a-level": ["oral literature: ifyabukaya", "comparative Bantu grammar"],
  },
  "Literature": {
    "ece": ["favourite story characters", "rhyme and rhythm"],
    "lower-primary": ["parts of a story", "rhyme and rhythm"],
    "upper-primary": ["parts of a story", "rhyme and rhythm"],
    "o-level": ["analysing an unseen poem", "character study in a Zambian novel"],
    "a-level": ["themes in post-colonial African literature", "tragic structure in drama"],
  },
  "Biology": {
    "ece": ["parts of a plant", "living vs non-living things"],
    "lower-primary": ["parts of a plant", "living vs non-living things"],
    "upper-primary": ["the human skeleton", "food chains"],
    "o-level": ["photosynthesis", "the human heart"],
    "a-level": ["photosynthesis: light vs dark reactions", "genetics and inheritance"],
  },
  "Chemistry": {
    "ece": ["solids, liquids, and gases", "mixing"],
    "lower-primary": ["solids, liquids, and gases", "mixing and separating"],
    "upper-primary": ["acids and bases", "changes of state"],
    "o-level": ["the periodic table", "balancing chemical equations"],
    "a-level": ["organic chemistry: alkanes and alkenes", "electrolysis"],
  },
  "Physics": {
    "ece": ["light and shadows", "pushing and pulling"],
    "lower-primary": ["light and shadows", "pushing and pulling"],
    "upper-primary": ["simple electric circuits", "magnetism"],
    "o-level": ["Newton's laws of motion", "reflection of light"],
    "a-level": ["electromagnetic induction", "waves and the Doppler effect"],
  },
  "Geography": {
    "ece": ["the four cardinal directions", "maps of our community"],
    "lower-primary": ["the four cardinal directions", "maps of our community"],
    "upper-primary": ["Zambia's provinces and capitals", "rivers of Zambia"],
    "o-level": ["the rock cycle", "climate vs weather"],
    "a-level": ["plate tectonics", "population and migration in Zambia"],
  },
  "History": {
    "ece": ["symbols of Zambia", "famous Zambian heroes"],
    "lower-primary": ["traditional ceremonies of Zambia", "famous Zambian heroes"],
    "upper-primary": ["the Zambian flag and what it means", "pre-colonial kingdoms"],
    "o-level": ["the Lozi kingdom", "Zambian independence in 1964"],
    "a-level": ["the rise of Kenneth Kaunda", "one-party state to multi-party democracy"],
  },
  "Civic Edu.": {
    "ece": ["rules at home and school", "symbols of Zambia"],
    "lower-primary": ["rules at home and at school", "symbols of Zambia"],
    "upper-primary": ["rights and responsibilities", "the three arms of government"],
    "o-level": ["the Constitution of Zambia", "human rights"],
    "a-level": ["democracy and elections in Zambia", "gender equality and the law"],
  },
  "Religious Edu.": {
    "ece": ["stories about kindness", "thanking God"],
    "lower-primary": ["Bible stories about kindness", "thanking God for our family"],
    "upper-primary": ["the Ten Commandments", "parables of Jesus"],
    "o-level": ["comparing Christianity, Islam, and Hinduism", "the African concept of God"],
    "a-level": ["ethics in modern Zambian society", "religion and politics"],
  },
  "Creative & Tech.": {
    "ece": ["drawing your favourite animal", "colours and shapes"],
    "lower-primary": ["drawing your favourite animal", "colours and shapes"],
    "upper-primary": ["simple woodwork joints", "the design process"],
    "o-level": ["the design cycle", "pattern-making in textiles"],
    "a-level": ["starting a small business", "CAD basics for design"],
  },
};

function topicsFor(subject, grade) {
  const band = levelOf(grade).band;
  return (SEEDS[subject] && SEEDS[subject][band]) || ["key concepts"];
}

// ═══════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — student-facing tutor, ZECF 2023
// ═══════════════════════════════════════════════════════════════════
function buildSystemPrompt(scope, mode) {
  const modeNote = {
    exam: "EXAM PREP mode — give exam-style structured answers with mark allocations where useful. Mirror ECZ marking conventions.",
    explain: "PLAIN-LANGUAGE mode — use everyday words, analogies, and short sentences. Define jargon instantly.",
    paper: "PAST-PAPER mode — break questions into steps, show full working, name the technique, explain what the examiner wants.",
    study: "general STUDY mode — be friendly, clear, and curriculum-accurate.",
  }[mode] || "";

  const lvl = levelOf(scope.grade);
  const guidance = {
    "ece": "You are speaking with a very young learner (ECE, age 3-5). Use simple, repetitive words, short sentences, lots of imagery. Praise warmly.",
    "lower-primary": "You are speaking with a Lower Primary learner (Grade 1-3). Very simple words and short sentences. Lean on Zambian everyday examples.",
    "upper-primary": "You are speaking with an Upper Primary learner (Grade 4-6). Clear, simple language with everyday Zambian examples. Define every new term immediately. Grade 6 ends with the Primary School Leaving Examination.",
    "o-level": "You are speaking with an O-Level learner (Form 1-4). Clear, structured explanations using proper subject vocabulary. Form 4 ends with the School Certificate examination.",
    "a-level": "You are speaking with an A-Level learner (Form 5-6). Use the full subject vocabulary. Show working in detail, cite formulas and laws.",
  }[lvl.band];

  const isExamYear = EXAM_GRADES.has(scope.grade);
  const examNote = scope.grade === "Grade 6" ? "Grade 6 — final Primary year, sits the Primary School Leaving Examination"
    : scope.grade === "Form 4" ? "Form 4 — final O-Level year, sits the School Certificate Examination"
    : scope.grade === "Form 6" ? "Form 6 — final A-Level year, sits the A-Level Certificate Examination"
    : "";

  return `You are Zed, the warm and sharp study companion built for ZedExams (zedexams.com) — a Zambian exam-prep platform whose tagline is "Practise smart."

CURRICULUM — 2023 Zambia Education Curriculum Framework (ZECF), administered by CDC and assessed by ECZ. Launched in 2025, replaces the 2013 OBE structure.

STRUCTURE (3-6-4-2):
- Early Childhood Education (ECE) — 3 years
- Primary — 6 years (Grade 1-6), ends with Primary School Leaving Examination at Grade 6
- Ordinary Secondary (O-Level) — 4 years (Form 1-4), ends with School Certificate at Form 4
- Advanced Secondary (A-Level) — 2 years (Form 5-6), ends with A-Level Certificate at Form 6

KEY REFORM POINTS:
1. Grade 7-12 NO LONGER EXIST. Replaced by Form 1-6.
2. "Form" is the secondary naming. "Grade" is only at Primary.
3. Junior + Senior Secondary merged into single 4-year O-Level.
4. A-Level (Form 5-6) is brand new in Zambia.
5. Integrated Science split into Biology, Chemistry, Physics. Social Studies split into Geography, History, Civic Education.

CURRENT STUDENT
- Level: ${lvl.name} — ${scope.grade}${isExamYear ? `  ⚠ EXAMINATION YEAR — ${examNote}` : ""}
- Subject: ${scope.subject}
- Mode: ${modeNote}

LEVEL-APPROPRIATE STYLE
${guidance}

TEACHING MECHANICS — apply rigorously
1. Show working. For maths/sciences, every step. Name the rule. Bold the final answer.
2. Define before using. First time a technical term appears, define inline.
3. Mark-scheme awareness. For exam questions, structure answers to earn each mark — distinct points.
4. Command-word discipline. Match the answer to the command word (Define / Explain / Compare / Discuss / Suggest).
5. Error correction with kindness. Find what's right, name where it slipped, guide to the correct answer.
6. Honest uncertainty. If unsure about syllabus specifics, say so. Never fabricate ECZ paper structures or syllabus point numbers.
7. Active learning. Where natural, end with a check-for-understanding question.

GENERAL STYLE
- Concise. Default 3-6 short paragraphs unless asked for more depth.
- Markdown: **bold** for key terms, lists for steps, ## headings for sections.
- For maths/science, LaTeX in $...$ or $$...$$.
- Anchor in Zambian context where natural (kwacha, Lusaka, Kafue, copper) — never force it.
- Speak warmly and directly. No filler ("Great question!"). Just answer.

After your answer, suggest 2-3 natural follow-up questions the student might ask next, formatted exactly like this at the end:

[FOLLOWUPS]
- First follow-up
- Second follow-up
- Third follow-up
[/FOLLOWUPS]

Keep follow-ups under 60 chars each, specific to what was just discussed.`;
}

function buildQuizSystemPrompt() {
  return `You are a quiz generator for ZedExams. Output strictly valid JSON. No prose, no markdown fences, no commentary — just the JSON object.`;
}

function buildQuizPrompt(scope, count, difficulty, topic) {
  const diffNote = {
    easy: "easy, foundational level",
    mixed: "mixed difficulty (some easy, some medium, one or two harder)",
    exam: `true exam-paper difficulty for ${scope.grade}`,
    hard: "challenging, stretch-level",
  }[difficulty];

  const topicLine = topic
    ? `Focus EXCLUSIVELY on this topic within ${scope.subject}: "${topic}". Vary the angles, but every question must be on this topic.`
    : `Vary topics across the ${scope.subject} syllabus.`;

  return `Generate a ${count}-question multiple-choice quiz in ${scope.subject} for a Zambian ${scope.grade} student under the 2023 ZECF.

Difficulty: ${diffNote}.
${topicLine}

Return ONLY a valid JSON object (no prose, no markdown fences) with this exact shape:
{
  "questions": [
    {
      "question": "the question text",
      "options": ["option A", "option B", "option C", "option D"],
      "correctIndex": 0,
      "explanation": "1-2 sentence explanation of why the correct answer is right",
      "topic": "short topic name e.g. 'Genetics'"
    }
  ]
}

Rules:
- Exactly 4 options per question.
- correctIndex is 0-3.
- Use British English spelling and Zambian context where natural.
- Keep each question under 35 words. Each option under 15 words. Explanation under 30 words.`;
}

// ═══════════════════════════════════════════════════════════════════
// LOCALSTORAGE — sessions, settings, streak, quiz history
// ═══════════════════════════════════════════════════════════════════
const STORAGE_KEY = "zed-state-v3";
const STREAK_KEY = "zed-streak-v1";
const SETTINGS_KEY = "zed-settings-v1";
const QUIZ_HIST_KEY = "zed-quiz-history-v1";

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

function makeSession(scope) {
  return {
    id: `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: "New chat",
    scope: { ...scope },
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// MARKDOWN — light theme renderer (escapes HTML, supports bold/italic/
// code/lists/headings/blockquotes)
// ═══════════════════════════════════════════════════════════════════
function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineFmt(t = "", { codeBg, codeFg }) {
  return escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, `<strong>$1</strong>`)
    .replace(/\*([^*\n]+)\*/g, `<em>$1</em>`)
    .replace(/`([^`]+)`/g, `<code style="background:${codeBg};color:${codeFg};padding:1px 5px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:0.88em">$1</code>`);
}

function MarkdownText({ text, palette, isUser = false }) {
  if (!text) return null;
  const lines = text.split("\n");
  const els = [];
  const baseColor = isUser ? palette.bubbleUserText : palette.ink;
  const headingColor = isUser ? palette.orange2 : palette.cobalt;
  const codeBg = isUser ? "rgba(255,255,255,0.18)" : palette.lineSoft;
  const codeFg = isUser ? palette.orange2 : palette.orange;
  const ifmt = (t) => inlineFmt(t, { codeBg, codeFg });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^###\s+/.test(line)) {
      els.push(
        <h3 key={i} style={{ color: headingColor, fontWeight: 600, fontSize: 15, margin: "14px 0 6px", fontFamily: "Outfit, system-ui, sans-serif", letterSpacing: "-0.01em" }}>
          {line.replace(/^###\s+/, "")}
        </h3>
      );
    } else if (/^##\s+/.test(line)) {
      els.push(
        <h2 key={i} style={{ color: baseColor, fontWeight: 600, fontSize: 16.5, margin: "14px 0 6px", fontFamily: "Outfit, system-ui, sans-serif", letterSpacing: "-0.01em" }}>
          {line.replace(/^##\s+/, "")}
        </h2>
      );
    } else if (/^#\s+/.test(line)) {
      els.push(
        <h1 key={i} style={{ color: baseColor, fontWeight: 700, fontSize: 18, margin: "14px 0 6px", fontFamily: "Outfit, system-ui, sans-serif", letterSpacing: "-0.01em" }}>
          {line.replace(/^#\s+/, "")}
        </h1>
      );
    } else if (/^>\s+/.test(line)) {
      els.push(
        <div key={i}
          style={{ borderLeft: `3px solid ${palette.orange}`, paddingLeft: 10, margin: "8px 0", color: palette.inkSoft, fontStyle: "italic" }}
          dangerouslySetInnerHTML={{ __html: ifmt(line.replace(/^>\s+/, "")) }} />
      );
    } else if (/^\d+\.\s+/.test(trimmed)) {
      const num = trimmed.match(/^(\d+)\./)[1];
      const content = trimmed.replace(/^\d+\.\s+/, "");
      els.push(
        <div key={i} style={{ display: "flex", gap: 8, margin: "3px 0", paddingLeft: 4 }}>
          <span style={{ color: palette.cobalt, fontWeight: 700, minWidth: 22, fontSize: 14, flexShrink: 0 }}>{num}.</span>
          <span style={{ color: baseColor, fontSize: 14.5, lineHeight: 1.55 }}
            dangerouslySetInnerHTML={{ __html: ifmt(content) }} />
        </div>
      );
    } else if (/^[-*•]\s+/.test(trimmed)) {
      const content = trimmed.replace(/^[-*•]\s+/, "");
      els.push(
        <div key={i} style={{ display: "flex", gap: 8, margin: "3px 0", paddingLeft: 4 }}>
          <span style={{ color: palette.cobalt, marginTop: 7, flexShrink: 0, fontSize: 6 }}>●</span>
          <span style={{ color: baseColor, fontSize: 14.5, lineHeight: 1.55 }}
            dangerouslySetInnerHTML={{ __html: ifmt(content) }} />
        </div>
      );
    } else if (trimmed === "") {
      els.push(<div key={i} style={{ height: 8 }} />);
    } else {
      els.push(
        <p key={i} style={{ color: baseColor, margin: "0 0 8px", lineHeight: 1.55, fontSize: 14.5 }}
          dangerouslySetInnerHTML={{ __html: ifmt(line) }} />
      );
    }
  }
  return <div>{els}</div>;
}

// ═══════════════════════════════════════════════════════════════════
// FOLLOW-UPS — extract `[FOLLOWUPS]…[/FOLLOWUPS]` block from reply
// ═══════════════════════════════════════════════════════════════════
function extractFollowups(text) {
  const m = text.match(/\[FOLLOWUPS\]([\s\S]*?)(\[\/FOLLOWUPS\]|$)/i);
  if (!m) return null;
  return m[1]
    .split("\n")
    .map(s => s.replace(/^[-•*\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}
function stripFollowups(text) {
  return text.replace(/\[FOLLOWUPS\][\s\S]*?(\[\/FOLLOWUPS\]|$)/i, "").trim();
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT — markdown download
// ═══════════════════════════════════════════════════════════════════
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function exportMessages(messages, scope, mode) {
  if (!messages.length) return false;
  const head = `# ZedExams Study Session\n\n**Scope:** ${scope.grade} · ${scope.subject} · ${mode} mode\n**Date:** ${new Date().toLocaleString("en-ZM", { dateStyle: "long", timeStyle: "short" })}\n\n---\n\n`;
  const body = messages.map(m => {
    const who = m.role === "user" ? "**You**" : "**Zed**";
    return `${who}:\n\n${m.content}\n\n`;
  }).join("---\n\n");
  const md = head + body;
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zed-${scope.subject.toLowerCase().replace(/\W+/g, "-")}-${todayStr()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS — relative time, debounced toast
// ═══════════════════════════════════════════════════════════════════
function relTime(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString("en-ZM", { day: "numeric", month: "short" });
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function ZedStudyAssistant() {
  // ── Settings (theme, voice, speech) ───────────────────────────
  const [settings, setSettings] = useState(() => {
    const def = { theme: "auto", voice: true, speech: true };
    const saved = loadJSON(SETTINGS_KEY, null);
    return saved ? { ...def, ...saved } : def;
  });
  useEffect(() => { saveJSON(SETTINGS_KEY, settings); }, [settings]);

  // Resolve theme: auto follows OS
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return undefined;
    const handler = (e) => setSystemDark(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  const isDark = settings.theme === "dark" || (settings.theme === "auto" && systemDark);
  const palette = isDark ? TOKENS.dark : TOKENS.light;

  // ── Sessions (multi-session storage) ────────────────────────────
  const [sessions, setSessions] = useState(() => {
    const saved = loadJSON(STORAGE_KEY, null);
    if (saved?.sessions?.length) return saved.sessions;
    return [makeSession({ grade: "Form 4", subject: "Biology", mode: "study" })];
  });
  const [activeId, setActiveId] = useState(() => {
    const saved = loadJSON(STORAGE_KEY, null);
    return saved?.activeId || sessions[0]?.id || null;
  });

  const active = useMemo(
    () => sessions.find(s => s.id === activeId) || sessions[0],
    [sessions, activeId]
  );
  const scope = useMemo(
    () => active?.scope || { grade: "Form 4", subject: "Biology", mode: "study" },
    [active]
  );
  const messages = useMemo(() => active?.messages || [], [active]);

  // Persist sessions whenever they change
  useEffect(() => {
    saveJSON(STORAGE_KEY, { sessions: sessions.slice(0, 30), activeId });
  }, [sessions, activeId]);

  const updateActiveSession = useCallback((updater) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== activeId) return s;
      const next = typeof updater === "function" ? updater(s) : { ...s, ...updater };
      next.updatedAt = Date.now();
      return next;
    }));
  }, [activeId]);

  const newSession = useCallback(() => {
    const fresh = makeSession({ grade: scope.grade, subject: scope.subject, mode: scope.mode });
    setSessions(prev => [fresh, ...prev].slice(0, 30));
    setActiveId(fresh.id);
  }, [scope.grade, scope.subject, scope.mode]);

  const switchSession = useCallback((id) => {
    setActiveId(id);
    setActiveTab("chat");
  }, []);

  const deleteSession = useCallback((id) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) {
        const fresh = makeSession({ grade: "Form 4", subject: "Biology", mode: "study" });
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }, [activeId]);

  // ── Streak ──────────────────────────────────────────────────────
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    const data = loadJSON(STREAK_KEY, { last: "", count: 0, best: 0 });
    const today = todayStr();
    if (data.last !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = `${yesterday.getFullYear()}-${yesterday.getMonth() + 1}-${yesterday.getDate()}`;
      data.count = data.last === yStr ? (data.count || 0) + 1 : 1;
      data.last = today;
      data.best = Math.max(data.best || 0, data.count);
      saveJSON(STREAK_KEY, data);
    }
    setStreak(data.count);
  }, []);

  // ── UI state ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("chat");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [pendingBotIdx, setPendingBotIdx] = useState(-1);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => setToastMsg(""), 1800);
  }, []);

  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const cancelRef = useRef(null);

  const scrollToBottom = useCallback((force = false) => {
    const el = messagesRef.current;
    if (!el) return;
    if (force) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(() => { scrollToBottom(); }, [messages.length, streamText, scrollToBottom]);

  // ── Speech (TTS + STT) ──────────────────────────────────────────
  const speech = useSpeech();
  useEffect(() => {
    if (!speech.finalTranscript) return;
    setInput(prev => {
      const trimmed = prev.trim();
      return (trimmed ? `${trimmed} ` : "") + speech.finalTranscript;
    });
    speech.resetTranscript();
  }, [speech.finalTranscript, speech.resetTranscript, speech]);
  const dictating = speech.listening && speech.interimTranscript;
  const composedInput = dictating
    ? (input ? `${input} ${speech.interimTranscript}` : speech.interimTranscript)
    : input;

  function toggleDictation() {
    if (speech.listening) speech.stopListening();
    else speech.startListening();
  }

  // Cancel stream on unmount
  useEffect(() => () => { cancelRef.current?.(); }, []);

  // ── Send message ────────────────────────────────────────────────
  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    const userMsg = { role: "user", content: text };
    const sysPrompt = buildSystemPrompt(scope, scope.mode || "study");

    // Snapshot history for the API (last 16 turns, exclude any error states)
    const apiHistory = messages.slice(-16).map(m => ({
      role: m.role === "bot" ? "assistant" : "user",
      content: String(m.content || ""),
    }));

    // Add user msg + placeholder bot msg in one update
    let newBotIdx = -1;
    updateActiveSession(s => {
      const next = [...s.messages, userMsg, { role: "bot", content: "", followups: null }];
      newBotIdx = next.length - 1;
      // Auto-title from first user message
      let title = s.title;
      if (title === "New chat") {
        title = text.slice(0, 60).replace(/\s+/g, " ").trim() + (text.length > 60 ? "…" : "");
      }
      return { ...s, messages: next, title };
    });
    setPendingBotIdx(newBotIdx);
    setInput("");
    setStreamText("");
    setStreaming(true);

    let accumulated = "";
    const cancel = sendAIChatStream({
      message: text,
      history: apiHistory.slice(0, -1), // exclude the just-added user msg pair
      context: { area: "study", role: "Learner", grade: scope.grade, subject: scope.subject, topic: scope.mode },
      systemPrompt: sysPrompt,
      onToken: (tok) => {
        accumulated += tok;
        setStreamText(accumulated);
      },
      onDone: (full) => {
        const finalText = full || accumulated;
        const cleaned = stripFollowups(finalText);
        const followups = extractFollowups(finalText);
        updateActiveSession(s => {
          const next = [...s.messages];
          // Replace the last bot message
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "bot") {
              next[i] = { ...next[i], content: cleaned, followups };
              break;
            }
          }
          return { ...s, messages: next };
        });
        setStreaming(false);
        setStreamText("");
        setPendingBotIdx(-1);
        cancelRef.current = null;
      },
      onError: (err) => {
        const msg = `_Sorry — I'm having trouble reaching the network (${err?.message || "unknown error"}). Tap regenerate to try again._`;
        updateActiveSession(s => {
          const next = [...s.messages];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "bot") {
              next[i] = { ...next[i], content: msg, isError: true };
              break;
            }
          }
          return { ...s, messages: next };
        });
        setStreaming(false);
        setStreamText("");
        setPendingBotIdx(-1);
        cancelRef.current = null;
      },
    });
    cancelRef.current = cancel;
  }, [input, streaming, scope, messages, updateActiveSession]);

  // Regenerate the bot reply at index (uses preceding user message)
  const regenerate = useCallback((botIdx) => {
    const userIdx = botIdx - 1;
    if (userIdx < 0 || messages[userIdx]?.role !== "user") return;
    const userText = messages[userIdx].content;
    // Remove this bot msg + everything after, then re-send
    updateActiveSession(s => ({
      ...s,
      messages: s.messages.slice(0, botIdx),
    }));
    // Defer send to next tick so messages state has settled
    setTimeout(() => {
      setInput(userText);
      setTimeout(() => {
        // We need to send the user message AGAIN — easiest path: just put it back and dispatch.
        // But our send() takes from `input`. Set input then trigger send.
        const ev = new Event("regen-send");
        window.dispatchEvent(ev);
      }, 0);
    }, 0);
  }, [messages, updateActiveSession]);

  // Handle the regen trigger
  useEffect(() => {
    const handler = () => { if (input.trim()) send(); };
    window.addEventListener("regen-send", handler);
    return () => window.removeEventListener("regen-send", handler);
  }, [input, send]);

  // ── Speak a message aloud ───────────────────────────────────────
  const speakMessage = useCallback((idx) => {
    const m = messages[idx];
    if (!m) return;
    if (speech.activeId === `m${idx}` && speech.speaking) {
      speech.stop();
      return;
    }
    speech.speak(m.content, `m${idx}`);
  }, [messages, speech]);

  // ── Set scope (grade/subject/mode) ──────────────────────────────
  const setGrade = (g) => updateActiveSession(s => ({ ...s, scope: { ...s.scope, grade: g } }));
  const setSubject = (sub) => {
    updateActiveSession(s => ({ ...s, scope: { ...s.scope, subject: sub } }));
    setTimeout(() => setScopeOpen(false), 180);
  };
  const setMode = (mode) => {
    updateActiveSession(s => ({ ...s, scope: { ...s.scope, mode } }));
    const labels = { exam: "Exam-style answers on", explain: "Plain-language mode on", paper: "Past-paper mode on", study: "Study mode on" };
    toast(labels[mode] || "Mode switched");
  };

  // ── Starter prompt cards (greeting) ─────────────────────────────
  const starterCards = useMemo(() => {
    const topics = topicsFor(scope.subject, scope.grade);
    const t1 = topics[0];
    const t2 = topics[1] || topics[0];
    const isExamYear = EXAM_GRADES.has(scope.grade);
    const examTag = scope.grade === "Grade 6" ? "Grade 6 Primary Exam"
      : scope.grade === "Form 4" ? "Form 4 School Certificate"
      : scope.grade === "Form 6" ? "Form 6 A-Level"
      : scope.grade;
    return [
      {
        Icon: BookOpen,
        label: `Explain ${t1}`,
        desc: `${scope.grade} · ${scope.subject} — clear breakdown with examples`,
        prompt: `Explain ${t1} for me at ${scope.grade} ${scope.subject} level. Use simple language with an analogy or two, and finish with a quick check-for-understanding question.`,
      },
      {
        Icon: PencilLine,
        label: `Drill me — ${scope.subject}`,
        desc: `5 ${isExamYear ? examTag : scope.grade}-style questions, marked`,
        prompt: `Give me 5 ${isExamYear ? examTag : scope.grade}-style questions on ${t1} (${scope.subject}). Number them, vary the command words, then I'll answer and you'll mark them with feedback.`,
      },
      {
        Icon: FileText,
        label: "Past-paper question",
        desc: "Step-by-step working with marks",
        prompt: `Walk me through a typical ${scope.grade} ${scope.subject} past-paper question on ${t2}. Show the working step by step and explain what the examiner wants for each mark.`,
      },
      {
        Icon: Layers,
        label: "Revision cheat-sheet",
        desc: `One-page summary of ${t1}`,
        prompt: `Make me a one-page revision cheat-sheet for "${t1}" at ${scope.grade} ${scope.subject} level. Use bullet points, key terms in bold, and a small "common exam traps" section at the end.`,
      },
    ];
  }, [scope.grade, scope.subject]);

  const usePrompt = (text) => {
    setInput(text);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const useFollowup = (text) => {
    setInput(text);
    setTimeout(() => send(), 50);
  };

  const composerCanSend = composedInput.trim().length > 0 && !streaming;

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100dvh",
      height: "100dvh",
      display: "flex",
      flexDirection: "column",
      background: palette.cream,
      color: palette.ink,
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      width: "100%",
      maxWidth: 820,
      margin: "0 auto",
      overflow: "hidden",
    }}>
      <ZedStyles palette={palette} isDark={isDark} />

      {/* TOPBAR */}
      <TopBar
        palette={palette}
        streak={streak}
        onTheme={() => setSettings(s => ({ ...s, theme: isDark ? "light" : "dark" }))}
        onSettings={() => setSettingsOpen(true)}
        onExport={() => {
          const ok = exportMessages(messages, scope, scope.mode || "study");
          toast(ok ? "Exported to Downloads" : "Nothing to export yet");
        }}
        onNew={() => { newSession(); setActiveTab("chat"); toast("New session started"); }}
        isDark={isDark}
      />

      {/* SCOPE PILL ROW */}
      <ScopeRow
        palette={palette}
        scope={scope}
        onOpenScope={() => setScopeOpen(true)}
        onMode={setMode}
      />

      {/* MAIN VIEW SWITCHER */}
      <main style={{
        flex: 1,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: palette.paper,
      }}>
        {activeTab === "chat" && (
          <ChatView
            palette={palette}
            scope={scope}
            messages={messages}
            streaming={streaming}
            streamText={streamText}
            pendingBotIdx={pendingBotIdx}
            starterCards={starterCards}
            onUsePrompt={usePrompt}
            onUseFollowup={useFollowup}
            onCopy={(text) => { navigator.clipboard?.writeText(text); toast("Copied to clipboard"); }}
            onRegenerate={regenerate}
            onSpeak={speakMessage}
            speech={speech}
            settings={settings}
            messagesRef={messagesRef}
          />
        )}
        {activeTab === "practice" && (
          <PracticeView
            palette={palette}
            scope={scope}
            onHandoff={(primer) => {
              setActiveTab("chat");
              setInput(primer);
              setTimeout(() => send(), 200);
            }}
            toast={toast}
          />
        )}
        {activeTab === "library" && (
          <LibraryView
            palette={palette}
            sessions={sessions}
            activeId={activeId}
            onSwitch={switchSession}
            onDelete={deleteSession}
            onNew={() => { newSession(); setActiveTab("chat"); toast("New session started"); }}
          />
        )}
      </main>

      {/* COMPOSER (chat tab only) */}
      {activeTab === "chat" && (
        <Composer
          palette={palette}
          input={composedInput}
          rawInput={input}
          dictating={!!dictating}
          listening={speech.listening}
          recognitionSupported={speech.recognitionSupported}
          voiceEnabled={settings.voice}
          streaming={streaming}
          canSend={composerCanSend}
          inputRef={inputRef}
          onChange={setInput}
          onSend={send}
          onCancel={() => { cancelRef.current?.(); cancelRef.current = null; setStreaming(false); }}
          onMic={toggleDictation}
        />
      )}

      {/* IN-APP TABS */}
      <TabBar palette={palette} activeTab={activeTab} onTab={setActiveTab} />

      {/* GLOBAL APP NAV (across other ZedExams routes) — static mode so it
          stacks below the in-app TabBar instead of floating over it */}
      <MobileBottomNav mode="static" />

      {/* SHEETS */}
      <ScopeSheet
        open={scopeOpen}
        palette={palette}
        scope={scope}
        onClose={() => setScopeOpen(false)}
        onGrade={setGrade}
        onSubject={setSubject}
      />
      <SettingsSheet
        open={settingsOpen}
        palette={palette}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={(patch) => setSettings(s => ({ ...s, ...patch }))}
        onClear={() => {
          try {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(STREAK_KEY);
            localStorage.removeItem(QUIZ_HIST_KEY);
          } catch { /* ignore */ }
          const fresh = makeSession({ grade: "Form 4", subject: "Biology", mode: "study" });
          setSessions([fresh]);
          setActiveId(fresh.id);
          setStreak(0);
          setSettingsOpen(false);
          toast("All data cleared");
        }}
      />

      {/* TOAST */}
      <div style={{
        position: "fixed",
        bottom: 100,
        left: "50%",
        transform: `translateX(-50%) translateY(${toastMsg ? 0 : 20}px)`,
        background: palette.ink,
        color: palette.paper,
        padding: "10px 16px",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 500,
        opacity: toastMsg ? 1 : 0,
        pointerEvents: "none",
        transition: "all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)",
        zIndex: 100,
        boxShadow: palette.shadowLg,
      }}>
        {toastMsg}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL STYLES — keyframes + scrollbar tweaks scoped to this component
// ═══════════════════════════════════════════════════════════════════
function ZedStyles({ palette, isDark }) {
  return (
    <style>{`
      @keyframes zed-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes zed-think { 0%,80%,100% { transform: scale(0.6); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }
      @keyframes zed-cursor { 50% { opacity: 0; } }
      @keyframes zed-status-pulse { 0% { box-shadow: 0 0 0 0 rgba(74,222,128,0.5); } 70% { box-shadow: 0 0 0 8px rgba(74,222,128,0); } 100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); } }
      @keyframes zed-blink { 50% { opacity: 0.4; } }
      @keyframes zed-spin { to { transform: rotate(360deg); } }
      @keyframes zed-pulse-fast { 50% { opacity: 0.7; } }
      .zed-scroll::-webkit-scrollbar { width: 6px; }
      .zed-scroll::-webkit-scrollbar-thumb { background: ${palette.line}; border-radius: 3px; }
      .zed-scroll::-webkit-scrollbar-track { background: transparent; }
      .zed-msg { animation: zed-fade-up 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
      .zed-stream-cursor { display: inline-block; width: 7px; height: 14px; background: ${palette.cobalt}; margin-left: 1px; vertical-align: -2px; animation: zed-cursor 0.8s infinite; }
      .zed-prompt-card:hover { border-color: ${palette.cobalt} !important; transform: translateX(2px); background: ${palette.paper2} !important; }
      .zed-scope-pill:hover { border-color: ${palette.cobalt} !important; color: ${palette.ink} !important; }
      .zed-action-btn:hover { color: ${palette.cobalt} !important; border-color: ${palette.cobalt} !important; background: ${palette.paper2} !important; }
      .zed-followup:hover { border-color: ${palette.cobalt} !important; background: ${palette.cobalt} !important; color: #fff !important; }
      .zed-followup:hover svg { color: #fff !important; }
      .zed-session-card:hover { border-color: ${palette.cobalt} !important; transform: translateY(-1px); box-shadow: ${palette.shadowSm}; }
      .zed-quiz-option:hover:not(:disabled) { border-color: ${palette.cobalt} !important; transform: translateX(2px); }
      .zed-tab:hover { color: ${palette.inkSoft} !important; background: ${palette.lineSoft} !important; }
      .zed-mode-pill:not(.active):hover { background: ${palette.lineSoft} !important; color: ${palette.ink} !important; }
      .zed-icon-btn:hover { background: ${palette.lineSoft} !important; color: ${palette.ink} !important; }
      .zed-topic-chip:hover { border-color: ${palette.cobalt} !important; color: ${palette.cobalt} !important; }
      ${isDark ? "" : ""}
    `}</style>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TOP BAR
// ═══════════════════════════════════════════════════════════════════
function TopBar({ palette, streak, onTheme, onSettings, onExport, onNew, isDark }) {
  return (
    <header style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "14px 16px 12px",
      borderBottom: `1px solid ${palette.line}`,
      background: palette.paper,
      position: "relative",
      flexShrink: 0,
    }}>
      <div style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
        <picture>
          <source type="image/webp" srcSet="/zedexams-logo.webp?v=1" />
          <img src="/zedexams-logo.png?v=4" alt="Zed" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        </picture>
        <span style={{
          position: "absolute",
          right: -2, bottom: -2,
          width: 11, height: 11,
          borderRadius: "50%",
          background: "#4ADE80",
          border: `2px solid ${palette.paper}`,
          animation: "zed-status-pulse 2.4s infinite",
        }} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{
          fontFamily: "Outfit, system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 16,
          letterSpacing: "-0.01em",
          color: palette.navy,
        }}>
          Zed Study
        </div>
        <div style={{
          fontSize: 10.5,
          color: palette.inkMuted,
          marginTop: 1,
          display: "flex",
          alignItems: "center",
          gap: 5,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ADE80", animation: "zed-blink 2s infinite" }} />
          2023 ZECF · Practise smart.
          {streak >= 2 && (
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px 3px 6px",
              borderRadius: 999,
              background: `linear-gradient(135deg, ${palette.orange} 0%, ${palette.orange2} 100%)`,
              color: "#fff",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.02em",
              marginLeft: 6,
              textTransform: "none",
            }}>
              <span style={{ fontSize: 11 }}>🔥</span> {streak}
            </span>
          )}
        </div>
      </div>
      <IconBtn onClick={onTheme} title="Toggle theme" palette={palette}>
        {isDark ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        )}
      </IconBtn>
      <IconBtn onClick={onSettings} title="Settings" palette={palette}>
        <Settings size={18} />
      </IconBtn>
      <IconBtn onClick={onExport} title="Export chat as Markdown" palette={palette}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </IconBtn>
      <IconBtn onClick={onNew} title="New chat" palette={palette}>
        <Plus size={18} />
      </IconBtn>
    </header>
  );
}

function IconBtn({ children, onClick, title, palette }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="zed-icon-btn"
      style={{
        width: 36,
        height: 36,
        borderRadius: "50%",
        border: 0,
        background: "transparent",
        color: palette.inkSoft,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "background 0.15s, color 0.15s",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SCOPE PILL ROW
// ═══════════════════════════════════════════════════════════════════
function ScopeRow({ palette, scope, onOpenScope, onMode }) {
  const modes = [
    { id: "exam", label: "📝 Exam Mode" },
    { id: "explain", label: "💡 Explain Like I'm 14" },
    { id: "paper", label: "📄 Past Papers" },
  ];
  return (
    <div className="zed-scroll" style={{
      display: "flex",
      gap: 8,
      padding: "10px 16px 12px",
      overflowX: "auto",
      borderBottom: `1px solid ${palette.line}`,
      background: palette.paper,
      flexShrink: 0,
      scrollbarWidth: "none",
    }}>
      <button
        onClick={onOpenScope}
        className="zed-scope-pill"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px 6px 10px",
          borderRadius: 999,
          background: palette.cobalt,
          color: "#fff",
          border: `1px solid ${palette.cobalt}`,
          fontSize: 12,
          fontWeight: 500,
          whiteSpace: "nowrap",
          cursor: "pointer",
          transition: "all 0.15s",
          flexShrink: 0,
          fontFamily: "inherit",
          boxShadow: `0 2px 6px ${palette.cobaltGlow}`,
        }}
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
        <span>{scope.grade} · {scope.subject}</span>
      </button>
      {modes.map(m => (
        <button
          key={m.id}
          onClick={() => onMode(m.id)}
          className="zed-scope-pill"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px 6px 10px",
            borderRadius: 999,
            background: scope.mode === m.id ? palette.cobalt : palette.paper2,
            color: scope.mode === m.id ? "#fff" : palette.inkSoft,
            border: `1px solid ${scope.mode === m.id ? palette.cobalt : palette.line}`,
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: "nowrap",
            cursor: "pointer",
            transition: "all 0.15s",
            flexShrink: 0,
            fontFamily: "inherit",
            boxShadow: scope.mode === m.id ? `0 2px 6px ${palette.cobaltGlow}` : "none",
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CHAT VIEW
// ═══════════════════════════════════════════════════════════════════
function ChatView({ palette, scope, messages, streaming, streamText, pendingBotIdx, starterCards, onUsePrompt, onUseFollowup, onCopy, onRegenerate, onSpeak, speech, settings, messagesRef }) {
  const showGreeting = messages.length === 0;
  return (
    <div
      ref={messagesRef}
      className="zed-scroll"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "20px 16px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        scrollBehavior: "smooth",
      }}
    >
      {showGreeting && <GreetingCard palette={palette} scope={scope} starterCards={starterCards} onUsePrompt={onUsePrompt} />}
      {messages.map((m, i) => {
        const isStreamingThis = streaming && i === pendingBotIdx && !m.content;
        const content = isStreamingThis ? streamText : m.content;
        const showCursor = streaming && i === pendingBotIdx;
        return (
          <MessageRow
            key={i}
            palette={palette}
            msg={m}
            content={content}
            showCursor={showCursor}
            onCopy={() => onCopy(m.content || "")}
            onRegenerate={() => onRegenerate(i)}
            onSpeak={() => onSpeak(i)}
            speakActive={speech.activeId === `m${i}` && speech.speaking}
            speechSupported={settings.speech && speech.supported}
          />
        );
      })}
      {streaming && pendingBotIdx >= 0 && !streamText && (
        <div className="zed-msg" style={{ display: "flex", gap: 10, alignSelf: "flex-start" }}>
          <BotMiniAvatar palette={palette} />
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 16,
            borderTopLeftRadius: 4,
            background: palette.bubbleBot,
            border: `1px solid ${palette.line}`,
            boxShadow: palette.shadowSm,
          }}>
            <span style={{ display: "flex", gap: 3 }}>
              {[0, 1, 2].map(d => (
                <span
                  key={d}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: palette.cobalt,
                    animation: `zed-think 1.4s ${d * 0.16}s infinite ease-in-out both`,
                  }}
                />
              ))}
            </span>
            <span style={{ fontSize: 12, color: palette.inkMuted, fontWeight: 500 }}>Zed is thinking…</span>
          </div>
        </div>
      )}
      {messages.map((m, i) => (
        m.role === "bot" && m.followups?.length && i === messages.length - 1 ? (
          <div key={`fu-${i}`} style={{ display: "flex", flexDirection: "column", gap: 6, alignSelf: "flex-start", marginTop: -8, marginLeft: 38 }}>
            {m.followups.map((f, k) => (
              <button
                key={k}
                onClick={() => onUseFollowup(f)}
                className="zed-followup"
                style={{
                  textAlign: "left",
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: palette.paper2,
                  border: `1px solid ${palette.line}`,
                  color: palette.cobalt,
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  alignSelf: "flex-start",
                  fontFamily: "inherit",
                }}
              >
                <ChevronRight size={11} />
                {f}
              </button>
            ))}
          </div>
        ) : null
      ))}
    </div>
  );
}

function GreetingCard({ palette, scope, starterCards, onUsePrompt }) {
  return (
    <div style={{
      margin: "8px 0 0",
      padding: "24px 22px",
      background: palette.paper2,
      border: `1px solid ${palette.line}`,
      borderRadius: 20,
      boxShadow: palette.shadowSm,
      position: "relative",
      overflow: "hidden",
      animation: "zed-fade-up 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both",
    }}>
      <div style={{
        position: "absolute",
        top: -40,
        right: -40,
        width: 140,
        height: 140,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${palette.orange2} 0%, transparent 70%)`,
        opacity: 0.2,
        pointerEvents: "none",
      }} />
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: palette.orange,
        marginBottom: 8,
      }}>
        Mwabuka · {scope.grade} · {scope.subject}
      </div>
      <h1 style={{
        fontFamily: "Outfit, system-ui, sans-serif",
        fontSize: 28,
        lineHeight: 1.1,
        fontWeight: 500,
        letterSpacing: "-0.025em",
        color: palette.ink,
        margin: "0 0 8px",
      }}>
        I'm <em style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", color: palette.cobalt, fontWeight: 500 }}>Zed</em>. <br />What shall we study?
      </h1>
      <p style={{ fontSize: 13.5, color: palette.inkSoft, margin: "0 0 16px", lineHeight: 1.55 }}>
        I follow the new <strong>2023 Zambia Education Curriculum Framework</strong> — from ECE through Form 6 A-Levels. Pick a starter or just ask me anything.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        {starterCards.map((card, i) => {
          const Ico = card.Icon;
          return (
            <button
              key={i}
              onClick={() => onUsePrompt(card.prompt)}
              className="zed-prompt-card"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 12,
                background: palette.paper,
                border: `1px solid ${palette.line}`,
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.15s",
                color: palette.ink,
                fontSize: 13,
                lineHeight: 1.4,
                fontFamily: "inherit",
              }}
            >
              <span style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                flexShrink: 0,
                background: palette.cobaltGlow,
                color: palette.cobalt,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                <Ico size={15} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: palette.ink, display: "block", marginBottom: 1, fontSize: 13 }}>
                  {card.label}
                </span>
                <span style={{ color: palette.inkMuted, fontSize: 12 }}>{card.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BotMiniAvatar({ palette }) {
  return (
    <div style={{
      width: 28,
      height: 28,
      flexShrink: 0,
      borderRadius: "50%",
      overflow: "hidden",
      background: palette.paper2,
      padding: 1,
      border: `1px solid ${palette.line}`,
    }}>
      <picture>
        <source type="image/webp" srcSet="/zedexams-logo.webp?v=1" />
        <img src="/zedexams-logo.png?v=4" alt="Zed" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
      </picture>
    </div>
  );
}

function MessageRow({ palette, msg, content, showCursor, onCopy, onRegenerate, onSpeak, speakActive, speechSupported }) {
  const isUser = msg.role === "user";
  if (isUser) {
    return (
      <div className="zed-msg" style={{ display: "flex", gap: 10, justifyContent: "flex-end", maxWidth: "100%" }}>
        <div style={{
          maxWidth: "84%",
          padding: "11px 14px",
          borderRadius: 16,
          borderTopRightRadius: 4,
          background: palette.bubbleUser,
          color: palette.bubbleUserText,
          fontSize: 14.5,
          lineHeight: 1.55,
          wordWrap: "break-word",
          overflowWrap: "break-word",
          boxShadow: palette.shadowSm,
        }}>
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="zed-msg" style={{ display: "flex", gap: 10, maxWidth: "100%" }}>
      <BotMiniAvatar palette={palette} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{
          maxWidth: "100%",
          padding: "11px 14px",
          borderRadius: 16,
          borderTopLeftRadius: 4,
          background: palette.bubbleBot,
          color: palette.ink,
          border: `1px solid ${palette.line}`,
          boxShadow: palette.shadowSm,
          fontSize: 14.5,
          lineHeight: 1.55,
          wordWrap: "break-word",
          overflowWrap: "break-word",
        }}>
          <MarkdownText text={content} palette={palette} />
          {showCursor && <span className="zed-stream-cursor" />}
        </div>
        {!showCursor && content && (
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            <ActionBtn palette={palette} onClick={onCopy} title="Copy">
              <Copy size={13} />
            </ActionBtn>
            <ActionBtn palette={palette} onClick={onRegenerate} title="Regenerate">
              <RotateCcw size={13} />
            </ActionBtn>
            {speechSupported && (
              <ActionBtn palette={palette} onClick={onSpeak} title={speakActive ? "Stop speaking" : "Read aloud"} active={speakActive}>
                {speakActive ? <Square size={13} /> : <Play size={13} />}
              </ActionBtn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ children, onClick, title, palette, active = false }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="zed-action-btn"
      style={{
        background: active ? palette.cobaltGlow : "transparent",
        border: `1px solid ${active ? palette.cobalt : palette.line}`,
        color: active ? palette.cobalt : palette.inkMuted,
        borderRadius: 6,
        width: 26,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// COMPOSER
// ═══════════════════════════════════════════════════════════════════
function Composer({ palette, input, rawInput, dictating, listening, recognitionSupported, voiceEnabled, streaming, canSend, inputRef, onChange, onSend, onCancel, onMic }) {
  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <div style={{
      padding: "10px 12px 14px",
      borderTop: `1px solid ${palette.line}`,
      background: palette.paper,
      paddingBottom: "max(14px, env(safe-area-inset-bottom))",
      flexShrink: 0,
    }}>
      <div style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        background: palette.paper2,
        border: `1px solid ${palette.line}`,
        borderRadius: 22,
        padding: "6px 6px 6px 14px",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}>
        <textarea
          ref={inputRef}
          value={dictating ? input : rawInput}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder="Ask Zed anything…  (try: explain photosynthesis)"
          style={{
            flex: 1,
            border: 0,
            outline: 0,
            resize: "none",
            background: "transparent",
            fontFamily: "inherit",
            fontSize: 14.5,
            lineHeight: 1.45,
            color: palette.ink,
            padding: "8px 4px",
            maxHeight: 120,
            minHeight: 22,
          }}
        />
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {voiceEnabled && recognitionSupported && (
            <button
              onClick={onMic}
              title="Voice input — tap and speak"
              aria-label="Voice input"
              className="zed-icon-btn"
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: 0,
                background: listening ? "rgba(240, 97, 33, 0.1)" : "transparent",
                color: listening ? palette.orange : palette.inkMuted,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "color 0.15s, background 0.15s",
              }}
            >
              <Mic size={17} />
            </button>
          )}
          {streaming ? (
            <button
              onClick={onCancel}
              aria-label="Stop"
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                border: 0,
                background: palette.orange,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 0.2s",
                flexShrink: 0,
              }}
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!canSend}
              aria-label="Send"
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                border: 0,
                background: palette.cobalt,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: canSend ? "pointer" : "not-allowed",
                opacity: canSend ? 1 : 0.35,
                transition: "all 0.2s",
                flexShrink: 0,
              }}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
      <div style={{
        textAlign: "center",
        fontSize: 10.5,
        color: palette.inkMuted,
        marginTop: 8,
        letterSpacing: "0.04em",
      }}>
        Powered by <span style={{ color: palette.orange, fontWeight: 600, fontFamily: "Lora, Georgia, serif", fontStyle: "italic" }}>ZedExams</span> · Enter to send · Shift+Enter for new line
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// IN-APP TAB BAR
// ═══════════════════════════════════════════════════════════════════
function TabBar({ palette, activeTab, onTab }) {
  const tabs = [
    { id: "chat", label: "Chat", Icon: ChatIcon },
    { id: "practice", label: "Practise", Icon: Award },
    { id: "library", label: "Library", Icon: Layers },
  ];
  return (
    <nav role="tablist" style={{
      display: "flex",
      borderTop: `1px solid ${palette.line}`,
      background: palette.paper,
      padding: "6px 8px",
      gap: 4,
      flexShrink: 0,
    }}>
      {tabs.map(t => {
        const Ico = t.Icon;
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            role="tab"
            aria-current={isActive ? "page" : "false"}
            className="zed-tab"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              padding: "8px 4px",
              border: 0,
              background: "transparent",
              color: isActive ? palette.cobalt : palette.inkMuted,
              cursor: "pointer",
              borderRadius: 12,
              fontFamily: "inherit",
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              transition: "color 0.15s, background 0.15s",
              position: "relative",
            }}
          >
            {isActive && (
              <span style={{
                position: "absolute",
                top: 2,
                left: "50%",
                transform: "translateX(-50%)",
                width: 22,
                height: 3,
                background: palette.cobalt,
                borderRadius: "0 0 3px 3px",
              }} />
            )}
            <Ico size={20} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ChatIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SCOPE SHEET — grade + subject picker
// ═══════════════════════════════════════════════════════════════════
function ScopeSheet({ open, palette, scope, onClose, onGrade, onSubject }) {
  return (
    <Sheet open={open} palette={palette} onClose={onClose}
      title="Tune your study scope"
      subtitle={(
        <span>
          Zed follows the <strong>2023 ZECF</strong> (3-6-4-2 structure) — pick a level and subject.
          {" "}<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: palette.orange, display: "inline-block" }} /> = national exam year
          </span>
        </span>
      )}
    >
      <SectionLabel palette={palette}>Grade level</SectionLabel>
      {GRADE_SECTIONS.map(sec => (
        <div key={sec.short} style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: palette.inkMuted,
            margin: "0 4px 6px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            {sec.label}
            <span style={{
              background: palette.cobaltGlow,
              color: palette.cobalt,
              padding: "2px 7px",
              borderRadius: 999,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}>{sec.short}</span>
            <span style={{ flex: 1, height: 1, background: palette.line }} />
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 5,
          }}>
            {sec.grades.map(g => {
              const compact = g.startsWith("ECE Level") ? g.replace("ECE Level ", "Level ")
                : g.startsWith("Grade ") ? g.replace("Grade ", "G")
                : g.startsWith("Form ") ? g.replace("Form ", "F")
                : g;
              const isActive = g === scope.grade;
              const isExam = EXAM_GRADES.has(g);
              return (
                <button
                  key={g}
                  onClick={() => onGrade(g)}
                  style={{
                    padding: "9px 4px",
                    borderRadius: 10,
                    border: `1px solid ${isActive ? palette.cobalt : palette.line}`,
                    background: isActive ? palette.cobalt : palette.paper2,
                    color: isActive ? "#fff" : palette.inkSoft,
                    fontSize: 12.5,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    textAlign: "center",
                    fontFamily: "inherit",
                    position: "relative",
                    boxShadow: isActive ? `0 2px 8px ${palette.cobaltGlow}` : "none",
                  }}
                >
                  {compact}
                  {isExam && (
                    <span style={{
                      position: "absolute",
                      top: 5,
                      right: 5,
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: isActive ? palette.orange2 : palette.orange,
                      boxShadow: `0 0 0 1.5px ${isActive ? palette.cobalt : palette.paper2}`,
                    }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <SectionLabel palette={palette} style={{ marginTop: 8 }}>Subject</SectionLabel>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 6,
      }}>
        {SUBJECTS.map(sub => {
          const isActive = sub === scope.subject;
          return (
            <button
              key={sub}
              onClick={() => onSubject(sub)}
              style={{
                padding: "10px 8px",
                borderRadius: 10,
                border: `1px solid ${isActive ? palette.cobalt : palette.line}`,
                background: isActive ? palette.cobalt : palette.paper2,
                color: isActive ? "#fff" : palette.inkSoft,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s",
                textAlign: "center",
                fontFamily: "inherit",
                boxShadow: isActive ? `0 2px 8px ${palette.cobaltGlow}` : "none",
              }}
            >
              {sub}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

function SectionLabel({ children, palette, style }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: palette.orange,
      margin: "0 4px 6px",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS SHEET
// ═══════════════════════════════════════════════════════════════════
function SettingsSheet({ open, palette, settings, onClose, onChange, onClear }) {
  const Toggle = ({ value, onClick, label, desc }) => (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 4px",
      gap: 12,
      borderBottom: `1px solid ${palette.line}`,
    }}>
      <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: palette.ink }}>
        {label}
        <span style={{ display: "block", fontSize: 11.5, color: palette.inkMuted, fontWeight: 400, marginTop: 2 }}>{desc}</span>
      </div>
      <button
        onClick={onClick}
        aria-label={label}
        style={{
          position: "relative",
          width: 42,
          height: 24,
          background: value ? palette.cobalt : palette.line,
          border: 0,
          borderRadius: 999,
          cursor: "pointer",
          transition: "background 0.2s",
          flexShrink: 0,
        }}
      >
        <span style={{
          position: "absolute",
          top: 3,
          left: 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transition: "transform 0.2s",
          transform: value ? "translateX(18px)" : "translateX(0)",
        }} />
      </button>
    </div>
  );
  return (
    <Sheet open={open} palette={palette} onClose={onClose}
      title="Settings"
      subtitle="Tune Zed to how you study best."
    >
      <Toggle
        value={settings.voice}
        onClick={() => onChange({ voice: !settings.voice })}
        label="Voice input"
        desc="Tap the mic in the composer to dictate questions"
      />
      <Toggle
        value={settings.speech}
        onClick={() => onChange({ speech: !settings.speech })}
        label="Reading aloud"
        desc="Show the speaker icon on bot replies"
      />
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 4px",
        gap: 12,
        borderBottom: `1px solid ${palette.line}`,
      }}>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: palette.ink }}>
          Theme
          <span style={{ display: "block", fontSize: 11.5, color: palette.inkMuted, fontWeight: 400, marginTop: 2 }}>Light, dark, or follow device</span>
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 4,
          background: palette.lineSoft,
          border: `1px solid ${palette.line}`,
          borderRadius: 12,
          padding: 3,
          flexShrink: 0,
        }}>
          {[["light", "Light"], ["dark", "Dark"], ["auto", "Auto"]].map(([v, l]) => {
            const isActive = settings.theme === v;
            return (
              <button
                key={v}
                onClick={() => onChange({ theme: v })}
                style={{
                  border: 0,
                  background: isActive ? palette.cobalt : "transparent",
                  color: isActive ? "#fff" : palette.inkSoft,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 9,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.18s",
                }}
              >
                {l}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ padding: "16px 0 4px" }}>
        <button
          onClick={onClear}
          style={{
            width: "100%",
            padding: 11,
            borderRadius: 10,
            background: "transparent",
            border: `1px solid ${palette.line}`,
            color: palette.orange,
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          Clear all sessions and quiz history
        </button>
      </div>
      <div style={{
        textAlign: "center",
        padding: "14px 0 4px",
        color: palette.inkMuted,
        fontSize: 11,
      }}>
        ZedExams Study Assistant · CBC-aligned
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SHEET — generic bottom sheet container
// ═══════════════════════════════════════════════════════════════════
function Sheet({ open, palette, onClose, title, subtitle, children }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(20, 17, 13, 0.4)",
          backdropFilter: "blur(4px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s",
          zIndex: 50,
        }}
      />
      <div style={{
        position: "fixed",
        left: "50%",
        bottom: 0,
        transform: `translate(-50%, ${open ? 0 : 100}%)`,
        width: "100%",
        maxWidth: 480,
        maxHeight: "70vh",
        background: palette.paper,
        borderRadius: "22px 22px 0 0",
        borderTop: `1px solid ${palette.line}`,
        boxShadow: palette.shadowLg,
        transition: "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)",
        zIndex: 51,
        display: "flex",
        flexDirection: "column",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        <div style={{ width: 36, height: 4, background: palette.line, borderRadius: 2, margin: "10px auto 4px" }} />
        <div style={{ padding: "10px 20px 14px", borderBottom: `1px solid ${palette.line}` }}>
          <div style={{
            fontFamily: "Outfit, system-ui, sans-serif",
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: palette.ink,
          }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 12.5, color: palette.inkMuted, marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
        <div className="zed-scroll" style={{ padding: "14px 16px 18px", overflowY: "auto" }}>
          {children}
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LIBRARY VIEW
// ═══════════════════════════════════════════════════════════════════
function LibraryView({ palette, sessions, activeId, onSwitch, onDelete, onNew }) {
  const sorted = useMemo(() => sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt), [sessions]);
  const handleDelete = (id, title) => {
    if (window.confirm(`Delete "${title || "this session"}"? This cannot be undone.`)) {
      onDelete(id);
    }
  };
  return (
    <div className="zed-scroll" style={{
      flex: 1,
      overflowY: "auto",
      padding: "18px 16px 12px",
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{
          fontFamily: "Outfit, system-ui, sans-serif",
          fontSize: 26,
          lineHeight: 1.15,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: palette.ink,
          margin: "0 0 4px",
        }}>
          Your <em style={{ fontFamily: "Lora, serif", fontStyle: "italic", color: palette.cobalt, fontWeight: 500 }}>study</em> sessions
        </h1>
        <p style={{ fontSize: 13, color: palette.inkSoft, margin: 0, lineHeight: 1.55 }}>
          Tap a session to switch into it. Each subject can have its own thread of conversation.
        </p>
      </div>
      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: palette.inkMuted, fontSize: 13, lineHeight: 1.5 }}>
          No sessions yet. Start one below to begin studying.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          {sorted.map(s => {
            const isActive = s.id === activeId;
            const lastUser = (s.messages || []).filter(m => m.role === "user").slice(-1)[0];
            const preview = lastUser?.content
              ? lastUser.content.slice(0, 110)
              : (s.messages?.length ? "Bot-led session" : "No messages yet");
            return (
              <div
                key={s.id}
                onClick={() => onSwitch(s.id)}
                className="zed-session-card"
                style={{
                  position: "relative",
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: isActive ? palette.cobaltGlow : palette.paper2,
                  border: `1px solid ${isActive ? palette.cobalt : palette.line}`,
                  cursor: "pointer",
                  transition: "all 0.18s",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  boxShadow: isActive ? `0 1px 3px ${palette.cobaltGlow}` : "none",
                }}
              >
                {isActive && (
                  <div style={{
                    position: "absolute",
                    left: -1,
                    top: 12,
                    bottom: 12,
                    width: 3,
                    background: palette.cobalt,
                    borderRadius: "0 3px 3px 0",
                  }} />
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
                  <span style={{
                    background: isActive ? palette.cobalt2 : palette.cobalt,
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontWeight: 600,
                    fontSize: 10.5,
                    letterSpacing: "0.02em",
                  }}>
                    {s.scope?.grade || "Form 4"} · {s.scope?.subject || "Biology"}
                  </span>
                  <span style={{ color: palette.inkMuted, fontWeight: 500 }}>{relTime(s.updatedAt)}</span>
                </div>
                <div style={{
                  fontFamily: "Outfit, system-ui, sans-serif",
                  fontSize: 14.5,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  color: palette.ink,
                  letterSpacing: "-0.01em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  paddingRight: 24,
                }}>
                  {s.title || "New chat"}
                </div>
                <div style={{
                  fontSize: 12.5,
                  color: palette.inkMuted,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  paddingRight: 24,
                }}>
                  {preview}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id, s.title); }}
                  aria-label="Delete session"
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    border: 0,
                    background: "transparent",
                    color: palette.inkMuted,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = palette.orange; e.currentTarget.style.color = "#fff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = palette.inkMuted; }}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button
        onClick={onNew}
        style={{
          marginTop: 16,
          padding: 12,
          border: `1.5px dashed ${palette.line}`,
          background: "transparent",
          color: palette.inkSoft,
          borderRadius: 14,
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.18s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = palette.cobalt; e.currentTarget.style.color = palette.cobalt; e.currentTarget.style.borderStyle = "solid"; e.currentTarget.style.background = palette.paper2; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = palette.line; e.currentTarget.style.color = palette.inkSoft; e.currentTarget.style.borderStyle = "dashed"; e.currentTarget.style.background = "transparent"; }}
      >
        <Plus size={14} />
        Start new session
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PRACTICE VIEW — config → quiz → results
// ═══════════════════════════════════════════════════════════════════
function PracticeView({ palette, scope, onHandoff, toast }) {
  const [phase, setPhase] = useState("config"); // config | loading | quiz | results
  const [count, setCount] = useState(5);
  const [timer, setTimer] = useState(30);
  const [difficulty, setDifficulty] = useState("mixed");
  const [topic, setTopic] = useState("");
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [startedAt, setStartedAt] = useState(0);
  const [history, setHistory] = useState(() => loadJSON(QUIZ_HIST_KEY, []));
  const cancelRef = useRef(null);

  useEffect(() => () => cancelRef.current?.(), []);

  const start = useCallback(() => {
    setPhase("loading");
    let accumulated = "";
    const sysPrompt = buildQuizSystemPrompt();
    const userPrompt = buildQuizPrompt(scope, count, difficulty, topic);
    cancelRef.current = sendAIChatStream({
      message: userPrompt,
      history: [],
      context: { area: "study", role: "Learner", grade: scope.grade, subject: scope.subject, topic: topic || "general" },
      systemPrompt: sysPrompt,
      onToken: (tok) => { accumulated += tok; },
      onDone: (full) => {
        const text = (full || accumulated || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
        let parsed;
        try { parsed = JSON.parse(text); }
        catch {
          // try to recover by extracting first {...} block
          const m = text.match(/\{[\s\S]*\}/);
          if (m) try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
        }
        const qs = parsed?.questions?.filter?.(q =>
          q.question && Array.isArray(q.options) && q.options.length === 4 && Number.isInteger(q.correctIndex)
        ) || [];
        if (qs.length === 0) {
          toast("Quiz generation failed — try again");
          setPhase("config");
          return;
        }
        setQuestions(qs.slice(0, count));
        setAnswers(new Array(qs.length).fill(-1));
        setCurrent(0);
        setStartedAt(Date.now());
        setPhase("quiz");
      },
      onError: () => {
        toast("Quiz generation failed — try again");
        setPhase("config");
      },
    });
  }, [scope, count, difficulty, topic, toast]);

  const submit = useCallback((picked) => {
    setAnswers(prev => {
      const next = prev.slice();
      next[current] = picked;
      return next;
    });
  }, [current]);

  const nextQ = useCallback(() => {
    if (current === questions.length - 1) {
      // Save to history
      const correct = questions.reduce((sum, q, i) => sum + (answers[i] === q.correctIndex ? 1 : 0), 0);
      // Note: 'answers' may be one tick stale if just submitted; use latest from setAnswers above
      const now = Date.now();
      const entry = {
        date: now,
        grade: scope.grade,
        subject: scope.subject,
        topic: topic || null,
        difficulty,
        score: correct,
        total: questions.length,
        pct: Math.round((correct / questions.length) * 100),
      };
      const next = [...history, entry].slice(-50);
      setHistory(next);
      saveJSON(QUIZ_HIST_KEY, next);
      setPhase("results");
    } else {
      setCurrent(c => c + 1);
    }
  }, [current, questions, answers, scope, topic, difficulty, history]);

  if (phase === "config") {
    return <PracticeConfig palette={palette} scope={scope} count={count} setCount={setCount} timer={timer} setTimer={setTimer} difficulty={difficulty} setDifficulty={setDifficulty} topic={topic} setTopic={setTopic} history={history} onStart={start} />;
  }
  if (phase === "loading") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", gap: 14, textAlign: "center" }}>
        <div style={{ width: 36, height: 36, border: `3px solid ${palette.line}`, borderTopColor: palette.cobalt, borderRadius: "50%", animation: "zed-spin 0.8s linear infinite" }} />
        <div style={{ fontSize: 13, color: palette.inkMuted }}>
          Generating {count} {difficulty} questions{topic ? ` on ` : ""}{topic && <strong>{topic}</strong>} in {scope.subject}…
        </div>
      </div>
    );
  }
  if (phase === "quiz") {
    return <PracticeQuiz palette={palette} questions={questions} current={current} answers={answers} onSubmit={submit} onNext={nextQ} timerSec={timer} />;
  }
  // results
  return <PracticeResults palette={palette} questions={questions} answers={answers} startedAt={startedAt} onAgain={() => setPhase("config")} onHandoff={onHandoff} scope={scope} />;
}

function PracticeConfig({ palette, scope, count, setCount, timer, setTimer, difficulty, setDifficulty, topic, setTopic, history, onStart }) {
  const seedTopics = topicsFor(scope.subject, scope.grade);
  return (
    <div className="zed-scroll" style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <div style={{ animation: "zed-fade-up 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: palette.orange, marginBottom: 6 }}>Practise mode</div>
        <h1 style={{ fontFamily: "Outfit, system-ui, sans-serif", fontSize: 26, lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.025em", color: palette.ink, margin: "0 0 6px" }}>
          Time to <em style={{ fontFamily: "Lora, serif", fontStyle: "italic", color: palette.cobalt, fontWeight: 500 }}>practise</em>.
        </h1>
        <p style={{ fontSize: 13.5, color: palette.inkSoft, margin: "0 0 22px", lineHeight: 1.55 }}>
          I'll set you a fresh {scope.grade} <strong>{scope.subject}</strong> mini-paper. Pick your settings, then let's go.
        </p>

        <PracticeField palette={palette} label={<>Topic <span style={{ color: palette.inkMuted, fontWeight: 500, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>(optional — leave blank for full subject)</span></>}>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Genetics, Quadratic equations, Photosynthesis…"
            style={{
              width: "100%",
              padding: "11px 14px",
              borderRadius: 12,
              background: palette.paper2,
              border: `1.5px solid ${palette.line}`,
              fontFamily: "inherit",
              fontSize: 13.5,
              color: palette.ink,
              transition: "all 0.15s",
              outline: 0,
              boxSizing: "border-box",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = palette.cobalt; e.currentTarget.style.boxShadow = `0 0 0 4px ${palette.cobaltGlow}`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = palette.line; e.currentTarget.style.boxShadow = "none"; }}
          />
          {seedTopics.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              {seedTopics.map(t => (
                <button
                  key={t}
                  onClick={() => setTopic(t)}
                  className="zed-topic-chip"
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: palette.lineSoft,
                    border: `1px solid ${palette.line}`,
                    fontSize: 11.5,
                    color: palette.inkSoft,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    fontFamily: "inherit",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </PracticeField>

        <PracticeField palette={palette} label="Number of questions">
          <SegControl palette={palette} value={count} onChange={setCount} options={[5, 10, 15, 20]} />
        </PracticeField>

        <PracticeField palette={palette} label="Time per question">
          <SegControl
            palette={palette}
            value={timer}
            onChange={setTimer}
            options={[
              { v: 0, l: "No timer" },
              { v: 30, l: "30s" },
              { v: 60, l: "60s" },
              { v: 90, l: "90s" },
            ]}
          />
        </PracticeField>

        <PracticeField palette={palette} label="Difficulty">
          <SegControl
            palette={palette}
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { v: "easy", l: "Easy" },
              { v: "mixed", l: "Mixed" },
              { v: "exam", l: "Exam" },
              { v: "hard", l: "Hard" },
            ]}
          />
        </PracticeField>

        <button
          onClick={onStart}
          style={{
            width: "100%",
            padding: 14,
            border: 0,
            background: palette.cobalt,
            color: "#fff",
            borderRadius: 14,
            fontFamily: "inherit",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            cursor: "pointer",
            transition: "all 0.18s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginTop: 8,
            boxShadow: `0 4px 12px -4px ${palette.cobaltGlow}`,
          }}
        >
          <Play size={16} fill="currentColor" />
          Start practice
        </button>

        {history.length > 0 && (
          <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${palette.line}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: palette.inkMuted, marginBottom: 8 }}>
              Your recent practice
            </div>
            {history.slice(-3).reverse().map((h, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "9px 0",
                  borderBottom: `1px solid ${palette.lineSoft}`,
                  fontSize: 13,
                }}
              >
                <div>
                  <div style={{ color: palette.ink, fontWeight: 600 }}>{h.subject} · {h.topic || "general"}</div>
                  <div style={{ color: palette.inkMuted, fontSize: 11.5 }}>{h.grade} · {h.difficulty} · {relTime(h.date)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: h.pct >= 70 ? "#16a34a" : h.pct >= 50 ? palette.orange : "#dc2626", fontWeight: 700, fontFamily: "Outfit, sans-serif" }}>
                    {h.score}/{h.total}
                  </div>
                  <div style={{ color: palette.inkMuted, fontSize: 10.5 }}>{h.pct}%</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PracticeField({ palette, label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: palette.inkMuted,
        margin: "0 0 6px",
      }}>{label}</div>
      {children}
    </div>
  );
}

function SegControl({ palette, value, onChange, options }) {
  const norm = options.map(o => typeof o === "object" ? o : { v: o, l: String(o) });
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${norm.length}, 1fr)`,
      gap: 4,
      background: palette.lineSoft,
      border: `1px solid ${palette.line}`,
      borderRadius: 12,
      padding: 4,
    }}>
      {norm.map(o => {
        const isActive = o.v === value;
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            style={{
              border: 0,
              background: isActive ? palette.cobalt : "transparent",
              padding: "8px 4px",
              fontFamily: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              color: isActive ? "#fff" : palette.inkSoft,
              borderRadius: 9,
              cursor: "pointer",
              transition: "all 0.18s",
              boxShadow: isActive ? `0 1px 3px ${palette.cobaltGlow}` : "none",
            }}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function PracticeQuiz({ palette, questions, current, answers, onSubmit, onNext, timerSec }) {
  const q = questions[current];
  const picked = answers[current];
  const settled = picked !== -1 && picked !== undefined;
  const total = questions.length;
  const pct = Math.round((current / total) * 100);
  const correct = settled && picked === q.correctIndex;

  // Timer
  const [remaining, setRemaining] = useState(timerSec);
  useEffect(() => {
    setRemaining(timerSec);
  }, [current, timerSec]);
  useEffect(() => {
    if (timerSec <= 0 || settled) return undefined;
    if (remaining <= 0) {
      onSubmit(-1);
      return undefined;
    }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, settled, timerSec, onSubmit]);

  const isLast = current === total - 1;

  return (
    <div className="zed-scroll" style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <div style={{ animation: "zed-fade-up 0.4s both" }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 18,
          fontSize: 12,
          color: palette.inkMuted,
          fontWeight: 600,
        }}>
          <span>Q{current + 1}/{total}</span>
          <div style={{ flex: 1, height: 5, background: palette.line, borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              background: `linear-gradient(90deg, ${palette.cobalt}, ${palette.cobalt2})`,
              borderRadius: 3,
              transition: "width 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)",
              width: `${pct}%`,
            }} />
          </div>
          {timerSec > 0 && (
            <span style={{
              fontFamily: "JetBrains Mono, monospace",
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: 6,
              background: remaining <= 5 ? palette.orange : palette.lineSoft,
              color: remaining <= 5 ? "#fff" : palette.inkSoft,
              fontSize: 12,
              minWidth: 42,
              textAlign: "center",
              animation: remaining <= 5 ? "zed-pulse-fast 0.6s infinite" : "none",
            }}>
              {remaining}s
            </span>
          )}
        </div>
        <h2 style={{
          fontFamily: "Outfit, system-ui, sans-serif",
          fontSize: 19,
          fontWeight: 600,
          lineHeight: 1.35,
          color: palette.ink,
          margin: "0 0 18px",
          letterSpacing: "-0.015em",
        }}>
          {q.question}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {q.options.map((opt, k) => {
            let optBg = palette.paper2;
            let optBorder = palette.line;
            let letterBg = palette.lineSoft;
            let letterColor = palette.inkSoft;
            if (settled) {
              if (k === q.correctIndex) { optBorder = "#22c55e"; optBg = "rgba(34,197,94,0.08)"; letterBg = "#22c55e"; letterColor = "#fff"; }
              else if (k === picked) { optBorder = "#ef4444"; optBg = "rgba(239,68,68,0.08)"; letterBg = "#ef4444"; letterColor = "#fff"; }
            } else if (k === picked) {
              optBorder = palette.cobalt; optBg = palette.cobaltGlow; letterBg = palette.cobalt; letterColor = "#fff";
            }
            return (
              <button
                key={k}
                onClick={() => !settled && onSubmit(k)}
                disabled={settled}
                className="zed-quiz-option"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: optBg,
                  border: `1.5px solid ${optBorder}`,
                  textAlign: "left",
                  cursor: settled ? "default" : "pointer",
                  transition: "all 0.18s",
                  color: palette.ink,
                  fontFamily: "inherit",
                  fontSize: 14,
                  lineHeight: 1.45,
                }}
              >
                <span style={{
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: letterBg,
                  color: letterColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  transition: "all 0.18s",
                }}>
                  {String.fromCharCode(65 + k)}
                </span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
        {settled && (
          <>
            <div style={{
              marginTop: 14,
              padding: "12px 14px",
              borderRadius: 12,
              background: correct ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
              borderLeft: `3px solid ${correct ? "#22c55e" : "#ef4444"}`,
              fontSize: 13.5,
              lineHeight: 1.55,
              color: palette.inkSoft,
              animation: "zed-fade-up 0.3s both",
            }}>
              <strong style={{ color: correct ? "#16a34a" : "#dc2626" }}>
                {picked === -1 ? "Time's up — let's see the answer: " : correct ? "Correct! " : "Not quite. "}
              </strong>
              {!correct && picked !== -1 && (
                <>Correct answer: <strong>{String.fromCharCode(65 + q.correctIndex)}</strong>. </>
              )}
              {q.explanation || ""}
            </div>
            <button
              onClick={onNext}
              style={{
                marginTop: 16,
                width: "100%",
                padding: 12,
                border: 0,
                borderRadius: 12,
                background: palette.cobalt,
                color: "#fff",
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.18s",
              }}
            >
              {isLast ? "See your results" : "Next question →"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PracticeResults({ palette, questions, answers, startedAt, onAgain, onHandoff, scope }) {
  const total = questions.length;
  const correctCount = answers.reduce((s, a, i) => s + (a === questions[i].correctIndex ? 1 : 0), 0);
  const pct = Math.round((correctCount / total) * 100);
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const verdict = pct >= 90 ? "Outstanding!"
    : pct >= 75 ? "Strong work."
    : pct >= 60 ? "Solid effort."
    : pct >= 40 ? "Keep going."
    : "Worth a re-run.";
  const isGold = pct >= 80;

  // Topic breakdown
  const byTopic = {};
  questions.forEach((q, i) => {
    const t = q.topic || "General";
    byTopic[t] = byTopic[t] || { right: 0, total: 0 };
    byTopic[t].total++;
    if (answers[i] === q.correctIndex) byTopic[t].right++;
  });
  const weakest = Object.entries(byTopic).filter(([, v]) => v.right / v.total < 0.6).map(([t]) => t);
  const summaryHTML = weakest.length === 0
    ? `You finished in ${Math.floor(elapsed / 60)}m ${elapsed % 60}s. No clear weak topics — solid coverage.`
    : `You finished in ${Math.floor(elapsed / 60)}m ${elapsed % 60}s. Worth revisiting: <strong>${weakest.join(", ")}</strong>.`;

  const ringR = 56;
  const circ = 2 * Math.PI * ringR;
  const offset = circ - (pct / 100) * circ;

  const handleDiscuss = () => {
    const wrong = questions
      .map((q, i) => ({ q, picked: answers[i] }))
      .filter(x => x.picked !== x.q.correctIndex);
    const primer = wrong.length === 0
      ? `I just got ${correctCount}/${total} on a ${scope.subject} quiz. Suggest 3 stretch topics I should cover next.`
      : `I just took a ${scope.subject} quiz and got these wrong:\n\n${wrong.slice(0, 3).map((x, i) =>
          `${i + 1}. ${x.q.question}\n   I picked: ${x.picked >= 0 ? x.q.options[x.picked] : "(timed out)"}\n   Correct: ${x.q.options[x.q.correctIndex]}`).join("\n\n")}\n\nWalk me through where my thinking went wrong on each, then suggest one stretch question.`;
    onHandoff(primer);
  };

  return (
    <div className="zed-scroll" style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <div style={{ animation: "zed-fade-up 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both", textAlign: "center", padding: "8px 0" }}>
        <div style={{ width: 130, height: 130, margin: "8px auto 18px", position: "relative" }}>
          <svg viewBox="0 0 130 130" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
            <circle cx="65" cy="65" r={ringR} fill="none" stroke={palette.line} strokeWidth="8" />
            <circle
              cx="65" cy="65" r={ringR}
              fill="none"
              stroke={isGold ? palette.orange : palette.cobalt}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.2, 0.8, 0.2, 1)" }}
            />
          </svg>
          <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "Outfit, system-ui, sans-serif",
          }}>
            <span style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: palette.ink }}>{correctCount}</span>
            <span style={{ fontSize: 12, color: palette.inkMuted, marginTop: 2, fontWeight: 600 }}>of {total} · {pct}%</span>
          </div>
        </div>
        <h2 style={{
          fontFamily: "Outfit, system-ui, sans-serif",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "0 0 4px",
          color: palette.ink,
        }}>{verdict}</h2>
        <p
          style={{ fontSize: 13.5, color: palette.inkSoft, margin: "0 auto 22px", lineHeight: 1.55, maxWidth: 380 }}
          dangerouslySetInnerHTML={{ __html: summaryHTML }}
        />
        <div style={{ display: "flex", gap: 8, maxWidth: 360, margin: "0 auto" }}>
          <button
            onClick={onAgain}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 12,
              background: "transparent",
              border: `1px solid ${palette.line}`,
              color: palette.inkSoft,
              fontFamily: "inherit",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.18s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = palette.cobalt; e.currentTarget.style.color = palette.cobalt; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = palette.line; e.currentTarget.style.color = palette.inkSoft; }}
          >
            Try another
          </button>
          <button
            onClick={handleDiscuss}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 12,
              background: palette.cobalt,
              border: 0,
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.18s",
            }}
          >
            Discuss with Zed →
          </button>
        </div>
      </div>
    </div>
  );
}
