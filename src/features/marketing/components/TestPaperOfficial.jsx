/**
 * TestPaperOfficial — the printed test paper a Zambian primary school
 * hands out: centred school head, NAME / DATE / TOTAL MARKS blanks, an
 * INSTRUCTIONS line, then lettered sections of numbered questions with
 * inline A–D options.
 *
 * Reads a `paper` artifact (see src/data/teacherSamples.js, the
 * 'term-tests' sample). Question types:
 *   mcq          — { n, prompt, options[] }   inline lettered options
 *   subhead      — { text }                   e.g. "Questions 7–10: True or False"
 *   label-diagram— { n, prompt, diagram, wordBank?, slots[] }
 *   fill-letters — { n, prompt, parts[{ letter, text }] }
 *
 * Serif on white, mirroring the other official-document renderers.
 */

const DOC_FONT = { fontFamily: "Georgia, 'Times New Roman', serif" }
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E']

function McqQuestion({ q }) {
  return (
    <div className="mt-2.5">
      <p className="font-medium">{q.n}. {q.prompt}</p>
      <div className="mt-1 pl-5 flex flex-wrap gap-x-8 gap-y-1">
        {q.options.map((opt, i) => (
          <span key={i}>
            <strong className="font-bold">{OPTION_LETTERS[i]}.</strong> {opt}
          </span>
        ))}
      </div>
    </div>
  )
}

function LabelDiagram({ q }) {
  return (
    <div className="mt-2.5">
      <p className="font-medium">{q.n}. {q.prompt}</p>
      {q.wordBank?.length > 0 && (
        <div className="mt-2 border border-black px-3 py-2 inline-block">
          <span className="font-bold">Use these words: </span>
          {q.wordBank.join(' · ')}
        </div>
      )}
      {q.image ? (
        <div className="mt-3 mx-auto w-full max-w-[420px] relative">
          <img
            src={q.image}
            alt={q.imageAlt || q.diagram}
            width={q.imageWidth || 640}
            height={q.imageHeight || 381}
            loading="lazy"
            className="w-full h-auto"
          />
          {/* Letter callouts pinned on the parts to label — what makes the
              task answerable. x/y are percentages of the image box. */}
          {(q.markers || []).map((m) => (
            <span
              key={m.letter}
              className="absolute grid place-items-center w-[22px] h-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border-[1.5px] border-black font-bold text-[12px] leading-none shadow-[0_0_0_1.5px_rgba(255,255,255,0.9)]"
              style={{ left: `${m.x}%`, top: `${m.y}%` }}
              aria-hidden="true"
            >
              {m.letter}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-2 border border-dashed border-black/60 rounded-sm h-36 grid place-items-center text-black/50 italic">
          [ {q.diagram} ]
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
        {q.slots.map((letter) => (
          <span key={letter}><strong className="font-bold">{letter}.</strong> ____________________</span>
        ))}
      </div>
    </div>
  )
}

function FillLetters({ q }) {
  return (
    <div className="mt-2.5">
      <p className="font-medium">{q.n}. {q.prompt}</p>
      <div className="mt-1 pl-5 space-y-1.5">
        {q.parts.map((part) => (
          <p key={part.letter}><strong className="font-bold">{part.letter}.</strong> {part.text} ____________________</p>
        ))}
      </div>
    </div>
  )
}

export default function TestPaperOfficial({ paper }) {
  if (!paper) return null
  const h = paper.header || {}

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-5 py-6 sm:px-8 text-[13px]"
      style={DOC_FONT}
    >
      {/* Paper head */}
      <div className="text-center">
        <div className="text-lg font-bold uppercase">{h.school}</div>
        <div className="mt-0.5 text-base font-bold uppercase">{h.title}</div>
        <div className="mt-1 border-y border-black py-1 text-sm font-bold tracking-[0.14em] uppercase">
          {h.subject} · Grade {h.grade}
        </div>
      </div>

      {/* Candidate lines */}
      <div className="mt-4 flex flex-wrap justify-between gap-x-8 gap-y-1.5">
        <span><strong className="font-bold">NAME:</strong> ________________________________</span>
        <span><strong className="font-bold">DATE:</strong> _________________</span>
      </div>
      <p className="mt-1.5"><strong className="font-bold">TOTAL MARKS:</strong> _________</p>
      <p className="mt-2.5"><strong className="font-bold">INSTRUCTIONS:</strong> {paper.instructions}</p>

      {/* Sections */}
      {(paper.sections || []).map((section, si) => (
        <section key={si} className="mt-5">
          <h3 className="font-bold">
            <span className="uppercase underline">{section.title}</span>
            {section.intro && <>: &nbsp;{section.intro}</>}
          </h3>
          {(section.questions || []).map((q, qi) => {
            if (q.type === 'subhead') {
              return <p key={qi} className="mt-3 font-bold italic">{q.text}</p>
            }
            if (q.type === 'label-diagram') return <LabelDiagram key={qi} q={q} />
            if (q.type === 'fill-letters') return <FillLetters key={qi} q={q} />
            return <McqQuestion key={qi} q={q} />
          })}
        </section>
      ))}

      <p className="mt-6 text-center font-bold tracking-[0.2em]">— END OF TEST —</p>
    </article>
  )
}
