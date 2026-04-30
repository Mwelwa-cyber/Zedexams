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

// Shared Bernard Tito CBC preliminary section — used by both Classic CBC and Classic 2
function renderBTPreliminary(data) {
  const lc = data.lessonCompetencies || {};
  const idc = data.interdisciplinaryConnections || [];
  const idcRows = idc.length
    ? `<table class="idc-table">
        <thead><tr><th>Subject</th><th>Connection to this Lesson</th></tr></thead>
        <tbody>${idc.map(c => `<tr><td>${esc(c.subject || '')}</td><td>${esc(c.connection || '')}</td></tr>`).join('')}</tbody>
      </table>`
    : '';
  return `
    <div class="field-line"><strong>Topic:</strong> ${esc(data.topic)}</div>
    <div class="field-line"><strong>Sub-topic:</strong> ${esc(data.subtopic)}</div>
    <div class="field-line"><strong>General Competences:</strong> ${esc(data.generalCompetences || '')}</div>
    <div class="field-line"><strong>Specific Competence:</strong> ${esc(data.specificCompetence || '')}</div>
    ${(lc.competency1 || lc.competency2 || lc.competency3) ? `
    <div class="field-line" style="margin-top:8px"><strong>Lesson Competencies:</strong></div>
    <div class="field-line" style="padding-left:18px">1. ${esc(lc.competency1 || '')}</div>
    <div class="field-line" style="padding-left:18px">2. ${esc(lc.competency2 || '')}</div>
    <div class="field-line" style="padding-left:18px">3. ${esc(lc.competency3 || '')}</div>` : ''}
    <div class="field-line" style="margin-top:8px"><strong>Major Learning Point / Activity:</strong> ${esc(data.majorLearningPoint || '')}</div>
    <div class="field-line"><strong>Lesson Goal:</strong> ${esc(data.lessonGoal || '')}</div>
    <div class="field-line"><strong>Rationale:</strong> ${esc(data.rationale || '')}</div>
    <div class="field-line"><strong>Prior Knowledge:</strong> ${esc(data.priorKnowledge || '')}</div>
    ${data.methodology ? `<div class="field-line"><strong>Methodology &amp; Strategies:</strong> ${esc(data.methodology)}</div>` : ''}
    ${data.formativeAssessment ? `<div class="field-line"><strong>Formative Assessment:</strong> ${esc(data.formativeAssessment)}</div>` : ''}
    ${data.summativeAssessment ? `<div class="field-line"><strong>Summative Assessment:</strong> ${esc(data.summativeAssessment)}</div>` : ''}
    <div class="field-line"><strong>References:</strong> ${esc(data.references || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>Learning Environment:</strong></div>
    <div class="field-line" style="padding-left:18px">I. <strong>Natural:</strong> ${esc(data.learningEnvironment?.natural || '')}</div>
    <div class="field-line" style="padding-left:18px">II. <strong>Artificial:</strong> ${esc(data.learningEnvironment?.artificial || '')}</div>
    <div class="field-line" style="padding-left:18px">III. <strong>Technological:</strong> ${esc(data.learningEnvironment?.technological || '')}</div>
    <div class="field-line" style="margin-top:8px"><strong>Teaching &amp; Learning Materials:</strong> ${esc(data.materials || '')}</div>
    <div class="field-line"><strong>Expected Standards:</strong> ${esc(data.expectedStandards || '')}</div>
    ${idcRows ? `<div class="field-line" style="margin-top:10px"><strong>Interdisciplinary Connections:</strong></div>${idcRows}` : ''}
  `;
}

function renderBTPostlude(data) {
  return `
    ${data.competenceContinuity ? `<h2 class="sec">Competence Continuity &amp; Strategy</h2>
    <p>${formatProse(data.competenceContinuity)}</p>` : ''}
    <div class="field-line" style="margin-top:14px"><strong>Teacher's Evaluation:</strong> ____________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>
    <div class="field-line" style="margin-top:10px"><strong>Learners' Evaluation:</strong> ____________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>
    <div class="field-line">__________________________________________________________________________________</div>
  `;
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
  // Per-stage tables (Modern Clean look) but with THREE columns like Classic CBC
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

$('#btn-generate').addEventListener('click', async () => {
  const i = gatherInput();
  if (!i.school) { toast('Please add a school name'); $('#f-school').focus(); return; }
  if (!i.topic && !i.subtopic) { toast('Add at least a topic or sub-topic'); $('#f-topic').focus(); return; }
  $('#loader').classList.add('show');
  $('#btn-generate').disabled = true;
  $('#btn-generate').innerHTML = '<span>Composing your lesson plan…</span>';
  try {
    const sysPrompt = i.format === 'classic' ? sysClassic : (i.format === 'classic2' ? sysClassic2 : sysModern);
    const data = await callClaude(sysPrompt, buildPrompt(i));
    if (data.error) {
      // Topic validation failed — show inline error in document area
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
      // Auto-save to library
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
    $('#loader').classList.remove('show');
    $('#btn-generate').disabled = false;
    $('#btn-generate').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/><path d="M9.6 5.6 8 8 5.6 6.4 4 9l2.4 1.6L5 13l3.4-1.4L10 14l1.6-3.4L15 12l-1.6-3.4L17 7l-3.4 1.4L12 5l-1.6 2.4z"/></svg> Generate Lesson Plan`;
  }
});
