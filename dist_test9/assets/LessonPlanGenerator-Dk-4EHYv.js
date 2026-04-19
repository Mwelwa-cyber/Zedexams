import{r as j,j as e}from"./react-vendor-n1G6Tmhm.js";import{u as E}from"./index-B0nSJzbV.js";import{T as F,a as O,D as R,b as G,g as z}from"./teacherTools-BC7FOuj2.js";import{d as B}from"./lessonPlanToDocx-Bwa0CPwF.js";import"./router-vendor-4PY3rGDt.js";import"./vendor-B1Wki5oI.js";import"./firebase-vendor-k8PPiJev.js";import"./sanitize-vendor-DKgZpLtg.js";import"./icons-vendor-CY4OHkc8.js";const $="#059669";function W(t,i="CBC Lesson Plan"){if(!t)throw new Error("No lesson plan to export.");const s=window.open("","_blank","noopener,noreferrer,width=900,height=1100");if(!s)throw new Error("Your browser blocked the print window. Please allow pop-ups and try again.");const a=I(t,i);s.document.open(),s.document.write(a),s.document.close();const o=()=>{try{s.focus(),s.print()}catch{}};s.document.readyState==="complete"?setTimeout(o,120):s.addEventListener("load",()=>setTimeout(o,120))}function I(t,i){var b,f,y,h,N,v,x,d,w,S;const s=t.header||{},a=r=>r==null?"":_(String(r)),o=[["School",s.school],["Teacher",s.teacherName],["Date",s.date],["Time",s.time],["Duration",s.durationMinutes?`${s.durationMinutes} min`:""],["Class",s.class],["Subject",s.subject],["Topic",s.topic],["Sub-topic",s.subtopic],["Term & Week",s.termAndWeek],["Number of Pupils",s.numberOfPupils],["Medium",s.mediumOfInstruction]].filter(([,r])=>r!=null&&r!==""),l=r=>(r||[]).length?`<ul>${(r||[]).map(n=>`<li>${a(n)}</li>`).join("")}</ul>`:'<p class="muted">—</p>',u=r=>(r||[]).length?`<ol>${(r||[]).map(n=>`<li>${a(n)}</li>`).join("")}</ol>`:'<p class="muted">—</p>',p=(r,n)=>n?`
      <div class="phase">
        <h4>${a(r)}${n.durationMinutes?` <span class="mins">· ${a(n.durationMinutes)} min</span>`:""}</h4>
        <div class="phase-grid">
          <div>
            <p class="sub">Teacher activities</p>
            ${l(n.teacherActivities)}
          </div>
          <div>
            <p class="sub">Pupil activities</p>
            ${l(n.pupilActivities)}
          </div>
        </div>
      </div>
    `:"",g=(((b=t.lessonDevelopment)==null?void 0:b.development)||[]).map(r=>p(`Development — Step ${a(r.stepNumber)}: ${a(r.title)}`,r)).join(""),m=(t.references||[]).length?`<ul>${t.references.map(r=>`<li>${r.title?`${a(r.title)}${r.publisher?" — "+a(r.publisher):""}${r.year?" ("+a(r.year)+")":""}`:a(r)}</li>`).join("")}</ul>`:'<p class="muted">—</p>';return`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${a(i)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:"Times New Roman",Georgia,serif;color:#0f172a;background:#fff;font-size:12pt;line-height:1.5}
  body{padding:24px 32px;max-width:210mm;margin:0 auto}
  h1{font-size:22pt;font-weight:800;color:${$};letter-spacing:-0.4px;border-bottom:3px solid ${$};padding-bottom:10px;margin-bottom:18px}
  h2{font-size:12pt;font-weight:800;color:${$};text-transform:uppercase;letter-spacing:0.8px;border-left:3px solid ${$};padding-left:9px;margin:18px 0 8px}
  h3{font-size:11pt;font-weight:700;color:#334155;margin:12px 0 4px}
  h4{font-size:11pt;font-weight:700;color:#0f172a;margin:12px 0 6px;border-bottom:1px dashed #cbd5e1;padding-bottom:4px}
  h4 .mins{color:#64748b;font-weight:500;font-size:10pt}
  p{margin:4px 0}
  p.muted{color:#94a3b8;font-style:italic}
  p.sub{font-size:10pt;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px}
  ul,ol{margin:4px 0 4px 22px}
  li{margin:2px 0}
  table{width:100%;border-collapse:collapse;margin:4px 0 12px}
  th,td{border:1px solid #cbd5e1;padding:7px 10px;text-align:left;vertical-align:top;font-size:11pt}
  th{background:#f1f5f9;font-weight:700;width:36%;color:#334155}
  .columns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .phase{margin-bottom:14px;page-break-inside:avoid}
  .phase-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .masthead{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px;border-bottom:2px solid ${$};padding-bottom:10px}
  .brand{font-size:16pt;font-weight:800;color:${$}}
  .brand-sub{font-size:9pt;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;margin-top:2px}
  .masthead-meta{font-size:9pt;color:#64748b;text-align:right}
  .reflection{font-style:italic;color:#64748b}
  @media print{
    body{padding:14mm 16mm;max-width:none}
    h2{page-break-after:avoid}
    .phase{page-break-inside:avoid}
  }
</style>
</head>
<body>
  <div class="masthead">
    <div>
      <div class="brand">ZedExams</div>
      <div class="brand-sub">Zambian CBC · Lesson Plan</div>
    </div>
    <div class="masthead-meta">
      ${new Date().toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"})}
    </div>
  </div>

  <h1>${a(s.topic||"Lesson Plan")}</h1>

  <table>
    <tbody>
      ${o.map(([r,n])=>`<tr><th>${a(r)}</th><td>${a(n)}</td></tr>`).join("")}
    </tbody>
  </table>

  ${(f=t.specificOutcomes)!=null&&f.length?`<h2>Specific Outcomes</h2>${u(t.specificOutcomes)}`:""}

  <div class="columns">
    <div>
      <h3>Key Competencies</h3>
      ${l(t.keyCompetencies)}
    </div>
    <div>
      <h3>Values</h3>
      ${l(t.values)}
    </div>
    <div>
      <h3>Prerequisite Knowledge</h3>
      ${l(t.prerequisiteKnowledge)}
    </div>
  </div>

  <div class="two-col">
    <div>
      <h3>Teaching / Learning Materials</h3>
      ${l(t.teachingLearningMaterials)}
    </div>
    <div>
      <h3>References</h3>
      ${m}
    </div>
  </div>

  <h2>Lesson Development</h2>
  ${p("Introduction",(y=t.lessonDevelopment)==null?void 0:y.introduction)}
  ${g}
  ${p("Conclusion",(h=t.lessonDevelopment)==null?void 0:h.conclusion)}

  <div class="two-col">
    <div>
      <h2>Assessment</h2>
      <h3>Formative</h3>
      ${l((N=t.assessment)==null?void 0:N.formative)}
      ${(x=(v=t.assessment)==null?void 0:v.summative)!=null&&x.description?`
        <h3>Summative</h3>
        <p>${a(t.assessment.summative.description)}</p>
        ${t.assessment.summative.successCriteria?`<p class="muted"><strong>Success criteria:</strong> ${a(t.assessment.summative.successCriteria)}</p>`:""}
      `:""}
    </div>
    <div>
      <h2>Differentiation</h2>
      <h3>For struggling pupils</h3>
      ${l((d=t.differentiation)==null?void 0:d.forStruggling)}
      <h3>For advanced pupils</h3>
      ${l((w=t.differentiation)==null?void 0:w.forAdvanced)}
    </div>
  </div>

  ${(S=t.homework)!=null&&S.description?`
    <h2>Homework</h2>
    <p>${a(t.homework.description)}</p>
    ${t.homework.estimatedMinutes?`<p class="muted">Estimated time: ${a(t.homework.estimatedMinutes)} minutes</p>`:""}
  `:""}

  <h2>Teacher's Reflection</h2>
  <p class="reflection">— What went well? What will you improve next time? Which pupils need follow-up?</p>

</body>
</html>`}function _(t){return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function ce(){const{userProfile:t}=E(),[i,s]=j.useState({grade:"G5",subject:"mathematics",topic:"",subtopic:"",durationMinutes:40,language:"english",teacherName:(t==null?void 0:t.displayName)||(t==null?void 0:t.fullName)||"",school:(t==null?void 0:t.schoolName)||"",numberOfPupils:40,instructions:""}),[a,o]=j.useState("idle"),[l,u]=j.useState(""),[p,g]=j.useState(""),[m,b]=j.useState(null),[f,y]=j.useState(null),[h,N]=j.useState(null),[v,x]=j.useState("");function d(n,c){s(T=>({...T,[n]:c}))}async function w(n){if(n.preventDefault(),!i.topic.trim()){u("Please enter a topic."),o("error");return}o("generating"),u(""),g(""),x(""),b(null);const c=await z(i);if(!c.ok){o("error"),u(c.error),g([c.code&&`code: ${c.code}`,c.rawMessage&&`detail: ${c.rawMessage}`].filter(Boolean).join(" · "));return}b(c.data.lessonPlan),y(c.data.generationId),N(c.data.usage),x(c.data.warning||""),o("success")}function S(){if(!m)return;const n=X(i,m);B(m,n)}function r(){var n;if(m)try{const c=(n=m.header)!=null&&n.topic?`CBC Lesson Plan — ${m.header.topic}`:"CBC Lesson Plan";W(m,c)}catch(c){u((c==null?void 0:c.message)||"Could not open the print window."),o("success"),g(""),x((c==null?void 0:c.message)||"Could not open the print window.")}}return e.jsx("div",{className:"min-h-screen theme-bg p-4 sm:p-6 lg:p-8",children:e.jsxs("div",{className:"max-w-7xl mx-auto",children:[e.jsxs("header",{className:"mb-6",children:[e.jsx("h1",{className:"text-2xl sm:text-3xl font-black theme-text",children:"Lesson Plan Generator"}),e.jsx("p",{className:"text-sm theme-text-secondary mt-1",children:"Zambian CBC format — Specific Outcomes, Key Competencies, Values, three-phase body, Assessment, Differentiation."})]}),e.jsxs("div",{className:"grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6",children:[e.jsxs("form",{onSubmit:w,className:"theme-card border theme-border rounded-2xl p-5 space-y-4 h-fit sticky top-4",children:[e.jsx(L,{label:"Grade",value:i.grade,options:F,onChange:n=>d("grade",n)}),e.jsx(L,{label:"Subject",value:i.subject,options:O,onChange:n=>d("subject",n)}),e.jsx(D,{label:"Topic *",placeholder:"e.g. Fractions",value:i.topic,onChange:n=>d("topic",n),maxLength:120}),e.jsx(D,{label:"Sub-topic (optional)",placeholder:"e.g. Adding Fractions with Unlike Denominators",value:i.subtopic,onChange:n=>d("subtopic",n),maxLength:160}),e.jsx(L,{label:"Lesson duration",value:String(i.durationMinutes),options:R.map(n=>({value:String(n.value),label:n.label})),onChange:n=>d("durationMinutes",Number(n))}),e.jsx(L,{label:"Medium of instruction",value:i.language,options:G,onChange:n=>d("language",n)}),e.jsxs("div",{className:"grid grid-cols-2 gap-3",children:[e.jsx(U,{label:"# of pupils",value:i.numberOfPupils,onChange:n=>d("numberOfPupils",n),min:1,max:200}),e.jsx(D,{label:"School",placeholder:"School name",value:i.school,onChange:n=>d("school",n),maxLength:120})]}),e.jsx(D,{label:"Teacher name",placeholder:"Mr / Mrs ...",value:i.teacherName,onChange:n=>d("teacherName",n),maxLength:80}),e.jsx(H,{label:"Extra instructions (optional)",placeholder:"e.g. Include a group activity. Emphasise real-life market examples.",value:i.instructions,onChange:n=>d("instructions",n),maxLength:500}),e.jsx("button",{type:"submit",disabled:a==="generating",className:"w-full py-3 rounded-xl font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition",children:a==="generating"?"Generating…":"✨ Generate Lesson Plan"}),h&&e.jsxs("div",{className:"text-xs theme-text-secondary text-center",children:[h.used,"/",h.limit," used on the"," ",e.jsx("span",{className:"font-bold capitalize",children:h.plan})," plan this month"]})]}),e.jsxs("section",{className:"theme-card border theme-border rounded-2xl p-5 min-h-[400px]",children:[a==="idle"&&e.jsx(K,{}),a==="generating"&&e.jsx(q,{}),a==="error"&&e.jsx(V,{message:l,detail:p,onDismiss:()=>o("idle")}),a==="success"&&m&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"flex flex-wrap items-center justify-between gap-3 mb-5",children:[e.jsxs("div",{children:[e.jsx("h2",{className:"text-lg font-black theme-text",children:"Your Lesson Plan"}),e.jsx("p",{className:"text-xs theme-text-secondary",children:"Review, edit in your document editor, and print for your head teacher."})]}),e.jsxs("div",{className:"flex gap-2 flex-wrap",children:[e.jsx("button",{onClick:r,title:"Opens the system print dialog — choose 'Save as PDF' as the destination",className:"inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-black border theme-border theme-card theme-text transition-all duration-fast ease-out shadow-elev-sm hover:-translate-y-px hover:border-[var(--accent)] hover:shadow-elev-md",children:"📑 Download PDF"}),e.jsx("button",{onClick:S,className:"inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-black border theme-border theme-card theme-text transition-all duration-fast ease-out shadow-elev-sm hover:-translate-y-px hover:border-[var(--accent)] hover:shadow-elev-md",children:"📄 Download .docx"}),e.jsx("button",{onClick:()=>o("idle"),className:"inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 shadow-elev-sm shadow-elev-inner-hl transition-all duration-fast ease-out hover:-translate-y-px hover:shadow-elev-md",children:"✨ Generate Another"})]})]}),v&&e.jsxs("div",{className:"mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm",children:["⚠️ ",v]}),e.jsx(Y,{plan:m}),f&&e.jsxs("div",{className:"mt-6 text-xs theme-text-secondary",children:["Saved as generation ",e.jsx("code",{children:f}),". Visit your Library to find it again."]})]})]})]})]})})}function A({children:t}){return e.jsx("label",{className:"block text-xs font-bold uppercase tracking-wide theme-text-secondary mb-1",children:t})}function D({label:t,value:i,onChange:s,placeholder:a,maxLength:o}){return e.jsxs("div",{children:[e.jsx(A,{children:t}),e.jsx("input",{type:"text",value:i,onChange:l=>s(l.target.value),placeholder:a,maxLength:o,className:"w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-emerald-500"})]})}function U({label:t,value:i,onChange:s,min:a,max:o}){return e.jsxs("div",{children:[e.jsx(A,{children:t}),e.jsx("input",{type:"number",value:i,onChange:l=>s(Number(l.target.value)),min:a,max:o,className:"w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-emerald-500"})]})}function H({label:t,value:i,onChange:s,placeholder:a,maxLength:o}){return e.jsxs("div",{children:[e.jsx(A,{children:t}),e.jsx("textarea",{value:i,onChange:l=>s(l.target.value),placeholder:a,maxLength:o,rows:3,className:"w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"})]})}function L({label:t,value:i,options:s,onChange:a}){return e.jsxs("div",{children:[e.jsx(A,{children:t}),e.jsx("select",{value:i,onChange:o=>a(o.target.value),className:"w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-emerald-500",children:s.map(o=>e.jsx("option",{value:o.value,children:o.label},o.value))})]})}function K(){return e.jsxs("div",{className:"flex flex-col items-center justify-center h-full py-12 text-center",children:[e.jsx("div",{className:"text-5xl mb-3",children:"📝"}),e.jsx("h3",{className:"text-lg font-black theme-text mb-1",children:"Ready when you are"}),e.jsx("p",{className:"text-sm theme-text-secondary max-w-md",children:"Fill in the grade, subject and topic on the left, then tap Generate. Your lesson plan will appear here — fully formatted in the Zambian CBC style."})]})}function q(){return e.jsxs("div",{className:"flex flex-col items-center justify-center h-full py-12 text-center",children:[e.jsx("div",{className:"text-5xl mb-3 animate-bounce",children:"🧠"}),e.jsx("h3",{className:"text-lg font-black theme-text mb-1",children:"Writing your lesson plan…"}),e.jsx("p",{className:"text-sm theme-text-secondary max-w-md",children:"Usually takes 15–30 seconds. Please don't refresh the page."})]})}function V({message:t,detail:i,onDismiss:s}){return e.jsxs("div",{className:"flex flex-col items-center justify-center h-full py-12 text-center",children:[e.jsx("div",{className:"text-5xl mb-3",children:"⚠️"}),e.jsx("h3",{className:"text-lg font-black theme-text mb-1",children:"Something went wrong"}),e.jsx("p",{className:"text-sm theme-text-secondary max-w-md mb-3",children:t}),i&&e.jsx("p",{className:"text-xs theme-text-secondary/70 max-w-md mb-4 font-mono break-all px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800",children:i}),e.jsx("button",{onClick:s,className:"px-4 py-2 rounded-xl text-sm font-bold border theme-border",children:"Try again"}),e.jsx("p",{className:"text-[10px] theme-text-secondary/60 mt-4 max-w-md",children:"See DEBUG_LESSON_PLAN.md in your project root for the diagnostic checklist."})]})}function Y({plan:t}){var i,s,a,o,l,u,p,g,m,b,f,y,h,N,v,x,d,w,S;return e.jsxs("article",{className:"space-y-6 print:space-y-4",children:[e.jsx(Z,{header:t.header}),e.jsx(C,{title:"Specific Outcomes",children:e.jsx(J,{items:t.specificOutcomes})}),e.jsxs("div",{className:"grid grid-cols-1 md:grid-cols-3 gap-4",children:[e.jsx(P,{title:"Key Competencies",items:t.keyCompetencies}),e.jsx(P,{title:"Values",items:t.values}),e.jsx(P,{title:"Prerequisite Knowledge",items:t.prerequisiteKnowledge})]}),e.jsxs("div",{className:"grid grid-cols-1 md:grid-cols-2 gap-4",children:[e.jsx(P,{title:"Teaching / Learning Materials",items:t.teachingLearningMaterials}),e.jsx(Q,{refs:t.references})]}),e.jsxs(C,{title:"Lesson Development",children:[e.jsx(M,{phase:"Introduction",minutes:(s=(i=t.lessonDevelopment)==null?void 0:i.introduction)==null?void 0:s.durationMinutes,teacher:(o=(a=t.lessonDevelopment)==null?void 0:a.introduction)==null?void 0:o.teacherActivities,pupils:(u=(l=t.lessonDevelopment)==null?void 0:l.introduction)==null?void 0:u.pupilActivities}),(((p=t.lessonDevelopment)==null?void 0:p.development)||[]).map(r=>e.jsx(M,{phase:`Development — Step ${r.stepNumber}: ${r.title}`,minutes:r.durationMinutes,teacher:r.teacherActivities,pupils:r.pupilActivities},r.stepNumber)),e.jsx(M,{phase:"Conclusion",minutes:(m=(g=t.lessonDevelopment)==null?void 0:g.conclusion)==null?void 0:m.durationMinutes,teacher:(f=(b=t.lessonDevelopment)==null?void 0:b.conclusion)==null?void 0:f.teacherActivities,pupils:(h=(y=t.lessonDevelopment)==null?void 0:y.conclusion)==null?void 0:h.pupilActivities})]}),e.jsxs("div",{className:"grid grid-cols-1 md:grid-cols-2 gap-4",children:[e.jsx(C,{title:"Assessment",children:e.jsxs("div",{className:"space-y-3",children:[e.jsxs("div",{children:[e.jsx("h4",{className:"font-bold text-sm mb-1",children:"Formative"}),e.jsx(k,{items:(N=t.assessment)==null?void 0:N.formative})]}),((x=(v=t.assessment)==null?void 0:v.summative)==null?void 0:x.description)&&e.jsxs("div",{children:[e.jsx("h4",{className:"font-bold text-sm mb-1",children:"Summative"}),e.jsx("p",{className:"text-sm theme-text",children:t.assessment.summative.description}),t.assessment.summative.successCriteria&&e.jsxs("p",{className:"text-xs theme-text-secondary mt-1",children:[e.jsx("span",{className:"font-bold",children:"Success criteria: "}),t.assessment.summative.successCriteria]})]})]})}),e.jsx(C,{title:"Differentiation",children:e.jsxs("div",{className:"space-y-3",children:[e.jsxs("div",{children:[e.jsx("h4",{className:"font-bold text-sm mb-1",children:"For struggling pupils"}),e.jsx(k,{items:(d=t.differentiation)==null?void 0:d.forStruggling})]}),e.jsxs("div",{children:[e.jsx("h4",{className:"font-bold text-sm mb-1",children:"For advanced pupils"}),e.jsx(k,{items:(w=t.differentiation)==null?void 0:w.forAdvanced})]})]})})]}),((S=t.homework)==null?void 0:S.description)&&e.jsxs(C,{title:"Homework",children:[e.jsx("p",{className:"text-sm theme-text",children:t.homework.description}),t.homework.estimatedMinutes>0&&e.jsxs("p",{className:"text-xs theme-text-secondary mt-1",children:["Estimated time: ",t.homework.estimatedMinutes," minutes"]})]}),e.jsx(C,{title:"Teacher's Reflection (fill in after teaching)",children:e.jsx("div",{className:"text-sm theme-text-secondary italic",children:"— What went well? What will you improve next time? Which pupils need follow-up?"})})]})}function Z({header:t={}}){const i=[["School",t.school],["Teacher",t.teacherName],["Date",t.date],["Time",t.time],["Duration",t.durationMinutes?`${t.durationMinutes} min`:""],["Class",t.class],["Subject",t.subject],["Topic",t.topic],["Sub-topic",t.subtopic],["Term & Week",t.termAndWeek],["Number of Pupils",t.numberOfPupils],["Medium",t.mediumOfInstruction]].filter(([,s])=>s!=null&&s!=="");return e.jsx("div",{className:"rounded-xl border theme-border overflow-hidden",children:e.jsx("table",{className:"w-full text-sm",children:e.jsx("tbody",{children:i.map(([s,a],o)=>e.jsxs("tr",{className:o%2===0?"bg-slate-50/50 dark:bg-slate-900/20":"",children:[e.jsx("th",{className:"px-3 py-2 text-left font-bold theme-text w-1/3",children:s}),e.jsx("td",{className:"px-3 py-2 theme-text",children:String(a)})]},s))})})})}function C({title:t,children:i}){return e.jsxs("div",{children:[e.jsx("h3",{className:"text-base font-black theme-text mb-2 border-b theme-border pb-1",children:t}),i]})}function P({title:t,items:i}){return e.jsxs("div",{className:"rounded-xl border theme-border p-3",children:[e.jsx("h4",{className:"font-bold text-sm mb-2 theme-text",children:t}),e.jsx(k,{items:i})]})}function J({items:t}){return t!=null&&t.length?e.jsx("ol",{className:"list-decimal list-inside space-y-1 text-sm theme-text",children:t.map((i,s)=>e.jsx("li",{children:i},s))}):e.jsx("p",{className:"text-sm theme-text-secondary italic",children:"—"})}function k({items:t}){return t!=null&&t.length?e.jsx("ul",{className:"list-disc list-inside space-y-1 text-sm theme-text",children:t.map((i,s)=>e.jsx("li",{children:i},s))}):e.jsx("p",{className:"text-sm theme-text-secondary italic",children:"—"})}function Q({refs:t}){return e.jsxs("div",{className:"rounded-xl border theme-border p-3",children:[e.jsx("h4",{className:"font-bold text-sm mb-2 theme-text",children:"References"}),t!=null&&t.length?e.jsx("ul",{className:"space-y-1 text-sm theme-text",children:t.map((i,s)=>e.jsxs("li",{children:[e.jsx("span",{className:"font-bold",children:i.title}),i.publisher&&e.jsxs("span",{children:[" — ",i.publisher]}),i.pages&&e.jsxs("span",{className:"theme-text-secondary",children:[" (pp. ",i.pages,")"]})]},s))}):e.jsx("p",{className:"text-sm theme-text-secondary italic",children:"—"})]})}function M({phase:t,minutes:i,teacher:s=[],pupils:a=[]}){return e.jsxs("div",{className:"rounded-xl border theme-border overflow-hidden mb-3",children:[e.jsxs("div",{className:"px-3 py-2 bg-slate-100 dark:bg-slate-800 border-b theme-border flex justify-between",children:[e.jsx("h4",{className:"font-bold text-sm theme-text",children:t}),i!=null&&e.jsxs("span",{className:"text-xs theme-text-secondary",children:[i," min"]})]}),e.jsxs("div",{className:"grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x theme-border",children:[e.jsxs("div",{className:"p-3",children:[e.jsx("h5",{className:"text-xs uppercase font-bold theme-text-secondary mb-2",children:"Teacher's Activities"}),e.jsx(k,{items:s})]}),e.jsxs("div",{className:"p-3",children:[e.jsx("h5",{className:"text-xs uppercase font-bold theme-text-secondary mb-2",children:"Pupils' Activities"}),e.jsx(k,{items:a})]})]})]})}function X(t,i){var o;const s=l=>String(l||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40);return`${[s(t.teacherName||"teacher"),s(t.grade),s(t.subject),s(((o=i==null?void 0:i.header)==null?void 0:o.topic)||t.topic),new Date().toISOString().slice(0,10)].filter(Boolean).join("_")}.docx`}export{ce as default};
