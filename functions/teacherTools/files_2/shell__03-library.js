// ============ LIBRARY (localStorage now, Firebase-ready schema) ============
const LIB_KEY = 'lps_library_v1';
function loadLib() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (!raw) return { plans: [], schemes: [], notes: [], worksheets: [] };
    const parsed = JSON.parse(raw);
    return { plans: parsed.plans || [], schemes: parsed.schemes || [], notes: parsed.notes || [], worksheets: parsed.worksheets || [] };
  } catch (e) { return { plans: [], schemes: [], notes: [], worksheets: [] }; }
}
function persistLib(lib) { try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch (e) { console.warn('Library save failed:', e); } }
function genId() { return 'lp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function saveToLibrary(item) {
  const lib = loadLib();
  const collection = item.type === 'plan' ? 'plans' : item.type === 'scheme' ? 'schemes' : item.type === 'note' ? 'notes' : 'worksheets';
  const entry = {
    id: genId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: item.meta.topic || item.meta.subject || 'Untitled',
    ...item
  };
  lib[collection].unshift(entry);
  // Cap to 100 most recent per collection
  lib[collection] = lib[collection].slice(0, 100);
  persistLib(lib);
}
function deleteFromLibrary(id, collection = 'plans') {
  const lib = loadLib();
  lib[collection] = (lib[collection] || []).filter(p => p.id !== id);
  persistLib(lib);
}
function reopenFromLibrary(id) {
  const lib = loadLib();
  const item = lib.plans.find(p => p.id === id);
  if (!item) { toast('Plan not found'); return; }
  showView('plans');
  // Restore HTML into doc
  setTimeout(() => {
    const docEl = $('#doc');
    if (docEl && item.html) docEl.innerHTML = item.html;
    toast('Plan restored');
  }, 80);
}
