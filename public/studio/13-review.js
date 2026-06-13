// ── Review & Generate step ──────────────────────────────────────────────────
//
// A confirmation pass between the Generate button and the actual run. The
// teacher fills in the accordion sections on the left; before we spend a
// generation (and a daily-cap credit) we surface a single consolidated card
// echoing every choice — subject, class, topic, format, plan scope, what to
// include — plus the official CBC competence the plan will target (fetched
// from the same merged KB the planner uses). This mirrors the "Review your
// choices, then generate" confirmation competitors lean on, but keeps our
// editable-canvas + multi-lesson advantages intact.
//
// Wiring contract with 06-generate.js:
//   • #btn-generate → window.__studioOpenReview() (06 falls back to a direct
//     run when this module is absent).
//   • The modal's confirm button → window.__studioConfirmGenerate() (the real
//     generation loop, still owned by 06).
// Close / backdrop / Escape are handled by 11-diagrams.js's global
// [data-close-modal] + .modal-scrim wiring, so the close button just needs the
// data attribute (already in the JSX markup).

(function () {
  // Friendly labels for the three CBC layouts (formatChoice is the studio's
  // global format id, set by 07-format-preview.js / 01-ui-setup.js).
  function formatLabel(fmt) {
    if (fmt === 'classic') return 'Classic CBC';
    if (fmt === 'classic2') return 'Classic 2';
    return 'Modern Clean';
  }

  function syllabusLabel() {
    // syllabusVersion is the studio global toggled by the New/Old segmented
    // control; default to the new syllabus when unset.
    return (typeof syllabusVersion !== 'undefined' && syllabusVersion === 'old')
      ? 'Old syllabus (2013)'
      : 'New syllabus (2023)';
  }

  // Mirror the planner's generate-button label so the confirm button reads the
  // same as what the teacher clicked.
  function confirmLabel(planner) {
    const count = Math.max(1, parseInt(planner && planner.count, 10) || 1);
    if (planner && planner.generateOnlyIndex && count > 1) {
      return `Generate Lesson ${planner.generateOnlyIndex} of ${count}`;
    }
    if (count > 1) return `Generate ${count} Lesson Plans`;
    return 'Generate Lesson Plan';
  }

  function planScopeText(planner) {
    const count = Math.max(1, parseInt(planner && planner.count, 10) || 1);
    if (planner && planner.generateOnlyIndex && count > 1) {
      return `Lesson ${planner.generateOnlyIndex} of a ${count}-lesson series`;
    }
    if (count > 1) {
      const mode = planner && planner.mode === 'week' ? 'full week plan'
        : planner && planner.mode === 'ai' ? 'AI-suggested split'
        : 'multiple lessons';
      return `${count} lessons · ${mode}`;
    }
    return 'Single lesson';
  }

  // The "Include" toggles that are switched on, as short chips.
  function includeChips(i) {
    const on = [];
    if (i.showEnrolment) on.push('Enrolment row');
    if (i.showAttendance) on.push('Attendance row');
    if (i.showReflection) on.push('Lesson evaluation');
    if (i.showVocabulary) on.push('Key vocabulary');
    if (i.compactMeta) on.push('Compact metadata');
    return on;
  }

  function chips(values) {
    if (!values || !values.length) return '<span class="lp-review-muted">—</span>';
    return values.map(v => `<span class="lp-review-chip">${esc(v)}</span>`).join('');
  }

  // One labelled cell in the summary grid. `full` spans both columns.
  function cell(label, valueHtml, full) {
    return `<div class="lp-review-cell${full ? ' lp-review-cell-full' : ''}">
      <div class="lp-review-k">${esc(label)}</div>
      <div class="lp-review-v">${valueHtml}</div>
    </div>`;
  }

  function buildSummary(i) {
    const title = i.subtopic || i.topic || 'Lesson Plan';
    const sub = [i.subject || '—', i.klass || '—', syllabusLabel()].filter(Boolean).join('  ·  ');
    const env = (i.learningEnvironments && i.learningEnvironments.length)
      ? chips(i.learningEnvironments)
      : '<span class="lp-review-muted">AI will choose a suitable environment</span>';
    const includes = chips(includeChips(i));

    const cells = [
      cell('Topic', i.topic ? esc(i.topic) : '<span class="lp-review-muted">AI will choose from syllabus</span>'),
      cell('Sub-topic', i.subtopic ? esc(i.subtopic) : '<span class="lp-review-muted">AI will choose</span>'),
      cell('Duration', `${esc(i.duration)} minutes`),
      cell('Term &amp; Week', i.termWeek ? esc(i.termWeek) : '<span class="lp-review-muted">—</span>'),
      cell('Format', esc(formatLabel(i.format))),
      cell('Plan scope', esc(planScopeText(i.planner))),
      cell('Learning environment', env, true),
      cell('Includes', includes, true),
    ].join('');

    // Multi-lesson breakdown — show the per-lesson focus headlines so the
    // teacher can confirm the split before spending several generations.
    let breakdown = '';
    const foci = (i.planner && Array.isArray(i.planner.foci)) ? i.planner.foci : [];
    const count = Math.max(1, parseInt(i.planner && i.planner.count, 10) || 1);
    if (count > 1 && foci.length) {
      const rows = foci.slice(0, count).map((f, idx) =>
        `<li><span class="lp-review-ln">Lesson ${idx + 1}</span>${esc(String(f || '').trim() || `Lesson ${idx + 1}`)}</li>`
      ).join('');
      breakdown = `<div class="lp-review-breakdown">
        <div class="lp-review-k">Lesson breakdown</div>
        <ol class="lp-review-foci">${rows}</ol>
      </div>`;
    }

    return `<div class="lp-review">
      <div class="lp-review-banner">
        <div class="lp-review-eyebrow">Ready to generate</div>
        <div class="lp-review-title">${esc(title)}</div>
        <div class="lp-review-sub">${esc(sub)}</div>
      </div>
      <div class="lp-review-grid">${cells}</div>
      ${breakdown}
      <div class="lp-review-cbc" id="lp-review-cbc">
        <div class="lp-review-cbc-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
          Targets CBC competence
        </div>
        <div class="lp-review-cbc-body" id="lp-review-cbc-body">
          <span class="lp-review-muted">Looking up the syllabus competence…</span>
        </div>
      </div>
    </div>`;
  }

  // Fill the CBC competence block once the async KB lookup resolves. Never
  // blocks the review from opening — a miss just shows a reassuring fallback.
  async function fillCompetence(i) {
    const body = document.getElementById('lp-review-cbc-body');
    if (!body) return;
    const fallback = 'The AI will select the official CBC competence for this sub-topic.';
    try {
      if (typeof window.__studioFetchSubtopicDetail !== 'function' || !i.subtopic || !i.topic) {
        body.innerHTML = `<span class="lp-review-muted">${esc(fallback)}</span>`;
        return;
      }
      const grade = (typeof classToCbcGrade === 'function') ? classToCbcGrade(i.klass) : i.klass;
      const subject = (typeof subjectToCbcSubject === 'function') ? subjectToCbcSubject(i.subject) : i.subject;
      if (!grade || !subject) {
        body.innerHTML = `<span class="lp-review-muted">${esc(fallback)}</span>`;
        return;
      }
      const detail = await window.__studioFetchSubtopicDetail({ grade, subject, topic: i.topic, subtopic: i.subtopic });
      const comp = detail && String(detail.specificCompetence || '').trim();
      const standard = detail && String(detail.expectedStandard || '').trim();
      if (comp) {
        body.innerHTML = `<div class="lp-review-comp">${esc(comp)}</div>` +
          (standard ? `<div class="lp-review-standard"><strong>Expected standard:</strong> ${esc(standard)}</div>` : '');
      } else {
        body.innerHTML = `<span class="lp-review-muted">${esc(fallback)}</span>`;
      }
    } catch (err) {
      body.innerHTML = `<span class="lp-review-muted">${esc(fallback)}</span>`;
    }
  }

  // Open the review modal. Validates the same minimums 06-generate enforces so
  // we never present a review of un-generatable input — on a miss we toast and
  // focus the offending field instead of opening.
  window.__studioOpenReview = function __studioOpenReview() {
    const i = (typeof gatherInput === 'function') ? gatherInput() : null;
    if (!i) { if (typeof window.__studioConfirmGenerate === 'function') window.__studioConfirmGenerate(); return; }
    if (!i.school) { toast('Please add a school name'); const el = $('#f-school'); if (el) el.focus(); return; }
    if (!i.topic && !i.subtopic) { toast('Add at least a topic or sub-topic'); const el = $('#f-topic'); if (el) el.focus(); return; }

    const scrim = document.getElementById('modal-review');
    const body = document.getElementById('review-modal-body');
    const confirmBtn = document.getElementById('review-generate');
    if (!scrim || !body) {
      // Markup missing (older cached DOM) — fail open to a direct generation.
      if (typeof window.__studioConfirmGenerate === 'function') window.__studioConfirmGenerate();
      return;
    }
    body.innerHTML = buildSummary(i);
    if (confirmBtn) {
      const lbl = confirmBtn.querySelector('#review-generate-label');
      if (lbl) lbl.textContent = confirmLabel(i.planner);
    }
    scrim.classList.add('show');
    // Async — fills in after the modal is already on screen.
    fillCompetence(i);
  };

  // Wire the confirm button. Close / backdrop / Escape are wired globally by
  // 11-diagrams.js. Idempotent across remounts via a data flag.
  function __studioInitReview() {
    const btn = document.getElementById('review-generate');
    if (!btn || btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', () => {
      const scrim = document.getElementById('modal-review');
      if (scrim) scrim.classList.remove('show');
      if (typeof window.__studioConfirmGenerate === 'function') window.__studioConfirmGenerate();
    });
  }

  window.__studioRebinders = window.__studioRebinders || [];
  window.__studioRebinders.push(__studioInitReview);
})();
