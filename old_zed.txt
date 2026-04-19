import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  Mic,
  MicOff,
  BookOpen,
  PenLine,
  ClipboardList,
  CheckSquare,
  ChevronDown,
  X,
  RotateCcw,
  Volume2,
  User,
  Bot,
  Award,
  Target,
  AlertCircle,
  RefreshCw,
  Layers,
  Copy,
  Check,
  Printer,
  Lightbulb,
  Zap,
  GraduationCap,
  BookMarked,
} from "lucide-react";
import { sendAIChat } from "../../utils/aiAssistant";

// ═══════════════════════════════════════════════════════════════════
// DESIGN SYSTEM — ZedExams Dark Academic
// ═══════════════════════════════════════════════════════════════════
const C = {
  bg: "#0A1128",
  surface: "#1A2B48",
  surfaceAlt: "#0F1D3A",
  panel: "#132039",
  border: "rgba(212,175,55,0.12)",
  borderMid: "rgba(212,175,55,0.28)",
  borderFull: "rgba(212,175,55,0.5)",
  gold: "#D4AF37",
  goldGlow: "rgba(212,175,55,0.12)",
  goldText: "#E8C84B",
  text: "#F8F9FA",
  muted: "#94A3B8",
  dim: "#64748B",
  dimmer: "#475569",
  emerald: "#10B981",
  blue: "#3B82F6",
  red: "#EF4444",
  orange: "#F59E0B",
  pink: "#EC4899",
};
const GOLD = C.gold;
const EMERALD = C.emerald;

// ═══════════════════════════════════════════════════════════════════
// CBC CURRICULUM DATA
// ═══════════════════════════════════════════════════════════════════
const CBC = {
  levels: [
    { id: "primary", label: "Primary", tag: "G1–6" },
    { id: "ordinary", label: "Ordinary Secondary", tag: "Form 1–4" },
    { id: "advanced", label: "Advanced Secondary", tag: "Form 5–6" },
  ],
  gradesByLevel: {
    primary: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7"],
    ordinary: ["Form 1", "Form 2", "Form 3", "Form 4"],
    advanced: ["Form 5", "Form 6"],
  },
  primaryAreas: [
    { id: "math", label: "Mathematics" },
    { id: "science", label: "Science" },
    { id: "literacy", label: "Literacy and Languages" },
    { id: "cts", label: "Creative & Technology Studies" },
    { id: "sds", label: "Social Studies" },
  ],
  pathways: [
    { id: "stem", label: "STEM" },
    { id: "social", label: "Social Sciences" },
    { id: "business", label: "Business" },
    { id: "arts", label: "Creative Arts" },
  ],
  subjectsByPathway: {
    stem: ["Pure Physics", "Chemistry", "Biology", "Additional Mathematics", "Computer Science", "Design & Technology"],
    social: ["History", "Geography", "Civic Education", "Literature in English", "Religious Education"],
    business: ["Principles of Accounts", "Commerce", "Economics", "Entrepreneurship"],
    arts: ["Visual Arts", "Music", "Drama", "Design"],
  },
  advancedByPathway: {
    stem: ["A-Level Physics", "A-Level Chemistry", "A-Level Biology", "A-Level Mathematics", "A-Level Computer Science"],
    social: ["A-Level History", "A-Level Geography", "A-Level Sociology", "A-Level Literature"],
    business: ["A-Level Economics", "A-Level Business Studies", "A-Level Accounts"],
    arts: ["A-Level Fine Art", "A-Level Music", "A-Level Drama & Theatre"],
  },
  competencies: [
    "Critical Thinking", "Problem Solving", "Communication", "Financial Literacy",
    "Ethical Reasoning", "Creativity", "Digital Literacy", "Active Citizenship",
    "Scientific Inquiry", "Environmental Awareness", "Entrepreneurial Skills",
    "Numeracy", "Reading Comprehension", "Collaborative Learning", "Self-Management",
  ],
};

// ═══════════════════════════════════════════════════════════════════
// CBC RUBRIC
// ═══════════════════════════════════════════════════════════════════
const RUBRIC = [
  { id: "emerging", label: "Emerging", color: "#EF4444", bg: "rgba(239,68,68,.1)", range: "0–39%" },
  { id: "developing", label: "Developing", color: "#F59E0B", bg: "rgba(245,158,11,.1)", range: "40–59%" },
  { id: "proficient", label: "Proficient", color: EMERALD, bg: "rgba(16,185,129,.1)", range: "60–79%" },
  { id: "exemplary", label: "Exemplary", color: GOLD, bg: "rgba(212,175,55,.1)", range: "80–100%" },
];

// ═══════════════════════════════════════════════════════════════════
// ZAMBIAN TOPIC BANK — suggested topics per grade
// ═══════════════════════════════════════════════════════════════════
const TOPIC_BANK = {
  "Grade 1": ["Counting 1–20", "Basic Addition", "Letter Sounds", "My Family", "Farm Animals", "Our School"],
  "Grade 2": ["Subtraction", "Simple Sentences", "Community Helpers", "Plants Around Us", "Days & Months", "Sharing"],
  "Grade 3": ["Multiplication Tables", "Reading Stories", "Our Environment", "Zambian Heritage", "Basic Fractions", "Healthy Living"],
  "Grade 4": ["Fractions & Decimals", "Creative Writing", "Health & Hygiene", "Financial Literacy", "Maps & Directions", "Local Governance"],
  "Grade 5": ["Percentages", "Civic Education", "The Human Body", "Zambian History", "Ecosystems", "Energy Sources"],
  "Grade 6": ["Ratios", "Expressive Writing", "Materials & Matter", "Governance in Zambia", "Climate & Weather", "Moral Development"],
  "Grade 7": ["Algebraic Thinking", "Exam Preparation", "Scientific Method", "Active Citizenship", "Integrated Science", "Writing Essays"],
  "Form 1": ["Algebraic Expressions", "Pre-Colonial African History", "Cell Biology", "Commerce Basics", "Map Reading", "Civic Rights & Duties"],
  "Form 2": ["Linear Equations", "Colonial Zambia", "Photosynthesis", "Principles of Accounts", "Weathering & Erosion", "Business Studies"],
  "Form 3": ["Quadratic Equations", "Post-Independence Zambia", "Genetics & Heredity", "Economic Systems", "Victoria Falls Geography", "Entrepreneurship"],
  "Form 4": ["Trigonometry", "Geography of Zambia", "Ecology", "Supply & Demand", "Chemical Bonding", "Literary Analysis"],
  "Form 5": ["Calculus", "A-Level World History", "Cell Biology Advanced", "Macroeconomics", "Organic Chemistry", "Research Statistics"],
  "Form 6": ["Advanced Statistics", "Political Theory", "Evolutionary Biology", "Microeconomics", "Thermodynamics", "Research Methods"],
};

// ═══════════════════════════════════════════════════════════════════
// PARSER — confidence-scored, priority-ordered
// ═══════════════════════════════════════════════════════════════════
function parseMessage(text) {
  const lower = text.toLowerCase();
  let score = 0;
  const r = {
    userType: null,
    level: null,
    grade: null,
    subject: null,
    taskType: null,
    pathway: null,
    competency: null,
    confidence: 0,
  };

  const teacherKW = ["lesson plan", "lesson notes", "scheme of work", "mark scheme",
    "mark answers", "class activity", "learning objectives", "homework task", "teaching activity"];
  const learnerKW = ["explain to me", "help me", "what is", "what are", "how do i",
    "how does", "i don't understand", "study tips", "revision", "quiz me", "can you explain", "solve for me"];

  const tHits = teacherKW.filter(k => lower.includes(k)).length;
  const lHits = learnerKW.filter(k => lower.includes(k)).length;
  if (tHits > lHits) { r.userType = "Teacher"; score += tHits * 15; }
  else if (lHits > 0) { r.userType = "Learner"; score += lHits * 10; }

  const gm = text.match(/\bgrade\s*([1-7])\b/i);
  const fm = text.match(/\bform\s*([1-6])\b/i);
  if (gm) { r.grade = `Grade ${gm[1]}`; r.level = "primary"; score += 20; }
  else if (fm) {
    const f = parseInt(fm[1]);
    r.grade = `Form ${f}`;
    r.level = f <= 4 ? "ordinary" : "advanced";
    score += 20;
  }

  if (!r.level) {
    if (lower.includes("a-level") || lower.includes("form 5") || lower.includes("form 6")) {
      r.level = "advanced"; score += 10;
    } else if (lower.includes("secondary") || lower.includes("form ")) {
      r.level = "ordinary"; score += 5;
    } else if (lower.includes("primary school") || lower.includes("primary level")) {
      r.level = "primary"; score += 5;
    }
  }

  const subjectMap = [
    { keys: ["fractions", "decimals", "percentages"], val: "Mathematics" },
    { keys: ["photosynthesis", "cells", "respiration"], val: "Biology" },
    { keys: ["acid", "base", "reaction", "ph scale"], val: "Chemistry" },
    { keys: ["forces", "motion", "energy"], val: "Pure Physics" },
    { keys: ["principles of accounts"], val: "Principles of Accounts" },
    { keys: ["computer science", "ict", "digital literacy"], val: "Computer Science" },
    { keys: ["additional mathematics", "add maths"], val: "Additional Mathematics" },
    { keys: ["mathematics", "maths", "numeracy", "algebra", "geometry"], val: "Mathematics" },
    { keys: ["biology", "ecology", "organisms"], val: "Biology" },
    { keys: ["chemistry", "chemical", "periodic"], val: "Chemistry" },
    { keys: ["physics", "forces", "energy", "motion"], val: "Pure Physics" },
    { keys: ["science"], val: "Science" },
    { keys: ["literacy", "grammar", "comprehension", "phonics", "writing", "reading"], val: "Literacy and Languages" },
    { keys: ["english", "literature"], val: "Literature in English" },
    { keys: ["history", "historical"], val: "History" },
    { keys: ["geography", "environment", "climate", "maps"], val: "Geography" },
    { keys: ["civic", "citizenship", "governance", "government"], val: "Civic Education" },
    { keys: ["social studies", "social and development"], val: "Social Studies" },
    { keys: ["cts", "technology studies", "expressive arts", "home economics"], val: "Creative & Technology Studies" },
    { keys: ["entrepreneurship", "enterprise"], val: "Entrepreneurship" },
    { keys: ["economics", "demand", "supply", "market"], val: "Economics" },
    { keys: ["commerce", "business", "trade"], val: "Commerce" },
  ];
  for (const { keys, val } of subjectMap) {
    if (keys.some(k => lower.includes(k))) { r.subject = val; score += 15; break; }
  }

  const taskMap = [
    [/(lesson notes|lesson plan|scheme of work|class activity|learning objective)/i, "Lesson Notes"],
    [/(comprehension|reading passage|reading extract)/i, "Comprehension"],
    [/(mark.*answer|check.*answer|correct.*answer|grade.*answer|\bmarking\b)/i, "Mark Answers"],
    [/(revise|revision|summarise|key points|recap|summary of)/i, "Revision Help"],
    [/(solve|calculate|work out|find.*value|evaluate|simplify)/i, "Solve Question"],
    [/(study tip|how to study|exam tip|exam preparation|prepare for exam)/i, "Study Tips"],
    [/(quiz|test|mcq|multiple choice|generate.*question|set.*question)/i, "Create Quiz"],
    [/(explain|definition|what is|what are|describe|tell me about|how does)/i, "Explain Topic"],
  ];
  for (const [pat, task] of taskMap) {
    if (pat.test(text)) { r.taskType = task; score += 20; break; }
  }

  const compMap = [
    ["critical thinking", "Critical Thinking"],
    ["problem solving", "Problem Solving"],
    ["active citizenship", "Active Citizenship"],
    ["financial literacy", "Financial Literacy"],
    ["ethical reasoning", "Ethical Reasoning"],
    ["digital literacy", "Digital Literacy"],
    ["scientific inquiry", "Scientific Inquiry"],
    ["entrepreneurial", "Entrepreneurial Skills"],
    ["self-management", "Self-Management"],
    ["communication", "Communication"],
    ["creativity", "Creativity"],
  ];
  for (const [key, val] of compMap) {
    if (lower.includes(key)) { r.competency = val; score += 10; break; }
  }

  r.confidence = Math.min(score, 100);
  return r;
}

// ═══════════════════════════════════════════════════════════════════
// CONTEXT RESOLVER — manual selections always override parser
// ═══════════════════════════════════════════════════════════════════
function resolveContext(parsed, manual) {
  const highConf = parsed.confidence >= 30;
  const pick = (manVal, parsedVal) => manVal || (highConf ? parsedVal : null) || "";

  const subject = pick(manual.subject, parsed.subject);
  const taskType = parsed.taskType || "Explain Topic";

  let competency = pick(manual.competency, parsed.competency);
  if (!manual.competency && !competency) {
    if (taskType === "Solve Question") competency = "Problem Solving";
    else if (subject === "Mathematics") competency = "Numeracy";
    else if (subject === "Civic Education") competency = "Active Citizenship";
  }

  return {
    userType: manual.userMode || parsed.userType || "Learner",
    level: pick(manual.level, parsed.level),
    grade: pick(manual.grade, parsed.grade),
    pathway: pick(manual.pathway, parsed.pathway),
    subject,
    competency,
    taskType,
    confidence: parsed.confidence,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT BUILDER — ZedExams production tone
// ═══════════════════════════════════════════════════════════════════
function buildSystemPrompt(ctx) {
  const levelLabel = CBC.levels.find(l => l.id === ctx.level)?.label || "";
  const pathLabel = ctx.pathway ? CBC.pathways.find(p => p.id === ctx.pathway)?.label || "" : "";
  const ctxBlock = [
    `[UserType: ${ctx.userType}]`,
    ctx.level && `[Level: ${levelLabel}]`,
    ctx.grade && `[GradeForm: ${ctx.grade}]`,
    pathLabel && `[Pathway: ${pathLabel}]`,
    ctx.subject && `[Subject: ${ctx.subject}]`,
    ctx.taskType && `[TaskType: ${ctx.taskType}]`,
    ctx.competency && `[Competency: ${ctx.competency}]`,
  ].filter(Boolean).join("\n");

  return `You are Zed Study Assistant on ZedExams — a professional academic AI built for the Zambian 2023 Competency-Based Curriculum (CBC) Framework. You serve learners, teachers, and parents across Zambia.

ACTIVE CONTEXT:
${ctxBlock}

IDENTITY:
- Respond as a trained Zambian educator at all times — never as a chatbot
- Be direct, structured, and level-appropriate. Avoid filler or hedging
- Complexity: simple/concrete language for Primary, academic-level for Secondary
- Sound like a professional educator at a well-resourced Zambian school

ZAMBIAN CONTEXT — always use where relevant:
- Monetary examples: Zambian Kwacha (K) — "K250 for maize seeds", "K50 transport to Lusaka"
- Local places: Lusaka, Ndola, Kitwe, Livingstone, Chipata, Copperbelt, Luapula, Eastern Province, Victoria Falls, Lake Kariba, Zambezi River
- Institutions: ECZ, Ministry of Education, University of Zambia (UNZA), CBU, Mulungushi University
- Local context: MTN Money, Airtel Money, local markets, farming, ZNBC, community health centres
- History: Kenneth Kaunda, UNIP, ZANC, pre-colonial Lozi/Bemba/Tonga/Ngoni peoples, Zambian independence 1964

CBC MANDATE:
- Prioritise competency development over rote fact recall
- Focus on observable skills, application, and critical thinking
- For civic/governance topics: teach active citizenship, not just definitions
- Connect all learning to real Zambian daily life, work, and community

STRICT OUTPUT FORMATS — follow based on task:

EXPLAIN TOPIC:
## Definition
[Clear, level-appropriate definition]
## Explanation
[Step-by-step breakdown with worked logic]
## Real-Life Example
[Zambian or community context — use K for money, local names and places]
## Practice Question
[One application question]

CREATE QUIZ:
## Instructions: [brief setup sentence]
1. [Question]
   A) [option]  B) [option]  C) [option]  D) [option]
[Continue...]
## Answer Key
1. A — [brief reason]

LESSON NOTES (Teacher):
## Competency Goal
## Topic & Grade
## Key Vocabulary
## Introduction
## Lesson Development
## Class Activity
## Exercise
## Homework

COMPREHENSION:
## Reading Passage
[150–250 words, Zambian context preferred]
## Questions
[5 questions testing inference, vocabulary in context, and reasoning]
## Answers

MARK ANSWERS (CBC Rubric):
## Marking Feedback
Score: [x/y marks]
Competency Level: [Emerging | Developing | Proficient | Exemplary]
Strengths: [specific positives]
Areas for Improvement: [specific gaps]
Next Step: [one actionable recommendation]

REVISION HELP:
## Key Competencies to Master
## Common Exam Mistakes
## Quick Self-Check
## Practice Prompts

SOLVE QUESTION:
## Solution
[Full step-by-step working — show method, not just answer]
## Competency Demonstrated
[Name the skill applied]

STUDY TIPS:
## Tips for [Subject/Level]
[Practical, active-learning strategies]

RULES:
- Always use ## headings for every required section
- Numbered lists for steps and quiz questions
- Bullet points (- ) for lists
- Never omit required sections for the detected task type
- Align vocabulary and examples precisely to the selected level`;
}

// ═══════════════════════════════════════════════════════════════════
// API — routes through the Firebase-authed /api/ai/chat proxy.
// sendAIChat handles auth tokens, Netlify rewrite, rate limits, errors.
// ═══════════════════════════════════════════════════════════════════
async function callAPI(systemPrompt, history, resolvedContext) {
  // history is [{role, content}, ...] ending with the current user message.
  const last = history[history.length - 1];
  const priorHistory = history.slice(0, -1).map((m) => ({
    role: m.role,
    content: String(m.content || ""),
  }));
  // Flatten resolved CBC context into the context field for server logging.
  const context = {
    area: "study",
    role: resolvedContext?.userType || "Learner",
    grade: resolvedContext?.grade || "",
    subject: resolvedContext?.subject || "",
    topic: resolvedContext?.taskType || "",
  };
  return sendAIChat({
    message: String(last?.content || ""),
    history: priorHistory,
    context,
    systemPrompt,
  });
}

function createMessage(role, text = "", ctx = {}) {
  return {
    id: `${role[0]}${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    role,
    text,
    createdAt: new Date().toISOString(),
    parsedContext: ctx.parsed || null,
    manualContext: ctx.manual || null,
    resolvedContext: ctx.resolved || null,
    isStreaming: false,
    isError: false,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PRINT / PDF UTILITY
// ═══════════════════════════════════════════════════════════════════
function printContent(text, taskType = "Study Material") {
  const titleMap = {
    "Lesson Notes": "Lesson Notes",
    "Create Quiz": "Quiz",
    "Comprehension": "Comprehension Exercise",
  };
  const title = titleMap[taskType] || "Study Material";

  // Escape HTML first so LLM output cannot inject scripts into the print window.
  const escaped = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const html = escaped
    .replace(/^##\s+(.+)$/gm, `<h2>$1</h2>`)
    .replace(/^#\s+(.+)$/gm, `<h1>$1</h1>`)
    .replace(/^\d+\.\s+(.+)$/gm, `<li class="num">$1</li>`)
    .replace(/^[-*]\s+(.+)$/gm, `<li>$1</li>`)
    .replace(/\*\*(.+?)\*\*/g, `<strong>$1</strong>`)
    .replace(/\*([^*\n]+)\*/g, `<em>$1</em>`)
    .replace(/\n/g, `<br>`);

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>ZedExams — ${title}</title><style>
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Lora,Georgia,serif;max-width:760px;margin:0 auto;color:#1a1a2e;line-height:1.8;padding:40px 32px;font-size:14px}
.hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #D4AF37;padding-bottom:14px;margin-bottom:28px}
.brand{font-size:22px;font-weight:700;color:#D4AF37;letter-spacing:-0.3px}
.brand-sub{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.8px;margin-top:2px}
.meta{font-size:11px;color:#888;text-align:right}
h1{font-size:20px;color:#0A1128;margin-bottom:20px;font-weight:700}
h2{font-size:11px;color:#D4AF37;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;border-left:3px solid #D4AF37;padding-left:9px;margin:22px 0 8px}
li{margin:4px 0 4px 20px}li.num{list-style:decimal}
strong{color:#0A1128;font-weight:700}em{color:#444;font-style:italic}
.footer{margin-top:40px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#aaa;display:flex;justify-content:space-between}
@media print{body{padding:20px}}</style></head><body><div class="hdr">
<div><div class="brand">ZedExams</div><div class="brand-sub">CBC-Aligned · Zambian Curriculum</div></div>
<div class="meta">${title}<br>${new Date().toLocaleDateString("en-ZM", { year: "numeric", month: "long", day: "numeric" })}</div></div><h1>${title}</h1><div>${html}</div><div class="footer"><span>Generated by Zed Study Assistant</span><span>zedexams.com</span></div>
</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

// ═══════════════════════════════════════════════════════════════════
// STREAMING HOOK
// ═══════════════════════════════════════════════════════════════════
function useStreaming() {
  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const cancelRef = useRef(false);
  const timerRef = useRef(null);

  const stream = useCallback((fullText, onComplete) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStreamText("");
    setStreaming(true);
    cancelRef.current = false;
    const chars = fullText.split("");
    let idx = 0;
    const tick = () => {
      if (cancelRef.current) { setStreaming(false); return; }
      if (idx >= chars.length) {
        setStreaming(false);
        onComplete?.(fullText);
        return;
      }
      // Fake-typewriter speed. Claude already finished — just paint it out
      // fast enough to feel animated but not slow. For very long replies
      // (>1500 chars) we take bigger chunks so lesson notes don't drag.
      const longReply = chars.length > 1500;
      const chunkSize = longReply
        ? Math.floor(Math.random() * 12) + 12     // 12–23 chars/tick
        : Math.floor(Math.random() * 8) + 8;       // 8–15 chars/tick
      const n = Math.min(chunkSize, chars.length - idx);
      setStreamText(prev => prev + chars.slice(idx, idx + n).join(""));
      idx += n;
      const baseDelay = longReply ? 3 : 5;
      timerRef.current = setTimeout(
        tick,
        chars[idx] === "\n" ? baseDelay + 8 : baseDelay + Math.random() * 4,
      );
    };
    tick();
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    setStreaming(false);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setStreamText("");
  }, [cancel]);

  // Cancel the fake-typewriter timer on unmount so it can't call setState
  // on a dead component and leak warnings.
  useEffect(() => () => {
    cancelRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { streamText, streaming, stream, cancel, reset };
}

// ═══════════════════════════════════════════════════════════════════
// MARKDOWN RENDERER — academic / textbook style
// ═══════════════════════════════════════════════════════════════════
const RUBRIC_COLORS = {
  emerging: "#EF4444",
  developing: "#F59E0B",
  proficient: EMERALD,
  exemplary: GOLD,
};

// Escape HTML first so LLM output cannot inject scripts or break layout.
function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineFmt(t = "") {
  return escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:#F8F9FA;font-weight:700">$1</strong>`)
    .replace(/\*([^*\n]+)\*/g, `<em style="color:#94A3B8;font-style:normal;font-weight:500">$1</em>`)
    .replace(/`([^`]+)`/g, `<code style="background:#0A1128;color:${GOLD};padding:1px 5px;border-radius:3px;font-size:12px;font-family:monospace">$1</code>`);
}

function MarkdownRenderer({ text }) {
  if (!text) return null;
  const lines = text.split("\n");
  const els = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^##\s+/.test(line)) {
      els.push(
        <div key={i} style={{
          borderLeft: `3px solid ${GOLD}`, paddingLeft: 10, margin: "16px 0 6px",
          color: GOLD, fontWeight: 700, fontSize: 11, letterSpacing: "0.8px",
          textTransform: "uppercase", lineHeight: 1.4,
        }}>
          {line.replace(/^##\s+/, "")}
        </div>
      );
    } else if (/^#\s+/.test(line)) {
      els.push(
        <div key={i} style={{
          color: C.text, fontWeight: 700, fontSize: 15, margin: "16px 0 8px",
          fontFamily: "Georgia, serif",
        }}>
          {line.replace(/^#\s+/, "")}
        </div>
      );
    } else if (/^(Emerging|Developing|Proficient|Exemplary):/i.test(trimmed)) {
      const lvl = trimmed.split(":")[0].toLowerCase();
      const rest = trimmed.replace(/^\w+:\s*/, "");
      const color = RUBRIC_COLORS[lvl] || GOLD;
      els.push(
        <div key={i} style={{
          display: "flex", gap: 8, margin: "4px 0",
          background: `${color}12`, border: `1px solid ${color}30`,
          borderRadius: 8, padding: "7px 11px",
        }}>
          <span style={{
            color, fontWeight: 700, fontSize: 11, minWidth: 90, flexShrink: 0,
            textTransform: "uppercase", letterSpacing: "0.4px",
          }}>{trimmed.split(":")[0]}</span>
          <span style={{ color: C.muted, fontSize: 13 }} dangerouslySetInnerHTML={{ __html: inlineFmt(rest) }} />
        </div>
      );
    } else if (/^[A-D]\)\s+/.test(trimmed)) {
      els.push(
        <div key={i} style={{ display: "flex", gap: 8, margin: "3px 0", paddingLeft: 12 }}>
          <span style={{ color: GOLD, fontWeight: 700, minWidth: 22, fontSize: 12, flexShrink: 0 }}>{trimmed.substring(0, 2)}</span>
          <span style={{ color: C.muted, fontSize: 13.5 }} dangerouslySetInnerHTML={{ __html: inlineFmt(trimmed.substring(3)) }} />
        </div>
      );
    } else if (/^\d+\.\s+/.test(trimmed)) {
      const num = trimmed.match(/^(\d+)\./)[1];
      const content = trimmed.replace(/^\d+\.\s+/, "");
      els.push(
        <div key={i} style={{ display: "flex", gap: 8, margin: "4px 0", paddingLeft: 4 }}>
          <span style={{ color: GOLD, fontWeight: 700, minWidth: 22, fontSize: 13, flexShrink: 0 }}>{num}.</span>
          <span style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.7, fontFamily: "Georgia, serif" }}
            dangerouslySetInnerHTML={{ __html: inlineFmt(content) }} />
        </div>
      );
    } else if (/^[-*•]\s+/.test(trimmed)) {
      const content = trimmed.replace(/^[-*•]\s+/, "");
      els.push(
        <div key={i} style={{ display: "flex", gap: 8, margin: "3px 0", paddingLeft: 4 }}>
          <span style={{ color: GOLD, marginTop: 5, flexShrink: 0, fontSize: 7 }}>◆</span>
          <span style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.7, fontFamily: "Georgia, serif" }}
            dangerouslySetInnerHTML={{ __html: inlineFmt(content) }} />
        </div>
      );
    } else if (/^>\s+/.test(line)) {
      els.push(
        <div key={i} style={{
          borderLeft: `3px solid ${C.blue}`, paddingLeft: 10, margin: "6px 0",
          color: C.dim, fontSize: 13, fontStyle: "italic",
        }} dangerouslySetInnerHTML={{ __html: inlineFmt(line.replace(/^>\s+/, "")) }} />
      );
    } else if (trimmed === "") {
      els.push(<div key={i} style={{ height: 7 }} />);
    } else {
      els.push(
        <p key={i} style={{
          color: C.muted, margin: "3px 0", lineHeight: 1.72, fontSize: 13.5,
          fontFamily: "Georgia, serif",
        }} dangerouslySetInnerHTML={{ __html: inlineFmt(line) }} />
      );
    }
  }
  return <div>{els}</div>;
}

// ═══════════════════════════════════════════════════════════════════
// UI ATOMS
// ═══════════════════════════════════════════════════════════════════
// Fixed waveform heights to avoid re-render flicker
const WAVE_BARS = [10, 16, 8, 18, 12, 14, 7, 20, 11, 17, 9, 15, 13, 19, 8, 16, 10, 14, 12, 18];
const WAVE_DELAYS = [0, .05, .11, .03, .18, .08, .24, .02, .15, .09, .21, .06, .17, .13, .01, .22, .07, .16, .04, .19];

function BannerWaveform() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 18 }}>
      {[0, 1, 2, 3, 4, 5, 6].map(i => (
        <div key={i} style={{
          width: 3, borderRadius: 2, background: GOLD, height: "100%",
          animation: `bwave 1s ${i * .12}s ease-in-out infinite`,
        }} />
      ))}
      <style>{`@keyframes bwave{0%,100%{transform:scaleY(.25);opacity:.4}50%{transform:scaleY(1);opacity:1}}`}</style>
    </div>
  );
}

function InputWaveform() {
  return (
    <div style={{
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      gap: 2.5, height: 22, marginTop: 7, padding: "0 4px",
    }}>
      {WAVE_BARS.map((h, i) => (
        <div key={i} style={{
          width: 2.5, borderRadius: 2, background: GOLD, height: h,
          animation: `iwave .5s ${WAVE_DELAYS[i]}s ease-in-out infinite alternate`,
          opacity: 0.8,
        }} />
      ))}
      <style>{`@keyframes iwave{from{transform:scaleY(0.2);opacity:.4}to{transform:scaleY(1);opacity:.9}}`}</style>
    </div>
  );
}

function TypingDots() {
  const [phase, setPhase] = useState(0);
  const labels = ["Zed is thinking…", "Preparing your CBC-aligned answer…", "Consulting the curriculum…"];
  useEffect(() => {
    const t = setInterval(() => setPhase(p => (p + 1) % labels.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 0" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: "50%", background: GOLD,
          animation: `zdot 1.2s ${i * .22}s infinite`,
        }} />
      ))}
      <span style={{
        fontSize: 12, color: C.dim, marginLeft: 4, fontStyle: "italic", transition: "opacity .4s",
      }}>{labels[phase]}</span>
      <style>{`@keyframes zdot{0%,80%,100%{transform:translateY(0);opacity:.3}40%{transform:translateY(-5px);opacity:1}}`}</style>
    </div>
  );
}

function Select({ value, onChange, options, placeholder, disabled = false }) {
  return (
    <div style={{ position: "relative", flex: 1 }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        style={{
          width: "100%", appearance: "none", WebkitAppearance: "none",
          background: disabled ? C.surfaceAlt : C.panel,
          border: `1px solid ${value ? C.borderMid : C.border}`,
          borderRadius: 10, padding: "7px 26px 7px 11px",
          color: value ? C.text : C.dim,
          fontSize: 12, fontWeight: value ? 600 : 400,
          cursor: disabled ? "not-allowed" : "pointer",
          outline: "none", fontFamily: "inherit",
          transition: "border-color .2s", opacity: disabled ? .4 : 1,
        }}
      >
        <option value="">{placeholder}</option>
        {options.map(o => {
          const v = typeof o === "object" ? o.id : o;
          const l = typeof o === "object" ? o.label : o;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
      <ChevronDown size={11} style={{
        position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
        color: C.dim, pointerEvents: "none",
      }} />
    </div>
  );
}

function ContextPill({ level, grade, pathway, subject, competency }) {
  const levelLabel = CBC.levels.find(l => l.id === level)?.label;
  const pathLabel = pathway ? CBC.pathways.find(p => p.id === pathway)?.label : null;
  const parts = [levelLabel, grade, pathLabel, subject, competency].filter(Boolean);
  if (!parts.length) return null;
  return (
    <div style={{
      background: C.goldGlow, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "5px 12px", marginBottom: 8, fontSize: 11, color: C.muted,
      display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap",
    }}>
      <Target size={10} color={GOLD} style={{ flexShrink: 0 }} />
      {parts.map((p, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{
            color: i === parts.length - 1 ? GOLD : C.text,
            fontWeight: i === parts.length - 1 ? 700 : 500,
          }}>{p}</span>
          {i < parts.length - 1 && <span style={{ color: C.dimmer }}>·</span>}
        </span>
      ))}
    </div>
  );
}

function ParsedBadges({ parsed }) {
  if (!parsed || parsed.confidence < 20) return null;
  const chips = [
    [parsed.userType, EMERALD, "rgba(16,185,129,.12)"],
    [parsed.grade, C.blue, "rgba(59,130,246,.12)"],
    [parsed.subject, GOLD, "rgba(212,175,55,.12)"],
    [parsed.taskType, "#C084FC", "rgba(192,132,252,.12)"],
  ].filter(([v]) => v);
  if (!chips.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
      {chips.map(([v, color, bg]) => (
        <span key={v} style={{
          background: bg, border: `1px solid ${color}40`, color,
          padding: "1px 7px", borderRadius: 4, fontSize: 10,
          fontWeight: 600, letterSpacing: "0.4px",
        }}>
          {v}
        </span>
      ))}
    </div>
  );
}

function TopicChips({ grade, onSelect }) {
  const topics = TOPIC_BANK[grade] || [];
  if (!topics.length) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 10, color: C.dim, letterSpacing: "0.6px",
        textTransform: "uppercase", marginBottom: 6, fontWeight: 600,
        display: "flex", alignItems: "center", gap: 5,
      }}>
        <Lightbulb size={10} color={GOLD} />
        Suggested Topics
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {topics.map(t => (
          <button
            key={t}
            onClick={() => onSelect(t)}
            style={{
              background: C.goldGlow, border: `1px solid ${C.border}`,
              color: C.muted, padding: "3px 10px", borderRadius: 20,
              fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              transition: "all .18s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = GOLD;
              e.currentTarget.style.borderColor = C.borderMid;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = C.muted;
              e.currentTarget.style.borderColor = C.border;
            }}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button onClick={copy} style={{
      display: "flex", alignItems: "center", gap: 4,
      background: done ? "rgba(16,185,129,.12)" : C.goldGlow,
      border: `1px solid ${done ? "rgba(16,185,129,.3)" : C.border}`,
      color: done ? EMERALD : C.dim,
      padding: "3px 9px", borderRadius: 5, fontSize: 10.5,
      fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
      transition: "all .2s",
    }}>
      {done ? <Check size={10} /> : <Copy size={10} />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// QUICK ACTIONS
// ═══════════════════════════════════════════════════════════════════
const QUICK_ACTIONS = [
  { id: "explain", label: "Explain a Topic", icon: BookOpen, color: EMERALD, desc: "CBC-aligned explanations with examples", prompt: "Explain the concept of " },
  { id: "quiz", label: "Create a Quiz", icon: PenLine, color: C.blue, desc: "Scenario-based ECZ-style questions", prompt: "Create a CBC quiz on " },
  { id: "notes", label: "Lesson Notes", icon: ClipboardList, color: GOLD, desc: "Classroom-ready lesson plans", prompt: "Create lesson notes for " },
  { id: "mark", label: "Mark Answers", icon: CheckSquare, color: C.pink, desc: "CBC rubric marking & feedback", prompt: "Mark these answers:\n" },
];

const EXTRA_TOOLS = [
  { id: "revision", label: "Revision Help", icon: BookMarked, color: "#A78BFA", prompt: "Help me revise " },
  { id: "solve", label: "Solve Question", icon: Zap, color: "#38BDF8", prompt: "Solve this question: " },
  { id: "tips", label: "Study Tips", icon: GraduationCap, color: "#FB923C", prompt: "Give me study tips for " },
];

const PRINTABLE_TASKS = new Set(["Lesson Notes", "Create Quiz", "Comprehension", "Revision Help"]);
const MAX_INPUT = 2000;

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function ZedStudyAssistant() {
  // Manual context (dropdowns)
  const [userMode, setUserMode] = useState("Learner");
  const [level, setLevel] = useState("");
  const [grade, setGrade] = useState("");
  const [pathway, setPathway] = useState("");
  const [subject, setSubject] = useState("");
  const [competency, setCompetency] = useState("");

  // UI state
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [retryPayload, setRetryPayload] = useState(null);

  const endRef = useRef(null);
  const inputRef = useRef(null);
  const activeStreamId = useRef(null);

  const { streamText, streaming, stream, cancel: cancelStream, reset: resetStream } = useStreaming();

  // Derived curriculum options
  const isSecondary = level === "ordinary" || level === "advanced";
  const gradeOptions = level ? CBC.gradesByLevel[level] || [] : [];
  const subjectOptions = (() => {
    if (!level) return [];
    if (level === "primary") return CBC.primaryAreas;
    if (isSecondary && pathway) {
      const src = level === "advanced" ? CBC.advancedByPathway : CBC.subjectsByPathway;
      return (src[pathway] || []).map(s => ({ id: s, label: s }));
    }
    return [];
  })();

  // Focus mode — dim controls when generating lesson notes or quizzes
  const focusMode = streaming && messages.some(m =>
    m.isStreaming && PRINTABLE_TASKS.has(m.resolvedContext?.taskType)
  );

  useEffect(() => { setGrade(""); setPathway(""); setSubject(""); }, [level]);
  useEffect(() => { setSubject(""); }, [pathway]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamText]);

  // Core send
  const executeSend = useCallback(async (text, historySnapshot, manualCtx) => {
    const parsed = parseMessage(text);
    const resolved = resolveContext(parsed, manualCtx);
    const sysPrompt = buildSystemPrompt(resolved);

    const prefix = [
      `[UserType: ${resolved.userType}]`,
      resolved.level && `[Level: ${CBC.levels.find(l => l.id === resolved.level)?.label}]`,
      resolved.grade && `[GradeForm: ${resolved.grade}]`,
      resolved.pathway && `[Pathway: ${CBC.pathways.find(p => p.id === resolved.pathway)?.label}]`,
      resolved.subject && `[Subject: ${resolved.subject}]`,
      resolved.taskType && `[TaskType: ${resolved.taskType}]`,
      resolved.competency && `[Competency: ${resolved.competency}]`,
    ].filter(Boolean).join(" ");

    const enriched = prefix ? `${prefix}\n\n${text}` : text;

    const apiHistory = [
      ...historySnapshot
        .filter(m => !m.isStreaming && !m.isError && m.text)
        .slice(-8)
        .map(m => ({
          role: m.role,
          content: m.role === "user" ? (m._enriched || m.text) : m.text,
        })),
      { role: "user", content: enriched },
    ];

    const userMsg = {
      ...createMessage("user", text, { parsed, manual: manualCtx, resolved }),
      _enriched: enriched,
    };
    const asstId = `a_${Date.now()}`;
    const asstMsg = {
      ...createMessage("assistant", "", { resolved }),
      id: asstId,
      isStreaming: true,
    };
    activeStreamId.current = asstId;
    setMessages(prev => [...prev, userMsg, asstMsg]);
    setError(null);

    try {
      const reply = await callAPI(sysPrompt, apiHistory, resolved);
      stream(reply, final => {
        setMessages(prev => prev.map(m =>
          m.id === asstId ? { ...m, text: final, isStreaming: false } : m
        ));
        if (activeStreamId.current === asstId) activeStreamId.current = null;
        setIsSending(false);
      });
    } catch (err) {
      const errMsg = err?.message || "Zed is having trouble responding right now. Please try again in a moment.";
      setMessages(prev => prev.map(m =>
        m.id === asstId ? { ...m, text: errMsg, isStreaming: false, isError: true } : m
      ));
      setError(err?.message || "Connection failed. Please check your internet and try again.");
      setRetryPayload({ sysPrompt, apiHistory, resolved, asstIdFailed: asstId });
      activeStreamId.current = null;
      setIsSending(false);
    }
  }, [stream]);

  const sendMessage = useCallback(async (override) => {
    if (activeStreamId.current) return;
    const text = (override ?? input).trim();
    if (!text || isSending) return;
    if (text.length > MAX_INPUT) {
      setError(`Message too long (${text.length}/${MAX_INPUT} chars). Please shorten it.`);
      return;
    }

    const manualCtx = { userMode, level, grade, pathway, subject, competency };
    const historySnap = [...messages];
    setInput("");
    setActiveAction(null);
    setRetryPayload(null);
    setIsSending(true);
    // NOTE: executeSend owns flipping isSending back to false — it happens
    // either when streaming completes (success) or in the catch (error).
    // Do NOT do it here, or the send button would re-enable mid-stream.
    await executeSend(text, historySnap, manualCtx);
  }, [input, isSending, messages, userMode, level, grade, pathway, subject, competency, executeSend]);

  const retryLast = useCallback(() => {
    if (!retryPayload || isSending) return;
    const { sysPrompt, apiHistory, resolved, asstIdFailed } = retryPayload;
    const newId = `a_retry_${Date.now()}`;
    setMessages(prev => [
      ...prev.filter(m => m.id !== asstIdFailed && !m.isError),
      { ...createMessage("assistant", "", {}), id: newId, isStreaming: true },
    ]);
    setError(null);
    setRetryPayload(null);
    setIsSending(true);
    activeStreamId.current = newId;

    callAPI(sysPrompt, apiHistory, resolved)
      .then(reply => {
        stream(reply, final => {
          setMessages(prev => prev.map(m =>
            m.id === newId ? { ...m, text: final, isStreaming: false } : m
          ));
          if (activeStreamId.current === newId) activeStreamId.current = null;
          setIsSending(false);
        });
      })
      .catch((err) => {
        const errMsg = err?.message || "Zed is still having trouble responding. Please check your connection and try again.";
        setMessages(prev => prev.map(m =>
          m.id === newId
            ? { ...m, text: errMsg, isStreaming: false, isError: true }
            : m
        ));
        setError(err?.message || "Still failing. Please check your internet connection.");
        setRetryPayload({ sysPrompt, apiHistory, resolved, asstIdFailed: newId });
        activeStreamId.current = null;
        setIsSending(false);
      });
  }, [retryPayload, isSending, stream]);

  const clearChat = () => {
    cancelStream();
    setMessages([]);
    resetStream();
    setError(null);
    setRetryPayload(null);
    activeStreamId.current = null;
  };

  const handleKey = e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const hasMsg = messages.length > 0;
  const canSend = input.trim().length > 0 && !isSending;
  const charCount = input.length;
  const charWarn = charCount > 1600;

  const handleTopicSelect = (topic) => {
    const prompt = `Explain the concept of ${topic}`;
    setActiveAction("explain");
    setInput(prompt);
    inputRef.current?.focus();
  };

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: C.bg, fontFamily: "'DM Sans','Segoe UI',sans-serif",
      maxWidth: 520, margin: "0 auto", overflow: "hidden",
    }}>
      {/* ── HEADER */}
      <header style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "11px 16px", display: "flex", alignItems: "center",
        justifyContent: "space-between", flexShrink: 0, zIndex: 10,
        boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{
            width: 36, height: 36,
            background: `linear-gradient(135deg,${GOLD},#B8960C)`,
            borderRadius: 10, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 19, fontWeight: 700,
            color: C.bg, fontFamily: "Georgia, serif", flexShrink: 0,
            boxShadow: `0 0 16px rgba(212,175,55,0.4)`,
          }}>
            Z
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: "-0.2px" }}>
                Zed Study Assistant
              </span>
              <span style={{
                background: C.goldGlow, border: `1px solid ${C.borderMid}`,
                color: GOLD, fontSize: 8.5, padding: "1px 6px", borderRadius: 3,
                fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase",
              }}>Beta</span>
            </div>
            <div style={{
              fontSize: 10, color: C.dim, letterSpacing: "0.5px",
              textTransform: "uppercase", fontWeight: 500, marginTop: 1,
            }}>
              CBC-Aligned · Zambian Learners &amp; Teachers
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <button onClick={() => setVoiceMode(v => !v)} title="Toggle voice mode"
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: `1px solid ${voiceMode ? GOLD : C.border}`,
              background: voiceMode ? C.goldGlow : C.surfaceAlt,
              color: voiceMode ? GOLD : C.dim,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", transition: "all .2s",
            }}>
            {voiceMode ? <Volume2 size={14} /> : <MicOff size={14} />}
          </button>

          {["Learner", "Teacher"].map(m => (
            <button key={m} onClick={() => setUserMode(m)}
              style={{
                padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                border: `1px solid ${userMode === m ? GOLD : C.border}`,
                background: userMode === m ? C.goldGlow : C.surfaceAlt,
                color: userMode === m ? GOLD : C.dim,
                cursor: "pointer", transition: "all .2s",
              }}>
              {m}
            </button>
          ))}

          <button onClick={() => setPanelOpen(o => !o)} title="Toggle curriculum selectors"
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: `1px solid ${panelOpen ? GOLD : C.border}`,
              background: panelOpen ? C.goldGlow : C.surfaceAlt,
              color: panelOpen ? GOLD : C.dim,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", transition: "all .2s",
            }}>
            <Layers size={14} />
          </button>

          {hasMsg && (
            <button onClick={clearChat} title="New chat"
              style={{
                width: 32, height: 32, borderRadius: 8,
                border: `1px solid ${C.border}`, background: C.surfaceAlt,
                color: C.dim, display: "flex", alignItems: "center",
                justifyContent: "center", cursor: "pointer",
              }}>
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </header>

      {/* ── VOICE BANNER */}
      {voiceMode && (
        <div style={{
          background: C.goldGlow, borderBottom: `1px solid ${C.borderMid}`,
          padding: "6px 16px", display: "flex", alignItems: "center",
          justifyContent: "space-between", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BannerWaveform />
            <span style={{ fontSize: 11, color: GOLD, fontWeight: 600 }}>
              Voice Mode Active — TTS Output Ready
            </span>
          </div>
          <button onClick={() => setVoiceMode(false)}
            style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "flex" }}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── CBC CURRICULUM PANEL */}
      {panelOpen && (
        <div style={{
          background: C.panel, borderBottom: `1px solid ${C.border}`,
          padding: "10px 14px", flexShrink: 0, transition: "opacity .3s",
          opacity: focusMode ? 0.3 : 1,
          pointerEvents: focusMode ? "none" : "auto",
        }}>
          <div style={{ display: "flex", gap: 7, marginBottom: 7 }}>
            <Select value={level} onChange={v => setLevel(v)} options={CBC.levels} placeholder="Level" />
            <Select value={grade} onChange={setGrade} options={gradeOptions} placeholder="Grade / Form" disabled={!level} />
          </div>
          <div style={{ display: "flex", gap: 7, marginBottom: 7 }}>
            {isSecondary ? (
              <Select value={pathway} onChange={setPathway} options={CBC.pathways} placeholder="Pathway" />
            ) : (
              <div style={{ flex: 1 }} />
            )}
            <Select
              value={subject}
              onChange={setSubject}
              options={subjectOptions}
              placeholder={level === "primary" ? "Learning Area" : "Subject"}
              disabled={isSecondary ? !pathway : !level}
            />
          </div>
          <div style={{ position: "relative" }}>
            <select
              value={competency}
              onChange={e => setCompetency(e.target.value)}
              style={{
                width: "100%", appearance: "none", WebkitAppearance: "none",
                background: C.surfaceAlt,
                border: `1px solid ${competency ? C.borderMid : C.border}`,
                borderRadius: 10, padding: "7px 26px 7px 11px",
                color: competency ? C.text : C.dim,
                fontSize: 12, fontWeight: competency ? 600 : 400,
                cursor: "pointer", outline: "none", fontFamily: "inherit",
              }}
            >
              <option value="">Competency Focus — e.g. Critical Thinking, Problem Solving</option>
              {CBC.competencies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown size={11} style={{
              position: "absolute", right: 8, top: "50%",
              transform: "translateY(-50%)", color: C.dim, pointerEvents: "none",
            }} />
          </div>
        </div>
      )}

      {/* ── MESSAGES AREA */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "16px 14px",
        display: "flex", flexDirection: "column", gap: 16,
        scrollbarWidth: "thin", scrollbarColor: `${C.border} transparent`,
      }}>
        {/* WELCOME DASHBOARD */}
        {!hasMsg && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <h1 style={{
                fontSize: 18, fontWeight: 700, color: C.text,
                margin: "0 0 5px", letterSpacing: "-0.3px",
              }}>
                Zed Study Assistant
              </h1>
              <p style={{ fontSize: 12, color: C.dim, margin: 0, lineHeight: 1.5 }}>
                Explain topics · Generate quizzes · Create lesson notes · Mark answers · Revise · Solve questions
              </p>
            </div>

            {/* Topic chips if grade selected */}
            {grade && <TopicChips grade={grade} onSelect={handleTopicSelect} />}

            {/* Main quick action cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {QUICK_ACTIONS.map(a => {
                const Icon = a.icon;
                const active = activeAction === a.id;
                return (
                  <button key={a.id}
                    onClick={() => {
                      setActiveAction(a.id);
                      setInput(a.prompt);
                      inputRef.current?.focus();
                    }}
                    style={{
                      background: active ? `${a.color}14` : C.surface,
                      border: `1px solid ${active ? a.color : C.border}`,
                      borderRadius: 14, padding: "14px 13px", cursor: "pointer",
                      textAlign: "left", transition: "all .2s",
                      boxShadow: active ? `0 0 14px ${a.color}20` : "none",
                    }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 9,
                      background: `${a.color}18`, display: "flex",
                      alignItems: "center", justifyContent: "center", marginBottom: 9,
                    }}>
                      <Icon size={15} color={a.color} />
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 3 }}>
                      {a.label}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.dim, lineHeight: 1.45 }}>
                      {a.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* More tools — compact secondary row */}
            <div>
              <div style={{
                fontSize: 9.5, color: C.dim, letterSpacing: "0.8px",
                textTransform: "uppercase", fontWeight: 700, marginBottom: 7,
              }}>
                More Tools
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {EXTRA_TOOLS.map(a => {
                  const Icon = a.icon;
                  const active = activeAction === a.id;
                  return (
                    <button key={a.id}
                      onClick={() => {
                        setActiveAction(a.id);
                        setInput(a.prompt);
                        inputRef.current?.focus();
                      }}
                      style={{
                        flex: 1, display: "flex", alignItems: "center", gap: 7,
                        background: active ? `${a.color}12` : C.surfaceAlt,
                        border: `1px solid ${active ? a.color : C.border}`,
                        borderRadius: 10, padding: "9px 11px",
                        cursor: "pointer", transition: "all .2s",
                      }}>
                      <Icon size={13} color={a.color} style={{ flexShrink: 0 }} />
                      <span style={{
                        fontSize: 11.5, fontWeight: 600,
                        color: active ? a.color : C.muted,
                      }}>{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Compact rubric legend */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 14, padding: "11px 14px",
            }}>
              <div style={{
                fontSize: 9.5, color: C.dim, letterSpacing: "0.9px",
                textTransform: "uppercase", fontWeight: 700, marginBottom: 9,
              }}>
                CBC Competency Rubric
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {RUBRIC.map(r => (
                  <div key={r.id} style={{
                    background: r.bg, border: `1px solid ${r.color}28`,
                    borderRadius: 8, padding: "5px 10px",
                    display: "flex", alignItems: "center", gap: 7,
                  }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: "50%",
                      background: r.color, flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: r.color }}>{r.label}</span>
                    <span style={{ fontSize: 10, color: C.dim, marginLeft: "auto" }}>{r.range}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tip */}
            <div style={{
              background: C.goldGlow, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: "8px 13px",
              fontSize: 11.5, color: C.dim, lineHeight: 1.65,
            }}>
              <span style={{ color: GOLD, fontWeight: 700 }}>Tip: </span>
              Select your level and grade above, then choose a quick action or type your question.
              Topic suggestions will appear once a grade is selected.
            </div>

          </div>
        )}

        {/* MESSAGE LIST */}
        {messages.map((msg, idx) => {
          const isUser = msg.role === "user";
          const isLastAsst = !isUser && idx === messages.length - 1;
          const display = (isLastAsst && msg.isStreaming) ? streamText : msg.text;
          const isPrintable = !isUser && !msg.isStreaming && PRINTABLE_TASKS.has(msg.resolvedContext?.taskType);

          return (
            <div key={msg.id} style={{
              display: "flex", flexDirection: isUser ? "row-reverse" : "row",
              gap: 9, animation: "zfade .28s ease",
            }}>
              <style>{`@keyframes zfade{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:translateY(0)}}`}</style>

              {/* Avatar */}
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: isUser ? "rgba(59,130,246,.14)" : C.goldGlow,
                border: `1px solid ${isUser ? "rgba(59,130,246,.28)" : C.borderMid}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, marginTop: 2,
              }}>
                {isUser ? <User size={13} color={C.blue} /> : <Bot size={13} color={GOLD} />}
              </div>

              {/* Bubble */}
              <div style={{
                maxWidth: "79%",
                background: isUser ? "rgba(59,130,246,.08)" : C.surface,
                border: `1px solid ${
                  isUser ? "rgba(59,130,246,.2)" :
                  msg.isError ? "rgba(239,68,68,.3)" : C.border
                }`,
                borderRadius: isUser ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
                padding: "11px 13px",
              }}>
                {/* Assistant header */}
                {!isUser && (
                  <div style={{
                    display: "flex", alignItems: "center",
                    justifyContent: "space-between", marginBottom: 8,
                  }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      background: C.goldGlow, border: `1px solid ${C.borderMid}`,
                      color: GOLD, padding: "2px 8px", borderRadius: 4,
                      fontSize: 9.5, fontWeight: 700, letterSpacing: "0.7px",
                    }}>
                      <Award size={9} /> ZedExams · CBC
                    </span>
                    {!msg.isStreaming && display && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <CopyButton text={display} />
                        {isPrintable && (
                          <button onClick={() => printContent(display, msg.resolvedContext?.taskType)}
                            style={{
                              display: "flex", alignItems: "center", gap: 4,
                              background: C.goldGlow, border: `1px solid ${C.border}`,
                              color: C.dim, padding: "3px 9px", borderRadius: 5,
                              fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                              fontFamily: "inherit",
                            }}>
                            <Printer size={10} /> PDF
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Parser badges on user messages */}
                {isUser && <ParsedBadges parsed={msg.parsedContext} />}

                {/* Content */}
                {isUser ? (
                  <p style={{
                    fontSize: 13.5, color: C.muted, lineHeight: 1.65,
                    margin: 0, whiteSpace: "pre-wrap",
                  }}>{display}</p>
                ) : msg.isError ? null : (
                  msg.isStreaming && !streamText
                    ? <TypingDots />
                    : <MarkdownRenderer text={display || ""} />
                )}

                {/* Streaming cursor */}
                {isLastAsst && msg.isStreaming && streamText && (
                  <span style={{
                    display: "inline-block", width: 2, height: 13,
                    background: GOLD, marginLeft: 2, verticalAlign: "middle",
                    animation: "zcursor .8s steps(1) infinite",
                  }} />
                )}
                <style>{`@keyframes zcursor{0%,100%{opacity:1}50%{opacity:0}}`}</style>

                {/* Retry on error */}
                {msg.isError && (
                  <div style={{
                    marginTop: 10, padding: "8px 10px",
                    background: "rgba(239,68,68,.07)",
                    border: "1px solid rgba(239,68,68,.2)", borderRadius: 8,
                  }}>
                    <div style={{ fontSize: 11.5, color: "#FDA4A4", marginBottom: 7, lineHeight: 1.5 }}>
                      {msg.text}
                    </div>
                    <button onClick={retryLast} style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      background: "rgba(239,68,68,.12)",
                      border: "1px solid rgba(239,68,68,.28)",
                      color: "#F87171", padding: "5px 11px", borderRadius: 7,
                      fontSize: 11, fontWeight: 600, cursor: "pointer",
                      fontFamily: "inherit",
                    }}>
                      <RefreshCw size={11} /> Try Again
                    </button>
                  </div>
                )}

                {/* Timestamp */}
                <div style={{
                  fontSize: 10, color: C.dimmer, marginTop: 6,
                  textAlign: isUser ? "right" : "left",
                }}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* ── INPUT AREA */}
      <div style={{
        background: C.surface, borderTop: `1px solid ${C.border}`,
        padding: "10px 14px 14px", flexShrink: 0,
      }}>
        {/* Context pill */}
        <ContextPill level={level} grade={grade} pathway={pathway} subject={subject} competency={competency} />

        {/* Error banner */}
        {error && (
          <div style={{
            display: "flex", alignItems: "center", gap: 7, marginBottom: 8,
            background: "rgba(239,68,68,.08)",
            border: "1px solid rgba(239,68,68,.25)",
            borderRadius: 8, padding: "7px 11px",
          }}>
            <AlertCircle size={12} color={C.red} />
            <span style={{ fontSize: 11, color: "#F87171", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)}
              style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "flex" }}>
              <X size={11} />
            </button>
          </div>
        )}

        {/* Active quick-action tag */}
        {activeAction && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
            background: C.goldGlow, border: `1px solid ${C.borderMid}`,
            borderRadius: 7, padding: "4px 11px",
          }}>
            <span style={{ fontSize: 11, color: GOLD, fontWeight: 600 }}>
              {QUICK_ACTIONS.find(a => a.id === activeAction)?.label} mode
            </span>
            <button onClick={() => { setActiveAction(null); setInput(""); }}
              style={{
                background: "none", border: "none", color: C.dim,
                cursor: "pointer", marginLeft: "auto", display: "flex",
              }}>
              <X size={11} />
            </button>
          </div>
        )}

        {/* Textarea row */}
        <div style={{ display: "flex", gap: 7, alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask Zed a question…"
            rows={1}
            disabled={isSending}
            maxLength={MAX_INPUT}
            style={{
              flex: 1, background: C.surfaceAlt,
              border: `1px solid ${
                charWarn ? C.orange : (input ? C.borderMid : C.border)
              }`,
              borderRadius: 11, padding: "10px 13px",
              color: C.text, fontSize: 13.5, resize: "none",
              outline: "none", lineHeight: 1.5, fontFamily: "inherit",
              maxHeight: 110, overflowY: "auto",
              transition: "border-color .2s",
              opacity: isSending ? .55 : 1,
            }}
            onInput={e => {
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 110) + "px";
            }}
          />
          <button onClick={() => setVoiceMode(v => !v)}
            style={{
              width: 40, height: 40, borderRadius: 10,
              border: `1px solid ${voiceMode ? GOLD : C.border}`,
              background: voiceMode ? C.goldGlow : C.surfaceAlt,
              color: voiceMode ? GOLD : C.dim,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", flexShrink: 0, transition: "all .2s",
            }}>
            <Mic size={15} />
          </button>
          <button onClick={() => sendMessage()} disabled={!canSend}
            style={{
              width: 40, height: 40, borderRadius: 10, border: "none",
              background: canSend ? `linear-gradient(135deg,${GOLD},#B8960C)` : C.surfaceAlt,
              color: canSend ? C.bg : C.dimmer,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: canSend ? "pointer" : "not-allowed", flexShrink: 0,
              transition: "all .2s",
              boxShadow: canSend ? `0 0 14px rgba(212,175,55,0.4)` : "none",
            }}>
            {isSending ? (
              <div style={{
                width: 14, height: 14, border: `2.5px solid ${C.bg}`,
                borderTopColor: "transparent", borderRadius: "50%",
                animation: "zspin .7s linear infinite",
              }} />
            ) : (
              <Send size={14} />
            )}
          </button>
          <style>{`@keyframes zspin{to{transform:rotate(360deg)}}`}</style>
        </div>

        {/* Voice waveform inside input area */}
        {voiceMode && <InputWaveform />}

        {/* Footer meta */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: voiceMode ? 4 : 8, fontSize: 10, color: C.dimmer,
        }}>
          <span>Enter to send · Shift+Enter for new line</span>
          <span style={{ color: charWarn ? C.orange : C.dimmer }}>
            {charWarn ? `${charCount}/${MAX_INPUT}` : "ZedExams · CBC 2023"}
          </span>
        </div>
      </div>
    </div>
  );
}
