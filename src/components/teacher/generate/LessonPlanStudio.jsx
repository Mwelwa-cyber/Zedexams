import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore'
import app from '../../../firebase/config'

const functions = getFunctions(app, 'us-central1')
const studioGenerateLessonPlanCallable = httpsCallable(functions, 'studioGenerateLessonPlan', {
  timeout: 120_000,
})

// Sequential script loader — each script must finish before the next starts
// because the studio scripts rely on globals set by earlier ones.
function loadScriptsSequentially(srcs) {
  return srcs.reduce((p, src) => p.then(() => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(s)
  })), Promise.resolve())
}

export default function LessonPlanStudio() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const scriptsLoaded = useRef(false)
  const db = getFirestore(app)

  useEffect(() => {
    if (scriptsLoaded.current) return
    scriptsLoaded.current = true

    // ---- Bridge: navigation ----
    window.__studioNavigateHome = () => navigate('/teacher')

    // ---- Bridge: Firestore save ----
    window.saveToLibrary = async ({ meta, data, html, studioFormat }) => {
      const uid = currentUser && currentUser.uid
      if (!uid) throw new Error('Not signed in')
      const ref = await addDoc(collection(db, 'aiGenerations'), {
        ownerUid: uid,
        tool: 'lesson-plan',
        createdAt: serverTimestamp(),
        meta: meta || {},
        data: data || {},
        html: html || '',
        studioFormat: studioFormat || 'modern',
      })
      return ref.id
    }

    // ---- Bridge: Claude generation ----
    window.__studioCallClaude = async (systemPrompt, userPrompt) => {
      const result = await studioGenerateLessonPlanCallable({ systemPrompt, userPrompt })
      // result.data.text is the raw JSON string from Claude
      return result.data.text
    }

    // ---- Bridge: auth (for any studio code that checks auth) ----
    window.__studioGetAuth = () => ({
      uid: currentUser && currentUser.uid,
      displayName: userProfile && (userProfile.displayName || userProfile.fullName),
      school: userProfile && userProfile.schoolName,
    })

    // ---- Load CSS ----
    if (!document.querySelector('link[href*="/studio/lesson.css"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = '/studio/lesson.css'
      document.head.appendChild(link)
    }

    // ---- Inject studio utility globals ($ $$ esc toast) before scripts run ----
    if (!window.__studioUtilsLoaded) {
      window.__studioUtilsLoaded = true
      window.$ = (s, r = document) => r.querySelector(s)
      window.$$ = (s, r = document) => Array.from(r.querySelectorAll(s))
      window.esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
      window.toast = (msg) => {
        const t = document.getElementById('toast')
        if (!t) return
        t.textContent = msg
        t.classList.add('show')
        clearTimeout(t._tid)
        t._tid = setTimeout(() => t.classList.remove('show'), 3000)
      }
    }

    // ---- Load scripts in dependency order ----
    const scripts = [
      '/studio/01-ui-setup.js',
      '/studio/02-syllabus-new.js',
      '/studio/03-syllabus-old.js',
      '/studio/04-syllabus-router.js',
      '/studio/05-system-prompts.js',
      '/studio/06-generate.js',
      '/studio/08-edit-mode.js',
      '/studio/09-symbols.js',
      '/studio/10-export.js',
      '/studio/11-diagrams.js',
    ]

    loadScriptsSequentially(scripts).catch(err => {
      console.error('LessonPlanStudio: script load failed', err)
    })

    // Pre-fill teacher name and school from profile
    setTimeout(() => {
      const tName = document.getElementById('f-teacher')
      const tSchool = document.getElementById('f-school')
      if (tName && !tName.value && userProfile) {
        tName.value = userProfile.displayName || userProfile.fullName || ''
      }
      if (tSchool && !tSchool.value && userProfile) {
        tSchool.value = userProfile.schoolName || ''
      }
    }, 600)

    return () => {
      delete window.__studioNavigateHome
      delete window.__studioCallClaude
      delete window.__studioGetAuth
      delete window.saveToLibrary
      delete window.__studioUtilsLoaded
      delete window.$
      delete window.$$
      delete window.esc
      delete window.toast
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Mobile sidebar scrim */}
      <div className="scrim" id="scrim"></div>

      {/* Studio HTML — exact markup from lesson-markup.html */}
      <div id="view-plans" className="view view-app">
        <div className="app">
          <aside className="sidebar" id="sidebar">
            <div className="brand">
              <img src="" className="brand-mark-img" alt="ZedExams" />
              <div className="brand-text">
                <h1>ZedExams</h1>
                <div className="sub">Lesson Plan Studio</div>
              </div>
            </div>
            <div className="tabs">
              <div className="tab active" data-tab="generate">Generate</div>
              <div className="tab" data-tab="style">Style</div>
            </div>

            {/* Generate pane */}
            <div className="tab-pane" id="pane-generate">
              <div className="section-label">School Identity</div>
              <div className="field"><label>Header line <span className="opt">(optional)</span></label><input type="text" id="f-header" placeholder="e.g. Ministry of Education" /><div className="helper">Leave blank if it doesn't apply.</div></div>
              <div className="field"><label>School name</label><input type="text" id="f-school" placeholder="e.g. Jemareen Primary School" /></div>
              <div className="field"><label>Department / sub-line <span className="opt">(optional)</span></label><input type="text" id="f-department" placeholder="e.g. Mathematics Department" /></div>

              <div className="section-label">Lesson Details</div>
              <div className="field">
                <label>Syllabus Version <span className="hint-inline">— grades 5, 6, 7, 10, 11, 12 still use the old syllabus</span></label>
                <div className="seg-toggle" id="syllabus-toggle">
                  <button type="button" className="seg active" data-version="new">New (2023)</button>
                  <button type="button" className="seg" data-version="old">Old (2013)</button>
                </div>
              </div>
              <div className="field-row">
                <div className="field"><label>Class</label><select id="f-class"></select></div>
                <div className="field"><label>Duration (min)</label><input type="number" id="f-duration" defaultValue="40" min="20" max="120" /></div>
              </div>
              <div className="field"><label>Subject</label><select id="f-subject"></select></div>
              <div className="field-row">
                <div className="field"><label>Term</label><select id="f-term"><option>1</option><option defaultValue="2">2</option><option>3</option></select></div>
                <div className="field"><label>Week</label><select id="f-week">
                  <option>1</option><option>2</option><option>3</option><option>4</option>
                  <option defaultValue="5">5</option><option>6</option><option>7</option><option>8</option>
                  <option>9</option><option>10</option><option>11</option><option>12</option><option>13</option>
                </select></div>
              </div>
              <div className="field-row">
                <div className="field"><label>Date <span className="opt">(auto)</span></label><input type="text" id="f-date" placeholder="29 April 2026" /></div>
                <div className="field"><label>Time <span className="opt">(opt.)</span></label><input type="text" id="f-time" placeholder="08:00" /></div>
              </div>

              <div className="section-label">Topic <span className="opt" style={{textTransform:'none',letterSpacing:0,color:'#6e6253',fontStyle:'italic'}}>— from CBC syllabus</span></div>
              <div className="field"><label>Topic</label><input type="text" id="f-topic" list="topic-list" placeholder="Pick from syllabus or type your own" autoComplete="off" /><datalist id="topic-list"></datalist></div>
              <div className="field"><label>Sub-topic</label><input type="text" id="f-subtopic" list="subtopic-list" placeholder="Pick from syllabus or type your own" autoComplete="off" /><datalist id="subtopic-list"></datalist></div>

              <div className="section-label">Teacher</div>
              <div className="field"><label>Name <span className="opt">(optional)</span></label><input type="text" id="f-teacher" placeholder="e.g. Mwelwa" /></div>
              <div className="field"><label>TS / ID <span className="opt">(optional)</span></label><input type="text" id="f-tsno" placeholder="e.g. 20158502" /></div>

              <div className="section-label">Format &amp; Options</div>
              <div className="format-grid" id="format-cards" style={{gridTemplateColumns:'1fr'}}>
                <div className="format-card active" data-format="modern"><div className="name">Modern Clean</div><div className="desc">Per-stage tables · Specific Outcomes, Assessment, Differentiation, Reflection sections.</div></div>
                <div className="format-card" data-format="classic2"><div className="name">Classic 2</div><div className="desc">Per-stage tables (Modern look) with three columns — Teacher's Role, Learners' Role, Assessment Criteria. Includes Teacher's and Learners' Evaluation.</div></div>
                <div className="format-card" data-format="classic"><div className="name">Classic CBC</div><div className="desc">Single progression table — Stages, Teacher, Learner, Assessment Criteria.</div></div>
              </div>

              <div className="toggle-row on" id="t-compact" data-on="true">
                <div className="lbl">Compact metadata layout<small>Horizontal "Label: Value" pairs (saves space)</small></div>
                <div className="toggle-switch"></div>
              </div>
              <div className="toggle-row" id="t-enrolment" data-on="false">
                <div className="lbl">Include Enrolment row<small>Boys / Girls headcount on roll</small></div>
                <div className="toggle-switch"></div>
              </div>
              <div className="toggle-row on" id="t-attendance" data-on="true">
                <div className="lbl">Include Attendance row<small>Boys / Girls present today</small></div>
                <div className="toggle-switch"></div>
              </div>
              <div className="toggle-row on" id="t-reflection" data-on="true">
                <div className="lbl">Include Teacher's Reflection<small>Modern Clean format only</small></div>
                <div className="toggle-switch"></div>
              </div>

              <button className="btn btn-primary" id="btn-generate">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/><path d="M9.6 5.6 8 8 5.6 6.4 4 9l2.4 1.6L5 13l3.4-1.4L10 14l1.6-3.4L15 12l-1.6-3.4L17 7l-3.4 1.4L12 5l-1.6 2.4z"/></svg>
                Generate Lesson Plan
              </button>
              <div className="helper" style={{marginTop:'10px'}}>Builds a CBC-aligned plan in your chosen format. Edit, restyle, and export when ready.</div>
            </div>

            {/* Style pane */}
            <div className="tab-pane" id="pane-style" style={{display:'none'}}>
              <div className="section-label">Typography</div>
              <div className="style-grid" id="font-pairs">
                <div className="style-card active" data-fontpair="classic"><div style={{font:"600 16px/1 'Fraunces',serif"}}>Aa</div><div style={{marginTop:'4px'}}>Classic<br/><span style={{opacity:.6}}>Fraunces × Lora</span></div></div>
                <div className="style-card" data-fontpair="modern"><div style={{font:"600 16px/1 'DM Sans',sans-serif"}}>Aa</div><div style={{marginTop:'4px'}}>Modern<br/><span style={{opacity:.6}}>DM Sans</span></div></div>
                <div className="style-card" data-fontpair="academic"><div style={{font:"600 16px/1 'Source Serif 4',serif"}}>Aa</div><div style={{marginTop:'4px'}}>Academic<br/><span style={{opacity:.6}}>Source Serif</span></div></div>
              </div>
              <div className="section-label" style={{marginTop:'18px'}}>Body Size</div>
              <div className="range-row"><input type="range" id="font-size" min="9" max="14" step="0.5" defaultValue="11" /><div className="val" id="font-size-val">11pt</div></div>
              <div className="section-label">Classic Table Style <span style={{fontSize:'10px',color:'#6e6253',fontWeight:400,textTransform:'none',letterSpacing:0,fontStyle:'italic'}}>(Classic CBC only)</span></div>
              <div className="style-grid" id="table-styles">
                <div className="style-card active" data-tablestyle="bordered">Bordered</div>
                <div className="style-card" data-tablestyle="simple">Simple</div>
                <div className="style-card" data-tablestyle="modern">Modern</div>
                <div className="style-card" data-tablestyle="minimal">Minimal</div>
              </div>
              <div className="section-label">Accent Colour</div>
              <div className="style-grid" style={{gridTemplateColumns:'repeat(4,1fr)',gap:'6px'}} id="accent-colors">
                <div className="style-card active" data-accent="#0a5454" style={{background:'#0a5454',height:'30px',padding:0}}></div>
                <div className="style-card" data-accent="#7c2d12" style={{background:'#7c2d12',height:'30px',padding:0}}></div>
                <div className="style-card" data-accent="#1e3a8a" style={{background:'#1e3a8a',height:'30px',padding:0}}></div>
                <div className="style-card" data-accent="#365314" style={{background:'#365314',height:'30px',padding:0}}></div>
                <div className="style-card" data-accent="#581c87" style={{background:'#581c87',height:'30px',padding:0}}></div>
                <div className="style-card" data-accent="#831843" style={{background:'#831843',height:'30px',padding:0}}></div>
                <div className="style-card" data-accent="#1c1612" style={{background:'#1c1612',height:'30px',padding:0}}></div>
                <div className="style-card" data-accent="#a16207" style={{background:'#a16207',height:'30px',padding:0}}></div>
              </div>
            </div>
          </aside>

          <main className="main">
            <div className="topbar">
              <button className="menu-btn" id="menu-btn" aria-label="Menu">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
              <button className="tb-btn" data-go-view="home" title="Back to home" style={{marginRight:'6px'}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                <span className="advanced-only">Home</span>
              </button>
              <div className="tb-group">
                <button className="tb-btn" id="btn-edit" title="Toggle edit mode">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>
                  <span>Edit</span>
                </button>
              </div>
              <div className="tb-group" id="format-tools" style={{display:'none'}}>
                <button className="tb-btn" data-cmd="bold" title="Bold"><b>B</b></button>
                <button className="tb-btn" data-cmd="italic" title="Italic"><i>I</i></button>
                <button className="tb-btn" data-cmd="underline" title="Underline"><u>U</u></button>
                <button className="tb-btn advanced-only" data-cmd="strikeThrough" title="Strike"><s>S</s></button>
              </div>
              <div className="tb-group advanced-only" id="format-tools-2" style={{display:'none'}}>
                <button className="tb-btn" data-cmd="insertUnorderedList" title="Bullets">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.2" fill="currentColor"/><circle cx="3.5" cy="12" r="1.2" fill="currentColor"/><circle cx="3.5" cy="18" r="1.2" fill="currentColor"/></svg>
                </button>
                <button className="tb-btn" data-cmd="insertOrderedList" title="Numbered">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/></svg>
                </button>
                <button className="tb-btn" data-cmd="justifyLeft" title="Align left">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
                </button>
                <button className="tb-btn" data-cmd="justifyCenter" title="Align center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="18" y1="18" x2="6" y2="18"/></svg>
                </button>
              </div>
              <div className="tb-group" id="insert-tools" style={{display:'none'}}>
                <button className="tb-btn" id="btn-diagram" title="Insert diagram">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>
                  <span className="advanced-only">Diagram</span>
                </button>
                <button className="tb-btn" id="btn-symbols" title="Insert math symbol">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M12 3v18M5 5l14 14M19 5L5 19"/></svg>
                  <span className="advanced-only">∑ Symbols</span>
                </button>
                <button className="tb-btn advanced-only" data-cmd="superscript" title="Superscript (x²)">x²</button>
                <button className="tb-btn advanced-only" data-cmd="subscript" title="Subscript (x₂)">x₂</button>
                <div className="export-menu" style={{position:'relative'}}>
                  <button className="tb-btn advanced-only" id="btn-table" title="Table tools">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                    <span>Table</span>
                  </button>
                  <div className="tt-pop" id="tt-pop">
                    <button data-tt="insertTable">Insert new table…</button>
                    <hr />
                    <button data-tt="rowAbove">Insert row above</button>
                    <button data-tt="rowBelow">Insert row below</button>
                    <button data-tt="colLeft">Insert column left</button>
                    <button data-tt="colRight">Insert column right</button>
                    <hr />
                    <button className="danger" data-tt="delRow">Delete row</button>
                    <button className="danger" data-tt="delCol">Delete column</button>
                    <button className="danger" data-tt="delTable">Delete table</button>
                  </div>
                </div>
              </div>
              <div className="tb-spacer"></div>
              <div className="export-menu">
                <button className="tb-btn" id="btn-export" style={{background:'var(--accent)',color:'#faf6ef',borderColor:'var(--accent)'}}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Export</span>
                </button>
                <div className="export-pop" id="export-pop">
                  <button data-export="pdf">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    PDF (A4 via Print)
                  </button>
                  <button data-export="word">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8 9.5 16 12 10 14.5 16 17 8" strokeWidth="1.7"/></svg>
                    Microsoft Word (.docx)
                  </button>
                  <button data-export="html">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                    HTML File
                  </button>
                </div>
              </div>
            </div>

            <div className="workspace">
              <div className="doc-wrap" id="doc-wrap">
                {/* Loading overlay — toggled by 06-generate.js via classList.add/remove('show') */}
                <div id="loader" style={{display:'none',position:'absolute',inset:0,zIndex:10,background:'rgba(250,246,239,0.85)',alignItems:'center',justifyContent:'center',borderRadius:'inherit'}}>
                  <div style={{textAlign:'center',color:'var(--muted,#7a6d5d)'}}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{animation:'spin 1s linear infinite'}}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    <div style={{marginTop:'10px',fontSize:'13px'}}>Generating…</div>
                  </div>
                </div>
                <div className="doc" id="doc">
                  <div className="empty-state">
                    <div className="glyph">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#7a6d5d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    </div>
                    <h2>An empty page is waiting</h2>
                    <p>Fill in your school identity and lesson details on the left, choose a format, then hit <strong>Generate Lesson Plan</strong>. You'll get a clean, A4-ready draft you can edit, illustrate, and export.</p>
                    <div className="hint"><strong>Two formats:</strong> <em>Modern Clean</em> uses separate stage tables and dedicated Assessment / Differentiation sections. <em>Classic CBC</em> uses one unified progression table.</div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Modals */}
      <div className="modal-scrim" id="modal-diagram">
        <div className="modal">
          <div className="modal-head">
            <h3>Insert Diagram</h3>
            <button className="close" data-close-modal>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="modal-body" id="diagram-modal-body"></div>
        </div>
      </div>
      <div className="modal-scrim" id="modal-symbols">
        <div className="modal">
          <div className="modal-head">
            <h3>Math Symbols</h3>
            <button className="close" data-close-modal>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="modal-body" id="symbols-modal-body"></div>
        </div>
      </div>
      <div className="toast" id="toast">Saved</div>

      {/* Loader overlay + spinner animation */}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} #loader.show{display:flex!important}`}</style>
    </>
  )
}
