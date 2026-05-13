import { memo } from 'react'

/* ── Character avatar sprite-sheet ──────────────────────────────────────────
 * One 5×4 PNG (1024×1536) holds all 20 student characters. Each tile is
 * 204.8 × 384 px in the source: the top ~256 px is the character portrait,
 * the bottom ~128 px carries the baked-in name label.
 *
 *   variant='tile'  — shows the full tile including the name label
 *                     (used in the settings picker so students can read names)
 *   variant='avatar' — square, rounded, crops the name label off
 *                     (used in navbar / drawer chips)
 *
 * Sprite math, for the curious:
 *   Tile mode      bg-size 500% 400%   pos (col/4, row/3) × 100%
 *   Avatar mode    bg-size 500% 600%   pos (col/4, row/5) × 100%
 *     — 600% vertical zoom hides the ~33% name-label strip at the bottom
 *       of each tile, so the position step is row/(6-1) instead of row/3.
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
  { id: 'math-genius',    name: 'Math Genius',     row: 0, col: 0, group: 'academic'   },
  { id: 'science-boy',    name: 'Science Boy',     row: 0, col: 1, group: 'academic'   },
  { id: 'coding-kid',     name: 'Coding Kid',      row: 0, col: 2, group: 'tech'       },
  { id: 'book-lover',     name: 'Book Lover',      row: 0, col: 3, group: 'academic'   },
  { id: 'tech-master',    name: 'Tech Master',     row: 0, col: 4, group: 'tech'       },
  // Row 1
  { id: 'smart-girl',     name: 'Smart Girl',      row: 1, col: 0, group: 'academic'   },
  { id: 'scientist-girl', name: 'Scientist Girl',  row: 1, col: 1, group: 'academic'   },
  { id: 'coder-girl',     name: 'Coder Girl',      row: 1, col: 2, group: 'tech'       },
  { id: 'reader-girl',    name: 'Reader Girl',     row: 1, col: 3, group: 'academic'   },
  { id: 'geography-girl', name: 'Geography Girl',  row: 1, col: 4, group: 'academic'   },
  // Row 2
  { id: 'soccer-boy',     name: 'Soccer Boy',      row: 2, col: 0, group: 'sports'     },
  { id: 'gamer-boy',      name: 'Gamer Boy',       row: 2, col: 1, group: 'tech'       },
  { id: 'music-boy',      name: 'Music Boy',       row: 2, col: 2, group: 'creative'   },
  { id: 'nature-boy',     name: 'Nature Boy',      row: 2, col: 3, group: 'sports'     },
  { id: 'skater-boy',     name: 'Skater Boy',      row: 2, col: 4, group: 'sports'     },
  // Row 3
  { id: 'football-girl',  name: 'Football Girl',   row: 3, col: 0, group: 'sports'     },
  { id: 'gamer-girl',     name: 'Gamer Girl',      row: 3, col: 1, group: 'tech'       },
  { id: 'artist-girl',    name: 'Artist Girl',     row: 3, col: 2, group: 'creative'   },
  { id: 'debate-girl',    name: 'Debate Girl',     row: 3, col: 3, group: 'leadership' },
  { id: 'young-leader',   name: 'Young Leader',    row: 3, col: 4, group: 'leadership' },
]

const CHARACTER_INDEX = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]))

export function getCharacter(id) {
  return CHARACTER_INDEX[id] || null
}

function spriteStyle(char, variant) {
  if (variant === 'tile') {
    return {
      backgroundImage: `url(${CHARACTER_AVATAR_SHEET})`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: '500% 400%',
      backgroundPosition: `${(char.col / 4) * 100}% ${(char.row / 3) * 100}%`,
    }
  }
  // variant === 'avatar' — square crop, name label hidden
  return {
    backgroundImage: `url(${CHARACTER_AVATAR_SHEET})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: '500% 600%',
    backgroundPosition: `${(char.col / 4) * 100}% ${(char.row / 5) * 100}%`,
  }
}

/**
 * Renders the chosen character. Pass `characterId` from the user profile.
 *
 * - variant="avatar" (default): square crop, hides the name label. Use
 *   inside a circular `overflow-hidden rounded-full` container of your
 *   choice; this component fills the parent.
 * - variant="tile": shows the full tile with the baked-in name. Use for
 *   the picker grid.
 *
 * `className` is forwarded to the rendered <div> so callers control sizing.
 */
function CharacterAvatar({ characterId, variant = 'avatar', className = '', title }) {
  const char = getCharacter(characterId)
  if (!char) return null
  return (
    <div
      className={className}
      role="img"
      aria-label={title || char.name}
      style={spriteStyle(char, variant)}
    />
  )
}

export default memo(CharacterAvatar)
