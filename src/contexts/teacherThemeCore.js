/**
 * Teacher workspace themes — pure data + decisions, no React and no DOM.
 *
 * WHY THIS IS SEPARATE FROM THE LEARNER READING THEMES
 * ----------------------------------------------------
 * ZedExams already ships a theme system: the reading palettes (oatmeal / sky
 * / solar / midnight) applied as `theme-<id>` classes on <body> by
 * ThemeContext. That system stays exactly as it is — this module does not
 * touch it.
 *
 * This module adds a SECOND, teacher-facing palette set applied as
 * `data-theme` on <html>. The two cannot be merged into one token set,
 * because the learner themes already own the names `--card`, `--text`,
 * `--text-muted`, `--accent` and `--surface` — and they declare them on
 * <body>. A <body> declaration always beats an <html> one for anything
 * inside <body>, so a teacher token sharing those names would be shadowed on
 * every page and silently never apply. Hence the `--zt-` prefix below
 * (`zt` = ZedExams theme); it is what makes the two systems co-exist rather
 * than fight.
 *
 * There is still only ONE provider, ONE persistence layer and ONE Firestore
 * field — see ThemeContext.jsx. The split is in the token namespace, not in
 * the machinery.
 *
 * WHY THE VALUES HERE ARE THE SOURCE OF TRUTH
 * -------------------------------------------
 * index.css must repeat these values (CSS cannot import JS), so they live
 * here once and `test:teacher-theme-css` parses the stylesheet and fails on
 * any drift. Editing a colour in one place and not the other is the failure
 * mode this guards.
 */

/** localStorage key holding the teacher's chosen workspace theme. */
export const TEACHER_THEME_STORAGE_KEY = 'zedexams-theme'

/** Firestore path on the user profile: users/{uid}.preferences.theme */
export const TEACHER_THEME_PROFILE_FIELD = 'preferences.theme'

/** CSS custom-property prefix. See the namespace note above. */
export const TOKEN_PREFIX = '--zt-'

/** The attribute carrying the active theme, set on <html>. */
export const THEME_ATTRIBUTE = 'data-theme'

export const DEFAULT_TEACHER_THEME = 'terracotta'

/**
 * Every token a theme must define. A theme missing one of these, or adding
 * one not listed, fails `test:teacher-theme`. Keeping the list explicit is
 * what stops a half-defined theme from falling back to another theme's
 * colour at runtime, which reads as a rendering bug rather than a typo.
 */
export const TOKEN_NAMES = Object.freeze([
  'sidebar-bg',
  'sidebar-text',
  'sidebar-muted',
  'surface',
  'card',
  'card-border',
  'line',
  'accent',
  'accent-deep',
  'accent-text',
  'on-accent',
  'text',
  'text-muted',
  'banner-bg',
  'banner-border',
  'banner-text',
])

/**
 * `--zt-accent-text` is the one token added beyond the original spec, and it
 * earns its place: `--zt-accent` is a FILL (nav pill, button, logo mark)
 * judged against the text sitting ON it, while a kicker label or link is the
 * accent used AS text, judged against the page behind it. One value cannot
 * satisfy both — Miombo's gold is a perfectly good button fill and a 2.4:1
 * link. The existing learner themes draw the same distinction (`--accent` vs
 * `--accent-fg`), so this mirrors a split the codebase already trusts.
 *
 * `--zt-line` is the second addition, for the same reason in reverse.
 * `--zt-card-border` is a deliberately STRONG outline (near-black on the
 * light themes). The teacher dashboard draws ~46 `1px solid` hairlines —
 * table rules, dividers, input outlines, card edges — and painting all of
 * them near-black reads as a broken stylesheet rather than a bold one. One
 * value also cannot serve both directions: a hairline must be darker than
 * the card on a light theme and LIGHTER than it on Night, so deriving one
 * from the other with color-mix goes invisible in exactly one of the two
 * cases. Hence an explicit per-theme hairline, with `--zt-card-border` kept
 * at full strength for anything that wants the emphatic outline.
 */

export const TEACHER_THEMES = Object.freeze([
  {
    id: 'terracotta',
    label: 'Terracotta',
    hint: 'The ZedExams default — warm clay on cream.',
    tokens: Object.freeze({
      'sidebar-bg': '#1E3247',
      'sidebar-text': 'rgba(255, 255, 255, 0.78)',
      'sidebar-muted': 'rgba(255, 255, 255, 0.55)',
      surface: '#F5EEE1',
      card: '#FFFFFF',
      'card-border': '#2E2A24',
      line: '#E4D9C6',
      // #C05F3C in the source palette. Darkened just enough that white text
      // on it clears 4.5:1 (4.25 → 4.51); the hue is unchanged and the shift
      // is imperceptible side by side.
      accent: '#B95C3A',
      'accent-deep': '#A94F2E',
      'accent-text': '#AA5435',
      'on-accent': '#FFFFFF',
      text: '#2E2A24',
      // #8A8172 in the source palette — 3.33:1 on the cream page, which is
      // below AA for body text.
      'text-muted': '#736C5F',
      'banner-bg': '#FBF3DC',
      'banner-border': '#EAD9A8',
      'banner-text': '#6B5B33',
    }),
  },
  {
    id: 'miombo',
    label: 'Miombo Green',
    hint: 'Deep woodland green with a gold accent.',
    tokens: Object.freeze({
      'sidebar-bg': '#24382C',
      'sidebar-text': 'rgba(255, 255, 255, 0.80)',
      'sidebar-muted': 'rgba(255, 255, 255, 0.55)',
      surface: '#F3F1E7',
      card: '#FFFFFF',
      'card-border': '#262A22',
      line: '#DFDCCB',
      // Kept at the source gold. Darkening it far enough to carry white text
      // lands on #996F23 — an olive-brown that is no longer the colour the
      // theme is named for, so the FOREGROUND moves instead (see on-accent).
      accent: '#C9922E',
      'accent-deep': '#A97A1F',
      'accent-text': '#8E6721',
      // Near-black rather than white: 6.50:1 on the gold and 4.68:1 on the
      // deep end, where white managed 2.75:1 and 3.82:1.
      'on-accent': '#1C1705',
      text: '#262A22',
      'text-muted': '#716E5E',
      'banner-bg': '#F6F0D9',
      'banner-border': '#E3D9A9',
      'banner-text': '#66603A',
    }),
  },
  {
    id: 'copperbelt',
    label: 'Copperbelt',
    hint: 'Deep teal with a copper accent.',
    tokens: Object.freeze({
      'sidebar-bg': '#173540',
      'sidebar-text': 'rgba(255, 255, 255, 0.80)',
      'sidebar-muted': 'rgba(255, 255, 255, 0.55)',
      surface: '#F2EFE6',
      card: '#FFFFFF',
      'card-border': '#22303A',
      line: '#DED9CB',
      // #B8622F in the source palette; same imperceptible darkening as
      // Terracotta to clear white-on-accent (4.35 → 4.51).
      accent: '#B4602E',
      'accent-deep': '#9C4F22',
      'accent-text': '#A6582A',
      'on-accent': '#FFFFFF',
      text: '#22303A',
      'text-muted': '#6F6C67',
      'banner-bg': '#F8F1DE',
      'banner-border': '#E7D9AC',
      'banner-text': '#695E38',
    }),
  },
  {
    id: 'night',
    label: 'Night',
    hint: 'Dark workspace for low-light marking.',
    tokens: Object.freeze({
      'sidebar-bg': '#10161F',
      'sidebar-text': 'rgba(255, 255, 255, 0.80)',
      'sidebar-muted': 'rgba(255, 255, 255, 0.50)',
      surface: '#1A222E',
      card: '#232D3B',
      // Lightened from the source #3B4757, which was only 1.47:1 against
      // the card — below the 3:1 WCAG 1.4.11 bar that a form-input outline
      // has to clear to be perceivable at all. This is also where Night's
      // outline and hairline stop being the same value: the outline has to
      // be seen, the hairline only has to separate.
      'card-border': '#6B7A8D',
      line: '#3B4757',
      accent: '#D9784F',
      'accent-deep': '#C0602F',
      // Lifted slightly off --accent so it clears AA as TEXT against the
      // card, which is the lighter of the two dark backgrounds.
      'accent-text': '#E08A61',
      // Same reasoning as Miombo: the coral is light enough that white on it
      // is 3.11:1. Near-black gives 6.28:1 / 4.61:1.
      'on-accent': '#120B04',
      text: '#EDE7DC',
      'text-muted': '#94A0AF',
      'banner-bg': '#2A2F26',
      'banner-border': '#4A4F3A',
      'banner-text': '#D9D3A8',
    }),
  },
])

export const TEACHER_THEME_IDS = Object.freeze(TEACHER_THEMES.map((t) => t.id))

/**
 * Themes whose surfaces are dark. Consumers that need to know (status-bar
 * colour, image treatments) read this rather than string-matching 'night'.
 */
export const DARK_TEACHER_THEME_IDS = Object.freeze(['night'])

export function isTeacherThemeId(id) {
  return TEACHER_THEME_IDS.includes(id)
}

/** Unknown, missing, or malformed ids resolve to the default. */
export function normalizeTeacherThemeId(id) {
  return isTeacherThemeId(id) ? id : DEFAULT_TEACHER_THEME
}

export function getTeacherTheme(id) {
  const wanted = normalizeTeacherThemeId(id)
  return TEACHER_THEMES.find((t) => t.id === wanted)
}

/** The accent swatch a picker shows as this theme's colour dot. */
export function teacherThemeSwatch(id) {
  return getTeacherTheme(id).tokens.accent
}

/**
 * Decide which theme wins when the signed-in profile and this device's
 * localStorage disagree.
 *
 * The profile wins whenever it holds a usable value: a teacher who picked
 * Night on their laptop should get Night when they sign in on a school
 * machine, rather than that machine's leftover choice. A profile with no
 * theme yet (or a corrupt one) must NOT stomp a local choice — that case is
 * "not answered", not "answered with the default", and treating the two the
 * same is how a fresh sign-in silently resets a deliberate pick.
 */
export function resolveThemeConflict({ profileTheme, localTheme } = {}) {
  if (isTeacherThemeId(profileTheme)) {
    return { theme: profileTheme, source: 'profile' }
  }
  if (isTeacherThemeId(localTheme)) {
    return { theme: localTheme, source: 'local' }
  }
  return { theme: DEFAULT_TEACHER_THEME, source: 'default' }
}

/**
 * Whether a profile write is worth making. Skips the no-op write that would
 * otherwise fire on every hydration and bill a Firestore write per sign-in.
 */
export function shouldPersistTheme({ nextTheme, profileTheme } = {}) {
  return isTeacherThemeId(nextTheme) && nextTheme !== profileTheme
}
