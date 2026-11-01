/**
 * The GENERAL COMPETENCES on a CBC lesson plan must show in the plan.
 *
 * The official CDC sample lesson plans (teaching modules 2025/26) list three
 * to five general competences and then make them VISIBLE: the lesson goal is
 * one sentence worded so the competences are in what learners do, and the
 * rationale names the competences the teaching methods develop. The Form 1
 * Geography sample lists Analytical Thinking, Citizenship, Collaboration and
 * Environmental Sustainability; its goal reads "...use them responsibly and
 * ensuring sustainable development" and its rationale "Through group
 * discussions and collaboration...". The Religious Education sample names its
 * competences in the rationale ("learners will develop competencies such as
 * critical thinking, emotional intelligence...").
 *
 * Teachers are told the same thing from the classroom side ("whatever you
 * write under General Competence should correspond with the Lesson Goal").
 * The format some teachers use for it, a numbered goal per competence, is NOT
 * the CDC sample's format, so the goal stays one sentence here.
 *
 * Before this module the generator listed competences and nothing tied them
 * to the rest of the plan. This package holds:
 *   - COMPETENCE_LINK_DIRECTIVE: the prompt rule (studio + server quote it),
 *   - missingCompetences(): which listed competences the goal and the
 *     rationale never mention,
 *   - ensureCompetenceLink(): names those in the rationale, so a plan never
 *     reaches a teacher with a competence that appears nowhere but its list.
 *
 * Shared by the browser (Lesson Plan Studio) and Cloud Functions
 * (generateLessonPlan). Plain ESM, no React/DOM/Firebase — see
 * neutrality.test.js.
 */

export const COMPETENCE_LINK_DIRECTIVE =
  'LINK THE COMPETENCES — every general competence you list must show in the plan, as it does in the official CDC samples. The LESSON GOAL stays ONE SMART sentence (never a numbered list, one item per competence), but word it so the competences are visible in what learners do: for example, "Learners should be able to work in groups to identify natural resources in their community and suggest ways of using them responsibly." shows Collaboration, Critical Thinking and Citizenship. In part (3) of the RATIONALE, name the competences the teaching methods develop, for example "Through group discussion and demonstration, learners will develop collaboration and critical thinking." Every listed general competence must be named or clearly shown in the lesson goal or the rationale.'

/**
 * The ZECF 2023 general competences (§2.3.1), each with the words that show
 * it in a goal or rationale. Lenient on purpose: the check exists to catch a
 * competence that appears NOWHERE, and a false "missing" costs the teacher a
 * redundant sentence, while a false "present" costs nothing worse than today.
 */
const COMPETENCES = [
  {key: 'analytical thinking', label: 'analytical thinking', re: /\banaly[sz]/},
  {key: 'collaboration', label: 'collaboration', re: /collaborat|work(?:s|ing)?\s+together|team\s?work|in\s+groups|group\s+(?:work|discussion)/},
  {key: 'communication', label: 'communication', re: /communicat|present(?:s|ing)?\s+(?:their|the|its)|share\s+their/},
  {key: 'creativity', label: 'creativity and innovation', re: /creativ|innovat|\bcreate|\bdesign/},
  {key: 'critical thinking', label: 'critical thinking', re: /critical|evaluat|\bjudge/},
  {key: 'citizenship', label: 'citizenship', re: /citizen|responsib|civic/},
  {key: 'digital literacy', label: 'digital literacy', re: /digital|\bict\b|computer|calculator|technolog/},
  {key: 'emotional intelligence', label: 'emotional intelligence', re: /emotion|feelings|empath/},
  {key: 'entrepreneurship', label: 'entrepreneurship', re: /entrepreneur|business|enterpris/},
  {key: 'environmental sustainability', label: 'environmental sustainability', re: /sustainab|environment|conserv|natural\s+resource/},
  {key: 'financial literacy', label: 'financial literacy', re: /financ|money|budget|saving/},
  {key: 'problem solving', label: 'problem solving', re: /problem|solv|solution/},
]

/** "Critical thinking: ability to..." / "Creativity & Innovation" → "critical thinking" / "creativity and innovation". */
function competenceName(raw) {
  return String(raw || '')
    .split(/[:;(]/)[0]
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function lookup(name) {
  return COMPETENCES.find((c) => name.includes(c.key)) || null
}

/** True when `text` names or clearly shows the general competence `raw`. */
export function competenceShown(raw, text) {
  const name = competenceName(raw)
  if (!name) return true
  const hay = String(text || '').toLowerCase()
  if (hay.includes(name)) return true
  const known = lookup(name)
  if (known) return known.re.test(hay)
  // A competence outside the framework list: accept its first real word.
  const word = name.split(' ').find((w) => w.length >= 5)
  return word ? hay.includes(word) : false
}

/** The listed general competences that neither the lesson goal nor the rationale shows. */
export function missingCompetences(plan) {
  if (!plan || typeof plan !== 'object') return []
  // A list, or (as the studio renderer also accepts) one comma/semicolon/line
  // separated string. Never split on "and": "Creativity and Innovation" is one.
  const raw = plan.generalCompetences
  const list = Array.isArray(raw) ? raw :
    typeof raw === 'string' ? raw.split(/[,;\n]/) : []
  const text = [plan.lessonGoal, plan.rationale]
    .map((v) => (typeof v === 'string' ? v : ''))
    .join(' ')
  return list
    .filter((c) => typeof c === 'string' && c.trim())
    .map((c) => c.trim())
    .filter((c) => !competenceShown(c, text))
}

function joinNames(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The sentence that names the missing competences. */
export function competenceSentence(missing) {
  const names = missing.map((c) => {
    const name = competenceName(c)
    return lookup(name)?.label || name
  }).filter(Boolean)
  return names.length ? `Through these activities, learners will also develop ${joinNames(names)}.` : ''
}

// The rationale's closing position sentence ("This is lesson 2 in a series
// of 3."). The competence sentence goes BEFORE it, so the rationale still ends
// with its position, as the CDC samples and the studio's position rule require.
const POSITION_RE = /\bseries\s+of\s+\w+|\blesson\s+(?:number\s+)?\w+\s+of\s+\w+|\b\w+\s+of\s+\w+\s+lessons\b/i

/**
 * Name, in the rationale, every listed general competence the goal and the
 * rationale do not already show. Returns the SAME plan object when nothing
 * changes. An empty rationale stays empty (the section may be switched off or
 * dropped at a one-page budget), and a rationale written in a local language
 * is left alone, because an English sentence inside it is worse than none.
 *
 * @param {object} plan
 * @param {{localLanguage?: boolean}} [opts]
 */
export function ensureCompetenceLink(plan, {localLanguage = false} = {}) {
  if (!plan || typeof plan !== 'object' || localLanguage) return plan
  const text = typeof plan.rationale === 'string' ? plan.rationale.trim() : ''
  if (!text) return plan
  const sentence = competenceSentence(missingCompetences(plan))
  if (!sentence) return plan

  const split = text.match(/^([\s\S]*[.!?])\s+([^.!?]+[.!?]?)$/)
  let rationale
  if (split && POSITION_RE.test(split[2])) {
    rationale = `${split[1]} ${sentence} ${split[2]}`
  } else if (!split && POSITION_RE.test(text)) {
    rationale = `${sentence} ${text}`
  } else {
    rationale = `${text}${/[.!?]$/.test(text) ? ' ' : '. '}${sentence}`
  }
  return {...plan, rationale}
}
