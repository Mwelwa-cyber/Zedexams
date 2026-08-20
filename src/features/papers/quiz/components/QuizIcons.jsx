/**
 * The quiz's icon set, as one module.
 *
 * Inline SVG rather than an icon package: this route is reachable by an
 * anonymous visitor on a crawled URL and is the one full-bleed screen in the
 * learner app, so its chunk is worth keeping small — and `lucide-react`, which
 * the teacher dashboard uses, is a dependency this side has never carried.
 *
 * Every icon takes `size` and inherits `currentColor`, so a token decides the
 * colour at the call site and no component here names one (§8: colours come
 * from the token file only).
 */

function Svg({ size = 20, stroke = 2.2, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconBack = (p) => <Svg stroke={2.4} {...p}><path d="M15 18l-6-6 6-6" /></Svg>
export const IconNext = (p) => <Svg stroke={2.6} {...p}><path d="M9 18l6-6-6-6" /></Svg>
export const IconPrev = (p) => <Svg stroke={2.6} {...p}><path d="M15 18l-6-6 6-6" /></Svg>
export const IconChevronDown = (p) => <Svg stroke={2.4} {...p}><path d="M6 9l6 6 6-6" /></Svg>
export const IconClock = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
export const IconCheck = (p) => <Svg stroke={2.6} {...p}><path d="M20 6L9 17l-5-5" /></Svg>
export const IconX = (p) => <Svg stroke={2.6} {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>
export const IconFlag = (p) => (
  <Svg {...p}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <path d="M4 22V4" />
  </Svg>
)
export const IconGrid = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.6" />
    <rect x="14" y="3" width="7" height="7" rx="1.6" />
    <rect x="3" y="14" width="7" height="7" rx="1.6" />
    <rect x="14" y="14" width="7" height="7" rx="1.6" />
  </Svg>
)
export const IconAa = (p) => <Svg {...p}><path d="M3 19l5-13 5 13M4.6 15h6.8" /><path d="M15 19l3-8 3 8M15.9 16.6h4.2" /></Svg>
export const IconWarn = (p) => (
  <Svg {...p}>
    <path d="M10.3 3.6L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.6a2 2 0 00-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </Svg>
)
export const IconLock = (p) => <Svg {...p}><rect x="3.5" y="11" width="17" height="10" rx="2.4" /><path d="M7.5 11V7a4.5 4.5 0 019 0v4" /></Svg>
export const IconBolt = (p) => <Svg {...p}><path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z" /></Svg>
export const IconEye = (p) => (
  <Svg {...p}><path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></Svg>
)
export const IconBook = (p) => <Svg {...p}><path d="M4 4.5A2.5 2.5 0 016.5 2H20v18H6.5A2.5 2.5 0 004 22.5z" /><path d="M4 17.5A2.5 2.5 0 016.5 15H20" /></Svg>
export const IconPlay = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M10 8.5l6 3.5-6 3.5z" /></Svg>
export const IconAward = (p) => <Svg {...p}><circle cx="12" cy="9" r="6" /><path d="M8.5 14.2L7 22l5-2.6L17 22l-1.5-7.8" /></Svg>
export const IconBulb = (p) => (
  <Svg {...p}>
    <path d="M9 18h6M10 21.5h4" />
    <path d="M12 2.5a6.5 6.5 0 00-3.8 11.8c.5.4.8 1 .8 1.7h6c0-.7.3-1.3.8-1.7A6.5 6.5 0 0012 2.5z" />
  </Svg>
)
export const IconTarget = (p) => (
  <Svg stroke={2.4} {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill="currentColor" /></Svg>
)
export const IconBookmark = (p) => <Svg {...p}><path d="M6 3.5h12a1 1 0 011 1V21l-7-4.2L5 21V4.5a1 1 0 011-1z" /></Svg>
export const IconRefresh = (p) => <Svg {...p}><path d="M21 12a9 9 0 11-2.6-6.4" /><path d="M21 3v6h-6" /></Svg>
export const IconShield = (p) => <Svg {...p}><path d="M12 2.5l8 3v6c0 4.6-3.2 8.6-8 10-4.8-1.4-8-5.4-8-10v-6z" /><path d="M9 12l2 2 4-4" /></Svg>
export const IconBookOpen = (p) => (
  <Svg stroke={2} {...p}>
    <path d="M2 4.5h6.5A3.5 3.5 0 0112 8v11a3 3 0 00-3-2.5H2z" />
    <path d="M22 4.5h-6.5A3.5 3.5 0 0012 8v11a3 3 0 013-2.5h7z" />
  </Svg>
)
export const IconCap = (p) => (
  <Svg stroke={2} {...p}><path d="M2 8.5L12 4l10 4.5-10 4.5z" /><path d="M6 11v4.5c0 1.5 2.7 2.8 6 2.8s6-1.3 6-2.8V11" /></Svg>
)
export const IconCalendar = (p) => (
  <Svg stroke={2} {...p}>
    <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
    <rect x="7" y="13" width="3" height="3" rx=".8" fill="currentColor" stroke="none" />
    <rect x="13" y="13" width="3" height="3" rx=".8" fill="currentColor" stroke="none" />
  </Svg>
)
export const IconDoc = (p) => (
  <Svg stroke={2} {...p}><path d="M14 2.5H7a2 2 0 00-2 2v15a2 2 0 002 2h10a2 2 0 002-2V7.5z" /><path d="M14 2.5v5h5" /><path d="M9 12h6M9 16h4" /></Svg>
)
export const IconQuestion = (p) => (
  <Svg stroke={2} {...p}><circle cx="12" cy="12" r="9.2" /><path d="M9.6 9.3a2.5 2.5 0 114.3 1.8c-.9.8-1.6 1.3-1.7 2.4" /><path d="M12 17h.01" /></Svg>
)

/** The icon a mode-card feature column names. One lookup, so `MODE_FEATURES`
 *  can stay pure data with no JSX in it. */
export const FEATURE_ICONS = {
  clock: IconClock,
  lock: IconLock,
  flag: IconFlag,
  award: IconAward,
  check: IconCheck,
  book: IconBook,
  eye: IconEye,
  play: IconPlay,
}
