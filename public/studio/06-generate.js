// callClaude — routes through the Firebase Cloud Function in production.
// Falls back to direct API if window.__studioCallClaude is not set (never in prod).
async function callClaude(systemPrompt, userPrompt) {
  if (typeof window.__studioCallClaude === 'function') {
    return window.__studioCallClaude(systemPrompt, userPrompt);
  }
  throw new Error('Studio bridge not initialised — __studioCallClaude is missing.');
}

function gatherInput() {
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
    date: $('#f-date').value.trim(),
    time: $('#f-time').value.trim(),
    topic: $('#f-topic').value.trim(),
    subtopic: $('#f-subtopic').value.trim(),
    teacher: $('#f-teacher').value.trim(),
    tsno: $('#f-tsno').value.trim(),
    showEnrolment: $('#t-enrolment').dataset.on === 'true',
    showAttendance: $('#t-attendance').dataset.on === 'true',
    showReflection: $('#t-reflection').dataset.on === 'true',
    compactMeta: $('#t-compact').dataset.on === 'true',
    format: formatChoice
  };
}

function buildPrompt(i) {
  const level = activeGradeLevel()[i.klass];
  const topics = getTopicsForClass(level, i.subject, i.klass);
  const versionLabel = syllabusVersion === 'old' ? '2013 Old CDC Syllabus' : '2023 Zambia ECF';
  let syllabusContext = '';
  if (Object.keys(topics).length) {
    const topicList = Object.entries(topics)
      .map(([t, subs]) => `  • ${t}: ${(subs || []).slice(0, 6).join('; ')}`)
      .join('\n');
    syllabusContext = `\n\nOFFICIAL ${i.klass} ${i.subject} SYLLABUS TOPICS (${versionLabel}):\n${topicList}\n`;
  }
  return `Generate a Zambian CBC lesson plan with these inputs:
- Class: ${i.klass}
- Subject: ${i.subject}
- Syllabus version: ${versionLabel}
- Topic: ${i.topic || 'choose an appropriate topic from the official syllabus below'}
- Sub-topic: ${i.subtopic || 'choose an appropriate sub-topic'}
- Duration: ${i.duration} minutes
- Term & Week: ${i.termWeek || 'unspecified'}
${syllabusContext}
IMPORTANT: The topic and sub-topic MUST fit within the ${i.klass} syllabus scope shown above (${versionLabel}). If the user-supplied topic doesn't match this grade level, return {"error": "explanation"} instead.

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

$('#btn-generate').addEventListener('click', async () => {
  const i = gatherInput();
  if (!i.school) { toast('Please add a school name'); $('#f-school').focus(); return; }
  if (!i.topic && !i.subtopic) { toast('Add at least a topic or sub-topic'); $('#f-topic').focus(); return; }
  const loader = $('#loader');
  if (loader) loader.classList.add('show');
  $('#btn-generate').disabled = true;
  $('#btn-generate').innerHTML = '<span>Composing your lesson plan…</span>';
  try {
    const sysPrompt = i.format === 'classic' ? sysClassic : (i.format === 'classic2' ? sysClassic2 : sysModern);
    const data = await callClaude(sysPrompt, buildPrompt(i));
    if (data.error) {
      $('#doc').innerHTML = `<div style="padding:60px 30px;text-align:center;font-family:var(--font-doc)">
        <div style="display:inline-block;padding:30px 36px;background:#fef2f2;border:2px solid #b8492a;border-radius:12px;max-width:560px;text-align:left">
          <div style="font:700 14px/1 var(--font-display);text-transform:uppercase;letter-spacing:.1em;color:#b8492a;margin-bottom:12px">Topic Out of Syllabus</div>
          <div style="font-size:14pt;color:#1c1612;line-height:1.5;margin-bottom:14px">${esc(data.error)}</div>
          <div style="font-size:11pt;color:#7a6d5d;font-style:italic">Pick one of the suggested topics, or refine your topic input on the left and try again.</div>
        </div>
      </div>`;
      toast('Topic does not match this grade');
    } else {
      const html = i.format === 'classic' ? renderClassic(data, i) : (i.format === 'classic2' ? renderClassic2(data, i) : renderModern(data, i));
      $('#doc').innerHTML = html;
      if (editing) setTimeout(enableAllTableResize, 50);
      saveToLibrary({
        type: 'plan',
        meta: { klass: i.klass, subject: i.subject, topic: i.topic, subtopic: i.subtopic, format: i.format, school: i.school, duration: i.duration, termWeek: i.termWeek, syllabusVersion },
        data: data,
        html: html
      });
      toast('Lesson plan generated and saved');
      $('#sidebar').classList.remove('open');
      $('#scrim').classList.remove('show');
    }
  } catch (err) {
    console.error(err); toast('Generation failed — try again');
  } finally {
    if (loader) loader.classList.remove('show');
    $('#btn-generate').disabled = false;
    $('#btn-generate').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/><path d="M9.6 5.6 8 8 5.6 6.4 4 9l2.4 1.6L5 13l3.4-1.4L10 14l1.6-3.4L15 12l-1.6-3.4L17 7l-3.4 1.4L12 5l-1.6 2.4z"/></svg> Generate Lesson Plan`;
  }
});
