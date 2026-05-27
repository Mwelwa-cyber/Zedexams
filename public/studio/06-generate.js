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
  // this grade so Claude recognises topics the teacher picks from the new
  // dropdown — otherwise it might flag them as "out of syllabus" when the
  // legacy subject map happens not to list them.
  const curated = (window.curriculumTopics && window.curriculumTopics[i.klass]) || {};
  // CRITICAL: the topic + subtopic dropdowns are populated by
  // 04-syllabus-router.js's `currentTopicsMap`, which prefers the dynamic
  // CBC KB (the same source CbcKbAdmin maintains). The legacy hardcoded
  // syllabus files lag behind the KB for several subjects — e.g. the new
  // 2023 Home Economics syllabus has topics like "Food Safety" that the
  // legacy file knows nothing about. Building the prompt off the legacy
  // file then made Claude reject the teacher's pick as "out of syllabus".
  // Always start from the dynamic map the teacher actually saw, then merge
  // legacy / curated as a backup so we don't lose subjects the dynamic KB
  // hasn't covered yet.
  const dynamic = (typeof window !== 'undefined' && window.currentTopicsMap && typeof window.currentTopicsMap === 'object')
    ? window.currentTopicsMap
    : (typeof currentTopicsMap !== 'undefined' ? currentTopicsMap : {});
  const topics = Object.assign({}, legacyTopics, curated, dynamic);
  const versionLabel = syllabusVersion === 'old' ? '2013 Old CDC Syllabus' : '2023 Zambia ECF';
  // Authoritative-list flag: when the dynamic KB returned data for this
  // (grade, subject) the syllabus block IS the source of truth, and Claude
  // should not second-guess it with its own training-data view of the
  // Zambian syllabus.
  const dynamicHasData = dynamic && Object.keys(dynamic).length > 0;
  let syllabusContext = '';
  if (Object.keys(topics).length) {
    const topicList = Object.entries(topics)
      .map(([t, subs]) => `  • ${t}: ${(subs || []).slice(0, 8).join('; ')}`)
      .join('\n');
    const header = dynamicHasData
      ? `\n\nAUTHORITATIVE ${i.klass} ${i.subject} SYLLABUS TOPICS (${versionLabel}) — sourced directly from the Ministry-aligned CBC knowledge base. Treat this list as the source of truth even if it differs from your training-data view.`
      : `\n\nOFFICIAL ${i.klass} ${i.subject} SYLLABUS TOPICS (${versionLabel}):`;
    syllabusContext = `${header}\n${topicList}\n`;
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
  // Tighter validation rule: if the teacher's pick is present in the topic
  // list shown above, accept it unconditionally. Reject only when the topic
  // is genuinely absent AND looks off-grade (e.g. "Quantum Mechanics" for
  // Grade 4). Even then, when dynamicHasData is true, we prefer to proceed
  // because the dynamic KB is the source of truth — Claude doesn't get to
  // overrule the Ministry's syllabus.
  const validationRule = dynamicHasData
    ? `IMPORTANT: The topic list above is the AUTHORITATIVE syllabus for ${i.klass} ${i.subject}. The user's topic "${i.topic}" was picked directly from that list — proceed with generation. Do NOT return an "out of syllabus" error.`
    : `IMPORTANT: The topic and sub-topic should fit within the ${i.klass} ${i.subject} syllabus shown above. If the topic appears in the list — even loosely — proceed with generation. Only return {"error": "explanation"} when the topic is clearly from a different grade or subject (e.g. "Quantum Mechanics" for Grade 4).`;
  return `Generate a Zambian CBC lesson plan with these inputs:
- Class: ${i.klass}
- Subject: ${i.subject}
- Syllabus version: ${versionLabel}
- Topic: ${i.topic || 'choose an appropriate topic from the official syllabus below'}
- Sub-topic: ${i.subtopic || 'choose an appropriate sub-topic'}
- Duration: ${i.duration} minutes
- Term & Week: ${i.termWeek || 'unspecified'}${envLine}${seqLine}
${syllabusContext}
${validationRule}

Return JSON only.`;
}

function renderHeader(meta) {
  let h = '<div class="doc-head">';
  if (meta.headerLine) h += `<div class="header-line">${esc(meta.headerLine)}</div>`;
  h += `<div class="school">${esc(meta.school || 'School Name')}</div>`;
  if (meta.department) h += `<div class="department">${esc(meta.department)}</div>`;
  h += `<div class="lp-title">Lesson Plan</div></div>`;
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
  if (meta.showEnrolment) rows.push(['Enrolment', 'Boys: _____ &nbsp;&nbsp; Girls: _____']);
  if (meta.showAttendance) rows.push(['Attendance', 'Boys: _____ &nbsp;&nbsp; Girls: _____']);
  if (meta.learningEnvironments && meta.learningEnvironments.length) rows.push(['Learning Environment', esc(meta.learningEnvironments.join(', '))]);
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
  if (meta.showEnrolment) items.push(['Enrolment', 'B: ___ G: ___']);
  if (meta.showAttendance) items.push(['Attendance', 'B: ___ G: ___']);
  if (meta.learningEnvironments && meta.learningEnvironments.length) items.push(['Learning Environment', esc(meta.learningEnvironments.join(', '))]);
  if (meta.multiLesson) {
    items.push(['Lesson Sequence', `Lesson ${esc(meta.lessonsCurrent)} of ${esc(meta.lessonsTotal)}`]);
    if (meta.lessonFocus) items.push(['Lesson Focus', esc(meta.lessonFocus)]);
  }
  return `<div class="meta-compact">${items.map(([k,v]) => `<div class="item"><span class="lbl">${k}:</span><span class="val">${v}</span></div>`).join('')}</div>`;
}

function renderMeta(meta) {
  return meta.compactMeta ? renderMetaCompact(meta) : renderMetaTable(meta);
}

function stripPrefix(s) { return String(s || '').replace(/^\s*\d+[.)]\s*/, ''); }

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

function renderModern(data, meta) {
  const list = (arr) => (arr || []).map(x => `<li>${esc(x)}</li>`).join('');
  const outcomes = (data.specificOutcomes || []).map(o => `<li>${esc(stripPrefix(o))}</li>`).join('');
  const stages = (data.stages || []).map(s => `
    <div class="stage-block"><table class="stage-table">
      <tr><td colspan="2" class="stage-head">${esc(s.name)}${s.duration ? `<span class="duration">${esc(s.duration)}</span>` : ''}</td></tr>
      <tr><th class="col-head">Teacher's Activities</th><th class="col-head">Pupils' Activities</th></tr>
      <tr><td>${formatProse(s.teacher)}</td><td>${formatProse(s.pupils)}</td></tr>
    </table></div>`).join('');
  const reflection = meta.showReflection ? `
    <h2 class="sec">Teacher's Reflection</h2>
    <div class="callout-line"><strong>What went well?</strong><span class="blank"></span></div>
    <div class="callout-line"><strong>What to improve next time?</strong><span class="blank"></span></div>
    <div class="callout-line"><strong>Pupils who need follow-up:</strong><span class="blank"></span></div>` : '';

  return `${renderHeader(meta)}${renderMeta(meta)}
    <h2 class="sec">Specific Outcomes</h2><ol class="outcomes-list">${outcomes}</ol>
    <h2 class="sec">Key Competencies</h2><ul>${list(data.keyCompetencies)}</ul>
    <h2 class="sec">Values</h2><ul>${list(data.values)}</ul>
    <h2 class="sec">Prerequisite Knowledge</h2><ul>${list(data.prerequisiteKnowledge)}</ul>
    <h2 class="sec">Teaching &amp; Learning Materials</h2><ul>${list(data.materials)}</ul>
    <h2 class="sec">References</h2><ul>${list(data.references)}</ul>
    <h2 class="sec">Lesson Development</h2>${stages}
    <h2 class="sec">Assessment</h2>
    <p><strong>Formative:</strong></p><ul>${list(data.assessment?.formative)}</ul>
    <p><strong>Summative:</strong> ${esc(data.assessment?.summative || '')}</p>
    <p><strong>Success criteria:</strong> ${esc(data.assessment?.successCriteria || '')}</p>
    <h2 class="sec">Differentiation</h2>
    <p><strong>For struggling pupils:</strong></p><ul>${list(data.differentiation?.struggling)}</ul>
    <p><strong>For advanced pupils:</strong></p><ul>${list(data.differentiation?.advanced)}</ul>
    <h2 class="sec">Homework</h2><p>${formatProse(data.homework || '')}</p>
    ${reflection}`;
}

function renderClassic(data, meta) {
  const stagesHtml = (data.stages || []).map(s => `<tr>
    <td class="stage">${esc(s.name).replace(/\s*\/\s*/g, '<br>')}</td>
    <td>${formatProse(s.teacher)}</td>
    <td>${formatProse(s.pupils)}</td>
    <td>${formatProse(s.assessment || '')}</td></tr>`).join('');
  return `${renderHeader(meta)}${renderMeta(meta)}
    <div class="field-line"><strong>Topic:</strong> ${esc(data.topic)}</div>
    <div class="field-line"><strong>Sub-topic:</strong> ${esc(data.subtopic)}</div>
    <div class="field-line"><strong>General Competences:</strong> ${esc(data.generalCompetences || '')}</div>
    <div class="field-line"><strong>Specific Competence:</strong> ${esc(data.specificCompetence || '')}</div>
    <div class="field-line"><strong>Major Learning Point / Activity:</strong> ${esc(data.majorLearningPoint || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>Lesson Goal:</strong> ${esc(data.lessonGoal || '')}</div>
    <div class="field-line"><strong>Rationale:</strong> ${esc(data.rationale || '')}</div>
    <div class="field-line"><strong>Prior Knowledge:</strong> ${esc(data.priorKnowledge || '')}</div>
    <div class="field-line"><strong>References:</strong> ${esc(data.references || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>Learning Environment:</strong></div>
    <div class="field-line" style="padding-left:18px">I. <strong>Natural:</strong> ${esc(data.learningEnvironment?.natural || '')}</div>
    <div class="field-line" style="padding-left:18px">II. <strong>Artificial:</strong> ${esc(data.learningEnvironment?.artificial || '')}</div>
    <div class="field-line" style="padding-left:18px">III. <strong>Technological:</strong> ${esc(data.learningEnvironment?.technological || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>Teaching &amp; Learning Materials:</strong> ${esc(data.materials || '')}</div>
    <div class="field-line"><strong>Expected Standards:</strong> ${esc(data.expectedStandards || '')}</div>
    <div class="progression-title">Lesson Progression</div>
    <table class="lp-table">
      <thead><tr><th style="width:15%">Stages</th><th style="width:31%">Teacher's Role</th><th style="width:30%">Learners' Role</th><th style="width:24%">Assessment Criteria</th></tr></thead>
      <tbody>${stagesHtml}</tbody>
    </table>
    <div class="field-line" style="margin-top:14px"><strong>Teacher's Evaluation:</strong> ____________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>
    <div class="field-line" style="margin-top:10px"><strong>Learners' Evaluation:</strong> ____________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>`;
}

function renderClassic2(data, meta) {
  const stages = (data.stages || []).map(s => `
    <div class="stage-block"><table class="stage-table c2-stage-table">
      <tr><td colspan="3" class="stage-head">${esc(s.name)}${s.duration ? `<span class="duration">${esc(s.duration)}</span>` : ''}</td></tr>
      <tr>
        <th class="col-head">Teacher's Role</th>
        <th class="col-head">Learners' Role</th>
        <th class="col-head">Assessment Criteria</th>
      </tr>
      <tr>
        <td>${formatProse(s.teacher)}</td>
        <td>${formatProse(s.pupils)}</td>
        <td>${formatProse(s.assessment || '')}</td>
      </tr>
    </table></div>`).join('');
  return `${renderHeader(meta)}${renderMeta(meta)}
    <div class="field-line"><strong>Topic:</strong> ${esc(data.topic)}</div>
    <div class="field-line"><strong>Sub-topic:</strong> ${esc(data.subtopic)}</div>
    <div class="field-line"><strong>General Competences:</strong> ${esc(data.generalCompetences || '')}</div>
    <div class="field-line"><strong>Specific Competence:</strong> ${esc(data.specificCompetence || '')}</div>
    <div class="field-line"><strong>Major Learning Point / Activity:</strong> ${esc(data.majorLearningPoint || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>Lesson Goal:</strong> ${esc(data.lessonGoal || '')}</div>
    <div class="field-line"><strong>Rationale:</strong> ${esc(data.rationale || '')}</div>
    <div class="field-line"><strong>Prior Knowledge:</strong> ${esc(data.priorKnowledge || '')}</div>
    <div class="field-line"><strong>References:</strong> ${esc(data.references || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>Learning Environment:</strong></div>
    <div class="field-line" style="padding-left:18px">I. <strong>Natural:</strong> ${esc(data.learningEnvironment?.natural || '')}</div>
    <div class="field-line" style="padding-left:18px">II. <strong>Artificial:</strong> ${esc(data.learningEnvironment?.artificial || '')}</div>
    <div class="field-line" style="padding-left:18px">III. <strong>Technological:</strong> ${esc(data.learningEnvironment?.technological || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>Teaching &amp; Learning Materials:</strong> ${esc(data.materials || '')}</div>
    <div class="field-line"><strong>Expected Standards:</strong> ${esc(data.expectedStandards || '')}</div>
    <h2 class="sec">Lesson Development</h2>${stages}
    <div class="field-line" style="margin-top:14px"><strong>Teacher's Evaluation:</strong> ____________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>
    <div class="field-line" style="margin-top:10px"><strong>Learners' Evaluation:</strong> ____________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>`;
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
  const html = i.format === 'classic' ? renderClassic(data, renderMeta)
    : (i.format === 'classic2' ? renderClassic2(data, renderMeta) : renderModern(data, renderMeta));
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

  const sysPrompt = i.format === 'classic' ? sysClassic : (i.format === 'classic2' ? sysClassic2 : sysModern);
  let madeCount = 0;
  try {
    for (const lessonNumber of indices) {
      if (btn) btn.innerHTML = `<span>${total > 1 ? `Composing lesson ${madeCount + 1} of ${indices.length}…` : 'Composing your lesson plan…'}</span>`;
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
  } finally {
    if (loader) loader.classList.remove('show');
    __studioRestoreGenerateBtn();
  }
}

function __studioInitGenerate() {
  const btn = $('#btn-generate');
  if (btn) btn.addEventListener('click', __studioOnGenerateClick);
}

window.__studioRebinders = window.__studioRebinders || [];
window.__studioRebinders.push(__studioInitGenerate);
