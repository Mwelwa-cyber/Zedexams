/**
 * ActivityTimeline — the day-grouped feed of what a child has been
 * doing. Used compactly on the child screen and in full on its own page.
 *
 * The grouping and the day headings are the server's (see
 * parentAppCore.groupActivityByDay) — a Cloud Function runs in UTC and
 * Zambia is UTC+2, so a client that re-derived "Today" from the raw
 * timestamps would disagree with the server about every evening after
 * 22:00. One decision, made once, in the place that can be tested.
 */
export default function ActivityTimeline({ days }) {
  if (!days || days.length === 0) return null

  return (
    <div>
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h3 className="pax-tl-day">{day.label}</h3>
          {day.items.map((item, i) => (
            <div
              className={`pax-tl-item${item.highlight ? ' is-win' : ''}`}
              key={`${day.key}-${i}`}
            >
              <span className="pax-tl-icon" aria-hidden="true">{item.icon || '•'}</span>
              <div className="pax-tl-body">
                <b>
                  {item.title}
                  {Number.isFinite(item.score) ? ` — ${item.score}%` : ''}
                </b>
                <div className="pax-tl-meta">
                  {[item.time, item.subjectLabel].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
