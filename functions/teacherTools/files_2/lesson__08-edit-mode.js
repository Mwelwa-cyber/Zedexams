// Edit mode
const doc = $('#doc');
let editing = false;
$('#btn-edit').addEventListener('click', () => {
  editing = !editing;
  doc.contentEditable = editing; doc.spellcheck = editing;
  $('#btn-edit').classList.toggle('active', editing);
  $('#format-tools').style.display = editing ? 'flex' : 'none';
  $('#format-tools-2').style.display = editing ? 'flex' : 'none';
  $('#insert-tools').style.display = editing ? 'flex' : 'none';
  if (editing) { doc.focus(); enableAllTableResize(); toast('Edit mode on'); } else toast('Edit mode off');
});
$$('#format-tools .tb-btn, #format-tools-2 .tb-btn, #insert-tools .tb-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => { const cmd = btn.dataset.cmd; if (cmd) document.execCommand(cmd, false, null); });
});

// ============ Table tools ============
const ttPop = $('#tt-pop');
$('#btn-table').addEventListener('click', e => { e.stopPropagation(); ttPop.classList.toggle('open'); });
document.addEventListener('click', () => ttPop.classList.remove('open'));
ttPop.addEventListener('click', e => e.stopPropagation());

function currentCell() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let n = sel.anchorNode;
  while (n && n !== doc) {
    if (n.nodeType === 1 && (n.tagName === 'TD' || n.tagName === 'TH')) return n;
    n = n.parentNode;
  }
  return null;
}
function cellIndex(cell) { return Array.from(cell.parentNode.children).indexOf(cell); }
function cellRow(cell) { return cell.parentNode; }
function cellTable(cell) { let n = cell; while (n && n.tagName !== 'TABLE') n = n.parentNode; return n; }

function ttInsertTable() {
  const rows = parseInt(prompt('Rows?', '3'), 10);
  const cols = parseInt(prompt('Columns?', '3'), 10);
  if (!rows || !cols) return;
  let html = '<table style="width:100%;border-collapse:collapse;margin:10px 0">';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      const tag = r === 0 ? 'th' : 'td';
      const style = 'border:1px solid #1c1612;padding:8px;text-align:left;' + (r === 0 ? 'background:#f3ece0;font-weight:700;' : '');
      html += `<${tag} style="${style}">&nbsp;</${tag}>`;
    }
    html += '</tr>';
  }
  html += '</table><p>&nbsp;</p>';
  document.execCommand('insertHTML', false, html);
  setTimeout(enableAllTableResize, 50);
}
function ttInsertRow(below) {
  const cell = currentCell(); if (!cell) { toast('Click inside a table first'); return; }
  const row = cellRow(cell);
  const newRow = row.cloneNode(true);
  Array.from(newRow.children).forEach(c => { c.innerHTML = '&nbsp;'; if (c.tagName === 'TH') { /* keep th style */ } });
  if (below) row.after(newRow); else row.before(newRow);
}
function ttInsertCol(right) {
  const cell = currentCell(); if (!cell) { toast('Click inside a table first'); return; }
  const idx = cellIndex(cell);
  const table = cellTable(cell);
  Array.from(table.rows).forEach(r => {
    const target = r.cells[idx];
    if (!target) return;
    const newCell = target.cloneNode(false);
    newCell.innerHTML = '&nbsp;';
    if (right) target.after(newCell); else target.before(newCell);
  });
  setTimeout(enableAllTableResize, 50);
}
function ttDelRow() {
  const cell = currentCell(); if (!cell) { toast('Click inside a table first'); return; }
  cellRow(cell).remove();
}
function ttDelCol() {
  const cell = currentCell(); if (!cell) { toast('Click inside a table first'); return; }
  const idx = cellIndex(cell);
  const table = cellTable(cell);
  Array.from(table.rows).forEach(r => { if (r.cells[idx]) r.cells[idx].remove(); });
}
function ttDelTable() {
  const cell = currentCell(); if (!cell) { toast('Click inside a table first'); return; }
  if (!confirm('Delete the entire table?')) return;
  cellTable(cell).remove();
}
$$('#tt-pop button[data-tt]').forEach(b => {
  b.addEventListener('click', () => {
    ttPop.classList.remove('open');
    const a = b.dataset.tt;
    if (a === 'insertTable') ttInsertTable();
    if (a === 'rowAbove') ttInsertRow(false);
    if (a === 'rowBelow') ttInsertRow(true);
    if (a === 'colLeft') ttInsertCol(false);
    if (a === 'colRight') ttInsertCol(true);
    if (a === 'delRow') ttDelRow();
    if (a === 'delCol') ttDelCol();
    if (a === 'delTable') ttDelTable();
  });
});

// ============ Column drag-resize ============
function enableAllTableResize() {
  if (!editing) return;
  $$('.doc table').forEach(enableTableResize);
}
function enableTableResize(table) {
  if (!editing) return;
  table.style.tableLayout = 'fixed';
  const firstRow = table.querySelector('thead tr, tr');
  if (!firstRow) return;
  const cells = firstRow.children;
  for (let i = 0; i < cells.length - 1; i++) {
    const cell = cells[i];
    if (cell.querySelector('.col-resize-handle')) continue;
    const cs = getComputedStyle(cell);
    if (cs.position === 'static') cell.style.position = 'relative';
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    handle.contentEditable = 'false';
    cell.appendChild(handle);
    handle.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX; const startW = cell.offsetWidth;
      const onMove = ev => { cell.style.width = Math.max(40, startW + ev.clientX - startX) + 'px'; };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
