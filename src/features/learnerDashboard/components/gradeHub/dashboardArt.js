/**
 * The dashboard's character art, and the decorative star positions behind the
 * hero.
 *
 * Data, not components — GradeHub itself picks a character for each action
 * card, so this cannot live inside `DashboardCharacter`. Both constants keep
 * their identity at module scope on purpose: `FloatingStar` is memoised, and
 * an inline style literal at the call site would hand it a new object every
 * render and defeat the memo.
 */

// Dashboard character art. WebP ships as both the <source> and the <img>
// fallback — every browser the app supports (Android Chrome 32+, iOS 14+)
// has native WebP decode, and the PNG originals were 5 MB of redundant
// hosting weight. Intrinsic pixel dimensions are passed to the <img> so
// the browser can reserve space and avoid CLS as images load.
export const DASHBOARD_CHARACTERS = {
  hero:  { src: '/images/characters/zed-zara-reading.webp?v=2', width: 1200, height: 960 },
  exams: { src: '/images/characters/todays-exams.webp?v=1',     width: 1075, height: 971 },
  games: { src: '/images/characters/zed-games.webp?v=1',        width: 1140, height: 866 },
  notes:     { src: '/images/characters/notes-notebook.webp?v=1',       width: 822, height: 887 },
  papers:    { src: '/images/characters/past-papers-clipboard.webp?v=1', width: 896, height: 924 },
  timetable: { src: '/images/characters/exam-calendar.webp?v=1',         width: 962, height: 914 },
}

// These sub-components are pure and prop-driven, but GradeHub re-renders on
// every menu / notification / tab / data-load state change. Wrapping the
// prop-stable leaves (especially SubjectCardRich, rendered ~21× across the
// three subject grids) in memo() lets them skip re-render when their props are
// unchanged — the biggest render-cost win on this dashboard.
// Fixed decorative star positions, hoisted to module scope so each memoised
// FloatingStar receives a stable `style` reference — an inline literal at the
// call site would give a new object every render and defeat the memo().
export const FLOATING_STAR_STYLES = [
  { top: '10%', left: '52%', fontSize: 12, animationDelay: '0s', zIndex: 2 },
  { top: '46%', left: '93%', fontSize: 10, animationDelay: '1s', zIndex: 2 },
  { top: '76%', left: '88%', fontSize: 9,  animationDelay: '2s', zIndex: 2 },
]
