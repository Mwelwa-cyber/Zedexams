import { humanizeKey, classifyValue } from './liveGenerationSections'

/**
 * Generic renderer for a Live Generation Canvas section value.
 *
 * One renderer serves every studio: `buildSections` classifies each value and
 * this component draws it — a paragraph for text, a bullet list for string
 * arrays, a stack of labelled cards for object arrays, and label/value rows for
 * plain objects (recursing). That's what lets a new studio join the canvas with
 * a config entry instead of a bespoke preview.
 *
 * It intentionally renders a readable *preview* of the model output, not the
 * export-grade document — the studio's own View component (shown after
 * "Continue editing") remains the source of truth for downloads and editing.
 */
export default function LiveGenerationSectionValue({ value, depth = 0 }) {
  const kind = classifyValue(value)

  if (kind === 'empty') return null

  if (kind === 'text') {
    return <Text value={value} />
  }

  if (kind === 'list') {
    const items = value.filter((v) => v !== null && v !== undefined && v !== '')
    return (
      <ul className="list-disc pl-5 space-y-1 text-sm theme-text leading-relaxed">
        {items.map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    )
  }

  if (kind === 'cards') {
    const items = value.filter((v) => v && typeof v === 'object')
    return (
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <Card key={i} index={i} item={item} depth={depth} />
        ))}
      </div>
    )
  }

  // kind === 'fields'
  return <Fields obj={value} depth={depth} />
}

function Text({ value }) {
  const str = String(value)
  // Preserve intentional paragraph breaks from the model.
  const paras = str.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (paras.length <= 1) {
    return <p className="text-sm theme-text leading-relaxed whitespace-pre-line">{str}</p>
  }
  return (
    <div className="space-y-2">
      {paras.map((p, i) => (
        <p key={i} className="text-sm theme-text leading-relaxed whitespace-pre-line">{p}</p>
      ))}
    </div>
  )
}

/**
 * A card for one object in an array. If the object has an obvious title-ish
 * field (name/title/question/term/front/problem/criterion) we lead with it, then
 * render the remaining fields underneath.
 */
function Card({ item, index, depth }) {
  const TITLE_KEYS = ['name', 'title', 'question', 'term', 'front', 'problem', 'criterion', 'week', 'day', 'heading', 'prompt']
  const titleKey = TITLE_KEYS.find((k) => typeof item[k] === 'string' && item[k].trim())
  const rest = Object.keys(item).filter((k) => k !== titleKey && classifyValue(item[k]) !== 'empty')

  return (
    <div className="rounded-xl border theme-border p-3.5">
      <p className="text-sm font-black theme-text mb-1">
        <span className="theme-text-muted mr-1">{index + 1}.</span>
        {titleKey ? String(item[titleKey]) : `Item ${index + 1}`}
      </p>
      {rest.length > 0 && (
        <div className="space-y-1.5 mt-1.5">
          {rest.map((k) => (
            <Field key={k} label={humanizeKey(k)} value={item[k]} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function Fields({ obj, depth }) {
  const keys = Object.keys(obj).filter((k) => classifyValue(obj[k]) !== 'empty')
  return (
    <div className="space-y-1.5">
      {keys.map((k) => (
        <Field key={k} label={humanizeKey(k)} value={obj[k]} depth={depth + 1} />
      ))}
    </div>
  )
}

function Field({ label, value, depth }) {
  const kind = classifyValue(value)
  if (kind === 'empty') return null

  if (kind === 'text') {
    return (
      <p className="text-sm theme-text leading-relaxed">
        <span className="font-bold theme-text">{label}: </span>
        <span className="theme-text whitespace-pre-line">{String(value)}</span>
      </p>
    )
  }

  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wide theme-text-secondary mb-1">{label}</p>
      <LiveGenerationSectionValue value={value} depth={depth} />
    </div>
  )
}
