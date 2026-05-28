// ============ Lesson Progression — planning modes ============
// Replaces the legacy "Subtopic needs multiple lessons" toggle with a
// 4-mode planner: Single / Multiple / Full week / Let AI suggest.
//
// State is owned here (not in the DOM data-on attributes alone) so the
// breakdown + generate-button label stay in sync with the user's selection
// even when they swap modes.
//
// Public API consumed by 06-generate.js:
//   window.__lpState  → { mode, totalLessons, foci[], seriesId,
//                         aiSuggestedReason, generateOnlyIndex }
//   window.__lpResolveSeries(meta)  → returns the lessonSeries payload to
//     attach to saveToLibrary for the lesson at meta.lessonNumber.
//   window.__lpResetGenerateOnly()  → clears any "generate only this one"
//     selection after a successful run.

(function () {
  const __lp = {
    mode: 'single',         // 'single' | 'multiple' | 'week' | 'ai'
    count: 1,               // resolved lesson count (>= 1)
    foci: ['Single lesson plan'],
    seriesId: null,         // null for single mode, uuid-ish otherwise
    aiSuggestedReason: null,
    generateOnlyIndex: null, // null = generate all; 1-based otherwise
    // Last context used to build foci (so we can rebuild without re-reading
    // the DOM in cases like "topic changed").
    lastSubject: '',
    lastSubtopic: '',
  };

  // expose for 06-generate.js
  window.__lpState = __lp;

  // ── Subject intelligence rules ──────────────────────────────────────────
  // Each subject keeps an ORDERED stage list. The planner picks the first N
  // stages when N <= rules.length, and otherwise repeats Practice/Application
  // until it reaches N. Each stage carries a short focus headline that the
  // teacher sees in the breakdown card AND that the studio sends to Claude
  // as the per-lesson focus directive.
  const SUBJECT_RULES = {
    mathematics: [
      'Concept introduction',
      'Worked examples',
      'Guided practice',
      'Independent practice',
      'Word problems and application',
      'Revision and assessment',
    ],
    integrated_science: [
      'Observation and identification',
      'Explanation of concepts',
      'Demonstration or hands-on activity',
      'Drawing and labelling',
      'Care, safety and responsible use',
      'Revision and assessment',
    ],
    english: [
      'Vocabulary and key terms',
      'Reading or listening',
      'Comprehension',
      'Grammar or writing skill',
      'Guided practice',
      'Revision and assessment',
    ],
    social_studies: [
      'Discussion and prior knowledge',
      'Explanation using local examples',
      'Activity or project',
      'Revision',
      'Assessment',
    ],
    // Generic CBC progression — used for any subject without a specific rule.
    _default: [
      'Introduction to the subtopic',
      'Explanation and guided activity',
      'Practice, drawing, experiment or application',
      'Revision and assessment',
    ],
  };

  // Map the studio's display subject names to the SUBJECT_RULES key.
  // Mirrors the SUBJECT_ALIAS table in 04-syllabus-router.js — kept inline so
  // this file has no cross-script load-order dependency on that one.
  function subjectRuleKey(name) {
    const s = String(name || '').toLowerCase();
    if (!s) return '_default';
    if (s.includes('math')) return 'mathematics';
    if (s.includes('integrated science') || s.includes('environmental') || s.includes('science')) return 'integrated_science';
    if (s.includes('english') || s.includes('literature')) return 'english';
    if (s.includes('social studies') || s.includes('civic') || s.includes('history') || s.includes('geography') || s.includes('commerce') || s.includes('economics')) return 'social_studies';
    return '_default';
  }

  function buildFoci(subject, count) {
    const rules = SUBJECT_RULES[subjectRuleKey(subject)] || SUBJECT_RULES._default;
    if (count <= 1) return ['Single lesson plan'];
    const out = [];
    for (let i = 0; i < count; i++) {
      // First, walk the rule list in order. After we exhaust it, repeat the
      // "Practice / Application" middle stage so very long sequences still
      // feel pedagogically reasonable.
      if (i < rules.length - 1) {
        out.push(rules[i]);
      } else if (i === count - 1) {
        // Always end with assessment / revision regardless of length.
        out.push(rules[rules.length - 1]);
      } else {
        const fallback = rules[Math.min(rules.length - 2, 2)] || 'Practice and application';
        out.push(`${fallback} (continued)`);
      }
    }
    return out;
  }

  function uuidish() {
    // Per-browser unique enough for series grouping — not crypto.
    return 'lps_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ── Mode + count helpers ────────────────────────────────────────────────
  function activeModePill() {
    return document.querySelector('#lp-mode-grid .lp-mode-pill[data-on="true"]');
  }
  function activeCountPill() {
    return document.querySelector('#lp-count-row .lp-count-pill[data-on="true"]');
  }
  function activeWeekPill() {
    return document.querySelector('#lp-week-row .lp-count-pill[data-on="true"]');
  }
  function currentSubject() {
    const el = document.getElementById('f-subject');
    return el ? el.value : '';
  }
  function currentSubtopic() {
    const el = document.getElementById('f-subtopic');
    return el ? el.value : '';
  }

  function readCount() {
    if (__lp.mode === 'single') return 1;
    if (__lp.mode === 'multiple') {
      const pill = activeCountPill();
      if (!pill) return 2;
      if (pill.dataset.count === 'custom') {
        const v = parseInt((document.getElementById('f-lp-count-custom') || {}).value, 10);
        return Math.max(2, Math.min(20, v || 6));
      }
      return parseInt(pill.dataset.count, 10) || 2;
    }
    if (__lp.mode === 'week') {
      const pill = activeWeekPill();
      return Math.max(1, parseInt((pill || {}).dataset?.week, 10) || 3);
    }
    if (__lp.mode === 'ai') {
      // Use whatever the banner currently shows; default to 1 until the
      // teacher accepts a suggestion.
      const c = parseInt((document.getElementById('lp-ai-count') || {}).textContent, 10);
      return Math.max(1, c || 1);
    }
    return 1;
  }

  // ── Renderers ───────────────────────────────────────────────────────────
  function syncModePills() {
    const pills = document.querySelectorAll('#lp-mode-grid .lp-mode-pill');
    pills.forEach(p => {
      const on = p.dataset.mode === __lp.mode;
      p.dataset.on = on ? 'true' : 'false';
      p.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    // Show only the panel for the active mode.
    const panels = { multiple: 'lp-panel-multiple', week: 'lp-panel-week', ai: 'lp-panel-ai' };
    Object.entries(panels).forEach(([mode, id]) => {
      const el = document.getElementById(id);
      if (el) el.hidden = __lp.mode !== mode;
    });
  }

  function syncCountPills() {
    const target = String(__lp.count);
    document.querySelectorAll('#lp-count-row .lp-count-pill').forEach(p => {
      const isCustom = p.dataset.count === 'custom';
      const matches = isCustom
        ? ![2, 3, 4, 5].includes(__lp.count)
        : p.dataset.count === target;
      p.dataset.on = matches ? 'true' : 'false';
    });
    const customInput = document.getElementById('f-lp-count-custom');
    if (customInput) {
      const customSelected = !!document.querySelector('#lp-count-row .lp-count-pill[data-count="custom"][data-on="true"]');
      customInput.hidden = !customSelected;
      if (customSelected && !customInput.value) customInput.value = String(__lp.count);
    }
  }

  function syncWeekPills() {
    const target = String(__lp.count);
    document.querySelectorAll('#lp-week-row .lp-count-pill').forEach(p => {
      p.dataset.on = p.dataset.week === target ? 'true' : 'false';
    });
  }

  function renderBreakdown() {
    const wrap = document.getElementById('lp-breakdown');
    const list = document.getElementById('lp-breakdown-list');
    if (!wrap || !list) return;
    const showAt = __lp.mode !== 'single' && __lp.count >= 1;
    wrap.hidden = !showAt;
    if (!showAt) { list.innerHTML = ''; return; }

    const html = __lp.foci.map((focus, idx) => {
      const n = idx + 1;
      const onlyThis = __lp.generateOnlyIndex === n;
      return `<div class="lp-breakdown-row${onlyThis ? ' only-this' : ''}" data-lesson="${n}">
        <div class="lp-breakdown-num">${n}</div>
        <div class="lp-breakdown-focus">
          <input type="text" class="lp-focus-input" data-lesson="${n}" value="${esc(focus)}" />
        </div>
        <button type="button" class="lp-only-this${onlyThis ? ' active' : ''}" data-only="${n}" title="Generate only this lesson">
          ${onlyThis ? 'Only this ✓' : 'Only this'}
        </button>
      </div>`;
    }).join('');
    list.innerHTML = html;

    // Bind: focus edits → update state in place
    list.querySelectorAll('.lp-focus-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const i = parseInt(e.target.dataset.lesson, 10) - 1;
        if (i >= 0 && i < __lp.foci.length) __lp.foci[i] = e.target.value.trim();
      });
    });
    // Bind: "Only this" toggles which lesson the generate button will produce.
    list.querySelectorAll('.lp-only-this').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.only, 10);
        __lp.generateOnlyIndex = (__lp.generateOnlyIndex === i) ? null : i;
        renderBreakdown();
        updateGenerateButton();
      });
    });
  }

  function updateGenerateButton() {
    const label = document.getElementById('btn-generate-label');
    if (!label) return;
    if (__lp.generateOnlyIndex && __lp.count > 1) {
      label.textContent = `Generate Lesson ${__lp.generateOnlyIndex} of ${__lp.count}`;
    } else if (__lp.count > 1) {
      label.textContent = `Generate ${__lp.count} Lesson Plans`;
    } else {
      label.textContent = 'Generate Lesson Plan';
    }
  }

  // ── Recompute pipeline (mode/count/subject change → rebuild everything) ──
  function recompute() {
    __lp.count = readCount();
    __lp.lastSubject = currentSubject();
    __lp.lastSubtopic = currentSubtopic();
    __lp.foci = buildFoci(__lp.lastSubject, __lp.count);
    if (__lp.count > 1 && !__lp.seriesId) __lp.seriesId = uuidish();
    if (__lp.count <= 1) {
      __lp.seriesId = null;
      __lp.aiSuggestedReason = null;
      __lp.generateOnlyIndex = null;
    }
    // Clamp out-of-range only-this selections.
    if (__lp.generateOnlyIndex && __lp.generateOnlyIndex > __lp.count) {
      __lp.generateOnlyIndex = null;
    }
    syncModePills();
    syncCountPills();
    syncWeekPills();
    renderBreakdown();
    updateGenerateButton();
  }

  // ── AI suggest ──────────────────────────────────────────────────────────
  async function runAiSuggest() {
    const btn = document.getElementById('btn-lp-ai-suggest');
    const banner = document.getElementById('lp-ai-banner');
    const grade = (document.getElementById('f-class') || {}).value || '';
    const subject = currentSubject();
    const topic = (document.getElementById('f-topic') || {}).value || '';
    const subtopic = currentSubtopic();
    const duration = parseInt((document.getElementById('f-duration') || {}).value, 10) || 40;
    if (!grade || !subject || !topic || !subtopic) {
      toast('Pick grade, subject, topic and sub-topic first');
      return;
    }
    if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Thinking…'; }

    // Try to enrich the prompt with the actual syllabus detail for this subtopic.
    let detail = null;
    try {
      if (typeof window.__studioFetchSubtopicDetail === 'function') {
        const cbcGrade = (typeof classToCbcGrade === 'function') ? classToCbcGrade(grade) : grade;
        const cbcSubject = (typeof subjectToCbcSubject === 'function') ? subjectToCbcSubject(subject) : subject;
        if (cbcGrade && cbcSubject) {
          detail = await window.__studioFetchSubtopicDetail({ grade: cbcGrade, subject: cbcSubject, topic, subtopic });
        }
      }
    } catch (e) { /* non-fatal */ }

    const detailBlock = detail ? `
SYLLABUS DETAIL FOR THIS SUB-TOPIC:
- Specific competence: ${detail.specificCompetence || '(not specified)'}
- Learning activities: ${detail.learningActivities || '(not specified)'}
- Expected standard:   ${detail.expectedStandard || '(not specified)'}` : '';

    // Grade-level pacing band. Lower-Primary (G1-G3) attention is shorter
    // so the same breadth of content needs more, smaller lessons; Forms
    // (G8-G12 / Form 1-5) can sustain longer concept chunks per period.
    // Upper-Primary sits in the middle.
    const gradeBand = (() => {
      if (/^Grade\s*[1-3]\b/i.test(grade)) return 'Lower Primary (Grades 1-3): short attention spans, plenty of repetition, hands-on. Bias toward MORE, shorter conceptual chunks.';
      if (/^Grade\s*[4-7]\b/i.test(grade)) return 'Upper Primary (Grades 4-7): can sustain one concept per period with practice. Standard pacing.';
      if (/^Form\s*\d|^Grade\s*([89]|1[012])\b/i.test(grade)) return 'Secondary (Forms 1-5 / Grades 8-12): can handle deeper concepts and longer practice per period. Bias toward FEWER but denser periods.';
      return 'Apply standard CBC pacing for the given grade.';
    })();

    const sysPrompt = `You are a Zambian CBC pacing advisor. Given a syllabus sub-topic, you suggest how many ${duration}-minute lesson periods a competent teacher should plan to cover it well.

PACING SIGNALS to weigh:
- Breadth of the specific competence and number of learning activities listed in the syllabus detail.
- Subject-specific pedagogy:
  · Mathematics → concept → worked examples → guided practice → independent practice → assessment
  · Integrated Science → observation → explanation → demonstration / activity → drawing / labelling → assessment
  · English → vocabulary → reading / listening → comprehension → grammar / writing → assessment
  · Social Studies → discussion → explanation with local examples → activity → revision → assessment
- Period length: scale your suggestion to the ACTUAL duration. A 30-minute period covers materially less than a 40-minute period; a 60- or 80-minute double-period covers more. Do NOT default to a 40-minute mental model.
- Learner level: ${gradeBand}
- Sub-topic depth: a single discrete sub-topic ("Adding fractions with the same denominator") usually fits in 1-3 periods; a broad sub-topic ("Food safety and hygiene") may need 4-8; a Form-level unit ("Quadratic functions and their graphs") can need 8-12.

Output STRICTLY valid JSON, no preamble:
{
  "suggestedCount": <integer between 1 and 12>,
  "reason": "<one short paragraph, 2-3 sentences explaining why this many periods at this duration for this grade>",
  "foci": ["<focus for lesson 1>", "<focus for lesson 2>", ...]
}
"foci" length MUST equal suggestedCount. Each focus is a short headline (max 60 chars).`;

    const userPrompt = `Grade: ${grade}
Subject: ${subject}
Topic: ${topic}
Sub-topic: ${subtopic}
Period length: ${duration} minutes${detailBlock}

Return JSON only.`;

    try {
      const raw = await window.__studioCallClaude(sysPrompt, userPrompt, { grade, subject, topic, subtopic });
      let text = String(raw || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(text);
      const n = Math.max(1, Math.min(12, parseInt(parsed.suggestedCount, 10) || 1));
      const reason = String(parsed.reason || '').slice(0, 600);
      // Trust the AI's foci when shape matches; otherwise fall back to the
      // subject-intelligence ordered list. Either way, the teacher can still
      // edit each focus inline.
      let foci = Array.isArray(parsed.foci) ? parsed.foci.map(s => String(s).slice(0, 240)) : [];
      if (foci.length !== n) foci = buildFoci(subject, n);

      __lp.aiSuggestedReason = reason;
      // Render banner.
      const countEl = document.getElementById('lp-ai-count');
      const reasonEl = document.getElementById('lp-ai-reason');
      if (countEl) countEl.textContent = String(n);
      if (reasonEl) reasonEl.textContent = reason || 'No reason returned.';
      if (banner) banner.hidden = false;
      // Stash the proposed foci so Accept can apply them.
      __lp.__aiProposed = { count: n, foci };
    } catch (err) {
      console.error('ai suggest failed', err);
      toast('Suggestion failed — try again');
    } finally {
      if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Suggest a number'; }
    }
  }

  function acceptAiSuggestion() {
    const p = __lp.__aiProposed;
    if (!p) return;
    __lp.count = p.count;
    __lp.foci = p.foci.slice();
    __lp.seriesId = __lp.seriesId || uuidish();
    __lp.generateOnlyIndex = null;
    syncModePills();
    syncCountPills();
    syncWeekPills();
    renderBreakdown();
    updateGenerateButton();
    toast(`Plan set to ${p.count} lesson plan${p.count > 1 ? 's' : ''}`);
  }

  function editAiSuggestion() {
    const current = __lp.__aiProposed ? __lp.__aiProposed.count : __lp.count;
    const raw = window.prompt('How many lesson plans?', String(current));
    if (raw == null) return;
    const n = Math.max(1, Math.min(20, parseInt(raw, 10) || current));
    const foci = buildFoci(currentSubject(), n);
    __lp.__aiProposed = { count: n, foci };
    const countEl = document.getElementById('lp-ai-count');
    if (countEl) countEl.textContent = String(n);
    // Apply immediately so the breakdown updates.
    acceptAiSuggestion();
  }

  // ── Public series payload used by saveToLibrary ──────────────────────────
  // 06-generate.js calls this once per generated lesson, passing the
  // 1-based lessonNumber it just produced. We return a snapshot of the
  // current planner state for THAT lesson.
  window.__lpResolveSeries = function (lessonNumber) {
    const n = Math.max(1, Math.min(__lp.count, parseInt(lessonNumber, 10) || 1));
    return {
      seriesId: __lp.seriesId,
      planningMode: __lp.mode === 'ai' ? 'ai_suggested' : __lp.mode,
      totalLessons: __lp.count,
      lessonNumber: n,
      lessonFocus: __lp.foci[n - 1] || '',
      aiSuggestedReason: __lp.mode === 'ai' ? __lp.aiSuggestedReason : null,
    };
  };

  window.__lpResetGenerateOnly = function () {
    __lp.generateOnlyIndex = null;
    renderBreakdown();
    updateGenerateButton();
  };

  // ── Init / rebind ───────────────────────────────────────────────────────
  function __studioInitLessonProgression() {
    const grid = document.getElementById('lp-mode-grid');
    if (!grid) return;

    // Mode pills
    grid.querySelectorAll('.lp-mode-pill').forEach(p => {
      p.addEventListener('click', () => {
        __lp.mode = p.dataset.mode;
        // When the teacher leaves AI mode the proposed payload is stale.
        if (__lp.mode !== 'ai') __lp.__aiProposed = null;
        // Each mode lands on a sensible default count.
        if (__lp.mode === 'multiple') __lp.count = 3;
        if (__lp.mode === 'week') __lp.count = 3;
        if (__lp.mode === 'single') __lp.count = 1;
        if (__lp.mode === 'ai' && !__lp.__aiProposed) __lp.count = 1;
        recompute();
      });
    });

    // Multiple-count pills
    document.querySelectorAll('#lp-count-row .lp-count-pill').forEach(p => {
      p.addEventListener('click', () => {
        document.querySelectorAll('#lp-count-row .lp-count-pill').forEach(x => x.dataset.on = 'false');
        p.dataset.on = 'true';
        recompute();
      });
    });
    const custom = document.getElementById('f-lp-count-custom');
    if (custom) custom.addEventListener('input', recompute);

    // Week pills
    document.querySelectorAll('#lp-week-row .lp-count-pill').forEach(p => {
      p.addEventListener('click', () => {
        document.querySelectorAll('#lp-week-row .lp-count-pill').forEach(x => x.dataset.on = 'false');
        p.dataset.on = 'true';
        recompute();
      });
    });

    // AI suggest controls
    const aiBtn = document.getElementById('btn-lp-ai-suggest');
    if (aiBtn) aiBtn.addEventListener('click', runAiSuggest);
    const acceptBtn = document.getElementById('btn-lp-ai-accept');
    if (acceptBtn) acceptBtn.addEventListener('click', acceptAiSuggestion);
    const editBtn = document.getElementById('btn-lp-ai-edit');
    if (editBtn) editBtn.addEventListener('click', editAiSuggestion);

    // Re-derive foci when the subject changes (so a Math user who switches
    // to English sees the English progression on their existing count).
    const subjEl = document.getElementById('f-subject');
    if (subjEl) subjEl.addEventListener('change', () => {
      if (__lp.count > 1) {
        __lp.foci = buildFoci(currentSubject(), __lp.count);
        renderBreakdown();
      }
    });

    // Auto-open the Lesson Progression accordion the first time a teacher
    // picks a sub-topic. The section is collapsed by default so the form
    // doesn't look intimidating, but a teacher who's reached "picked a
    // sub-topic" is ready to think about pacing — and most won't know to
    // expand it. We only auto-open once per session so a teacher who
    // deliberately closes it again isn't fought by the script.
    const subSel = document.getElementById('f-subtopic');
    const progressionSection = document.querySelector('.lp-section[data-section="progression"]');
    if (subSel && progressionSection && !__lp.__autoOpenedProgression) {
      const maybeOpen = () => {
        if (__lp.__autoOpenedProgression) return;
        if (!subSel.value) return;
        if (progressionSection.classList.contains('open')) {
          __lp.__autoOpenedProgression = true;   // Already open; mark as done so we don't try again.
          return;
        }
        progressionSection.classList.add('open');
        __lp.__autoOpenedProgression = true;
      };
      subSel.addEventListener('change', maybeOpen);
      // Run once at bind time in case the teacher landed on a session with
      // a pre-selected sub-topic (rebind path).
      maybeOpen();
    }

    recompute();
  }

  window.__studioRebinders = window.__studioRebinders || [];
  window.__studioRebinders.push(__studioInitLessonProgression);
})();
