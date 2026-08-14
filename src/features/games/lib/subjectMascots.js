/**
 * Subject mascot definitions and lookup helper.
 *
 * Extracted into a plain .js module so it can be:
 *   - imported by gamesUi.jsx (the main games UI)
 *   - imported by DailyExamsHub.jsx (exam subject cards)
 *   - tested in plain Node scripts (scripts/test-exam-calendar-fix.mjs)
 *     without needing a JSX/React transform.
 *
 * Each mascot has a personality and a short tagline so the experience
 * feels like a cast of guides rather than a list of links.
 *
 * Keys are the "subject slug" — the value of SUBJECT_SLUG[subject.id]
 * in DailyExamsHub, and the subject.slug field on SubjectProgressCard
 * in the games hub. They must stay in sync with the SUBJECT_SLUG map in
 * DailyExamsHub.jsx.
 */

export const SUBJECT_MASCOTS = {
  mathematics: { emoji: '🦊', name: 'Maths Fox',       tagline: 'Numbers are my game!' },
  english:     { emoji: '🦉', name: 'Story Owl',        tagline: 'Word adventures await.' },
  science:     { emoji: '🐢', name: 'Science Turtle',   tagline: "Let's explore the world." },
  social:      { emoji: '🦁', name: 'Adventure Lion',   tagline: 'Every place has a story.' },
  technology:  { emoji: '🤖', name: 'Tech Robot',       tagline: 'Tinker, build, repeat.' },
  home:        { emoji: '🐝', name: 'Home Bee',         tagline: 'Care, cook, create.' },
  arts:        { emoji: '🎨', name: 'Art Parrot',       tagline: 'Colour your ideas!' },
  // 'cinyanja' was missing before this fix. DailyExamsHub maps the
  // curriculum id 'cinyanja' → slug 'cinyanja', so without this entry
  // getSubjectMascot returned the generic DEFAULT_MASCOT (🎮 Game Pal).
  cinyanja:    { emoji: '🦜', name: 'Cinyanja Parrot',  tagline: 'Stories in every word.' },
}

const DEFAULT_MASCOT = { emoji: '🎮', name: 'Game Pal', tagline: 'Pick a game and play!' }

/**
 * Return the mascot for a subject slug, falling back to DEFAULT_MASCOT
 * for unknown slugs. Never returns undefined/null — safe to call with
 * any value including null/undefined/empty string.
 */
export function getSubjectMascot(slug) {
  return SUBJECT_MASCOTS[String(slug || '').toLowerCase()] || DEFAULT_MASCOT
}
