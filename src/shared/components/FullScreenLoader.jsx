// Branded full-screen loader for the auth-resolution window (cold start +
// sign-in). It deliberately mirrors the inline boot skeleton in index.html
// (same beige canvas, brand ring loader, wordmark, and progress bar) so the
// hand-off from the pre-React skeleton to React is seamless — no flash of a
// blank white page while Firebase restores the session, the Firestore profile
// round-trips, and the first route chunk downloads.
//
// The animation is the "new" brand loader introduced by
// SessionRestorationScreen's LoaderRing: a soft orange glow, a faint track
// ring, two counter-rotating arcs (brand blue + brand orange, each with a
// leading dot), and the ZedExams app-icon badge at the centre, over an
// indeterminate blue→orange progress bar. It intentionally REUSES the boot
// skeleton's `zed-boot-*` class + keyframes names so the ring keeps turning
// across the skeleton → React swap; re-defining identical rules here is safe
// and covers the case where the skeleton was already torn down.
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
        padding: 20,
        boxSizing: 'border-box',
        background: 'var(--zt-surface)',
        fontFamily: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
        zIndex: 9999,
      }}
    >
      <div className="zed-boot-loader" aria-hidden="true">
        <div className="zed-boot-glow" />
        <svg className="zed-boot-ring" viewBox="0 0 160 160" role="presentation">
          <circle className="zed-boot-track" cx="80" cy="80" r="72" />
          <g className="zed-boot-arc zed-boot-arc--blue">
            <circle className="zed-boot-stroke zed-boot-stroke--blue" cx="80" cy="80" r="72" />
            <circle className="zed-boot-dot--blue" cx="80" cy="8" r="6" />
          </g>
          <g className="zed-boot-arc zed-boot-arc--orange">
            <circle className="zed-boot-stroke zed-boot-stroke--orange" cx="80" cy="80" r="72" />
            <circle className="zed-boot-dot--orange" cx="80" cy="152" r="6" />
          </g>
        </svg>
        <img
          className="zed-boot-badge"
          src="/zedexams-app-icon.jpg?v=1"
          alt=""
          aria-hidden="true"
          width="64"
          height="64"
          draggable="false"
        />
      </div>
      <div
        aria-hidden="true"
        style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#1A1F2E' }}
      >
        Zed<span style={{ color: '#C5613F' }}>Exams</span>
      </div>
      {label ? (
        <div style={{ fontSize: '0.9rem', color: 'var(--info-fg)', fontWeight: 600 }}>{label}</div>
      ) : null}
      <div className="zed-boot-bar" aria-hidden="true">
        <div className="zed-boot-bar-fill" />
      </div>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Loading ZedExams…
      </span>
      <style>{`
        .zed-boot-loader { position: relative; width: 140px; height: 140px; display: grid; place-items: center; }
        .zed-boot-glow { position: absolute; inset: -18%; border-radius: 50%; background: radial-gradient(circle, rgba(197, 97, 63, 0.22) 0%, rgba(197, 97, 63, 0) 68%); filter: blur(6px); animation: zed-boot-glow 2.8s ease-in-out infinite; }
        .zed-boot-ring { position: absolute; inset: 0; width: 100%; height: 100%; }
        .zed-boot-track { fill: none; stroke: #EBD9C2; stroke-width: 5; opacity: 0.5; }
        .zed-boot-arc { transform-origin: 50% 50%; animation: zed-boot-spin 1.5s linear infinite; }
        .zed-boot-arc--orange { animation-duration: 1.9s; animation-direction: reverse; }
        .zed-boot-stroke { fill: none; stroke-width: 5; stroke-linecap: round; stroke-dasharray: 135 320; }
        .zed-boot-stroke--blue { stroke: #2563EB; }
        .zed-boot-stroke--orange { stroke: #C5613F; }
        .zed-boot-dot--blue { fill: #2563EB; }
        .zed-boot-dot--orange { fill: #C5613F; }
        .zed-boot-badge { position: relative; z-index: 1; width: 64px; height: 64px; border-radius: 16px; object-fit: cover; box-shadow: 0 6px 16px rgba(26, 31, 46, 0.28); user-select: none; -webkit-user-drag: none; }
        .zed-boot-bar { position: relative; width: min(78vw, 320px); height: 4px; border-radius: 999px; background: #EBD9C2; overflow: hidden; }
        .zed-boot-bar-fill { position: absolute; top: 0; left: 0; height: 100%; width: 40%; border-radius: 999px; background: linear-gradient(90deg, #2563EB, #C5613F); animation: zed-boot-bar 1.5s cubic-bezier(0.65, 0, 0.35, 1) infinite; }
        @media (max-width: 767px) { .zed-boot-loader { width: 112px; height: 112px; } }
        @keyframes zed-boot-spin { to { transform: rotate(360deg); } }
        @keyframes zed-boot-glow { 0%, 100% { opacity: 0.55; transform: scale(0.96); } 50% { opacity: 1; transform: scale(1.04); } }
        @keyframes zed-boot-bar { 0% { left: -40%; width: 40%; } 50% { left: 25%; width: 55%; } 100% { left: 100%; width: 40%; } }
        @media (prefers-reduced-motion: reduce) {
          .zed-boot-arc, .zed-boot-glow { animation: none; }
          .zed-boot-bar-fill { animation: none; left: 0; width: 100%; opacity: 0.8; }
        }
      `}</style>
    </div>
  )
}
