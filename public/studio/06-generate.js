// callClaude — routes through the Firebase Cloud Function in production.
// The bridge returns the raw JSON string from Claude; parse it here so the
// rest of the studio can treat it as a normal object (matching the original
// direct-API implementation in files_2/lesson__06-generate.js).
async function callClaude(systemPrompt, userPrompt, context) {
  if (typeof window.__studioCallClaude !== 'function') {
    throw new Error('Studio bridge not initialised — __studioCallClaude is missing.');
  }
  const raw = await window.__studioCallClaude(systemPrompt, userPrompt, context || null);
  let text = String(raw || '').trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('callClaude: JSON parse failed', err, text.slice(0, 500));
    throw new Error('Could not read AI response — please try again.');
  }
}

// Native <input type="date"> hands us YYYY-MM-DD. Render that as
// "29 April 2026" for the lesson plan header so it's readable on print.
// Anything we don't recognise is passed through unchanged.
function formatLessonDate(raw) {
  if (!raw) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return raw;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) return raw;
  return `${d} ${months[mo - 1]} ${y}`;
}

function gatherInput() {
  // The planner (12-lesson-progression.js) owns the lesson-count / foci
  // state; gatherInput() reads it via window.__lpState so the legacy
  // single-lesson DOM fields stay accurate when the planner is single-mode,
  // and the multi-lesson loop in __studioOnGenerateClick uses the planner's
  // count + per-lesson focus instead of the old f-lessons-* inputs.
  const lp = window.__lpState || { mode: 'single', count: 1, foci: ['Single lesson plan'] };
  const lessonsTotal = Math.max(1, parseInt(lp.count, 10) || 1);
  return {
    headerLine: $('#f-header').value.trim(),
    school: $('#f-school').value.trim(),
    department: $('#f-department').value.trim(),
    klass: $('#f-class').value,
    subject: $('#f-subject').value,
    duration: parseInt($('#f-duration').value, 10) || 40,
    term: $('#f-term').value,
    week: $('#f-week').value,
    termWeek: `Term ${$('#f-term').value}, Week ${$('#f-week').value}`,
    date: formatLessonDate($('#f-date').value.trim()),
    time: $('#f-time').value.trim(),
    topic: $('#f-topic').value.trim(),
    subtopic: $('#f-subtopic').value.trim(),
    // Medium of instruction — defaults to English when the row is missing
    // (older cached bundle) so the header never goes blank.
    medium: (() => { const el = $('#f-medium'); return (el && el.value) || 'English'; })(),
    teacher: $('#f-teacher').value.trim(),
    tsno: $('#f-tsno').value.trim(),
    showEnrolment: $('#t-enrolment').dataset.on === 'true',
    showAttendance: $('#t-attendance').dataset.on === 'true',
    showReflection: $('#t-reflection').dataset.on === 'true',
    // Optional toggle — older studio DOMs may not have the row yet.
    showVocabulary: (() => { const el = $('#t-vocab'); return !!el && el.dataset.on === 'true'; })(),
    compactMeta: $('#t-compact').dataset.on === 'true',
    // Writing-style controls. Selects read directly; default to a professional
    // register + a simplified plan when the DOM is an older bundle.
    languageLevel: (() => { const el = $('#f-language-level'); return (el && el.value) || 'professional'; })(),
    detailLevel: (() => { const el = $('#f-detail-level'); return (el && el.value) || 'simplified'; })(),
    // Auto-draw diagrams for Maths/Science. On by default; older DOMs (no row)
    // fall back to on so the feature is not silently lost on a stale bundle.
    autoDiagrams: (() => { const el = $('#t-diagrams'); return el ? el.dataset.on === 'true' : true; })(),
    // For a non-English medium: write the WHOLE plan in that language rather
    // than an English document with local-language touches. Off by default
    // (and absent on older bundles) so the inspection-friendly English plan
    // stays the default.
    planInMedium: (() => { const el = $('#t-plan-in-medium'); return !!el && el.dataset.on === 'true'; })(),
    format: formatChoice,
    learningEnvironments: $$('#learning-env .le-pill')
      .filter(p => p.dataset.on === 'true')
      .map(p => p.dataset.env),
    // Backwards-compat fields: keep the single-lesson DOM shape but populate
    // it from the planner. Other studio modules (10-export.js, 07-format-
    // preview.js) read these names so we keep the contract stable.
    multiLesson: lessonsTotal > 1,
    lessonsTotal,
    lessonsCurrent: 1,
    progressNotes: '',
    // Planner snapshot — used by __studioOnGenerateClick to drive the loop.
    planner: {
      mode: lp.mode || 'single',
      count: lessonsTotal,
      foci: Array.isArray(lp.foci) ? lp.foci.slice(0, lessonsTotal) : [],
      seriesId: lp.seriesId || null,
      aiSuggestedReason: lp.aiSuggestedReason || null,
      generateOnlyIndex: lp.generateOnlyIndex || null,
    },
  };
}

// Writing-style guidance injected into the user prompt from the teacher's
// "Language level" + "Lesson plan type" selectors. Kept here (not in the
// cached system prompt) so changing a knob never invalidates Anthropic's
// system-prompt cache.
//
// Language level controls the REGISTER and how much teaching guidance is woven
// in — it never changes the JSON shape:
//   • simple        — plain words, quick classroom use
//   • professional  — formal, for records / inspection / submission
//   • teacher       — explanatory; coaches the teacher on HOW to teach the lesson
const LANGUAGE_GUIDE = {
  simple: 'Simple — Use easy, everyday words and short sentences so the plan is quick to read and use in class. Avoid jargon; if a subject term is unavoidable, explain it in plain words. Pitch the reading level low. Good for quick classroom use.',
  professional: 'Professional — Use formal, polished staffroom English suitable for official records, the school file, inspection and submission to a head teacher or standards officer. Keep it correct, concise and businesslike.',
  teacher: 'Detailed Teacher Language — As well as the lesson content, coach the teacher on HOW to teach this lesson. Within the EXISTING activity and prose fields (do not add new JSON keys), weave in brief, practical guidance: how to introduce and explain each step, what to demonstrate or ask, why each activity matters, simple classroom-management tips, and the common mistakes or misconceptions learners make and how to correct them. Aim so that even a new or non-specialist teacher could deliver the lesson confidently.',
  // Back-compat aliases for any value left over in a stale cached bundle.
  standard: 'Professional — Use formal, polished staffroom English suitable for official records, inspection and submission.',
  advanced: 'Detailed Teacher Language — Coach the teacher on how to teach the lesson, folding practical guidance into the existing activity and prose fields.',
};
// Lesson plan type controls how SHORT or COMPLETE the plan is.
//   • simplified — short, main parts only (quick planning)
//   • detailed   — full plan for formal submission / inspection
const DETAIL_GUIDE = {
  simplified: 'Simplified — A short, easy-to-prepare plan covering only the main, important parts, in the spirit of the official printed sample lesson plans. Keep every progression-table cell concise (2 to 4 short bullet-style points, each a brief phrase or one short sentence) and keep prose fields (rationale, lesson goal) short. Do NOT write long paragraphs inside the table. Good for quick planning.',
  detailed: 'Detailed — A more complete, well-explained plan. Expand each cell with fuller teaching detail: more numbered steps, worked examples and expected answers, richer teacher and learner activities, clear assessment criteria, listed teaching and learning resources, and a reflection — so the plan is suitable for formal submission or inspection and a relief teacher could deliver it without extra preparation.',
  // Back-compat alias for any value left over in a stale cached bundle.
  summarised: 'Simplified — Keep every table cell concise (2 to 4 short points) and prose fields short, like the official printed sample lesson plans.',
};

// Subjects for which auto-diagrams make sense. The studio toggle gates the
// feature; this regex makes sure we only ask for diagrams when the lesson is
// genuinely Mathematics or a Science.
const DIAGRAM_SUBJECT_RE = /math|science|biolog|chemis|physic/i;

// The diagram types the studio's SVG engine (11-diagrams.js) can draw, with
// the params each one accepts. Listed inline (not read from the catalog,
// which loads after this file) so the model only ever names a renderable
// type. labels/values are comma-separated lists.
const DIAGRAM_SPEC_HELP = [
  'Shapes 2D — triangle{a,b,c}, righttriangle{a,b,c}, square{side}, rectangle{l,w}, parallelogram{base,side}, trapezium{top,bottom,height}, rhombus{side}, pentagon{}, hexagon{}, circle{center,radius}, angle{label}',
  'Shapes 3D — cube{side}, cuboid{l,w,h}, cylinder{r,h}, cone{r,h}, sphere{r}',
  'Number & data — numberline{min,max,step,highlight}, coordgrid{range}, fractionbar{parts,shaded}, barchart{labels,values}, piechart{labels,values}, linegraph{labels,values}',
  'Sets — venn2{a,b}, venn3{a,b,c}',
  'Science — plantcell{}, animalcell{}, circuit{}, forcearrows{up,down,left,right}, foodchain{a,b,c,d}',
  'Geography — compass{}, contourlines{}',
  'Organisers — mindmap{centre,a,b,c,d}, tchart{left,right}, timeline{years,events}, flowchart{a,b,c,d}',
].map((l) => `  • ${l}`).join('\n');

function buildStyleBlock(i) {
  const langKey = (i.languageLevel || 'professional').toLowerCase();
  const detKey = (i.detailLevel || 'simplified').toLowerCase();
  return `\n\nSTYLE CONTROLS (the teacher chose these — follow them exactly):\n- Language level: ${LANGUAGE_GUIDE[langKey] || LANGUAGE_GUIDE.professional}\n- Lesson plan type: ${DETAIL_GUIDE[detKey] || DETAIL_GUIDE.simplified}`;
}

function buildDiagramBlock(i) {
  if (!i.autoDiagrams || !DIAGRAM_SUBJECT_RE.test(String(i.subject || ''))) return '';
  return `\n\nDIAGRAMS (this is a Mathematics/Science lesson — include diagrams where they genuinely help, exactly as the official printed Maths and Science modules do):\n- Add an OPTIONAL top-level "diagrams" array to your JSON. Each entry: { "stage": one of the stage names you used, "type": one of the supported types below, "params": { ... }, "caption": short caption }.\n- Use a diagram ONLY where a picture aids the explanation or the exercise (e.g. a shape whose area is found, a number line, a Venn/set grouping, a bar chart of collected data, a plant or animal cell, a simple circuit). Do not force one into every lesson — 1 to 3 well-chosen diagrams is plenty. If none would help, omit the array entirely.\n- Attach each diagram to the stage where it is used (usually "LESSON DEVELOPMENT" or "EXERCISE / ASSESSMENT").\n- Supported "type" values and their "params" (use ONLY these; keep params short with plain ASCII labels; for barchart/piechart/linegraph/timeline pass comma-separated strings):\n${DIAGRAM_SPEC_HELP}`;
}

// Build the user prompt for one specific lesson in the series.
// `lessonNumber` is 1-based; `lessonFocus` is the short focus headline
// (e.g. "Concept introduction"). When totalLessons === 1, the focus block
// is omitted entirely so the prompt looks exactly like the single-lesson
// path that already works in production.
function buildPrompt(i, lessonNumber, lessonFocus, totalLessons) {
  const level = activeGradeLevel()[i.klass];
  const legacyTopics = getTopicsForClass(level, i.subject, i.klass);
  // Merge in the clean curriculumTopics map (02b-curriculum-topics.js) for
  // this grade AND subject so Claude recognises topics the teacher picks from
  // the new dropdown — otherwise it might flag them as "out of syllabus" when
  // the legacy subject map happens not to list them. The lookup is
  // subject-scoped: passing only the grade used to inject one subject's topics
  // (e.g. Grade 4 Science) into every other subject, so the model rejected
  // valid topics like "Prepositions" for Grade 4 English.
  const curated = (typeof window.curatedTopicsFor === 'function')
    ? window.curatedTopicsFor(i.klass, i.subject)
    : {};
  const topics = Object.assign({}, legacyTopics, curated);
  const versionLabel = syllabusVersion === 'old' ? '2013 Old CDC Syllabus' : '2023 Zambia ECF';
  let syllabusContext = '';
  if (Object.keys(topics).length) {
    const topicList = Object.entries(topics)
      .map(([t, subs]) => `  • ${t}: ${(subs || []).slice(0, 6).join('; ')}`)
      .join('\n');
    syllabusContext = `\n\nOFFICIAL ${i.klass} ${i.subject} SYLLABUS TOPICS (${versionLabel}):\n${topicList}\n`;
  }
  const envLine = (i.learningEnvironments && i.learningEnvironments.length)
    ? `\n- Learning environment(s) to use: ${i.learningEnvironments.join(', ')} — design activities suited to ${i.learningEnvironments.length > 1 ? 'these environments' : 'this environment'}.`
    : '';
  // Medium of instruction. Default: the plan stays in English (an official
  // document the head teacher / standards officer reads) with the delivery
  // language reflected only in the parts learners actually hear. When the
  // teacher ticks "write the whole plan in the local language", the entire
  // document is written in that medium instead.
  const medium = String(i.medium || 'English').trim();
  const isLocalMedium = medium && medium.toLowerCase() !== 'english';
  let mediumLine = '';
  if (isLocalMedium && i.planInMedium) {
    mediumLine = `\n- MEDIUM OF INSTRUCTION: Write the ENTIRE lesson plan in ${medium} — every heading, the rationale, all teacher and learner activities, the assessment criteria and all prose. Use correct ${medium} spelling and grammar. Keep the syllabus topic and competence codes and proper nouns as they appear officially; only fall back to an English term in brackets where no established ${medium} word exists.`;
  } else if (isLocalMedium) {
    mediumLine = `\n- MEDIUM OF INSTRUCTION: The lesson is taught in ${medium}. Write the plan in English (it is an official document), but reflect the medium — give the teacher's key questions and greetings, any songs, rhymes or chants, and the key vocabulary in ${medium} with a short English gloss in brackets where helpful, e.g. "Mwapoleni mukwai (Good morning)". Keep the stage names, assessment criteria and other prose in English.`;
  }
  const N = Math.max(1, parseInt(totalLessons, 10) || 1);
  const K = Math.max(1, Math.min(N, parseInt(lessonNumber, 10) || 1));
  const focusLines = (N > 1 && Array.isArray(i.planner && i.planner.foci) && i.planner.foci.length)
    ? i.planner.foci.map((f, idx) => `   ${idx + 1}. ${String(f || '').trim()}`).join('\n')
    : '';
  const seqLine = N > 1
    ? `\n- LESSON SEQUENCE: This sub-topic is being split into ${N} lesson periods. You are writing LESSON ${K} of ${N}.\n- This lesson's focus: "${String(lessonFocus || '').trim() || `Lesson ${K}`}". Scope the entire plan to this focus only — do NOT cover content earmarked for later lessons.\n- Series outline so you know what to leave for siblings:\n${focusLines}`
    : '';
  return `Generate a Zambian CBC lesson plan with these inputs:
- Class: ${i.klass}
- Subject: ${i.subject}
- Syllabus version: ${versionLabel}
- Topic: ${i.topic || 'choose an appropriate topic from the official syllabus below'}
- Sub-topic: ${i.subtopic || 'choose an appropriate sub-topic'}
- Duration: ${i.duration} minutes
- Medium of instruction: ${medium}
- Term & Week: ${i.termWeek || 'unspecified'}${envLine}${mediumLine}${seqLine}
${syllabusContext}${buildStyleBlock(i)}${buildDiagramBlock(i)}
IMPORTANT: The topic and sub-topic MUST fit within the ${i.klass} syllabus scope shown above (${versionLabel}). If the user-supplied topic doesn't match this grade level, return {"error": "explanation"} instead.

Return JSON only.`;
}

function renderHeader(meta, titleText) {
  let h = '<div class="doc-head">';
  if (meta.headerLine) h += `<div class="header-line">${esc(meta.headerLine)}</div>`;
  h += `<div class="school">${esc(meta.school || 'School Name')}</div>`;
  if (meta.department) h += `<div class="department">${esc(meta.department)}</div>`;
  h += `<div class="lp-title">${esc(titleText || 'Lesson Plan')}</div></div>`;
  return h;
}


function renderMetaTable(meta) {
  const rows = [];
  if (meta.teacher) rows.push(['Teacher', esc(meta.teacher) + (meta.tsno ? ' &nbsp;·&nbsp; TS ' + esc(meta.tsno) : '')]);
  if (meta.date) rows.push(['Date', esc(meta.date)]);
  if (meta.time) rows.push(['Time', esc(meta.time)]);
  rows.push(['Duration', esc(meta.duration) + ' minutes']);
  rows.push(['Class', esc(meta.klass)]);
  rows.push(['Subject', esc(meta.subject)]);
  if (meta.topic) rows.push(['Topic', esc(meta.topic)]);
  if (meta.subtopic) rows.push(['Sub-topic', esc(meta.subtopic)]);
  if (meta.termWeek) rows.push(['Term &amp; Week', esc(meta.termWeek)]);
  if (meta.showEnrolment) rows.push(['Total Enrolment', 'Boys: _____ &nbsp;&nbsp; Girls: _____ &nbsp;&nbsp; Total: _____']);
  if (meta.showAttendance) rows.push(['Total Attendance', 'Boys: _____ &nbsp;&nbsp; Girls: _____ &nbsp;&nbsp; Total: _____']);
  if (meta.multiLesson) {
    rows.push(['Lesson Sequence', `Lesson ${esc(meta.lessonsCurrent)} of ${esc(meta.lessonsTotal)}`]);
    if (meta.lessonFocus) rows.push(['Lesson Focus', esc(meta.lessonFocus)]);
  }
  rows.push(['Medium of Instruction', esc(meta.medium || 'English')]);
  return `<table class="meta-table"><tbody>${rows.map(r => `<tr><td class="k">${r[0]}</td><td class="v">${r[1]}</td></tr>`).join('')}</tbody></table>`;
}

function renderMetaCompact(meta) {
  const items = [];
  if (meta.teacher) items.push(["Teacher's name", esc(meta.teacher) + (meta.tsno ? ' (TS ' + esc(meta.tsno) + ')' : '')]);
  if (meta.date) items.push(['Date', esc(meta.date)]);
  if (meta.time) items.push(['Time', esc(meta.time)]);
  items.push(['Subject', esc(meta.subject)]);
  items.push(['Duration', esc(meta.duration) + ' min']);
  items.push(['Class', esc(meta.klass)]);
  if (meta.termWeek) items.push(['Term &amp; Week', esc(meta.termWeek)]);
  if (meta.topic) items.push(['Topic', esc(meta.topic)]);
  if (meta.subtopic) items.push(['Sub-topic', esc(meta.subtopic)]);
  if (meta.showEnrolment) items.push(['Enrolment', 'B: ___ G: ___ T: ___']);
  if (meta.showAttendance) items.push(['Attendance', 'B: ___ G: ___ T: ___']);
  items.push(['Medium', esc(meta.medium || 'English')]);
  if (meta.multiLesson) {
    items.push(['Lesson Sequence', `Lesson ${esc(meta.lessonsCurrent)} of ${esc(meta.lessonsTotal)}`]);
    if (meta.lessonFocus) items.push(['Lesson Focus', esc(meta.lessonFocus)]);
  }
  return `<div class="meta-compact">${items.map(([k,v]) => `<div class="item"><span class="lbl">${k}:</span><span class="val">${v}</span></div>`).join('')}</div>`;
}

function renderMeta(meta) {
  return meta.compactMeta ? renderMetaCompact(meta) : renderMetaTable(meta);
}

// Official module header for the classic formats — tight "LABEL: value"
// lines exactly like the SAMPLE LESSON PLAN appendices (no boxed meta
// table, no duplicated Topic/Sub-topic/Learning Environment: those live in
// the field lines that follow). compactMeta pairs two entries per row, off
// puts one per line.
function renderOfficialHeader(meta) {
  const pairs = [];
  pairs.push(['NAME OF TEACHER', esc(meta.teacher || '') + (meta.tsno ? ' (TS ' + esc(meta.tsno) + ')' : ''), 'wide']);
  pairs.push(['DATE', esc(meta.date || '')]);
  pairs.push(['TIME', esc(meta.time || '')]);
  pairs.push(['CLASS', esc(meta.klass || '')]);
  pairs.push(['DURATION', esc(meta.duration) + ' minutes']);
  pairs.push(['TERM &amp; WEEK', esc(meta.termWeek || '')]);
  // Enrolment/attendance get a full-width row each (grid-column 1/-1, like
  // the official modules) — squeezed into a half column the "Total" blank
  // wraps untidily onto a second line.
  if (meta.showEnrolment) pairs.push(['TOTAL ENROLMENT', 'Boys: ______ Girls: ______ Total: ______', 'wide']);
  if (meta.showAttendance) pairs.push(['TOTAL ATTENDANCE', 'Boys: ______ Girls: ______ Total: ______', 'wide']);
  pairs.push(['SUBJECT', esc(meta.subject || ''), 'wide']);
  pairs.push(['MEDIUM OF INSTRUCTION', esc(meta.medium || 'English')]);
  if (meta.multiLesson) pairs.push(['LESSON', `${esc(meta.lessonsCurrent)} of ${esc(meta.lessonsTotal)}` + (meta.lessonFocus ? ' — ' + esc(meta.lessonFocus) : ''), 'wide']);
  const line = ([k, v, wide]) => `<div class="om-item${wide ? ' om-wide' : ''}"><strong>${k}:</strong> ${v}</div>`;
  return `<div class="official-meta${meta.compactMeta ? ' two-col' : ''}">${pairs.map(line).join('')}</div>`;
}

// The official progression table must NEVER be missing — if the model
// under-delivered stages (or an older saved object is re-rendered), fall
// back to the five official stage names with blank cells the teacher can
// fill in by hand.
const OFFICIAL_STAGES = ['INTRODUCTION', 'LESSON DEVELOPMENT', 'EXERCISE / ASSESSMENT', 'HOMEWORK', 'CONCLUSION'];
function ensureStages(stages) {
  const list = Array.isArray(stages) ? stages.filter(s => s && (s.name || s.teacher || s.pupils)) : [];
  if (list.length > 0) return list;
  return OFFICIAL_STAGES.map(name => ({name, duration: '', teacher: '', pupils: '', assessment: ''}));
}

function stripPrefix(s) { return String(s || '').replace(/^\s*\d+[.)]\s*/, ''); }

// The canonical contract sends arrays for list-ish fields, but be tolerant
// of strings (older saved data, model drift) — split on ; or newline.
function asList(v) {
  if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
  return String(v || '').split(/\n|;\s*/).map(s => s.trim()).filter(Boolean);
}
function joinList(v, sep) { return asList(v).join(sep || '; '); }

function formatProse(text) {
  if (!text) return '';
  const t = String(text).trim();
  const lines = t.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const isNumbered = lines.length > 1 && lines.every(l => /^\d+[.)]/.test(l));
  if (isNumbered) {
    return '<ol style="padding-left:20px;margin:4px 0">' + lines.map(l => '<li>' + esc(l.replace(/^\d+[.)]\s*/, '')) + '</li>').join('') + '</ol>';
  }
  return lines.map(l => '<div style="margin:3px 0">' + esc(l) + '</div>').join('');
}

// Render any AI-supplied diagrams attached to a given stage, using the same
// SVG engine the manual diagram inserter uses (11-diagrams.js exposes its
// catalog on window.__studioDiagrams). Robust by design: an unknown type, a
// bad param, or a render throw is skipped silently rather than breaking the
// plan. Params are coerced to strings (arrays joined with commas) so the
// renderers — several of which call .split(',') — never choke on model drift.
function normStageName(s) {
  return String(s || '').toUpperCase().replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
}
function baseStageName(s) {
  return normStageName(s).split(' — ')[0].split(' - ')[0].trim();
}
function stageDiagramsHtml(stageName, specs) {
  if (!Array.isArray(specs) || specs.length === 0) return '';
  const catalog = (typeof window !== 'undefined' && window.__studioDiagrams) || null;
  if (!catalog) return '';
  const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim() || '#0a5454';
  const target = baseStageName(stageName);
  if (!target) return '';
  const html = specs.filter((d) => {
    if (!d || !d.type || !catalog[d.type]) return false;
    const sb = baseStageName(d.stage);
    return sb && (sb === target || target.startsWith(sb) || sb.startsWith(target));
  }).map((d) => {
    const def = catalog[d.type];
    const params = Object.assign({}, def.defaults);
    const raw = (d.params && typeof d.params === 'object') ? d.params : {};
    for (const k of Object.keys(raw)) {
      const v = raw[k];
      params[k] = Array.isArray(v) ? v.join(',') : (v == null ? '' : String(v));
    }
    let svg = '';
    try { svg = def.render(params, accent); } catch (e) { svg = ''; }
    if (!svg) return '';
    const cap = esc(d.caption || params.cap || def.name);
    return `<div class="diagram-wrap" contenteditable="false">${svg}<div class="diagram-caption">${cap}</div></div>`;
  }).join('');
  return html ? `<div class="stage-diagrams">${html}</div>` : '';
}

// ── Renderers ─────────────────────────────────────────────────────────────────
//
// All three formats render the SAME canonical data contract (see
// 05-system-prompts.js) extracted from the official CDC teaching-module
// sample lesson plans. Only the presentation differs:
//   modern   — sectioned layout, one mini-table per stage (2 activity
//              columns + an assessment-criteria row)
//   classic  — the official module replica: field lines + ONE progression
//              table [Stages | Teacher's Activities | Learners' Activities |
//              Assessment Criteria]
//   classic2 — per-stage tables with Teacher's Role / Learners' Role /
//              Assessment Criteria columns (Maths-module style naming)

// Canonical pre-table field lines (classic + classic2). Mirrors the
// official order: Topic → Sub-topic → General Competences → Specific
// Competence → Lesson Goal → Rationale → Prior Knowledge → References →
// Learning Environment → Materials → Expected Standard [→ Key Vocabulary].
function renderFieldLines(data, meta) {
  // Labels are literal CAPITALS (not CSS text-transform) so they survive the
  // Word export — exactly as the official module samples print them.
  const refs = asList(data.references);
  const refsHtml = refs.length > 1
    ? `<div class="field-line"><strong>REFERENCES:</strong></div>` +
      refs.map(r => `<div class="field-line" style="padding-left:18px">&bull; ${esc(r)}</div>`).join('')
    : `<div class="field-line"><strong>REFERENCES:</strong> ${esc(refs[0] || '')}</div>`;
  const mats = asList(data.materials);
  const matsHtml = mats.length > 1
    ? `<div class="field-line" style="margin-top:8px"><strong>TEACHING AND LEARNING MATERIALS/RESOURCES:</strong></div>` +
      mats.map(m => `<div class="field-line" style="padding-left:18px">&bull; ${esc(m)}</div>`).join('')
    : `<div class="field-line" style="margin-top:8px"><strong>TEACHING AND LEARNING MATERIALS/RESOURCES:</strong> ${esc(mats[0] || '')}</div>`;
  const vocab = meta.showVocabulary ? asList(data.keyVocabulary) : [];
  const vocabHtml = vocab.length
    ? `<div class="field-line" style="margin-top:8px"><strong>KEY VOCABULARY:</strong></div>` +
      vocab.map(v => `<div class="field-line" style="padding-left:18px">&bull; ${esc(v)}</div>`).join('')
    : '';
  return `
    <div class="field-line"><strong>TOPIC:</strong> ${esc(data.topic)}</div>
    <div class="field-line"><strong>SUB-TOPIC:</strong> ${esc(data.subtopic)}</div>
    <div class="field-line"><strong>GENERAL COMPETENCES:</strong> ${esc(joinList(data.generalCompetences, ', '))}</div>
    <div class="field-line"><strong>SPECIFIC COMPETENCE:</strong> ${esc(data.specificCompetence || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>LESSON GOAL:</strong> ${esc(data.lessonGoal || '')}</div>
    <div class="field-line"><strong>RATIONALE:</strong> ${esc(data.rationale || '')}</div>
    <div class="field-line"><strong>PRIOR KNOWLEDGE:</strong> ${esc(data.priorKnowledge || '')}</div>
    ${refsHtml}
    <div class="field-line" style="margin-top:8px"><strong>LEARNING ENVIRONMENT:</strong></div>
    <div class="field-line" style="padding-left:18px">I. <strong>Natural:</strong> ${esc(data.learningEnvironment?.natural || '')}</div>
    <div class="field-line" style="padding-left:18px">II. <strong>Artificial:</strong> ${esc(data.learningEnvironment?.artificial || '')}</div>
    <div class="field-line" style="padding-left:18px">III. <strong>Technological:</strong> ${esc(data.learningEnvironment?.technological || '')}</div>
    ${matsHtml}
    <div class="field-line"><strong>EXPECTED STANDARD:</strong> ${esc(data.expectedStandard || data.expectedStandards || '')}</div>
    ${vocabHtml}`;
}

// Official closing block: LESSON EVALUATION left blank for the teacher,
// with the guidance every module prints (successes / challenges / way
// forward), plus HEH-style Remedial Work + Extension Activity when the AI
// supplied them. Gated by the teacher's reflection toggle.
function renderLessonEvaluation(data, meta) {
  const extras = [];
  if (data.remedialWork) {
    extras.push(`<div class="field-line" style="margin-top:10px"><strong>REMEDIAL WORK:</strong> ${esc(data.remedialWork)}</div>`);
  }
  if (data.extensionActivity) {
    extras.push(`<div class="field-line"${data.remedialWork ? '' : ' style="margin-top:10px"'}><strong>EXTENSION ACTIVITY:</strong> ${esc(data.extensionActivity)}</div>`);
  }
  if (!meta.showReflection) return extras.join('');
  // Underscore runs (not CSS borders) so the blanks survive the Word export
  // (10-export.js → html-docx-js drops borders on plain divs). Runs are kept
  // short enough to never wrap (a wrapped run leaves an ugly dangling "__").
  const blank = (n) => `<div class="field-line">${'_'.repeat(n)}</div>`;
  const prompt = (label, hint) =>
    `<div class="field-line"><strong>${label}</strong> (${hint}): ${'_'.repeat(18)}</div>`;
  return `${extras.join('')}
    <div class="field-line" style="margin-top:14px"><strong>LESSON EVALUATION:</strong></div>
    ${prompt('Successes', 'competences achieved')}
    ${blank(58)}
    ${prompt('Challenges', 'competences not achieved and why')}
    ${blank(58)}
    ${prompt('Way forward', 'including remedial work if applicable')}
    ${blank(58)}`;
}

function renderModern(data, meta) {
  const list = (arr) => asList(arr).map(x => `<li>${esc(stripPrefix(x))}</li>`).join('');
  const stages = ensureStages(data.stages).map(s => `
    <div class="stage-block"><table class="stage-table m-stage-table">
      <tr><td colspan="3" class="stage-head">${esc(s.name)}${s.duration ? `<span class="duration">${esc(s.duration)}</span>` : ''}</td></tr>
      <tr><th class="col-head">TEACHER'S ACTIVITIES</th><th class="col-head">LEARNERS' ACTIVITIES</th><th class="col-head">ASSESSMENT CRITERIA</th></tr>
      <tr><td>${formatProse(s.teacher)}</td><td>${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td><td>${formatProse(s.assessment || '')}</td></tr>
    </table></div>`).join('');
  const vocab = meta.showVocabulary && asList(data.keyVocabulary).length
    ? `<h2 class="sec">Key Vocabulary</h2><ul>${list(data.keyVocabulary)}</ul>` : '';
  const support = (data.remedialWork || data.extensionActivity) ? `
    <h2 class="sec">Remedial Work &amp; Extension</h2>
    ${data.remedialWork ? `<p><strong>Remedial work:</strong> ${esc(data.remedialWork)}</p>` : ''}
    ${data.extensionActivity ? `<p><strong>Extension activity:</strong> ${esc(data.extensionActivity)}</p>` : ''}` : '';
  const evaluation = meta.showReflection ? `
    <h2 class="sec">Lesson Evaluation</h2>
    <div class="callout-line"><strong>Successes (competences achieved):</strong><span class="blank"></span></div>
    <div class="callout-line"><strong>Challenges (competences not achieved and why):</strong><span class="blank"></span></div>
    <div class="callout-line"><strong>Way forward (including remedial work if applicable):</strong><span class="blank"></span></div>` : '';

  return `<div class="plan-official">${renderHeader(meta)}${renderMeta(meta)}
    <h2 class="sec">General Competences</h2><ul>${list(data.generalCompetences)}</ul>
    <h2 class="sec">Specific Competence</h2><p>${esc(data.specificCompetence || '')}</p>
    <h2 class="sec">Lesson Goal</h2><p>${esc(data.lessonGoal || '')}</p>
    <h2 class="sec">Rationale</h2><p>${esc(data.rationale || '')}</p>
    <h2 class="sec">Prior Knowledge</h2><p>${esc(data.priorKnowledge || '')}</p>
    <h2 class="sec">References</h2><ul>${list(data.references)}</ul>
    <h2 class="sec">Learning Environment</h2>
    <p><strong>Natural:</strong> ${esc(data.learningEnvironment?.natural || '')}</p>
    <p><strong>Artificial:</strong> ${esc(data.learningEnvironment?.artificial || '')}</p>
    <p><strong>Technological:</strong> ${esc(data.learningEnvironment?.technological || '')}</p>
    <h2 class="sec">Teaching &amp; Learning Materials</h2><ul>${list(data.materials)}</ul>
    <h2 class="sec">Expected Standard</h2><p>${esc(data.expectedStandard || data.expectedStandards || '')}</p>
    ${vocab}
    <h2 class="sec">Lesson Progression</h2>${stages}
    ${support}
    ${evaluation}</div>`;
}

// Inline border styles (not just CSS classes) so the official black grid
// survives the html-docx-js Word export unchanged.
const OFFICIAL_TD = 'border:1px solid #000;padding:5px 7px;vertical-align:top;text-align:left';
const OFFICIAL_TH = OFFICIAL_TD + ';font-weight:700';

function renderClassic(data, meta) {
  const stagesHtml = ensureStages(data.stages).map(s => `<tr>
    <td class="stage" style="${OFFICIAL_TD}">${esc(s.name).replace(/\s*\/\s*/g, '<br>')}${s.duration ? `<br><span class="duration">(${esc(s.duration)})</span>` : ''}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.assessment || '')}</td></tr>`).join('');
  return `<div class="plan-official">${renderHeader(meta)}${renderOfficialHeader(meta)}
    ${renderFieldLines(data, meta)}
    <div class="progression-title">LESSON PROGRESSION</div>
    <table class="lp-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%">
      <thead><tr><th style="width:15%;${OFFICIAL_TH}">STAGES</th><th style="width:31%;${OFFICIAL_TH}">TEACHER'S ACTIVITIES</th><th style="width:30%;${OFFICIAL_TH}">LEARNERS' ACTIVITIES</th><th style="width:24%;${OFFICIAL_TH}">ASSESSMENT CRITERIA</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>
    ${renderLessonEvaluation(data, meta)}</div>`;
}

function renderClassic2(data, meta) {
  const stages = ensureStages(data.stages).map(s => `
    <div class="stage-block"><table class="stage-table c2-stage-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%">
      <tr><td colspan="3" class="stage-head" style="${OFFICIAL_TH}">${esc(s.name)}${s.duration ? `<span class="duration">${esc(s.duration)}</span>` : ''}</td></tr>
      <tr>
        <th class="col-head" style="width:33%;${OFFICIAL_TH}">TEACHER'S ROLE</th>
        <th class="col-head" style="width:33%;${OFFICIAL_TH}">LEARNERS' ROLE</th>
        <th class="col-head" style="width:34%;${OFFICIAL_TH}">ASSESSMENT CRITERIA</th>
      </tr>
      <tr>
        <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
        <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td>
        <td style="${OFFICIAL_TD}">${formatProse(s.assessment || '')}</td>
      </tr>
    </table></div>`).join('');
  return `<div class="plan-official">${renderHeader(meta)}${renderOfficialHeader(meta)}
    ${renderFieldLines(data, meta)}
    <div class="progression-title">LESSON PROGRESSION</div>${stages}
    ${renderLessonEvaluation(data, meta)}</div>`;
}

// ── OLD curriculum (2013) renderers ───────────────────────────────────────────
//
// Outcomes-based format from the official 2013 samples (Grade 4 template,
// Grade 4 I-Science, Grade 10 Computer Studies, Lesson Study Teaching
// Skills Book): header lines → RATIONALE → PRE-REQUISITE KNOWLEDGE →
// SPECIFIC OUTCOMES (LSBAT) → [Stage/Time | Content | Teacher's Activity |
// Pupils' Activity | Methods] with INTRODUCTION → DEVELOPMENT → CONCLUSION
// → HOMEWORK → PUPIL EVALUATION + TEACHER EVALUATION blanks.

const OLD_STAGES = ['INTRODUCTION', 'DEVELOPMENT', 'CONCLUSION'];
function ensureOldStages(stages) {
  const list = Array.isArray(stages) ? stages.filter(s => s && (s.name || s.teacher || s.pupils || s.content)) : [];
  if (list.length > 0) return list;
  return OLD_STAGES.map(name => ({name, duration: '', content: '', teacher: '', pupils: '', methods: ''}));
}

// Official header lines for the old format. TOPIC/SUB-TOPIC/T-L AIDS/
// REFERENCES live in the header block itself (unlike the new format).
function renderOldHeader(meta, data) {
  const pairs = [];
  pairs.push(['NAME OF TEACHER', esc(meta.teacher || '') + (meta.tsno ? ' (TS ' + esc(meta.tsno) + ')' : ''), 'wide']);
  pairs.push(['DATE', esc(meta.date || '')]);
  pairs.push(['TIME', esc(meta.time || '')]);
  pairs.push(['SUBJECT', esc(meta.subject || '')]);
  pairs.push(['DURATION', esc(meta.duration) + ' minutes']);
  pairs.push(['GRADE', esc(meta.klass || '')]);
  pairs.push(['TERM &amp; WEEK', esc(meta.termWeek || '')]);
  pairs.push(['MEDIUM OF INSTRUCTION', esc(meta.medium || 'English')]);
  pairs.push(['TOPIC', esc(data.topic || meta.topic || ''), 'wide']);
  pairs.push(['SUB-TOPIC', esc(data.subtopic || meta.subtopic || ''), 'wide']);
  if (meta.showEnrolment) pairs.push(['NO. OF PUPILS', 'Boys: ______ Girls: ______ Total: ______', 'wide']);
  if (meta.showAttendance) pairs.push(['ATTENDANCE', 'Boys: ______ Girls: ______ Total: ______', 'wide']);
  pairs.push(['T/L AIDS', esc(joinList(data.tlAids || data.materials, ', ')), 'wide']);
  pairs.push(['REFERENCES', esc(joinList(data.references, '; ')), 'wide']);
  if (meta.multiLesson) pairs.push(['LESSON', `${esc(meta.lessonsCurrent)} of ${esc(meta.lessonsTotal)}` + (meta.lessonFocus ? ' — ' + esc(meta.lessonFocus) : ''), 'wide']);
  const line = ([k, v, wide]) => `<div class="om-item${wide ? ' om-wide' : ''}"><strong>${k}:</strong> ${v}</div>`;
  return `<div class="official-meta${meta.compactMeta ? ' two-col' : ''}">${pairs.map(line).join('')}</div>`;
}

// RATIONALE → PRE-REQUISITE → SPECIFIC OUTCOMES (LSBAT) section lines.
function renderOldFieldLines(data) {
  const outcomes = asList(data.specificOutcomes);
  const outcomesHtml = outcomes.length
    ? `<div class="field-line" style="margin-top:8px"><strong>SPECIFIC OUTCOMES (LSBAT):</strong> By the end of this lesson, pupils should be able to:</div>` +
      outcomes.map((o, i) => `<div class="field-line" style="padding-left:18px">${romanNum(i + 1)}. ${esc(stripPrefix(o))}</div>`).join('')
    : '';
  return `
    <div class="field-line" style="margin-top:8px"><strong>RATIONALE:</strong> ${esc(data.rationale || '')}</div>
    <div class="field-line"><strong>PRE-REQUISITE KNOWLEDGE:</strong> ${esc(data.prerequisiteKnowledge || data.priorKnowledge || '')}</div>
    ${outcomesHtml}`;
}

function romanNum(n) {
  const map = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
  return `(${map[n - 1] || n})`;
}

// HOMEWORK + the official double evaluation blanks (PUPIL EVALUATION and
// TEACHER EVALUATION) — gated by the evaluation toggle like the new format.
function renderOldClosing(data, meta) {
  const parts = [];
  if (data.homework) {
    parts.push(`<div class="field-line" style="margin-top:10px"><strong>HOMEWORK / EXERCISE:</strong> ${esc(data.homework)}</div>`);
  }
  if (!meta.showReflection) return parts.join('');
  const blank = (n) => `<div class="field-line">${'_'.repeat(n)}</div>`;
  parts.push(`
    <div class="field-line" style="margin-top:14px"><strong>PUPIL EVALUATION:</strong></div>
    ${blank(58)}
    ${blank(58)}
    <div class="field-line" style="margin-top:10px"><strong>TEACHER EVALUATION:</strong></div>
    ${blank(58)}
    ${blank(58)}`);
  return parts.join('');
}

function renderOldClassic(data, meta) {
  const stagesHtml = ensureOldStages(data.stages).map(s => `<tr>
    <td class="stage" style="${OFFICIAL_TD}">${esc(s.name).replace(/\s*\/\s*/g, '<br>')}${s.duration ? `<br><span class="duration">(${esc(s.duration)})</span>` : ''}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.content || '')}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.methods || '')}</td></tr>`).join('');
  return `<div class="plan-official">${renderHeader(meta)}${renderOldHeader(meta, data)}
    ${renderOldFieldLines(data)}
    <table class="lp-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%;margin-top:10px">
      <thead><tr><th style="width:11%;${OFFICIAL_TH}">STAGE/TIME</th><th style="width:30%;${OFFICIAL_TH}">CONTENT</th><th style="width:22%;${OFFICIAL_TH}">TEACHER'S ACTIVITY</th><th style="width:22%;${OFFICIAL_TH}">PUPILS' ACTIVITY</th><th style="width:15%;${OFFICIAL_TH}">METHODS</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>
    ${renderOldClosing(data, meta)}</div>`;
}

// Classic 2 (old) — the simpler primary-template variant: ONE ruled table
// like the Classic format but WITHOUT the CONTENT column (matches the
// Grade 4 "STAGES/TIME | TEACHING ACTIVITIES | LEARNING ACTIVITIES"
// template, plus the METHODS column).
function renderOldClassic2(data, meta) {
  const stagesHtml = ensureOldStages(data.stages).map(s => `<tr>
    <td class="stage" style="${OFFICIAL_TD}">${esc(s.name).replace(/\s*\/\s*/g, '<br>')}${s.duration ? `<br><span class="duration">(${esc(s.duration)})</span>` : ''}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.methods || '')}</td></tr>`).join('');
  return `<div class="plan-official">${renderHeader(meta)}${renderOldHeader(meta, data)}
    ${renderOldFieldLines(data)}
    <table class="lp-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%;margin-top:10px">
      <thead><tr><th style="width:14%;${OFFICIAL_TH}">STAGE/TIME</th><th style="width:34%;${OFFICIAL_TH}">TEACHER'S ACTIVITY</th><th style="width:34%;${OFFICIAL_TH}">PUPILS' ACTIVITY</th><th style="width:18%;${OFFICIAL_TH}">METHODS</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>
    ${renderOldClosing(data, meta)}</div>`;
}

// Format 3 (old) — faithful replica of the simple primary template
// ("Lesson Plan 3.docx"): NAME/DATE, SUBJECT/DURATION, TOPIC/NO. OF
// PUPILS, SUB-TOPIC, T/L MATERIALS, REFERENCE, RATIONALE, OUTCOMES
// (LSBAT), PRE-REQUISITE, then the 3-column table [STAGES/TIME |
// TEACHING ACTIVITIES | LEARNING ACTIVITIES] and a single EVALUATION.
function renderOldModern(data, meta) {
  const outcomes = asList(data.specificOutcomes);
  const outcomesHtml = outcomes.length
    ? outcomes.map((o, i) => `<div class="field-line" style="padding-left:18px">${romanNum(i + 1)}. ${esc(stripPrefix(o))}</div>`).join('')
    : '';
  const headerPairs = [
    ['NAME', esc(meta.teacher || '') + (meta.tsno ? ' (TS ' + esc(meta.tsno) + ')' : '')],
    ['DATE', esc(meta.date || '')],
    ['SUBJECT', esc(meta.subject || '')],
    ['DURATION', esc(meta.duration) + ' minutes'],
    ['TOPIC', esc(data.topic || meta.topic || '')],
    ['MEDIUM OF INSTRUCTION', esc(meta.medium || 'English')],
    ['NO. OF PUPILS', 'Boys: ______ Girls: ______ Total: ______'],
    ['SUB-TOPIC', esc(data.subtopic || meta.subtopic || ''), 'wide'],
  ];
  if (meta.showAttendance) headerPairs.push(['ATTENDANCE', 'Boys: ______ Girls: ______ Total: ______', 'wide']);
  const line = ([k, v, wide]) => `<div class="om-item${wide ? ' om-wide' : ''}"><strong>${k}:</strong> ${v}</div>`;
  const stagesHtml = ensureOldStages(data.stages).map(s => `<tr>
    <td class="stage" style="${OFFICIAL_TD}">${esc(s.name).replace(/\s*\/\s*/g, '<br>')}${s.duration ? `<br><span class="duration">(${esc(s.duration)})</span>` : ''}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}${stageDiagramsHtml(s.name, data.diagrams)}</td></tr>`).join('');
  const blank = (n) => `<div class="field-line">${'_'.repeat(n)}</div>`;
  const evaluation = meta.showReflection ? `
    <div class="field-line" style="margin-top:14px"><strong>EVALUATION:</strong></div>
    ${blank(58)}
    ${blank(58)}
    ${blank(58)}` : '';
  return `<div class="plan-official">${renderHeader(meta)}
    <div class="official-meta${meta.compactMeta ? ' two-col' : ''}">${headerPairs.map(line).join('')}</div>
    <div class="field-line"><strong>T/L MATERIALS:</strong> ${esc(joinList(data.tlAids || data.materials, ', '))}</div>
    <div class="field-line"><strong>REFERENCE:</strong> ${esc(joinList(data.references, '; '))}</div>
    <div class="field-line" style="margin-top:8px"><strong>RATIONALE:</strong> ${esc(data.rationale || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>OUTCOMES:</strong> By the end of this lesson, LSBAT;</div>
    ${outcomesHtml}
    <div class="field-line" style="margin-top:8px"><strong>PRE-REQUISITE:</strong> ${esc(data.prerequisiteKnowledge || data.priorKnowledge || '')}</div>
    <table class="lp-table official-table" border="1" style="border-collapse:collapse;border:1px solid #000;width:100%;margin-top:10px">
      <thead><tr><th style="width:16%;${OFFICIAL_TH}">STAGES/TIME</th><th style="width:42%;${OFFICIAL_TH}">TEACHING ACTIVITIES</th><th style="width:42%;${OFFICIAL_TH}">LEARNING ACTIVITIES</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>
    ${data.homework ? `<div class="field-line" style="margin-top:10px"><strong>HOMEWORK:</strong> ${esc(data.homework)}</div>` : ''}
    ${evaluation}</div>`;
}

// ── Generate button ────────────────────────────────────────────────────────────

// Restore the generate button's label after a run. The planner owns the
// "Generate N Lesson Plans" text via #btn-generate-label, so we just hand
// control back and let it re-render on the next state change.
function __studioRestoreGenerateBtn() {
  const btn = $('#btn-generate');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/><path d="M9.6 5.6 8 8 5.6 6.4 4 9l2.4 1.6L5 13l3.4-1.4L10 14l1.6-3.4L15 12l-1.6-3.4L17 7l-3.4 1.4L12 5l-1.6 2.4z"/></svg><span id="btn-generate-label">Generate Lesson Plan</span>`;
  // Repaint the planner's label.
  const planner = window.__lpState;
  const label = document.getElementById('btn-generate-label');
  if (label && planner) {
    if (planner.generateOnlyIndex && planner.count > 1) label.textContent = `Generate Lesson ${planner.generateOnlyIndex} of ${planner.count}`;
    else if (planner.count > 1) label.textContent = `Generate ${planner.count} Lesson Plans`;
  }
}

// Render the out-of-syllabus error card. Pulled out of the loop so each
// failed lesson can show the same UI.
function __studioRenderOutOfSyllabusError(message) {
  $('#doc').innerHTML = `<div style="padding:60px 30px;text-align:center;font-family:var(--font-doc)">
    <div style="display:inline-block;padding:30px 36px;background:#fef2f2;border:2px solid #b8492a;border-radius:12px;max-width:560px;text-align:left">
      <div style="font:700 14px/1 var(--font-display);text-transform:uppercase;letter-spacing:.1em;color:#b8492a;margin-bottom:12px">Topic Out of Syllabus</div>
      <div style="font-size:14pt;color:#1c1612;line-height:1.5;margin-bottom:14px">${esc(message)}</div>
      <div style="font-size:11pt;color:#7a6d5d;font-style:italic">Pick one of the suggested topics, or refine your topic input on the left and try again.</div>
    </div>
  </div>`;
}

// Generate ONE lesson, render it, save it. Returns true on success, false on
// out-of-syllabus error (which short-circuits the rest of a multi-lesson
// run), throws on transport/system errors.
async function __studioGenerateOneLesson({ i, lessonNumber, totalLessons, lessonFocus, sysPrompt }) {
  const planContext = {
    grade: i.klass, subject: i.subject, term: i.term, week: i.week,
    topic: i.topic, subtopic: i.subtopic,
  };
  const data = await callClaude(sysPrompt, buildPrompt(i, lessonNumber, lessonFocus, totalLessons), planContext);
  if (data.error) {
    __studioRenderOutOfSyllabusError(data.error);
    toast('Topic does not match this grade');
    return false;
  }
  // For multi-lesson runs we tag the meta so the rendered header shows
  // "Lesson K of N" / "Lesson Focus: …" — even though i.lessonsCurrent
  // from gatherInput is always 1 (planner-owned).
  const renderMeta = Object.assign({}, i, {
    lessonsCurrent: lessonNumber,
    lessonFocus: lessonFocus || '',
  });
  // The old (2013) syllabus has its own outcomes-based renderers; the new
  // (2023) syllabus uses the official CDC module renderers.
  const isOld = syllabusVersion === 'old';
  const html = i.format === 'classic'
    ? (isOld ? renderOldClassic(data, renderMeta) : renderClassic(data, renderMeta))
    : (i.format === 'classic2'
      ? (isOld ? renderOldClassic2(data, renderMeta) : renderClassic2(data, renderMeta))
      : (isOld ? renderOldModern(data, renderMeta) : renderModern(data, renderMeta)));
  $('#doc').innerHTML = html;
  if (editing) setTimeout(enableAllTableResize, 50);

  // Collect this lesson's rendered HTML so a multi-lesson run can be exported
  // as ONE document (cover sheet + every lesson) — see 10-export.js. Each loop
  // iteration overwrites #doc, so without this the export would only ever see
  // the last lesson. Guarded so a stale bundle without the store never throws.
  if (window.__lpBatch && Array.isArray(window.__lpBatch.lessons)) {
    window.__lpBatch.lessons.push({
      lessonNumber,
      total: totalLessons,
      focus: lessonFocus || '',
      html,
    });
  }

  // Hand the planner the lesson number so it can return the matching
  // seriesId / planningMode / focus payload to attach to this doc.
  const lessonSeries = (typeof window.__lpResolveSeries === 'function')
    ? window.__lpResolveSeries(lessonNumber)
    : null;

  // Auto-save to the teacher's library. Awaited (not fire-and-forget) so a
  // rejected write surfaces instead of silently leaving the plan out of the
  // library while we still claim "generated and saved". A save failure must
  // not discard the already-rendered plan, so the lesson stays on screen.
  try {
    await saveToLibrary({
      type: 'plan',
      meta: {
        klass: i.klass, subject: i.subject, topic: i.topic, subtopic: i.subtopic,
        format: i.format, school: i.school, duration: i.duration,
        termWeek: i.termWeek, syllabusVersion,
        learningEnvironments: i.learningEnvironments,
        // Series metadata — read by the React-side saveToLibrary bridge to
        // populate inputs.lessonSeries on the aiGenerations doc.
        lessonSeries,
        // Backwards-compat flags so older readers that only know about the
        // single multi-lesson flag still surface "Lesson K of N".
        multiLesson: totalLessons > 1,
        lessonsTotal: totalLessons,
        lessonsCurrent: lessonNumber,
        lessonFocus: lessonFocus || '',
        progressNotes: '',
      },
      data: data,
      html: html,
    });
  } catch (err) {
    console.error('saveToLibrary failed', err);
    toast('Plan made, but saving to your library failed — try again');
  }
  return true;
}

// ── Staged progress tracker (bridge to React) ───────────────────────
// The Lesson Plan studio is plain DOM, but the rest of the app shows the
// React <AiGenerationProgress> tracker during AI generation. Rather than
// re-implement it in DOM strings (fragile, easy to miss), we bridge the
// generation lifecycle to the React overlay that LessonPlanStudio.jsx renders
// over the document pane via window.__studioSetGenerating. No-ops gracefully
// if the bridge isn't present.
const __studioProgress = {
  start(headingText) {
    if (typeof window.__studioSetGenerating === 'function') {
      window.__studioSetGenerating({
        running: true,
        title: headingText || 'Composing your lesson plan…',
      });
    }
  },
  stop() {
    if (typeof window.__studioSetGenerating === 'function') {
      window.__studioSetGenerating({ running: false });
    }
  },
};

async function __studioOnGenerateClick() {
  const i = gatherInput();
  if (!i.school) { toast('Please add a school name'); $('#f-school').focus(); return; }
  if (!i.topic && !i.subtopic) { toast('Add at least a topic or sub-topic'); $('#f-topic').focus(); return; }
  const btn = $('#btn-generate');

  // Fresh batch store for this run. Lessons are pushed in
  // __studioGenerateOneLesson; the export menu (10-export.js) offers a combined
  // "whole series" download when more than one lesson lands here. We snapshot
  // the shared header fields now so the cover sheet matches what was generated
  // even if the teacher edits the form afterwards.
  window.__lpBatch = {
    meta: {
      headerLine: i.headerLine, school: i.school, department: i.department,
      teacher: i.teacher, tsno: i.tsno, klass: i.klass, subject: i.subject,
      termWeek: i.termWeek, duration: i.duration, topic: i.topic,
      subtopic: i.subtopic, medium: i.medium, syllabusVersion,
    },
    lessons: [],
  };

  const total = Math.max(1, parseInt(i.planner.count, 10) || 1);
  // "Only this" overrides the loop — produce a single lesson at that index.
  const onlyIndex = (i.planner.generateOnlyIndex && i.planner.generateOnlyIndex >= 1 && i.planner.generateOnlyIndex <= total)
    ? i.planner.generateOnlyIndex
    : null;
  const indices = onlyIndex ? [onlyIndex] : Array.from({ length: total }, (_, k) => k + 1);

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>${total > 1 ? `Composing lesson plans…` : 'Composing your lesson plan…'}</span>`;
  }

  const sysPrompt = syllabusVersion === 'old'
    ? (i.format === 'classic' ? sysOldClassic : (i.format === 'classic2' ? sysOldClassic2 : sysOldModern))
    : (i.format === 'classic' ? sysClassic : (i.format === 'classic2' ? sysClassic2 : sysModern));
  let madeCount = 0;
  try {
    for (const lessonNumber of indices) {
      if (btn) btn.innerHTML = `<span>${total > 1 ? `Composing lesson ${madeCount + 1} of ${indices.length}…` : 'Composing your lesson plan…'}</span>`;
      // Show (or re-title) the React progress overlay for this lesson; it stays
      // up across a multi-lesson run and clears in the finally below.
      __studioProgress.start(total > 1 ? `Composing lesson ${madeCount + 1} of ${indices.length}…` : 'Composing your lesson plan…');
      const focus = (i.planner.foci && i.planner.foci[lessonNumber - 1]) || '';
      const ok = await __studioGenerateOneLesson({ i, lessonNumber, totalLessons: total, lessonFocus: focus, sysPrompt });
      if (!ok) break;        // Out-of-syllabus error — stop the series here.
      madeCount += 1;
    }
    if (madeCount > 0) {
      if (madeCount === 1 && total === 1) toast('Lesson plan generated and saved');
      else if (onlyIndex) toast(`Lesson ${onlyIndex} of ${total} generated and saved`);
      else toast(`${madeCount} of ${total} lesson plans generated and saved`);
      // Clear "only this" so the next click defaults back to the full series.
      if (typeof window.__lpResetGenerateOnly === 'function') window.__lpResetGenerateOnly();
      // Surface the lesson kit (Create worksheet / homework / notes for this
      // lesson). Hand React the CBC-normalised coords the companion studios
      // expect: classToCbcGrade turns "Grade 5" → "G5" and subjectToCbcSubject
      // turns the display subject → its snake_case slug, matching TEACHER_GRADES
      // + useCurriculumOptions so the deep-linked form pre-fills cleanly.
      if (typeof window.__studioOnGenerated === 'function') {
        const cbcGrade = (typeof classToCbcGrade === 'function') ? classToCbcGrade(i.klass) : i.klass;
        const cbcSubject = (typeof subjectToCbcSubject === 'function') ? subjectToCbcSubject(i.subject) : i.subject;
        window.__studioOnGenerated({
          grade: cbcGrade || '',
          subject: cbcSubject || '',
          topic: i.topic || '',
          subtopic: i.subtopic || '',
          term: i.term || '',
        });
      }
      $('#sidebar').classList.remove('open');
      $('#scrim').classList.remove('show');
      // On phones the form is now an in-flow panel above the preview, so
      // bring the freshly generated plan into view instead of leaving the
      // teacher staring at the form wondering if anything happened.
      if (window.matchMedia && window.matchMedia('(max-width:980px)').matches) {
        const dw = document.getElementById('doc-wrap');
        if (dw) setTimeout(() => dw.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      }
    }
  } catch (err) {
    console.error(err);
    const msg = (err && (err.message || err.code)) || '';
    toast(msg ? `Generation failed: ${msg}` : 'Generation failed — try again');
    // The overlay clears in the finally; the toast + any in-#doc error card
    // convey the failure.
  } finally {
    __studioProgress.stop();
    __studioRestoreGenerateBtn();
  }
}

// The real generation loop, exposed so the Review step (13-review.js) can fire
// it once the teacher confirms. Kept stable so 06 works standalone too.
window.__studioConfirmGenerate = __studioOnGenerateClick;

function __studioInitGenerate() {
  const btn = $('#btn-generate');
  if (!btn) return;
  // Generate now opens the Review & Generate confirmation first. When the
  // review module isn't loaded (older cached bundle) fall straight through to
  // a direct run so generation never breaks.
  btn.addEventListener('click', () => {
    if (typeof window.__studioOpenReview === 'function') window.__studioOpenReview();
    else __studioOnGenerateClick();
  });
}

window.__studioRebinders = window.__studioRebinders || [];
window.__studioRebinders.push(__studioInitGenerate);

// Test seam — expose the pure prompt/diagram helpers so the node regression
// test (scripts/test-lesson-studio-style.mjs) can exercise them without a
// browser. No production effect beyond attaching three function references.
if (typeof window !== 'undefined') {
  window.__studioBuildStyleBlock = buildStyleBlock;
  window.__studioBuildDiagramBlock = buildDiagramBlock;
  window.__studioStageDiagramsHtml = stageDiagramsHtml;
}
