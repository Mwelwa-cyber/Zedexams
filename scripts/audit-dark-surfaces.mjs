#!/usr/bin/env node
/* global console, process, document, getComputedStyle */
/**
 * The dark-mode audit: render every themed surface against the REAL built
 * stylesheets and measure what is painted.
 *
 * WHY MEASURE RATHER THAN GREP
 * The two worst bugs found in this work were both invisible to a grep. The
 * quiz editor was unreadable at 1.04:1 while containing no "wrong" colour at
 * all — its surfaces were pinned light and its ink followed the theme, and
 * each half looked correct on its own. /my-subscription rendered fully bright
 * while being 100% tokenised, because it was tokenised in the token set the
 * OTHER theme system owns. Neither shows up as a literal.
 *
 * WHAT IT CHECKS, PER THEME
 *  - every text/background pair against WCAG AA, with translucent layers
 *    COMPOSITED down to the colour actually painted (a frosted bar or an rgba
 *    chip measured as if opaque reports a ratio against a colour nothing
 *    draws — that reads as a pass and hides a real failure)
 *  - how much of the painted area is light, so a surface that contrasts fine
 *    but is still a white slab on a dark page is caught
 *  - the surfaces that are SUPPOSED to stay light, asserted as light rather
 *    than left to inspection: the A4 paper preview, the image-judging canvas
 *    in Visual Studio, the print-preview sheet
 *
 * Not in test:all — it needs a `dist/` build and a real Chromium, like the
 * mobile smoke. Run: npm run build && npm run audit:dark
 */
import puppeteer from 'puppeteer'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist/assets'
if (!existsSync(DIST)) {
  console.error('No dist/ build found. Run `npm run build` (or `npm run smoke:build`) first.')
  process.exit(2)
}
const css = readdirSync(DIST)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(DIST, f), 'utf8'))
  .join('\n')

// The two studio stylesheets that ship inside JSX template literals and so
// never reach a .css file.
function inlineStyle(file) {
  const m = readFileSync(file, 'utf8').match(/<style>\{`([\s\S]*?)`\}<\/style>/)
  return m ? m[1] : ''
}
const extraCss = [
  'src/components/teacher/SyllabiLibrary.jsx',
  'src/components/admin/CbcKbAdmin.jsx',
].map(inlineStyle).join('\n')

/* ── The surfaces, and what each is expected to be ─────────────────────── */
// `expect: 'light'` marks a surface that must stay light in EVERY theme and
// says why. Anything else is expected to follow the theme.
const SURFACES = [
  {
    id: 'shared', name: 'Shared pages + ui/ primitives',
    html: `<div class="min-h-screen theme-bg" data-s>
      <div class="zx-card rounded-3xl border theme-border theme-card p-5" data-s>
        <p class="theme-text">Free plan</p><p class="theme-text-muted">Renews 12 May</p>
        <div class="rounded-2xl theme-bg-subtle px-3 py-2.5" data-s><span class="theme-text">8 left</span></div>
      </div></div>`,
  },
  {
    id: 'modal', name: 'Shared modal / overlay',
    html: `<div class="theme-card theme-text rounded-t-3xl p-5" data-s>
      <div class="h-1 w-10 rounded-full theme-bg-subtle"></div>
      <p class="theme-text">Confirm this action</p>
      <p class="theme-text-muted">This cannot be undone.</p>
      <div class="border-t theme-border theme-card px-5 pt-2.5" data-s><span class="theme-text">Cancel</span></div>
    </div>`,
  },
  {
    id: 'studio', name: 'Teacher studio design system',
    html: `<div class="studio-theme studio-page" data-s><div class="studio-card" style="padding:14px" data-s>
      <span class="studio-eyebrow">Teacher tools</span>
      <label class="studio-label">Grade</label>
      <select class="studio-input"><option>Grade 5</option></select>
      <span class="studio-badge">Draft</span>
      <button class="studio-btn-ghost">Cancel</button></div></div>`,
  },
  {
    id: 'assessment', name: 'Assessment Paper Studio',
    html: `<div class="studio-v2" data-s><div class="sv-app-bar" data-s>Studio</div>
      <div class="sv-field"><label>Grade</label><select><option>5</option></select></div>
      <span class="sv-status-pill draft">Draft</span><span class="sv-status-pill ready">Ready</span>
      <div class="sv-warn-error">Blocked</div></div>`,
  },
  {
    id: 'paper', name: 'A4 paper preview', expect: 'light',
    why: 'a picture of the sheet that comes out of the printer',
    html: `<div class="studio-v2"><div class="sv-preview-shell"><div class="sv-paper" data-s>
      <p>GRADE 4 END OF TERM 1 TEST</p></div></div></div>`,
  },
  {
    id: 'lesson', name: 'Lesson Plan Studio',
    html: `<div class="lps-game studio-theme" data-s><div class="lps-soft-shadow" style="padding:14px" data-s>
      <span class="lps-eyebrow">TEACHER STUDIO</span>
      <select><option>CBC</option></select>
      <button class="lps-btn-ghost">Save &amp; exit</button></div></div>`,
  },
  {
    id: 'editor', name: 'Quiz editor', expect: 'light',
    why: 'a document-authoring canvas, pinned light by design (color-scheme: light)',
    html: `<div class="qe-page" data-s><div class="editor-area" data-s><div class="re-wrap" data-s>
      <p>Question stem</p></div></div><div class="toolbar" data-s>B I U</div></div>`,
  },
  {
    id: 'calendar', name: 'MoE school calendar',
    html: `<div class="moe-calendar" style="background:var(--moe-page-bg)" data-s>
      <div style="background:var(--moe-surface);color:var(--moe-fg)" data-s>Term 2</div></div>`,
  },
  {
    id: 'notes', name: 'Notes / lessons reader',
    html: `<div class="notes-studio" data-s><div class="notes-card" style="padding:10px" data-s>A note</div></div>`,
  },
  {
    // The shape the neutral-vocabulary remap exists for: a page whose own
    // background is tokenised and goes dark, carrying cards written in
    // Tailwind literals that do not. Lifted from QuizRunnerV2.
    id: 'runner', name: 'Quiz runner (tokenised page, literal cards)',
    html: `<div class="theme-bg theme-text min-h-screen px-3 py-8" data-s>
      <div class="bg-white rounded-2xl border border-slate-200 p-5" data-s>
        <p class="text-slate-900">What is 3/4 of 20?</p>
        <p class="text-slate-500">Question 3 of 10</p>
        <button class="bg-slate-100 border border-slate-300 text-slate-800 px-3 py-2" data-s>A. 15</button>
      </div></div>`,
  },
  {
    id: 'games', name: 'Games / quiz list',
    html: `<div class="force-light-theme" data-s><div class="bg-white p-4" data-s>
      <span class="text-slate-900">Leaderboard</span></div></div>`,
  },
  {
    id: 'syllabi', name: 'Syllabi Studio',
    html: `<div class="ss-root" data-s><div class="ss-main" data-s>
      <h2 class="ss-sh-title">Grade 5 Mathematics</h2>
      <div class="ss-sri-meta">Grade 5</div></div></div>`,
  },
  {
    id: 'vstudio', name: 'Visual Studio chrome',
    html: `<div class="vstudio" data-s><div class="vs-panel" data-s>
      <span class="vs-hint">Pick a style</span></div></div>`,
  },
  {
    id: 'vscanvas', name: 'Visual Studio image canvas', expect: 'light',
    why: 'a generated picture is judged against a constant surround',
    html: `<div class="vstudio"><div class="vs-stage"><div class="vs-canvas" data-s>img</div></div></div>`,
  },
]

// Which theme system a surface answers to. The teacher studios follow the
// WORKSPACE theme — a teacher whose reading theme is Midnight but whose
// workspace theme is Terracotta gets a light studio, and that is correct, not
// a miss. Getting this wrong makes the audit demand that a studio track a
// preference its own palette deliberately ignores.
const FOLLOWS = {
  studio: 'workspace', assessment: 'workspace', lesson: 'workspace',
  syllabi: 'workspace', vstudio: 'workspace', calendar: 'either',
  shared: 'either', modal: 'either', notes: 'either', games: 'either',
  runner: 'either',
}

const THEMES = [
  { id: 'terracotta', name: 'teacher · Terracotta', body: 'theme-oatmeal', attr: 'terracotta', dark: false },
  { id: 'night', name: 'teacher · Night', body: 'theme-oatmeal', attr: 'night', dark: true },
  { id: 'oatmeal', name: 'learner · Oatmeal', body: 'theme-oatmeal', attr: 'terracotta', dark: false },
  { id: 'midnight', name: 'learner · Midnight', body: 'theme-midnight', attr: 'terracotta', dark: true },
]

const MEASURE = `(() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (f, b) => ({ r: f.r*f.a + b.r*(1-f.a), g: f.g*f.a + b.g*(1-f.a), b: f.b*f.a + b.b*(1-f.a), a: 1 })
  const lum = (c) => { const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b) }
  const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05) }
  // Composite the ancestor chain. A gradient/image is unreadable from computed
  // style, so it returns null rather than a fabricated number.
  const effBg = (el) => {
    const stack=[]; let n=el
    while(n){ const cs=getComputedStyle(n)
      if(cs.backgroundImage && cs.backgroundImage!=='none') return null
      const c=parse(cs.backgroundColor); if(c&&c.a>0) stack.push(c); if(c&&c.a===1) break
      n=n.parentElement }
    let base={r:255,g:255,b:255,a:1}
    for(let i=stack.length-1;i>=0;i--) base=over(stack[i],base)
    return base
  }
  const label=(el)=>el.tagName.toLowerCase()+(typeof el.className==='string'&&el.className.trim()
    ? '.'+el.className.trim().split(/\\s+/).slice(0,3).join('.') : '')
  const pairs=[], skipped=[]
  document.querySelectorAll('*').forEach((el)=>{
    if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())) return
    const cs=getComputedStyle(el)
    if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0) return
    const r=el.getBoundingClientRect(); if(r.width<2||r.height<2) return
    const fg=parse(cs.color); if(!fg) return
    const bg=effBg(el); if(!bg){ skipped.push(label(el)); return }
    const px=parseFloat(cs.fontSize), bold=Number(cs.fontWeight)>=700
    const large=px>=24||(px>=18.66&&bold)
    pairs.push({ sel:label(el), text:el.innerText.trim().slice(0,32),
      ratio:Math.round(ratio(over(fg,bg),bg)*100)/100, min:large?3:4.5,
      fg:cs.color, bg:'rgb('+[bg.r,bg.g,bg.b].map(Math.round).join(',')+')' })
  })
  // Painted area by tone, over the elements explicitly marked as surfaces.
  let light=0, total=0
  document.querySelectorAll('[data-s]').forEach((el)=>{
    const bg=effBg(el); if(!bg) return
    const r=el.getBoundingClientRect(); if(r.width<4||r.height<4) return
    const a=r.width*r.height; total+=a; if(lum(bg)>0.5) light+=a
  })
  return { pairs, skipped, lightArea:Math.round(light), totalArea:Math.round(total) }
})()`

const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

const rows = []
let failures = 0
for (const surface of SURFACES) {
  const row = { surface, byTheme: {} }
  for (const theme of THEMES) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1100, height: 800 })
    await page.setContent(
      `<!doctype html><html data-theme="${theme.attr}"${theme.id === 'midnight' ? ' class="dark"' : ''}>` +
      `<head><style>${css}</style><style>${extraCss}</style></head>` +
      `<body class="${theme.body}">${
        FOLLOWS[surface.id] === 'workspace'
          // NESTED, not one element with both classes: the rule is
          // `.studio-theme .studio-page`, a DESCENDANT selector, so a single
          // <div class="studio-theme studio-page"> matches neither half and
          // the shell paints nothing. The surface then shows <body> — the
          // READING theme — and the audit reports a mixed-theme failure that
          // only exists in the harness.
          ? `<div class="studio-theme"><div class="studio-page">${surface.html}</div></div>`
          : surface.html
      }</body></html>`,
      { waitUntil: 'domcontentloaded' },
    )
    await new Promise((r) => setTimeout(r, 120))
    row.byTheme[theme.id] = await page.evaluate(MEASURE)
    await page.close()
  }
  rows.push(row)
}
await browser.close()

/* ── Report ───────────────────────────────────────────────────────────── */
const pct = (r) => (r.totalArea ? (r.lightArea / r.totalArea) * 100 : 0)

console.log('# Dark-surface audit\n')
console.log('| Surface | ' + THEMES.map((t) => t.name).join(' | ') + ' |')
console.log('|---|' + THEMES.map(() => '---').join('|') + '|')
for (const { surface, byTheme } of rows) {
  const cells = THEMES.map((t) => {
    const r = byTheme[t.id]
    const light = pct(r) > 50
    const bad = r.pairs.filter((p) => p.ratio < p.min).length
    const tone = light ? 'light' : 'dark'
    const follows = FOLLOWS[surface.id] || 'either'
    const isDark = follows === 'workspace' ? t.attr === 'night'
      : follows === 'reading' ? t.body === 'theme-midnight'
      : t.dark
    const wanted = surface.expect === 'light' ? 'light' : isDark ? 'dark' : 'light'
    const ok = tone === wanted && bad === 0
    if (!ok) failures++
    return `${ok ? '✓' : '✗'} ${tone}${bad ? ` · ${bad} low` : ''}`
  })
  console.log(`| ${surface.name}${surface.expect === 'light' ? ' *' : ''} | ${cells.join(' | ')} |`)
}
console.log('\n`*` = intentionally light in every theme:')
for (const { surface } of rows.filter((r) => r.surface.expect === 'light')) {
  console.log(`  - **${surface.name}** — ${surface.why}`)
}

const problems = []
for (const { surface, byTheme } of rows) {
  for (const theme of THEMES) {
    for (const p of byTheme[theme.id].pairs.filter((x) => x.ratio < x.min)) {
      problems.push(`${surface.name} · ${theme.name}: ${p.ratio}:1 (need ${p.min}) ${p.sel} — "${p.text}" ${p.fg} on ${p.bg}`)
    }
  }
}
if (problems.length) {
  console.log(`\n## ${problems.length} contrast failures\n`)
  for (const p of problems) console.log(`  ✗ ${p}`)
}
console.log(`\n${failures === 0 ? 'All surfaces correct in all four themes.' : `${failures} surface/theme combinations wrong.`}`)
process.exit(failures ? 1 : 0)
