// A4 preview — after generation, the teacher clicks "A4 Preview" in the
// topbar to see exactly how the lesson plan will print on paper (and
// therefore what the PDF / Word export will look like). The preview
// mirrors the live #doc HTML into a fixed-width A4 sheet (210mm wide)
// inside #modal-a4-preview, so the teacher can spot layout, wrapping,
// and column-width issues before downloading.

(function () {
  function hasGeneratedContent() {
    const docEl = document.getElementById('doc');
    if (!docEl) return false;
    // The initial empty-state markup is replaced wholesale on first
    // generation, so its presence is a reliable "nothing here yet" signal.
    return !docEl.querySelector('.empty-state');
  }

  function openA4Preview() {
    const modal = document.getElementById('modal-a4-preview');
    const body = document.getElementById('a4-preview-body');
    const docEl = document.getElementById('doc');
    if (!modal || !body || !docEl) return;

    if (!hasGeneratedContent()) {
      if (typeof window.toast === 'function') {
        window.toast('Generate a lesson plan first');
      }
      return;
    }

    // Wrap the live HTML in an A4 page. We intentionally do NOT try to
    // split the content across multiple page sheets — the browser's
    // print pipeline handles page breaks honestly, so a continuous A4-
    // width sheet is the most accurate "this is what your PDF will look
    // like" preview without re-implementing pagination.
    body.innerHTML =
      '<div class="a4-page" id="a4-preview-page">' + docEl.innerHTML + '</div>';

    modal.classList.add('show');
  }

  function closeA4Preview() {
    const modal = document.getElementById('modal-a4-preview');
    if (modal) modal.classList.remove('show');
  }

  function __studioInitA4Preview() {
    const btn = document.getElementById('btn-a4-preview');
    if (btn) btn.addEventListener('click', openA4Preview);

    // Print / Word buttons inside the preview modal delegate to the
    // existing export functions so the teacher can preview-then-export
    // in one flow.
    document.querySelectorAll('#modal-a4-preview [data-a4-action]').forEach(b => {
      b.addEventListener('click', () => {
        const action = b.dataset.a4Action;
        closeA4Preview();
        if (action === 'print' && typeof window.exportPDF === 'function') {
          window.exportPDF();
        } else if (action === 'word' && typeof window.exportWord === 'function') {
          window.exportWord();
        }
      });
    });
  }

  window.__studioRebinders = window.__studioRebinders || [];
  window.__studioRebinders.push(__studioInitA4Preview);
})();
