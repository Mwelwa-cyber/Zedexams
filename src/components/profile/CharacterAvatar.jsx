import { memo } from 'react'

/* ── Character avatar sprite-sheet ──────────────────────────────────────────
 * One 4×4 PNG (2048×2048) holds all 16 student characters. Each tile is a
 * 512×512 square portrait — no baked-in name label.
 *
 *   variant='tile'   — used in the settings picker
 *   variant='avatar' — used in navbar / drawer chips
 *
 * Both variants render the same square crop; the prop is kept for callers.
 *
 * Sprite math:
 *   bg-size 400% 400%   pos (col/3, row/3) × 100%
 * ────────────────────────────────────────────────────────────────────────── */

export const CHARACTER_AVATAR_SHEET = '/images/characters/avatars-grid.png'

export const INTEREST_GROUPS = [
  { id: 'academic',   label: 'Academic'  },
  { id: 'tech',       label: 'Tech & Gaming' },
  { id: 'sports',     label: 'Sports'    },
  { id: 'creative',   label: 'Creative'  },
  { id: 'leadership', label: 'Leadership' },
]

export const CHARACTERS = [
  // Row 0
  { id: 'ruby',  name: 'Ruby',  row: 0, col: 0, group: 'academic'   },
  { id: 'finn',  name: 'Finn',  row: 0, col: 1, group: 'sports'     },
  { id: 'mia',   name: 'Mia',   row: 0, col: 2, group: 'creative'   },
  { id: 'kai',   name: 'Kai',   row: 0, col: 3, group: 'academic'   },
  // Row 1
  { id: 'leo',   name: 'Leo',   row: 1, col: 0, group: 'tech'       },
  { id: 'aria',  name: 'Aria',  row: 1, col: 1, group: 'creative'   },
  { id: 'theo',  name: 'Theo',  row: 1, col: 2, group: 'tech'       },
  { id: 'ella',  name: 'Ella',  row: 1, col: 3, group: 'academic'   },
  // Row 2
  { id: 'sam',   name: 'Sam',   row: 2, col: 0, group: 'academic'   },
  { id: 'lily',  name: 'Lily',  row: 2, col: 1, group: 'creative'   },
  { id: 'zoe',   name: 'Zoe',   row: 2, col: 2, group: 'academic'   },
  { id: 'max',   name: 'Max',   row: 2, col: 3, group: 'leadership' },
  // Row 3
  { id: 'nia',   name: 'Nia',   row: 3, col: 0, group: 'leadership' },
  { id: 'eli',   name: 'Eli',   row: 3, col: 1, group: 'sports'     },
  { id: 'jude',  name: 'Jude',  row: 3, col: 2, group: 'sports'     },
  { id: 'tara',  name: 'Tara',  row: 3, col: 3, group: 'tech'       },
]

const CHARACTER_INDEX = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]))

export function getCharacter(id) {
  return CHARACTER_INDEX[id] || null
}

function spriteStyle(char) {
  return {
    backgroundImage: `url(${CHARACTER_AVATAR_SHEET})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: '400% 400%',
    backgroundPosition: `${(char.col / 3) * 100}% ${(char.row / 3) * 100}%`,
  }
}

/**
 * Renders the chosen character. Pass `characterId` from the user profile.
 *
 * `className` is forwarded to the rendered <div> so callers control sizing.
 * The `variant` prop is accepted for API compatibility but both variants
 * render the same square crop now that the sprite has no name labels.
 */
function CharacterAvatar({ characterId, variant: _variant = 'avatar', className = '', title }) {
  const char = getCharacter(characterId)
  if (!char) return null
  return (
    <div
      className={className}
      role="img"
      aria-label={title || char.name}
      style={spriteStyle(char)}
    />
  )
}

export default memo(CharacterAvatar)
