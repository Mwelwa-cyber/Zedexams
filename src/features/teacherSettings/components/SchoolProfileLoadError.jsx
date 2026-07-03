// Blocking error strip for the schoolProfiles-backed panels. Shown when the
// saved doc could not be read — editing stays disabled so a blank form can
// never be saved over real data (see useSchoolProfileForm).
export default function SchoolProfileLoadError({ school }) {
  if (!school.loadError) return null
  return (
    <section className="tset-section" style={{ borderColor: '#f3cdcd' }}>
      <p className="tset-section__hint" style={{ margin: '0 0 12px', color: '#b91c1c', fontWeight: 700 }}>
        We couldn't load your saved school details — editing is paused so
        nothing gets overwritten. Check your connection and retry.
      </p>
      <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={school.retry}>
        Retry
      </button>
    </section>
  )
}
