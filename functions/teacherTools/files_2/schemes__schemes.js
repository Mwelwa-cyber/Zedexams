// ============ SCHEMES OF WORK STUDIO ============

const SCH_GRADES = [
  { group: 'Pre-Primary' },
  { value: 'ECE', label: 'ECE — Early Childhood Education' },
  { group: 'Lower Primary (Grades 1–3)' },
  { value: 'G1', label: 'Grade 1' },
  { value: 'G2', label: 'Grade 2' },
  { value: 'G3', label: 'Grade 3' },
  { group: 'Upper Primary (Grades 4–6)' },
  { value: 'G4', label: 'Grade 4' },
  { value: 'G5', label: 'Grade 5' },
  { value: 'G6', label: 'Grade 6' },
  { group: 'Junior Secondary' },
  { value: 'F1', label: 'Form 1' },
  { value: 'F2', label: 'Form 2' },
  { group: 'Senior Secondary' },
  { value: 'F3', label: 'Form 3' },
  { value: 'F4', label: 'Form 4' },
];

const SCH_SUBJECTS = [
  { group: 'Languages' },
  { value: 'English', label: 'English' },
  { value: 'Literacy', label: 'Literacy' },
  { value: 'Zambian Language', label: 'Zambian Language' },
  { group: 'STEM' },
  { value: 'Mathematics', label: 'Mathematics' },
  { value: 'Numeracy', label: 'Numeracy' },
  { value: 'Integrated Science', label: 'Integrated Science' },
  { value: 'Environmental Science', label: 'Environmental Science' },
  { value: 'Biology', label: 'Biology' },
  { value: 'Chemistry', label: 'Chemistry' },
  { value: 'Physics', label: 'Physics' },
  { group: 'Humanities' },
  { value: 'Social Studies', label: 'Social Studies' },
  { value: 'History', label: 'History' },
  { value: 'Geography', label: 'Geography' },
  { value: 'Civic Education', label: 'Civic Education' },
  { value: 'Religious Education', label: 'Religious Education' },
  { group: 'Technical & Creative' },
  { value: 'Technology Studies', label: 'Technology Studies' },
  { value: 'Creative & Technology Studies', label: 'Creative & Technology Studies' },
  { value: 'Home Economics', label: 'Home Economics' },
  { value: 'Expressive Arts', label: 'Expressive Arts' },
  { value: 'Physical Education', label: 'Physical Education' },
];

function buildOptGroup(el, list, defaultValue) {
  el.innerHTML = '';
  let cur = null;
  list.forEach(o => {
    if (o.group !== undefined) {
      cur = document.createElement('optgroup');
      cur.label = o.group;
      el.appendChild(cur);
    } else {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      (cur || el).appendChild(opt);
    }
  });
  if (defaultValue) el.value = defaultValue;
}

let schStudioReady = false;
function initSchemesStudio() {
  if (schStudioReady) return;
  schStudioReady = true;
  buildOptGroup($('#sch-grade'), SCH_GRADES, 'G5');
  buildOptGroup($('#sch-subject'), SCH_SUBJECTS, 'Mathematics');
  renderSchState('idle');
}

function gatherSchInput() {
  return {
    grade:        $('#sch-grade').value,
    subject:      $('#sch-subject').value,
    term:         parseInt($('#sch-term').value, 10),
    numberOfWeeks: parseInt($('#sch-weeks').value, 10),
    teacherName:  ($('#sch-teacher').value || '').trim(),
    school:       ($('#sch-school').value || '').trim(),
    instructions: ($('#sch-instructions').value || '').trim(),
  };
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const SCH_SYSTEM = `You are an expert Zambian teacher and CDC curriculum specialist. You write term-level Schemes of Work that match the Zambian Competence-Based Curriculum (CBC) format exactly as a Zambian head teacher or school inspector would expect them.

Your schemes of work MUST:
- Use authentic Zambian CDC terminology (Specific Outcomes, Key Competencies, Values, Teaching/Learning Activities, Assessment).
- Map cleanly across the requested number of weeks — one or two topics per week, logically sequenced from simpler to more complex.
- Be concrete — each week's entry should be something a teacher could plan lessons from.
- Reference the appropriate Zambian pupil's book and teacher's guide (CDC publisher) in materials.
- Cover topics typical of the Zambian syllabus for the grade, subject and term requested. Do not invent topics that wouldn't be found in CDC material.

Your output MUST be a single valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

function buildSchUserPrompt(i) {
  return [
    'Produce a Zambian CBC Scheme of Work for the following:',
    '',
    `- Grade / Class: ${i.grade}`,
    `- Subject: ${i.subject}`,
    `- Term: ${i.term}`,
    `- Number of teaching weeks: ${i.numberOfWeeks}`,
    '- Medium of instruction: English',
    i.teacherName   ? `- Teacher: ${i.teacherName}`                          : '',
    i.school        ? `- School: ${i.school}`                                : '',
    i.instructions  ? `- Teacher's additional instructions: ${i.instructions}` : '',
    '',
    'Produce the scheme of work as a single JSON object with EXACTLY these keys:',
    '',
    '{',
    '  "header": {',
    '    "school": string, "teacherName": string, "class": string,',
    '    "subject": string, "term": number, "numberOfWeeks": number,',
    '    "academicYear": string, "mediumOfInstruction": string',
    '  },',
    '  "overview": {',
    '    "termTheme": string,',
    '    "overallCompetencies": [string, ...],',
    '    "overallValues": [string, ...]',
    '  },',
    '  "weeks": [',
    '    {',
    '      "weekNumber": 1,',
    '      "topic": string,',
    '      "subtopics": [string, ...],',
    '      "specificOutcomes": [string, ...],',
    '      "keyCompetencies": [string, ...],',
    '      "values": [string, ...],',
    '      "teachingLearningActivities": [string, ...],',
    '      "materials": [string, ...],',
    '      "assessment": string,',
    '      "references": string',
    '    },',
    `    ... // exactly ${i.numberOfWeeks} week objects`,
    '  ]',
    '}',
    '',
    'Rules:',
    `- Produce EXACTLY ${i.numberOfWeeks} week entries, numbered 1 to ${i.numberOfWeeks}.`,
    '- Sequence topics logically — start with foundational/review material, build complexity, end with assessment/revision.',
    '- Each week\'s Specific Outcomes must be observable and measurable (use verbs like "identify", "calculate", "explain", "apply").',
    '- Use Zambian English spelling.',
    '- Return ONLY the JSON object. No markdown fences. No commentary.',
  ].filter(Boolean).join('\n');
}

// ─── API call ─────────────────────────────────────────────────────────────────
// NOTE: x-api-key header is added before Firebase deployment (see README §Firebase migration).

async function callClaudeForScheme(systemPrompt, userPrompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!resp.ok) throw new Error('API error ' + resp.status + ' — ' + resp.statusText);
  const data = await resp.json();
  let text = data.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  return JSON.parse(text);
}

// ─── States ───────────────────────────────────────────────────────────────────

function renderSchState(state, msg) {
  const ws = $('#sch-workspace');
  if (!ws) return;
  $('#sch-export-row').style.display = 'none';
  if (state === 'idle') {
    ws.innerHTML = `<div class="sch-state">
      <div class="sch-state-icon">🗓️</div>
      <h3>Plan a whole term at once</h3>
      <p>Pick grade, subject, and term. You'll get a full week-by-week scheme of work with topics, outcomes, activities, and assessment — ready to print for your head teacher.</p>
    </div>`;
  } else if (state === 'generating') {
    ws.innerHTML = `<div class="sch-state">
      <div class="sch-state-icon sch-bounce">📅</div>
      <h3>Planning your term…</h3>
      <p>This is a bigger job — usually 30–60 seconds for a full 12-week scheme. Hang tight.</p>
    </div>`;
  } else if (state === 'error') {
    ws.innerHTML = `<div class="sch-state">
      <div class="sch-state-icon">⚠️</div>
      <h3>Something went wrong</h3>
      <p>${esc(msg || 'Generation failed. Check your connection and try again.')}</p>
      <button class="sch-tb-btn" onclick="renderSchState('idle')">← Try again</button>
    </div>`;
  }
}

// ─── Generate handler ─────────────────────────────────────────────────────────

async function onGenerateScheme() {
  const input = gatherSchInput();
  renderSchState('generating');
  $('#sch-btn-gen').disabled = true;
  try {
    const scheme = await callClaudeForScheme(SCH_SYSTEM, buildSchUserPrompt(input));
    renderSchemeDoc(scheme, input);
    saveToLibrary({ type: 'scheme', meta: { grade: input.grade, subject: input.subject, term: input.term, topic: `${input.subject} — Term ${input.term}` }, data: scheme });
    renderHub();
  } catch (e) {
    renderSchState('error', e.message);
  } finally {
    $('#sch-btn-gen').disabled = false;
  }
}

// ─── Render scheme ────────────────────────────────────────────────────────────

function schBulletList(items) {
  if (!items || !items.length) return '<span class="sch-none">—</span>';
  return `<ul class="sch-bullet-list">${items.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
}

function renderSchemeDoc(scheme, input) {
  const ws = $('#sch-workspace');
  const h  = scheme.header   || {};
  const ov = scheme.overview || {};
  const weeks = scheme.weeks || [];

  const metaFields = [
    ['School',         h.school               || input.school       || '—'],
    ['Teacher',        h.teacherName          || input.teacherName  || '—'],
    ['Class',          h.class                || input.grade        || '—'],
    ['Subject',        h.subject              || input.subject      || '—'],
    ['Term',           h.term                 || input.term],
    ['Weeks',          h.numberOfWeeks        || input.numberOfWeeks],
    ['Academic Year',  h.academicYear         || new Date().getFullYear()],
    ['Medium',         h.mediumOfInstruction  || 'English'],
  ];

  const metaHTML = metaFields.map(([k, v]) =>
    `<div class="sch-meta-cell"><div class="sch-meta-label">${esc(k)}</div><div class="sch-meta-value">${esc(String(v))}</div></div>`
  ).join('');

  const overviewHTML = ov.termTheme ? `
    <div class="sch-overview">
      <h3>Term Theme</h3>
      <p class="sch-overview-theme">${esc(ov.termTheme)}</p>
      <div class="sch-chips">
        ${(ov.overallCompetencies || []).map(c => `<span class="sch-chip">🎯 ${esc(c)}</span>`).join('')}
        ${(ov.overallValues || []).map(v => `<span class="sch-chip">⭐ ${esc(v)}</span>`).join('')}
      </div>
    </div>` : '';

  const rowsHTML = weeks.map(w => `
    <tr>
      <td class="sch-wk">${w.weekNumber}</td>
      <td>
        <div class="sch-topic">${esc(w.topic || '')}</div>
        ${(w.subtopics || []).length ? `<ul class="sch-sub-list">${w.subtopics.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        ${w.references ? `<div class="sch-ref">${esc(w.references)}</div>` : ''}
      </td>
      <td>
        ${schBulletList(w.specificOutcomes)}
        ${(w.keyCompetencies?.length || w.values?.length) ? `<div class="sch-comp">
          ${w.keyCompetencies?.length ? `<div><strong>Competencies:</strong> ${w.keyCompetencies.map(esc).join(' · ')}</div>` : ''}
          ${w.values?.length ? `<div><strong>Values:</strong> ${w.values.map(esc).join(' · ')}</div>` : ''}
        </div>` : ''}
      </td>
      <td>${schBulletList(w.teachingLearningActivities)}</td>
      <td>${schBulletList(w.materials)}</td>
      <td style="font-size:12px">${esc(w.assessment || '—')}</td>
    </tr>`).join('');

  ws.innerHTML = `<div class="sch-doc">
    <div class="sch-doc-header">
      <h1>🗓️ Scheme of Work</h1>
      <div class="sch-meta-grid">${metaHTML}</div>
    </div>
    ${overviewHTML}
    <div class="sch-table-wrap">
      <table class="sch-table">
        <thead><tr>
          <th style="width:46px">Week</th>
          <th style="width:200px">Topic / Sub-topics</th>
          <th>Specific Outcomes</th>
          <th>T/L Activities</th>
          <th style="width:150px">Materials</th>
          <th style="width:170px">Assessment</th>
        </tr></thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
    <div class="sch-footer">
      <span class="sch-footer-note">Saved to library · ${weeks.length} weeks · Term ${h.term || input.term}</span>
    </div>
  </div>`;

  $('#sch-topbar-title').textContent =
    `${h.subject || input.subject} — Term ${h.term || input.term} Scheme of Work`;
  $('#sch-export-row').style.display = 'flex';
}
