/**
 * Learner avatars — the manifest, and nothing that draws one.
 *
 * The art ships as ten circular PNGs under `public/images/avatars/`, beside
 * `avatars.manifest.json` — the file the artwork was delivered with. THAT json
 * is the record; this module is the same data in a form both Vite and plain
 * `node` can import without JSON-import attributes, and
 * `learnerAvatarManifest.test.js` fails if the two disagree or if a `file`
 * names a PNG that is not on disk. So "read it from the manifest" stays true
 * while no consumer pays for a fetch.
 *
 * ── Grouped by GRADE, not by hobby ─────────────────────────────────────────
 *
 * The set this replaced was grouped Academic / Sports / Creative / Gaming /
 * Leadership — five filters over sixteen faces, which is a lot of chrome for a
 * child to work through before they find one they like. This set splits the way
 * the learners do: `junior` (Grades 4–9) and `senior` (10–12). The learner's own
 * group is shown FIRST — a Grade 4 should not have to scroll past graduation
 * caps — but every avatar stays pickable, because a nine-year-old who wants the
 * mortarboard should have it.
 *
 * ── They have names, and the names are the interface ───────────────────────
 *
 * Children pick an avatar by personality. "The Questioner", "Bookworm",
 * "ZedExams Eagle" — never "2. (Male)", which is what a file-order label would
 * produce. Every tile renders `name`, so the manifest is the copy too.
 *
 * ── Legacy ids ─────────────────────────────────────────────────────────────
 *
 * Sixteen ids from the old sprite sheet are stored on live profiles. Nothing
 * migrates them in the database — `resolveAvatarId` maps them on READ instead,
 * because a batch write over every learner to change a picture is a poor trade
 * against a lookup table. Two properties matter and both are tested: the map is
 * TOTAL (every old id resolves, so no learner loses their face and lands on an
 * empty circle — the callers branch on `avatarCharacter` being truthy, not on
 * whether it resolves, so an unmapped id renders nothing at all), and it is
 * FIXED (the same old id always lands on the same new face, so a child's avatar
 * does not move again on the next deploy).
 */

/** Where the PNGs are served from. `file` in the manifest is relative to this. */
export const AVATAR_BASE = '/images/avatars/'

/**
 * The delivered manifest, verbatim. Mirrors
 * `public/images/avatars/avatars.manifest.json`; the test compares them field
 * by field, so editing one without the other fails the build rather than
 * quietly shipping a picker that disagrees with the art.
 */
export const AVATAR_MANIFEST = Object.freeze({
  version: 1,
  groups: Object.freeze([
    Object.freeze({ id: 'junior', label: 'Junior Scholars', grades: Object.freeze([4, 5, 6, 7, 8, 9]) }),
    Object.freeze({ id: 'senior', label: 'Exam Candidates', grades: Object.freeze([10, 11, 12]) }),
  ]),
  avatars: Object.freeze([
    Object.freeze({ id: 'questioner', name: 'The Questioner', group: 'junior', file: 'avatars/01-questioner.png' }),
    Object.freeze({ id: 'raiser', name: 'Hand Raiser', group: 'junior', file: 'avatars/02-raiser.png' }),
    Object.freeze({ id: 'bookworm', name: 'Bookworm', group: 'junior', file: 'avatars/03-bookworm.png' }),
    Object.freeze({ id: 'scientist', name: 'The Scientist', group: 'junior', file: 'avatars/04-scientist.png' }),
    Object.freeze({ id: 'eagle', name: 'ZedExams Eagle', group: 'junior', file: 'avatars/05-eagle.png' }),
    Object.freeze({ id: 'graduate', name: 'The Graduate', group: 'senior', file: 'avatars/06-graduate.png' }),
    Object.freeze({ id: 'lateshift', name: 'Late Shift', group: 'senior', file: 'avatars/07-lateshift.png' }),
    Object.freeze({ id: 'focus', name: 'Focus Mode', group: 'senior', file: 'avatars/08-headphones.png' }),
    Object.freeze({ id: 'proud', name: 'Proud', group: 'senior', file: 'avatars/09-proud.png' }),
    Object.freeze({ id: 'mature', name: 'Mature Student', group: 'senior', file: 'avatars/10-mature.png' }),
  ]),
})

export const AVATAR_GROUPS = AVATAR_MANIFEST.groups
export const AVATARS = AVATAR_MANIFEST.avatars

const BY_ID = Object.freeze(Object.fromEntries(AVATARS.map((a) => [a.id, a])))

/**
 * Old sprite-sheet id → new avatar id.
 *
 * Sixteen onto ten, in delivery order and then round again, so the table is
 * mechanical rather than a series of small judgements about which cartoon most
 * resembles which other cartoon — a judgement nobody can check, since the old
 * art is one flat grid with no identities attached to it. What it guarantees is
 * what matters: every stored id resolves to a face, and always the same one.
 */
export const LEGACY_AVATAR_IDS = Object.freeze({
  ruby: 'questioner',
  finn: 'raiser',
  mia: 'bookworm',
  kai: 'scientist',
  leo: 'eagle',
  aria: 'graduate',
  theo: 'lateshift',
  ella: 'focus',
  sam: 'proud',
  lily: 'mature',
  zoe: 'questioner',
  max: 'raiser',
  nia: 'bookworm',
  eli: 'scientist',
  jude: 'eagle',
  tara: 'graduate',
})

/**
 * The id a stored profile value actually means. Unknown values return `null`
 * rather than a default face: a wrong picture presented confidently is worse
 * than no picture, and the callers already have an initial to fall back on once
 * they are told there is nothing here.
 *
 * @param {string|null|undefined} id
 * @return {string|null}
 */
export function resolveAvatarId(id) {
  const key = String(id || '').trim()
  if (!key) return null
  if (BY_ID[key]) return key
  return LEGACY_AVATAR_IDS[key] || null
}

/**
 * The avatar record for a stored profile value, legacy ids included.
 *
 * @param {string|null|undefined} id
 * @return {{id: string, name: string, group: string, file: string}|null}
 */
export function getAvatar(id) {
  const resolved = resolveAvatarId(id)
  return resolved ? BY_ID[resolved] : null
}

/**
 * The served URL for an avatar record.
 *
 * @param {{file: string}|null|undefined} avatar
 * @return {string|null}
 */
export function avatarSrc(avatar) {
  return avatar?.file ? `${AVATAR_BASE}${avatar.file.replace(/^avatars\//, '')}` : null
}

/**
 * Which group a grade belongs to. An unknown or missing grade falls to the
 * FIRST group rather than to none: the picker has to open on something, and
 * "Junior Scholars" is both the larger set and the safer guess for a learner we
 * know nothing about.
 *
 * @param {number|string|null|undefined} grade
 * @return {string} a group id
 */
export function groupForGrade(grade) {
  const n = Number(String(grade ?? '').replace(/[^\d]/g, ''))
  const hit = AVATAR_GROUPS.find((g) => g.grades.includes(n))
  return hit ? hit.id : AVATAR_GROUPS[0].id
}

/**
 * The groups in the order this learner should meet them — their own first.
 *
 * @param {number|string|null|undefined} grade
 * @return {Array<{id: string, label: string, grades: number[]}>}
 */
export function groupsForGrade(grade) {
  const own = groupForGrade(grade)
  return [...AVATAR_GROUPS].sort((a, b) => (a.id === own ? -1 : b.id === own ? 1 : 0))
}

/**
 * The avatars in one group.
 *
 * @param {string} groupId
 * @return {Array<object>}
 */
export function avatarsInGroup(groupId) {
  return AVATARS.filter((a) => a.group === groupId)
}
