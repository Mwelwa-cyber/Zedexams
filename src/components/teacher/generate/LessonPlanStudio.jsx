import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { getFunctions, httpsCallable } from 'firebase/functions'
import {
  getFirestore, collection, addDoc, serverTimestamp,
  query, where, getDocs, orderBy, limit,
} from 'firebase/firestore'
import app from '../../../firebase/config'
import { getActiveKbVersion, subtopicName } from '../../../utils/adminCbcKbService'
import { getMergedSyllabi } from '../../../utils/syllabusKbService'
import { syllabiToKbTopics } from '../../../utils/syllabusMapping'
import SeoHelmet from '../../seo/SeoHelmet'
import { LIBRARY_TYPES, SYLLABUS_TYPES } from '../../../config/library'
import { classifyForLibrary } from '../../../utils/libraryClassification'

const functions = getFunctions(app, 'us-central1')
const studioGenerateLessonPlanCallable = httpsCallable(functions, 'studioGenerateLessonPlan', {
  timeout: 120_000,
})

// Bump this when /public/studio/* is changed so phones / CDNs refetch
// instead of serving the cached old file.
const STUDIO_ASSET_VERSION = 'v20'

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
  const db = getFirestore(app)

  useEffect(() => {
    // Studio scripts are loaded once (cached in <head>), but their DOM
    // bindings need to be re-applied every time React mounts a fresh copy
    // of the markup. Each script pushes an init fn into this registry.
    if (!Array.isArray(window.__studioRebinders)) window.__studioRebinders = []

    // ---- Bridge: navigation ----
    window.__studioNavigateHome = () => navigate('/teacher')

    // ---- Bridge: Firestore save ----
    window.saveToLibrary = async ({ meta, data, html, studioFormat }) => {
      const uid = currentUser && currentUser.uid
      if (!uid) throw new Error('Not signed in')
      // Classify the studio meta into canonical library coords so the saved
      // doc lands in the correct /Lesson Plans/<syllabus>/<grade>/<term>/
      // <subject>/ folder. studioFormat is the hardcoded "new" / "old"
      // version flag — we map it to CBC vs OBC so old-syllabus plans go
      // into the OBC tree.
      const m = meta || {}
      const syllabusHint = m.syllabusVersion === 'old'
        ? SYLLABUS_TYPES.OBC
        : SYLLABUS_TYPES.CBC
      const termOnly = (() => {
        const tw = String(m.termWeek || '')
        const match = tw.match(/Term\s*(\d)/i)
        return match ? `Term ${match[1]}` : null
      })()
      const library = classifyForLibrary({
        libraryType:  LIBRARY_TYPES.LESSON_PLANS,
        syllabusHint,
        grade:        m.klass,
        term:         termOnly,
        subject:      m.subject,
      })
      // Save with the canonical tool key + populated `inputs` so the
      // library detail view, folder bucketing, and titleForGeneration all
      // work without needing to know about the legacy 'lesson-plan' shape.
      // We intentionally do NOT set `output` — the studio's data tree has
      // a different schema than LessonPlanView expects; the detail view's
      // LegacyStudioFrame renders the pre-rendered `html` blob instead.
      // Series metadata describes whether this lesson plan belongs to a
      // multi-lesson group (Multiple lessons / Full week plan / Let AI
      // suggest), or stands alone (Single lesson). When present, seriesId
      // links sibling plans in the library so a future grouping UI can
      // surface them together. lessonFocus carries the per-lesson topic
      // angle the studio generated this plan for ("Introduction…",
      // "Guided practice…", etc.).
      const series = m.lessonSeries && typeof m.lessonSeries === 'object'
        ? m.lessonSeries
        : null
      const weekOnly = (() => {
        const tw = String(m.termWeek || '')
        const match = tw.match(/Week\s*(\d+)/i)
        return match ? `Week ${match[1]}` : null
      })()
      const ref = await addDoc(collection(db, 'aiGenerations'), {
        ownerUid: uid,
        tool: 'lesson_plan',
        createdAt: serverTimestamp(),
        inputs: {
          grade:    m.klass || null,
          subject:  m.subject || null,
          topic:    m.topic || null,
          subtopic: m.subtopic || null,
          term:     termOnly,
          week:     weekOnly,
          learningEnvironments: Array.isArray(m.learningEnvironments) ? m.learningEnvironments : [],
          lessonSeries: series ? {
            seriesId:        String(series.seriesId || '') || null,
            planningMode:    String(series.planningMode || 'single'),
            totalLessons:    Number(series.totalLessons) || 1,
            lessonNumber:    Number(series.lessonNumber) || 1,
            lessonFocus:     String(series.lessonFocus || '').slice(0, 240),
            aiSuggestedReason: series.aiSuggestedReason ? String(series.aiSuggestedReason).slice(0, 600) : null,
          } : {
            seriesId: null,
            planningMode: 'single',
            totalLessons: 1,
            lessonNumber: 1,
            lessonFocus: '',
            aiSuggestedReason: null,
          },
          // Kept for backwards-compat with any reader still looking at the
          // pre-v14 shape; new readers should prefer lessonSeries above.
          lessonProgression: m.multiLesson ? {
            requiresMultipleLessons: true,
            totalLessons:  Number(m.lessonsTotal) || null,
            currentLesson: Number(m.lessonsCurrent) || null,
            progressionNotes: m.progressNotes || '',
          } : { requiresMultipleLessons: false },
        },
        meta: m,
        data: data || {},
        html: html || '',
        studioFormat: studioFormat || 'modern',
        library: library || null,
      })
      return ref.id
    }

    // ---- Bridge: Claude generation ----
    // `context` carries the lesson coords (grade/subject/term/week/topic)
    // so the function can ground the plan on the teacher's own saved
    // Scheme of Work / Weekly Forecast. Optional — older studio bundles
    // that don't pass it still work (the function treats it as absent).
    window.__studioCallClaude = async (systemPrompt, userPrompt, context) => {
      const result = await studioGenerateLessonPlanCallable({
        systemPrompt,
        userPrompt,
        context: context || null,
      })
      // result.data.text is the raw JSON string from Claude
      return result.data.text
    }

    // ---- Bridge: auth (for any studio code that checks auth) ----
    window.__studioGetAuth = () => ({
      uid: currentUser && currentUser.uid,
      displayName: userProfile && (userProfile.displayName || userProfile.fullName),
      school: userProfile && userProfile.schoolName,
    })

    // ---- Bridge: dynamic CBC syllabus from Firestore ----
    // The studio's hardcoded /public/studio/02-syllabus-new.js +
    // 03-syllabus-old.js have gaps (entire Grade 8/9 old-syllabus
    // secondary curriculum is empty, plus a few language gaps in primary).
    // 04-syllabus-router.js calls this bridge first when populating the
    // topic + subtopic <datalist>s; if it returns a non-empty map it wins,
    // otherwise the router falls back to the hardcoded JS. Result: any
    // topic admins add via CbcKbAdmin shows up in the studio's dropdowns
    // automatically — no second source of truth to maintain.
    //
    // Returns { [topicName]: [subtopic, ...] } on success, {} when the KB
    // has no rows for that grade+subject, or null on error (router treats
    // null the same as "use fallback").
    // Memoised by (grade, subject) so keystrokes don't repeatedly walk the
    // merged source's ~800 entries.
    const cbcCache = new Map()
    // Two-stage read: the merged source (curriculum-data.json + admin
    // overrides + Firestore topics, the same set every generator now
    // grounds on) usually has data. When it doesn't, fall back to the
    // older direct-Firestore path so we never regress for grade+subject
    // pairs the merged source doesn't reach.
    window.__studioFetchSyllabusTopics = async ({ grade, subject }) => {
      if (!grade || !subject) return {}
      const key = `${grade}|${subject}`
      if (cbcCache.has(key)) return cbcCache.get(key)
      try {
        const merged = await getMergedSyllabi()
        const kbTopics = syllabiToKbTopics(merged)
        const out = {}
        for (const t of kbTopics) {
          if (t.grade !== grade || t.subject !== subject) continue
          if (!t.topic) continue
          // Studio router expects { topic: [subtopicName, ...] }; subtopics
          // here are enriched objects, so surface only their names.
          out[t.topic] = (Array.isArray(t.subtopics) ? t.subtopics : [])
            .map(subtopicName)
            .filter(Boolean)
        }
        if (Object.keys(out).length > 0) {
          cbcCache.set(key, out)
          return out
        }
        // Merged source had nothing — try the legacy direct-Firestore path.
        const version = await getActiveKbVersion()
        const snap = await getDocs(query(
          collection(db, 'cbcKnowledgeBase', version, 'topics'),
          where('grade', '==', grade),
          where('subject', '==', subject),
        ))
        snap.forEach((d) => {
          const t = d.data()
          if (t && t.topic) {
            out[t.topic] = (Array.isArray(t.subtopics) ? t.subtopics : [])
              .map(subtopicName)
              .filter(Boolean)
          }
        })
        cbcCache.set(key, out)
        return out
      } catch (err) {
        console.warn('studio CBC KB fetch failed', err)
        return null
      }
    }

    // ---- Bridge: fetch saved siblings of a multi-lesson series ----
    // Used by 06-generate.js's "Only this" path so a regenerated lesson K
    // sees what lessons 1..K-1 actually taught even when those plans were
    // generated in a previous session. Returns an array of
    //   { lessonNumber, lessonFocus, data, format }
    // sorted by lessonNumber ascending, with siblings filtered to
    // lessonNumber < `lessThan`. Returns [] when not signed in, when the
    // seriesId is missing, or on any query error (fail-open — past-lesson
    // awareness is a nice-to-have, never a blocker).
    //
    // Server query is narrow on purpose — only filters we already have
    // composite indexes for: ownerUid + createdAt desc, capped at 100.
    // The tool and seriesId filters happen client-side, so we don't need
    // a new Firestore index. A series usually has 2–12 lessons generated
    // close in time, so 100 rows of recent ownerUid history is a
    // comfortable upper bound to find every sibling.
    window.__studioFetchSeriesSiblings = async ({ seriesId, lessThan }) => {
      const uid = currentUser && currentUser.uid
      if (!uid || !seriesId) return []
      const cap = Number.isFinite(Number(lessThan)) ? Number(lessThan) : Infinity
      try {
        const snap = await getDocs(query(
          collection(db, 'aiGenerations'),
          where('ownerUid', '==', uid),
          orderBy('createdAt', 'desc'),
          limit(100),
        ))
        const out = []
        // De-dupe by lessonNumber — if a teacher regenerated lesson 2
        // multiple times, only the most recent (which sorts first thanks
        // to createdAt desc) wins. That's what we want: feed the freshest
        // version into the new lesson's PREVIOUSLY COVERED block.
        const seen = new Set()
        snap.forEach((d) => {
          const row = d.data()
          if (!row || row.tool !== 'lesson_plan') return
          const series = row && row.inputs && row.inputs.lessonSeries
          if (!series || series.seriesId !== seriesId) return
          const n = Number(series.lessonNumber) || 0
          if (n <= 0 || n >= cap) return
          if (seen.has(n)) return
          seen.add(n)
          out.push({
            lessonNumber: n,
            lessonFocus:  String(series.lessonFocus || ''),
            data:         row.data || null,
            // studioFormat is the renderer key (modern/classic/classic2)
            // the planner used at save time; summariseLessonForFollowups
            // needs it to pick the right field extraction.
            format:       String(row.studioFormat || 'modern'),
          })
        })
        out.sort((a, b) => a.lessonNumber - b.lessonNumber)
        return out
      } catch (err) {
        console.warn('studio series siblings fetch failed', err)
        return []
      }
    }

    // ---- Bridge: fetch the rich detail for one subtopic ----
    // The topics bridge above only surfaces subtopic NAMES (because the
    // studio's hardcoded JS expects { topic: [subName, ...] }). The richer
    // {specificCompetence, learningActivities, expectedStandard} shape lives
    // in the merged source and is what the Lesson Progression planner needs
    // to a) build subject-aware breakdowns and b) ask Claude to suggest a
    // lesson count grounded in the actual syllabus content.
    //
    // Returns { name, specificCompetence, learningActivities, expectedStandard }
    // on a match, null otherwise.
    window.__studioFetchSubtopicDetail = async ({ grade, subject, topic, subtopic }) => {
      if (!grade || !subject || !topic || !subtopic) return null
      try {
        const merged = await getMergedSyllabi()
        const kbTopics = syllabiToKbTopics(merged)
        const wanted = String(subtopic).trim().toLowerCase()
        for (const t of kbTopics) {
          if (t.grade !== grade || t.subject !== subject) continue
          if (String(t.topic || '').trim().toLowerCase() !== String(topic).trim().toLowerCase()) continue
          for (const s of (Array.isArray(t.subtopics) ? t.subtopics : [])) {
            const name = subtopicName(s)
            if (String(name).trim().toLowerCase() !== wanted) continue
            // Legacy string subtopics carry no detail; that's a null match.
            if (typeof s === 'string') return { name, specificCompetence: '', learningActivities: '', expectedStandard: '' }
            return {
              name,
              specificCompetence: String(s.specificCompetence || ''),
              learningActivities: String(s.learningActivities || ''),
              expectedStandard:   String(s.expectedStandard || ''),
            }
          }
        }
        return null
      } catch (err) {
        console.warn('studio subtopic detail fetch failed', err)
        return null
      }
    }

    // ---- Bridge: dynamic subject list per grade from the active CBC KB ----
    // The studio's hardcoded subjectsByLevel maps each level (lp/up/js/ss/al)
    // to a fixed subject list. That can't reflect what an admin has actually
    // uploaded via /admin/curriculum/replace — so when a teacher selects a
    // grade, the dropdown shows the canonical list even if their school's
    // own activated syllabus has a narrower or different one. This bridge
    // returns the distinct subject display names present in the active KB
    // for a given grade; the router uses it (when on the New syllabus
    // toggle) to replace the hardcoded list when the KB has data.
    //
    // Returns Array<string> (subject display names) on success, [] when the
    // KB has no rows for that grade, or null on error.
    const subjectsCache = new Map()
    window.__studioFetchSyllabusSubjects = async ({ grade }) => {
      if (!grade) return []
      if (subjectsCache.has(grade)) return subjectsCache.get(grade)
      try {
        const merged = await getMergedSyllabi()
        const kbTopics = syllabiToKbTopics(merged)
        const seen = new Set()
        const out = []
        for (const t of kbTopics) {
          if (t.grade !== grade || !t.subject || seen.has(t.subject)) continue
          seen.add(t.subject)
          out.push(String(t.subject).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
        }
        if (out.length === 0) {
          // Merged source had nothing for this grade — try direct Firestore.
          const version = await getActiveKbVersion()
          const snap = await getDocs(query(
            collection(db, 'cbcKnowledgeBase', version, 'topics'),
            where('grade', '==', grade),
          ))
          snap.forEach((d) => {
            const t = d.data()
            if (!t || !t.subject) return
            const display = (t.subjectDisplay && String(t.subjectDisplay).trim())
              || String(t.subject).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            if (seen.has(display)) return
            seen.add(display)
            out.push(display)
          })
        }
        out.sort((a, b) => a.localeCompare(b))
        subjectsCache.set(grade, out)
        return out
      } catch (err) {
        console.warn('studio CBC KB subjects fetch failed', err)
        return null
      }
    }

    // ---- Load CSS ----
    if (!document.querySelector('link[href*="/studio/lesson.css"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = `/studio/lesson.css?${STUDIO_ASSET_VERSION}`
      document.head.appendChild(link)
    }

    // ---- Inject studio utility globals ($ $$ esc toast) before scripts run ----
    // Re-set on every mount: the cleanup deletes them, and the rebinders
    // run after this effect, so they need fresh references each time.
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

    // ---- Load scripts in dependency order ----
    const v = `?${STUDIO_ASSET_VERSION}`
    const scripts = [
      `/studio/01-ui-setup.js${v}`,
      `/studio/02-syllabus-new.js${v}`,
      `/studio/02b-curriculum-topics.js${v}`,
      `/studio/03-syllabus-old.js${v}`,
      `/studio/04-syllabus-router.js${v}`,
      `/studio/05-system-prompts.js${v}`,
      `/studio/06-generate.js${v}`,
      `/studio/07-format-preview.js${v}`,
      `/studio/08-edit-mode.js${v}`,
      `/studio/09-symbols.js${v}`,
      `/studio/10-export.js${v}`,
      `/studio/11-diagrams.js${v}`,
      `/studio/12-lesson-progression.js${v}`,
    ]

    loadScriptsSequentially(scripts)
      .then(() => {
        // Re-bind handlers on every mount. On first mount this binds to the
        // freshly-rendered DOM after scripts populate the registry. On
        // subsequent mounts (after navigating away and back) the scripts
        // are cached in <head>, so the rebinders are the only path that
        // attaches click handlers to the new DOM nodes.
        const rebinders = window.__studioRebinders || []
        for (const fn of rebinders) {
          try { fn() } catch (e) { console.error('LessonPlanStudio rebind failed', e) }
        }
      })
      .catch(err => {
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
      delete window.__studioFetchSyllabusTopics
      delete window.__studioFetchSubtopicDetail
      delete window.__studioFetchSyllabusSubjects
      delete window.__studioFetchSeriesSiblings
      delete window.saveToLibrary
      delete window.$
      delete window.$$
      delete window.esc
      delete window.toast
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <SeoHelmet title="Lesson plan studio" noIndex />
      {/* Mobile sidebar scrim */}
      <div className="scrim" id="scrim"></div>

      {/* Studio HTML — exact markup from lesson-markup.html */}
      <div id="view-plans" className="view view-app">
        <div className="app">
          <aside className="sidebar" id="sidebar">
            <div className="brand">
              <picture>
                <source type="image/webp" srcSet="/zedexams-logo.webp?v=1" />
                <img src="/zedexams-logo.png?v=4" className="brand-mark-img" alt="ZedExams" />
              </picture>
              <div className="brand-text">
                <h1>ZedExams</h1>
                <div className="sub">Lesson Plan Studio</div>
              </div>
            </div>
            <div className="tabs">
              <div className="tab active" data-tab="generate">Generate</div>
              <div className="tab" data-tab="style">Style</div>
            </div>

            {/* Generate pane — accordion sections + sticky generate bar */}
            <div className="tab-pane" id="pane-generate">

              {/* 1 · School Identity */}
              <div className="lp-section open" data-section="identity">
                <button type="button" className="lp-section-head">
                  <span className="lp-section-title">School Identity</span>
                  <svg className="lp-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className="lp-section-body">
                  <div className="field"><label>Header line <span className="opt">(optional)</span></label><input type="text" id="f-header" placeholder="e.g. Ministry of Education" /><div className="helper">Leave blank if it doesn't apply.</div></div>
                  <div className="field"><label>School name</label><input type="text" id="f-school" placeholder="e.g. Jemareen Primary School" /></div>
                  <div className="field"><label>Department / sub-line <span className="opt">(optional)</span></label><input type="text" id="f-department" placeholder="e.g. Mathematics Department" /></div>
                </div>
              </div>

              {/* 2 · Lesson Details */}
              <div className="lp-section" data-section="details">
                <button type="button" className="lp-section-head">
                  <span className="lp-section-title">Lesson Details</span>
                  <svg className="lp-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className="lp-section-body">
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
                    <div className="field"><label>Date <span className="opt">(auto)</span></label><input type="date" id="f-date" /></div>
                    <div className="field"><label>Time <span className="opt">(opt.)</span></label><input type="time" id="f-time" /></div>
                  </div>
                </div>
              </div>

              {/* 3 · Topic & Subtopic */}
              <div className="lp-section" data-section="topic">
                <button type="button" className="lp-section-head">
                  <span className="lp-section-title">Topic &amp; Subtopic</span>
                  <span className="lp-section-hint">from CBC syllabus</span>
                  <svg className="lp-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className="lp-section-body">
                  <div className="field"><label>Topic</label><select id="f-topic"><option value="">Select a topic…</option></select></div>
                  <div className="field"><label>Sub-topic</label><select id="f-subtopic"><option value="">Select a sub-topic…</option></select></div>
                </div>
              </div>

              {/* 4 · Learning Environment (NEW) */}
              <div className="lp-section" data-section="environment">
                <button type="button" className="lp-section-head">
                  <span className="lp-section-title">Learning Environment</span>
                  <svg className="lp-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className="lp-section-body">
                  <div className="helper" style={{marginTop:0,marginBottom:'10px'}}>Pick one or more environments this lesson uses.</div>
                  <div className="le-grid" id="learning-env">
                    <button type="button" className="le-pill" data-env="Natural" data-on="false"><span className="name">Natural</span><span className="desc">Gardens, fields, outdoor sites</span></button>
                    <button type="button" className="le-pill" data-env="Artificial" data-on="false"><span className="name">Artificial</span><span className="desc">Classroom, lab, models, charts</span></button>
                    <button type="button" className="le-pill" data-env="Technological" data-on="false"><span className="name">Technological</span><span className="desc">Computers, projector, digital tools</span></button>
                  </div>
                </div>
              </div>

              {/* 5 · Lesson Progression (NEW — planning modes) */}
              <div className="lp-section" data-section="progression">
                <button type="button" className="lp-section-head">
                  <span className="lp-section-title">Lesson Progression</span>
                  <span className="lp-section-hint">one subtopic ≠ one lesson</span>
                  <svg className="lp-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className="lp-section-body">
                  <div className="helper" style={{marginTop:0,marginBottom:'10px'}}>Choose how many lesson plans this subtopic needs. One plan covers one lesson period.</div>

                  {/* Planning mode pills (segmented) */}
                  <div className="lp-mode-grid" id="lp-mode-grid" role="radiogroup" aria-label="Planning mode">
                    <button type="button" className="lp-mode-pill" data-mode="single" data-on="true" role="radio" aria-checked="true">
                      <span className="name">Single lesson</span>
                      <span className="desc">One 40-min plan for this subtopic</span>
                    </button>
                    <button type="button" className="lp-mode-pill" data-mode="multiple" data-on="false" role="radio" aria-checked="false">
                      <span className="name">Multiple lessons</span>
                      <span className="desc">Pick 2–5 (or custom) sequenced plans</span>
                    </button>
                    <button type="button" className="lp-mode-pill" data-mode="week" data-on="false" role="radio" aria-checked="false">
                      <span className="name">Full week plan</span>
                      <span className="desc">One plan per period this week</span>
                    </button>
                    <button type="button" className="lp-mode-pill" data-mode="ai" data-on="false" role="radio" aria-checked="false">
                      <span className="name">Let AI suggest</span>
                      <span className="desc">Reads the syllabus and recommends</span>
                    </button>
                  </div>

                  {/* Multiple-lessons count selector */}
                  <div className="lp-mode-panel" id="lp-panel-multiple" hidden>
                    <div className="field">
                      <label>How many lesson plans?</label>
                      <div className="lp-count-row" id="lp-count-row">
                        <button type="button" className="lp-count-pill" data-count="2">2</button>
                        <button type="button" className="lp-count-pill" data-count="3" data-on="true">3</button>
                        <button type="button" className="lp-count-pill" data-count="4">4</button>
                        <button type="button" className="lp-count-pill" data-count="5">5</button>
                        <button type="button" className="lp-count-pill" data-count="custom">Custom</button>
                      </div>
                      <input type="number" id="f-lp-count-custom" min="2" max="20" defaultValue="6" hidden />
                    </div>
                  </div>

                  {/* Full week — periods per week */}
                  <div className="lp-mode-panel" id="lp-panel-week" hidden>
                    <div className="field">
                      <label>Periods for this subject this week</label>
                      <div className="lp-count-row" id="lp-week-row">
                        <button type="button" className="lp-count-pill" data-week="2">2</button>
                        <button type="button" className="lp-count-pill" data-week="3" data-on="true">3</button>
                        <button type="button" className="lp-count-pill" data-week="4">4</button>
                        <button type="button" className="lp-count-pill" data-week="5">5</button>
                        <button type="button" className="lp-count-pill" data-week="6">6</button>
                      </div>
                      <div className="helper" style={{marginTop:'6px'}}>One lesson plan will be generated per period.</div>
                    </div>
                  </div>

                  {/* AI-suggest panel */}
                  <div className="lp-mode-panel" id="lp-panel-ai" hidden>
                    <button type="button" className="btn lp-ai-btn" id="btn-lp-ai-suggest">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>
                      <span>Suggest a number</span>
                    </button>
                    <div className="lp-ai-banner" id="lp-ai-banner" hidden>
                      <div className="lp-ai-banner-head">
                        <span className="lp-ai-count" id="lp-ai-count">—</span>
                        <span className="lp-ai-count-label">lesson plans suggested</span>
                      </div>
                      <div className="lp-ai-reason" id="lp-ai-reason"></div>
                      <div className="lp-ai-actions">
                        <button type="button" className="lp-ai-accept" id="btn-lp-ai-accept">Accept</button>
                        <button type="button" className="lp-ai-edit" id="btn-lp-ai-edit">Edit number…</button>
                      </div>
                    </div>
                  </div>

                  {/* Breakdown preview — shown whenever a non-single mode resolves to N ≥ 1 lessons */}
                  <div className="lp-breakdown" id="lp-breakdown" hidden>
                    <div className="lp-breakdown-head">
                      <span className="lp-breakdown-title">Lesson breakdown</span>
                      <span className="lp-breakdown-hint" id="lp-breakdown-hint">Edit any focus, or click a row to generate just that lesson.</span>
                    </div>
                    <div className="lp-breakdown-list" id="lp-breakdown-list"></div>
                  </div>

                  {/* Hidden legacy fields — kept so 06-generate.js gatherInput()
                      doesn't break on first load before the new panel writes
                      its values. The new planner overwrites these on every
                      change. */}
                  <input type="hidden" id="f-lessons-total" defaultValue="1" />
                  <input type="hidden" id="f-lessons-current" defaultValue="1" />
                  <input type="hidden" id="f-progress-notes" defaultValue="" />
                </div>
              </div>

              {/* 6 · Teacher Details */}
              <div className="lp-section" data-section="teacher">
                <button type="button" className="lp-section-head">
                  <span className="lp-section-title">Teacher Details</span>
                  <svg className="lp-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className="lp-section-body">
                  <div className="field"><label>Name <span className="opt">(optional)</span></label><input type="text" id="f-teacher" placeholder="e.g. Mwelwa" /></div>
                  <div className="field"><label>TS / ID <span className="opt">(optional)</span></label><input type="text" id="f-tsno" placeholder="e.g. 20158502" /></div>
                </div>
              </div>

              {/* 7 · Format & Options */}
              <div className="lp-section" data-section="format">
                <button type="button" className="lp-section-head">
                  <span className="lp-section-title">Format &amp; Options</span>
                  <svg className="lp-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className="lp-section-body">
                  <div className="format-grid" id="format-cards" style={{gridTemplateColumns:'1fr'}}>
                    <div className="format-card active" data-format="modern">
                      <div className="format-card-body">
                        <div className="format-thumb format-thumb-modern" aria-hidden="true">
                          <div className="t-head"></div>
                          <div className="t-line t-line-md"></div>
                          <div className="t-line t-line-sm"></div>
                          <div className="t-stage"><div className="t-stage-head"></div><div className="t-stage-cols"><div></div><div></div></div></div>
                          <div className="t-stage"><div className="t-stage-head"></div><div className="t-stage-cols"><div></div><div></div></div></div>
                          <div className="t-line t-line-md"></div>
                        </div>
                        <div className="format-card-text">
                          <div className="name">Modern Clean</div>
                          <div className="desc">Per-stage tables · Specific Outcomes, Assessment, Differentiation, Reflection sections.</div>
                        </div>
                      </div>
                      <button type="button" className="format-preview-btn" data-preview-format="modern" aria-label="Preview Modern Clean format">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        <span>Preview</span>
                      </button>
                    </div>
                    <div className="format-card" data-format="classic2">
                      <div className="format-card-body">
                        <div className="format-thumb format-thumb-classic2" aria-hidden="true">
                          <div className="t-head"></div>
                          <div className="t-line t-line-md"></div>
                          <div className="t-line t-line-sm"></div>
                          <div className="t-stage"><div className="t-stage-head"></div><div className="t-stage-cols t-cols-3"><div></div><div></div><div></div></div></div>
                          <div className="t-stage"><div className="t-stage-head"></div><div className="t-stage-cols t-cols-3"><div></div><div></div><div></div></div></div>
                          <div className="t-line t-line-sm"></div>
                        </div>
                        <div className="format-card-text">
                          <div className="name">Classic 2</div>
                          <div className="desc">Per-stage tables (Modern look) with three columns — Teacher's Role, Learners' Role, Assessment Criteria. Includes Teacher's and Learners' Evaluation.</div>
                        </div>
                      </div>
                      <button type="button" className="format-preview-btn" data-preview-format="classic2" aria-label="Preview Classic 2 format">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        <span>Preview</span>
                      </button>
                    </div>
                    <div className="format-card" data-format="classic">
                      <div className="format-card-body">
                        <div className="format-thumb format-thumb-classic" aria-hidden="true">
                          <div className="t-head"></div>
                          <div className="t-line t-line-md"></div>
                          <div className="t-line t-line-sm"></div>
                          <div className="t-table">
                            <div className="t-row t-row-head"><div></div><div></div><div></div><div></div></div>
                            <div className="t-row"><div></div><div></div><div></div><div></div></div>
                            <div className="t-row"><div></div><div></div><div></div><div></div></div>
                            <div className="t-row"><div></div><div></div><div></div><div></div></div>
                          </div>
                        </div>
                        <div className="format-card-text">
                          <div className="name">Classic CBC</div>
                          <div className="desc">Single progression table — Stages, Teacher, Learner, Assessment Criteria.</div>
                        </div>
                      </div>
                      <button type="button" className="format-preview-btn" data-preview-format="classic" aria-label="Preview Classic CBC format">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        <span>Preview</span>
                      </button>
                    </div>
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
                </div>
              </div>

              {/* 8 · Generate — sticky bar.
                  Label changes to "Generate N Lesson Plans" when the planner
                  resolves to a multi-lesson mode (12-lesson-progression.js). */}
              <div className="lp-generate-bar">
                <button className="btn btn-primary" id="btn-generate">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/><path d="M9.6 5.6 8 8 5.6 6.4 4 9l2.4 1.6L5 13l3.4-1.4L10 14l1.6-3.4L15 12l-1.6-3.4L17 7l-3.4 1.4L12 5l-1.6 2.4z"/></svg>
                  <span id="btn-generate-label">Generate Lesson Plan</span>
                </button>
                <div className="helper lp-generate-help">Builds CBC-aligned plans in your chosen format. Edit, restyle, and export when ready.</div>
              </div>
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
      <div className="modal-scrim" id="modal-format-preview">
        <div className="modal modal-wide">
          <div className="modal-head">
            <h3 id="format-preview-title">Format preview</h3>
            <button className="close" data-close-modal>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="modal-body modal-body-flush" id="format-preview-body">
            <div className="format-preview-empty">Loading sample lesson plan…</div>
          </div>
        </div>
      </div>
      <div className="toast" id="toast">Saved</div>

      {/* Loader overlay + spinner animation */}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} #loader.show{display:flex!important}`}</style>
    </>
  )
}
