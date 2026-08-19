import { memo } from 'react'
import {
  AVATARS,
  AVATAR_GROUPS,
  getAvatar,
  avatarSrc,
} from './learnerAvatarManifest'

/* ── Learner avatar ─────────────────────────────────────────────────────────
 *
 * Ten circular PNGs, one <img> each, described by `learnerAvatarManifest.js`.
 *
 * This replaced a 4×4 sprite sheet of sixteen characters positioned with
 * background-size / background-position arithmetic. The sprite is gone rather
 * than re-cut, for two reasons beyond the art itself:
 *
 *   • A sprite tile cannot carry an intrinsic size, so every caller had to
 *     size it from the outside and a caller that forgot rendered a 0×0 div.
 *     An <img> is a picture whether or not the CSS arrives.
 *   • The browser cannot lazily fetch one tile of a sheet. Every surface that
 *     showed a single avatar — the nav chip, a leaderboard row — downloaded
 *     all sixteen faces at 2048×2048.
 *
 * `characterId` may be a current id or one of the old sprite ids; the manifest
 * resolves both (see its LEGACY_AVATAR_IDS note). An id it cannot place renders
 * NOTHING and returns null, which is what the callers' initial-letter fallback
 * is for — but note that most of them branch on the profile field being
 * truthy rather than on this returning something, so a null here shows an empty
 * circle. That is why the legacy map is total and tested.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Back-compat aliases. `CHARACTERS` / `INTEREST_GROUPS` / `getCharacter` were
 * this module's exports when the set was hobby-grouped, and
 * `features/accountSettings/pages/zedexams-settings.jsx` (the admin + parent
 * settings page) still imports all three. They now describe the grade groups,
 * so that picker keeps working and simply groups by grade instead. New code
 * should import from `learnerAvatarManifest.js` directly.
 */
export const CHARACTERS = AVATARS
export const INTEREST_GROUPS = AVATAR_GROUPS
export const getCharacter = getAvatar

/**
 * Renders the chosen avatar. Pass `characterId` from the user profile.
 *
 * `className` is forwarded so callers control sizing; the image fills its box
 * and is cropped to a circle by the caller's own border-radius where they want
 * one (the source art is already circular on transparency).
 *
 * @param {object}  props
 * @param {string}  props.characterId  profile `avatarCharacter` value.
 * @param {string}  [props.className]
 * @param {string}  [props.title]      accessible name; defaults to the avatar's.
 * @param {boolean} [props.decorative] true when a visible label already names
 *   it, so the image is hidden from assistive tech instead of read twice.
 */
function CharacterAvatar({
  characterId,
  variant: _variant = 'avatar',
  className = '',
  title,
  decorative = false,
}) {
  const avatar = getAvatar(characterId)
  if (!avatar) return null
  return (
    <img
      className={className}
      src={avatarSrc(avatar)}
      alt={decorative ? '' : (title || avatar.name)}
      aria-hidden={decorative ? 'true' : undefined}
      loading="lazy"
      decoding="async"
      draggable="false"
      style={{ objectFit: 'cover' }}
    />
  )
}

export default memo(CharacterAvatar)
