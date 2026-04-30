async function callClaude(systemPrompt, userPrompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4500, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] })
  });
  if (!resp.ok) throw new Error('API call failed: ' + resp.status);
  const data = await resp.json();
  let text = data.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  return JSON.parse(text);
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
  // Surface the official grade-specific topics/subtopics to the AI for accuracy
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
