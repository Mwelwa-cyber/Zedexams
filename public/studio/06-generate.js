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
    teacher: $('#f-teacher').value.trim(),
    tsno: $('#f-tsno').value.trim(),
    showEnrolment: $('#t-enrolment').dataset.on === 'true',
    showAttendance: $('#t-attendance').dataset.on === 'true',
    showReflection: $('#t-reflection').dataset.on === 'true',
    // Optional toggle — older studio DOMs may not have the row yet.
    showVocabulary: (() => { const el = $('#t-vocab'); return !!el && el.dataset.on === 'true'; })(),
    compactMeta: $('#t-compact').dataset.on === 'true',
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
- Term & Week: ${i.termWeek || 'unspecified'}${envLine}${seqLine}
${syllabusContext}
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
  rows.push(['Medium of Instruction', 'English']);
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
      <tr><td>${formatProse(s.teacher)}</td><td>${formatProse(s.pupils)}</td><td>${formatProse(s.assessment || '')}</td></tr>
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
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}</td>
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
        <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}</td>
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
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}</td>
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
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}</td>
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
    ['NO. OF PUPILS', 'Boys: ______ Girls: ______ Total: ______'],
    ['SUB-TOPIC', esc(data.subtopic || meta.subtopic || ''), 'wide'],
  ];
  if (meta.showAttendance) headerPairs.push(['ATTENDANCE', 'Boys: ______ Girls: ______ Total: ______', 'wide']);
  const line = ([k, v, wide]) => `<div class="om-item${wide ? ' om-wide' : ''}"><strong>${k}:</strong> ${v}</div>`;
  const stagesHtml = ensureOldStages(data.stages).map(s => `<tr>
    <td class="stage" style="${OFFICIAL_TD}">${esc(s.name).replace(/\s*\/\s*/g, '<br>')}${s.duration ? `<br><span class="duration">(${esc(s.duration)})</span>` : ''}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.teacher)}</td>
    <td style="${OFFICIAL_TD}">${formatProse(s.pupils)}</td></tr>`).join('');
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

  // Hand the planner the lesson number so it can return the matching
  // seriesId / planningMode / focus payload to attach to this doc.
  const lessonSeries = (typeof window.__lpResolveSeries === 'function')
    ? window.__lpResolveSeries(lessonNumber)
    : null;

  saveToLibrary({
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
  return true;
}

// ── Staged progress tracker (vanilla port) ──────────────────────────
// The React studios share <AiGenerationProgress>; the Lesson Plan studio is
// plain DOM, so this mirrors the same staged look in the preview pane (#doc).
// Generation here is a single awaited callable (no live phases), so the stage
// walk is simulated on a time-weighted timeline — and, like the React version,
// the final stage never auto-completes: it waits for the real result to render
// over the top of the card.
const __LP_STAGES = [
  { id: 'reading',    label: 'Reading your request',    icon: '📖', estMs: 1500 },
  { id: 'curriculum', label: 'Checking the curriculum',  icon: '📚', estMs: 4000 },
  { id: 'content',    label: 'Composing the lesson plan', icon: '✍️', estMs: 14000 },
  { id: 'preview',    label: 'Preparing your preview',   icon: '📄', estMs: 2500 },
];

const __studioProgress = (() => {
  let timer = null;
  let startedAt = 0;
  let heading = '';
  let errored = false;

  function activeIndex(elapsedMs) {
    let acc = 0;
    for (let k = 0; k < __LP_STAGES.length; k++) {
      acc += __LP_STAGES[k].estMs;
      if (elapsedMs < acc) return k;
    }
    // While running, hold on the final stage rather than completing it.
    return __LP_STAGES.length - 1;
  }

  function percent(elapsedMs, idx) {
    const total = __LP_STAGES.reduce((s, st) => s + st.estMs, 0);
    let done = 0;
    for (let k = 0; k < idx; k++) done += __LP_STAGES[k].estMs;
    const partial = Math.min(__LP_STAGES[idx].estMs, Math.max(0, elapsedMs - done));
    return Math.min(96, Math.round(((done + partial) / total) * 100));
  }

  function render() {
    const host = $('#doc');
    if (!host) return;
    const elapsed = Date.now() - startedAt;
    const idx = activeIndex(elapsed);
    const pct = errored ? Math.round((idx / __LP_STAGES.length) * 100) : percent(elapsed, idx);
    const rows = __LP_STAGES.map((st, k) => {
      const state = k < idx ? 'done' : (k === idx ? (errored ? 'error' : 'active') : 'pending');
      const mark = state === 'done' ? '✓' : state === 'error' ? '!' : st.icon;
      return `<li class="lp-progress-step ${state}">
        <span class="lp-progress-dot">${mark}</span>
        <span class="lp-progress-label">${esc(st.label)}</span>
        ${state === 'active' ? '<span class="lp-progress-tag">Working</span>' : ''}
      </li>`;
    }).join('');
    host.innerHTML = `<div class="lp-progress" role="status" aria-live="polite">
      <div class="lp-progress-emoji">${errored ? '⚠️' : '✨'}</div>
      <div class="lp-progress-title">${esc(heading || 'Composing your lesson plan…')}</div>
      <div class="lp-progress-bar"><div class="lp-progress-bar-fill ${errored ? 'is-error' : ''}" style="width:${pct}%"></div></div>
      <ul class="lp-progress-steps">${rows}</ul>
    </div>`;
  }

  return {
    start(headingText) {
      heading = headingText || 'Composing your lesson plan…';
      startedAt = Date.now();
      errored = false;
      render();
      if (timer) clearInterval(timer);
      timer = setInterval(render, 250);
    },
    setLesson(headingText) {
      heading = headingText || heading;
      startedAt = Date.now();
      render();
    },
    error() {
      errored = true;
      if (timer) { clearInterval(timer); timer = null; }
      render();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
})();

async function __studioOnGenerateClick() {
  const i = gatherInput();
  if (!i.school) { toast('Please add a school name'); $('#f-school').focus(); return; }
  if (!i.topic && !i.subtopic) { toast('Add at least a topic or sub-topic'); $('#f-topic').focus(); return; }
  const loader = $('#loader');
  const btn = $('#btn-generate');

  const total = Math.max(1, parseInt(i.planner.count, 10) || 1);
  // "Only this" overrides the loop — produce a single lesson at that index.
  const onlyIndex = (i.planner.generateOnlyIndex && i.planner.generateOnlyIndex >= 1 && i.planner.generateOnlyIndex <= total)
    ? i.planner.generateOnlyIndex
    : null;
  const indices = onlyIndex ? [onlyIndex] : Array.from({ length: total }, (_, k) => k + 1);

  if (loader) loader.classList.add('show');
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
      // (Re)start the staged card for this lesson; it animates in #doc until the
      // awaited call renders the real lesson over the top.
      __studioProgress.start(total > 1 ? `Composing lesson ${madeCount + 1} of ${indices.length}…` : 'Composing your lesson plan…');
      const focus = (i.planner.foci && i.planner.foci[lessonNumber - 1]) || '';
      let ok;
      try {
        ok = await __studioGenerateOneLesson({ i, lessonNumber, totalLessons: total, lessonFocus: focus, sysPrompt });
      } finally {
        // Stop ticking immediately so it can't overwrite the rendered lesson or
        // the out-of-syllabus error card (both written into #doc by the call).
        __studioProgress.stop();
      }
      if (!ok) break;        // Out-of-syllabus error — stop the series here.
      madeCount += 1;
    }
    if (madeCount > 0) {
      if (madeCount === 1 && total === 1) toast('Lesson plan generated and saved');
      else if (onlyIndex) toast(`Lesson ${onlyIndex} of ${total} generated and saved`);
      else toast(`${madeCount} of ${total} lesson plans generated and saved`);
      // Clear "only this" so the next click defaults back to the full series.
      if (typeof window.__lpResetGenerateOnly === 'function') window.__lpResetGenerateOnly();
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
    // Surface the failure on the frozen progress card instead of leaving it
    // stuck mid-stage.
    __studioProgress.error();
  } finally {
    __studioProgress.stop();
    if (loader) loader.classList.remove('show');
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
