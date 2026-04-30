// ============ SYLLABI CATALOG ============
const SYLLABI_CATALOG = {"new": [{"k": "new-framework", "t": "National Curriculum Framework", "g": "All grades", "l": "Framework", "s": 1336532, "e": false}, {"k": "new-ece-syllabi", "t": "Early Childhood Education", "g": "Ages 3-5", "l": "ECE", "s": 791294, "e": false}, {"k": "new-ece-jan2025", "t": "ECE Syllabus (Jan 2025)", "g": "Ages 3-5", "l": "ECE", "s": 3706262, "e": false}, {"k": "new-ece-math", "t": "ECE Mathematics", "g": "Ages 5-6", "l": "ECE", "s": 2756061, "e": false}, {"k": "new-ece-lp", "t": "ECE Lesson Plan Guide", "g": "Ages 3-5", "l": "ECE", "s": 202345, "e": true}, {"k": "new-lp-syllabi", "t": "Lower Primary Syllabi", "g": "Grades 1-3", "l": "Lower Primary", "s": 1913157, "e": false}, {"k": "new-lp-sign", "t": "Zambian Sign Languages", "g": "Grades 1-3", "l": "Lower Primary", "s": 916594, "e": false}, {"k": "new-lp-math-weekly", "t": "Mathematics Weekly Plan", "g": "Grade 1 Term 1", "l": "Lower Primary", "s": 715831, "e": false}, {"k": "new-up-math", "t": "Mathematics", "g": "Grades 4-6", "l": "Upper Primary", "s": 1393181, "e": false}, {"k": "new-up-science", "t": "Science", "g": "Grades 4-5", "l": "Upper Primary", "s": 1468816, "e": false}, {"k": "new-up-social", "t": "Social Studies", "g": "Grades 4-6", "l": "Upper Primary", "s": 1465143, "e": false}, {"k": "new-up-tech", "t": "Technology Studies", "g": "Grades 4-6", "l": "Upper Primary", "s": 2297876, "e": false}, {"k": "new-up-tech2", "t": "Technology Studies (alt)", "g": "Grades 4-6", "l": "Upper Primary", "s": 799080, "e": false}, {"k": "new-up-heh", "t": "Home Economics & Hospitality", "g": "Grades 4-6", "l": "Upper Primary", "s": 1457802, "e": false}, {"k": "new-up-heh2", "t": "Home Economics & Hospitality (2025)", "g": "Grades 4-6", "l": "Upper Primary", "s": 534140, "e": false}, {"k": "new-up-arts", "t": "Expressive Arts", "g": "Grades 4-6", "l": "Upper Primary", "s": 547725, "e": false}, {"k": "new-up-arts2", "t": "Expressive Arts (alt)", "g": "Grades 4-6", "l": "Upper Primary", "s": 1243664, "e": false}, {"k": "new-tech-g5", "t": "Technology Studies (Home)", "g": "Grade 5", "l": "Upper Primary", "s": 39254, "e": true}, {"k": "new-sec-math", "t": "Mathematics", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 868348, "e": false}, {"k": "new-sec-math2", "t": "Mathematics I (Validated 2024)", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 0, "e": false}, {"k": "new-sec-math2b", "t": "Mathematics II", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 844866, "e": false}, {"k": "new-sec-eng", "t": "English Language", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1758301, "e": false}, {"k": "new-sec-bio", "t": "Biology", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 870477, "e": false}, {"k": "new-sec-chem", "t": "Chemistry", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 731338, "e": false}, {"k": "new-sec-phys", "t": "Physics", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1899208, "e": false}, {"k": "new-sec-geog", "t": "Geography", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1568271, "e": false}, {"k": "new-sec-hist", "t": "History", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1142375, "e": false}, {"k": "new-sec-civic", "t": "Civic Education", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 895123, "e": false}, {"k": "new-sec-relig", "t": "Religious Education", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 911427, "e": false}, {"k": "new-sec-zamb", "t": "Zambian Languages", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1246466, "e": false}, {"k": "new-sec-french", "t": "French Language", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1015461, "e": false}, {"k": "new-sec-lit", "t": "Literature in English", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 993543, "e": false}, {"k": "new-sec-agri", "t": "Agricultural Science", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1033424, "e": false}, {"k": "new-sec-comm", "t": "Commerce & Principles of Accounts", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 534037, "e": false}, {"k": "new-sec-comp", "t": "Computer Science", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 871754, "e": false}, {"k": "new-sec-ict", "t": "ICT", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1205223, "e": false}, {"k": "new-sec-art", "t": "Art and Design", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1610614, "e": false}, {"k": "new-sec-music", "t": "Music & Performing Arts", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1432141, "e": false}, {"k": "new-sec-pe", "t": "Physical Education", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 2354896, "e": false}, {"k": "new-sec-fash", "t": "Fashion and Fabrics", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 1173727, "e": false}, {"k": "new-sec-food", "t": "Food and Nutrition", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 649185, "e": false}, {"k": "new-sec-dt", "t": "Design & Technology Studies", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 883567, "e": false}, {"k": "new-sec-hosp", "t": "Hospitality Management", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 620887, "e": false}, {"k": "new-sec-tour", "t": "Travel and Tourism", "g": "Forms 1-4", "l": "O-Level (Secondary)", "s": 631524, "e": false}, {"k": "new-sp-id-ece", "t": "Intellectual Disability \u2014 ECE", "g": "Special Ed", "l": "Special Education", "s": 972799, "e": false}, {"k": "new-sp-id-eng", "t": "Intellectual Disability \u2014 English", "g": "Special Ed Levels I-III", "l": "Special Education", "s": 323108, "e": false}, {"k": "new-sp-id-mat", "t": "Intellectual Disability \u2014 Learning Materials", "g": "Special Ed Level I", "l": "Special Education", "s": 742059, "e": false}], "old": [{"k": "old-math-g5-7", "t": "Mathematics", "g": "Grades 1-7", "l": "Upper Primary G5-7", "s": 529364, "e": true}, {"k": "old-eng-g2-7", "t": "English Language", "g": "Grades 2-7", "l": "Upper Primary G5-7", "s": 658441, "e": false}, {"k": "old-sci-g1-7", "t": "Integrated Science", "g": "Grades 1-7", "l": "Upper Primary G5-7", "s": 1296435, "e": false}, {"k": "old-soc-g1-7", "t": "Social Studies", "g": "Grades 1-7", "l": "Upper Primary G5-7", "s": 733389, "e": false}, {"k": "old-zamb-g5-7", "t": "Zambian Languages", "g": "Grades 5-7", "l": "Upper Primary G5-7", "s": 838453, "e": false}, {"k": "old-home-g5-7", "t": "Home Economics", "g": "Grades 5-7", "l": "Upper Primary G5-7", "s": 800932, "e": false}, {"k": "old-tech-g5-7", "t": "Technology Studies", "g": "Grades 5-7", "l": "Upper Primary G5-7", "s": 858517, "e": false}, {"k": "old-cts", "t": "Creative and Technology Studies", "g": "Grades 1-4", "l": "Lower Primary G1-4", "s": 925897, "e": false}, {"k": "old-math-g10", "t": "Mathematics", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 821097, "e": false}, {"k": "old-amath-g10", "t": "Additional Mathematics", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 894982, "e": false}, {"k": "old-bio-g10", "t": "Biology", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 638032, "e": false}, {"k": "old-chem-g10", "t": "Chemistry", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 1155613, "e": false}, {"k": "old-phys-g10", "t": "Physics", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 925338, "e": false}, {"k": "old-sci-g10", "t": "Science 5124", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 1621024, "e": false}, {"k": "old-geog-g10", "t": "Geography", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 534813, "e": false}, {"k": "old-history", "t": "History", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 543520, "e": true}, {"k": "old-lit-g10", "t": "Literature in English", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 552623, "e": false}, {"k": "old-home-g10", "t": "Home Management", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 609685, "e": false}, {"k": "old-food-g10", "t": "Food and Nutrition", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 675605, "e": false}, {"k": "old-fash-g10", "t": "Fashion and Fabrics", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 776018, "e": false}, {"k": "old-dt-g10", "t": "Design and Technology", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 1045822, "e": false}, {"k": "old-agri-g10", "t": "Agricultural Science", "g": "Grades 10-12", "l": "Senior Secondary G10-12", "s": 998295, "e": false}]};
// PDFs are stored as files alongside this script.
// In production (Firebase deployment), set PDF_BASE_URL to your Firebase Storage URL.
const PDF_BASE_URL = './studios/syllabi/assets/pdfs';
function getPdfUrl(key) { return `${PDF_BASE_URL}/${key}.pdf`; }
// Map of which PDFs are actually available (matches files in ./assets/pdfs/)
const SYLLABI_AVAILABLE = new Set(['new-tech-g5','new-ece-lp','old-math-g5-7','old-history']);
let sylVersion = 'new';
let sylFilter = 'all';

const SUBJECT_ICON_FOR_SYLLABUS = {
  'Mathematics':'🔢','Mathematics I (Validated 2024)':'🔢','Mathematics II':'📐','Additional Mathematics':'📐',
  'English Language':'📖','Literature in English':'📚','Zambian Languages':'🗣️','Zambian Sign Languages':'🤟','French Language':'🇫🇷',
  'Biology':'🧬','Chemistry':'⚗️','Physics':'⚛️','Integrated Science':'🔬','Science':'🔬','Science 5124':'🔬',
  'Geography':'🗺️','History':'📜','Civic Education':'⚖️','Religious Education':'✝️','Social Studies':'🌍',
  'Home Economics':'🍳','Home Economics & Hospitality':'🍳','Home Economics & Hospitality (2025)':'🍳','Home Management':'🏠',
  'Food and Nutrition':'🥗','Fashion and Fabrics':'🧵','Hospitality Management':'🏨','Travel and Tourism':'✈️',
  'Technology Studies':'🔧','Technology Studies (alt)':'🔧','Technology Studies (Home)':'🔧','Design & Technology Studies':'⚙️','Design and Technology':'⚙️','Creative and Technology Studies':'🎨',
  'Agricultural Science':'🌾','Computer Science':'💻','ICT':'💻',
  'Art and Design':'🎨','Music & Performing Arts':'🎵','Expressive Arts':'🎭','Expressive Arts (alt)':'🎭','Physical Education':'⚽',
  'Commerce & Principles of Accounts':'💼','Early Childhood Education':'🧒','ECE Syllabus (Jan 2025)':'🧒','ECE Mathematics':'🧮','ECE Lesson Plan Guide':'📝',
  'Lower Primary Syllabi':'📚','Mathematics Weekly Plan':'📅','National Curriculum Framework':'📋',
  'Intellectual Disability — ECE':'♿','Intellectual Disability — English':'♿','Intellectual Disability — Learning Materials':'♿'
};

function syllabusIconFor(title) { return SUBJECT_ICON_FOR_SYLLABUS[title] || '📄'; }

function getActiveSyllabi() {
  const list = SYLLABI_CATALOG[sylVersion] || [];
  if (sylFilter === 'all') return list;
  return list.filter(s => s.l === sylFilter);
}

function getCategories() {
  const list = SYLLABI_CATALOG[sylVersion] || [];
  const cats = [...new Set(list.map(s => s.l))];
  return cats;
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024*1024) return Math.round(bytes/1024) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

function renderSyllabi() {
  // Filters
  const cats = getCategories();
  const filtersEl = $('#syllabi-filters');
  filtersEl.innerHTML = `<button class="syllabi-chip ${sylFilter==='all'?'active':''}" data-syl-filter="all">All ${(SYLLABI_CATALOG[sylVersion]||[]).length}</button>` +
    cats.map(c => {
      const count = (SYLLABI_CATALOG[sylVersion]||[]).filter(s => s.l === c).length;
      return `<button class="syllabi-chip ${sylFilter===c?'active':''}" data-syl-filter="${esc(c)}">${esc(c)} (${count})</button>`;
    }).join('');
  // Wire filter clicks
  $$('#syllabi-filters .syllabi-chip').forEach(b => b.addEventListener('click', () => {
    sylFilter = b.dataset.sylFilter; renderSyllabi();
  }));
  // Cards
  const items = getActiveSyllabi();
  const grid = $('#syllabi-grid');
  if (items.length === 0) {
    grid.innerHTML = `<div class="lib-empty" style="grid-column:1/-1"><div class="lib-empty-icon">🐘</div><strong>No syllabi in this category</strong><p>Try the other version or filter.</p></div>`;
    return;
  }
  grid.innerHTML = items.map(s => `
    <div class="syl-card ${s.e?'embedded':''}" data-syl-key="${esc(s.k)}">
      <div class="syl-card-icon">${syllabusIconFor(s.t)}</div>
      <div class="syl-card-subj">${esc(s.l)}</div>
      <div class="syl-card-title">${esc(s.t)}</div>
      <div class="syl-card-grade">${esc(s.g)}</div>
      <div class="syl-card-meta"><span>${fmtSize(s.s)}</span><span class="syl-card-view">${s.e?'View ›':'Preview'}</span></div>
    </div>
  `).join('');
  $$('#syllabi-grid .syl-card').forEach(c => c.addEventListener('click', () => openPdfViewer(c.dataset.sylKey)));
}

function openPdfViewer(key) {
  const all = [...SYLLABI_CATALOG.new, ...SYLLABI_CATALOG.old];
  const item = all.find(s => s.k === key);
  if (!item) return;
  $('#pdf-viewer-title').innerHTML = `${esc(item.t)} — ${esc(item.g)}<span class="badge">VIEW ONLY</span>`;
  const body = $('#pdf-viewer-body');
  if (item.e && SYLLABI_AVAILABLE.has(key)) {
    // Real PDF served from file/Firebase Storage with toolbar hidden
    const url = getPdfUrl(key);
    body.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0&scrollbar=1" sandbox="allow-same-origin allow-scripts" oncontextmenu="return false"></iframe>`;
  } else {
    body.innerHTML = `
      <div class="pdf-stub"><div class="pdf-stub-card">
        <div style="font-size:48px;margin-bottom:14px">${syllabusIconFor(item.t)}</div>
        <h2>${esc(item.t)}</h2>
        <p style="font:600 13px system-ui;color:#0e2a32"><span class="key">${esc(item.l)}</span><span class="key">${esc(item.g)}</span></p>
        <p>This syllabus PDF will load directly from the ZedExams secure cloud library when this app is deployed to <strong>zedexams.com</strong>.</p>
        <p style="font-size:13px;color:#8a9aa1">In this preview build, four sample syllabi are embedded for demonstration. The full library activates on deployment.</p>
      </div></div>`;
  }
  $('#pdf-viewer').classList.add('show');
}

function closePdfViewer() {
  $('#pdf-viewer').classList.remove('show');
  setTimeout(() => $('#pdf-viewer-body').innerHTML = '', 200);
}

$('#pdf-viewer-close').addEventListener('click', closePdfViewer);
$('#pdf-viewer').addEventListener('click', e => { if (e.target.id === 'pdf-viewer') closePdfViewer(); });
$$('#syllabi-toggle button').forEach(b => b.addEventListener('click', () => {
  $$('#syllabi-toggle button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  sylVersion = b.dataset.sylVersion; sylFilter = 'all';
  renderSyllabi();
}));
