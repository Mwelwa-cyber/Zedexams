// Expanded "Detected from" panel under an assignment row: the documents that
// caused the assignment to be suggested (title — type · date). Never shows
// internal Firestore document ids.

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

function formatDate(dateMs) {
  if (!Number.isFinite(dateMs)) return ''
  try {
    return DATE_FMT.format(new Date(dateMs))
  } catch {
    return ''
  }
}

export default function AssignmentSourceDetails({ id, sources = [] }) {
  const list = (Array.isArray(sources) ? sources : []).filter(Boolean)
  return (
    <div className="tset-dta-sources" id={id}>
      <p className="tset-dta-sources__lead">Detected from:</p>
      {list.length === 0 ? (
        <p className="tset-dta-sources__empty">
          Suggested from your recent teaching documents.
        </p>
      ) : (
        <ul className="tset-dta-sources__list">
          {list.map((src, i) => {
            const date = formatDate(src.dateMs)
            return (
              <li key={src.id || i} className="tset-dta-sources__item">
                <span className="tset-dta-sources__title">{src.title || src.typeLabel || 'Document'}</span>
                <span className="tset-dta-sources__meta">
                  {src.typeLabel || 'Document'}
                  {date ? ` · ${date}` : ''}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
