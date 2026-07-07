// Branded full-screen loader for the auth-resolution window (cold start +
// sign-in). It deliberately mirrors the inline boot skeleton in index.html
// (same beige canvas, ZedExams wordmark, and spinner) so the hand-off from
// the pre-React skeleton to React is seamless — no flash of a blank white
// page while Firebase restores the session, the Firestore profile round-trips,
// and the first route chunk downloads.
//
// This is the heavier sibling of <PageLoader /> (a 3px top bar). Use this ONLY
// for the initial auth gate, where the app would otherwise show white for
// several seconds on slow Zambian mobile networks. Keep <PageLoader /> for
// in-app route/chunk transitions, which must stay lightweight.
export default function FullScreenLoader({ label }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        background: '#FDF6EC',
        fontFamily: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
        zIndex: 9999,
      }}
    >
      <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#1A1F2E' }}>
        Zed<span style={{ color: '#EA580C' }}>Exams</span>
      </div>
      <div
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          border: '3px solid #EBD9C2',
          borderTopColor: '#EA580C',
          borderRadius: '50%',
          animation: 'zed-boot-spin 0.8s linear infinite',
        }}
      />
      {label ? (
        <div style={{ fontSize: '0.9rem', color: '#4B6280', fontWeight: 600 }}>{label}</div>
      ) : null}
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Loading ZedExams…
      </span>
      {/* Reuse the boot skeleton's keyframes name so the spinner keeps turning
          across the skeleton → React hand-off. Defining it again here is safe
          (identical @keyframes) and covers the case where the skeleton was
          already torn down. */}
      <style>{`
        @keyframes zed-boot-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          [role="status"] > [aria-hidden="true"] { animation: none; }
        }
      `}</style>
    </div>
  )
}
