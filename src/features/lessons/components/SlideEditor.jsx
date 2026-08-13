import { createBlankSlide, normalizeStringList, SLIDE_TYPES, SLIDE_TYPE_MAP } from '../lib/lessonConstants'

const FIELD = 'w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-800 outline-none transition-colors focus:border-emerald-500'
const LABEL = 'mb-1.5 block text-xs font-black uppercase tracking-wide text-gray-500'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  )
}

function TextInput({ value, onChange, placeholder }) {
  return <input value={value || ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={FIELD} />
}

function TextArea({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea
      value={value || ''}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`${FIELD} resize-y leading-relaxed`}
    />
  )
}

function BulletsField({ value, onChange }) {
  return (
    <Field label="Bullet points">
      <textarea
        value={normalizeStringList(value).join('\n')}
        onChange={event => onChange(event.target.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))}
        placeholder="Write one point per line"
        rows={5}
        className={`${FIELD} resize-y leading-relaxed`}
      />
    </Field>
  )
}

export default function SlideEditor({ slide, index, total, onChange, onDuplicate, onDelete, onMove }) {
  const typeMeta = SLIDE_TYPE_MAP[slide?.type] ?? SLIDE_TYPE_MAP.text

  function patch(field, value) {
    onChange({ ...slide, [field]: value })
  }

  function changeType(type) {
    const defaults = createBlankSlide(type, {
      id: slide.id,
      title: slide.title,
      subtitle: slide.subtitle,
      body: slide.body,
      bullets: slide.bullets,
      imageUrl: slide.imageUrl,
      imageAlt: slide.imageAlt,
      imageStoragePath: slide.imageStoragePath,
      imageSourcePath: slide.imageSourcePath,
      importAssetId: slide.importAssetId,
      example: slide.example,
      prompt: slide.prompt,
      answer: slide.answer,
      explanation: slide.explanation,
      teacherNotes: slide.teacherNotes,
      requiresReview: slide.requiresReview,
      reviewNotes: slide.reviewNotes,
      importWarnings: slide.importWarnings,
      sourceSlidePath: slide.sourceSlidePath,
    })
    onChange({ ...defaults, type })
  }

  return (
    <div className="space-y-4">
      {slide.requiresReview && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-900">Review this imported slide</p>
          <ul className="mt-2 space-y-1">
            {(slide.reviewNotes?.length ? slide.reviewNotes : ['PowerPoint layout conversion may need a quick check.']).map((note, noteIndex) => (
              <li key={`${note}-${noteIndex}`} className="text-xs font-bold leading-relaxed text-amber-800">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-gray-400">Slide {index + 1} of {total}</p>
          <h2 className="mt-1 text-xl font-black text-gray-900">{typeMeta.label}</h2>
          <p className="mt-1 text-sm font-bold text-gray-500">{typeMeta.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onMove(index, index - 1)} disabled={index === 0} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-black text-gray-600 disabled:opacity-40">
            Up
          </button>
          <button onClick={() => onMove(index, index + 1)} disabled={index === total - 1} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-black text-gray-600 disabled:opacity-40">
            Down
          </button>
          <button onClick={() => onDuplicate(index)} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700">
            Duplicate
          </button>
          <button onClick={() => onDelete(index)} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-600">
            Delete
          </button>
        </div>
      </div>

      <Field label="Slide type">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SLIDE_TYPES.map(type => (
            <button
              key={type.id}
              onClick={() => changeType(type.id)}
              className={`rounded-xl border-2 px-3 py-2 text-left transition-all ${
                slide.type === type.id
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-200'
              }`}
            >
              <span className="block text-sm font-black">{type.icon} {type.label}</span>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Slide title">
          <TextInput value={slide.title} onChange={value => patch('title', value)} placeholder="Slide heading" />
        </Field>
        {(slide.type === 'title' || slide.type === 'end') && (
          <Field label="Subtitle">
            <TextInput value={slide.subtitle} onChange={value => patch('subtitle', value)} placeholder="Short subtitle" />
          </Field>
        )}
      </div>

      {['title', 'text', 'imageText', 'example', 'summary', 'end'].includes(slide.type) && (
        <Field label="Main text">
          <TextArea value={slide.body} onChange={value => patch('body', value)} placeholder="Write learner-facing text" rows={slide.type === 'text' ? 6 : 4} />
        </Field>
      )}

      {(slide.type === 'bullets' || slide.type === 'summary') && (
        <BulletsField value={slide.bullets} onChange={value => patch('bullets', value)} />
      )}

      {slide.type === 'imageText' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Image URL">
            <TextInput
              value={slide.imageUrl}
              onChange={value => onChange({
                ...slide,
                imageUrl: value,
                imageStoragePath: '',
                imageSourcePath: '',
                importAssetId: '',
              })}
              placeholder="https://example.com/diagram.png"
            />
          </Field>
          <Field label="Image alt text">
            <TextInput value={slide.imageAlt} onChange={value => patch('imageAlt', value)} placeholder="Describe the image" />
          </Field>
        </div>
      )}

      {slide.type === 'example' && (
        <>
          <Field label="Example">
            <TextArea value={slide.example} onChange={value => patch('example', value)} placeholder="Add the worked example" rows={4} />
          </Field>
          <Field label="Explanation">
            <TextArea value={slide.explanation} onChange={value => patch('explanation', value)} placeholder="Explain the example" rows={3} />
          </Field>
        </>
      )}

      {slide.type === 'question' && (
        <>
          <Field label="Activity or question">
            <TextArea value={slide.prompt} onChange={value => patch('prompt', value)} placeholder="Ask learners to do something" rows={4} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Answer">
              <TextArea value={slide.answer} onChange={value => patch('answer', value)} placeholder="Correct answer" rows={4} />
            </Field>
            <Field label="Explanation">
              <TextArea value={slide.explanation} onChange={value => patch('explanation', value)} placeholder="Short explanation" rows={4} />
            </Field>
          </div>
        </>
      )}

      <Field label="Teacher notes">
        <TextArea value={slide.teacherNotes} onChange={value => patch('teacherNotes', value)} placeholder="Private notes for presentation mode" rows={3} />
      </Field>
    </div>
  )
}
