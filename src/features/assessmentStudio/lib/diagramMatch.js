// Match a diagram brief ("A labelled ear with X on the eardrum") against
// picture-bank entries. Pure scoring logic — node-testable — used by the
// studio's DiagramFixupPanel to suggest existing bank pictures before the
// teacher spends money generating a new one.

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'on', 'in', 'with', 'and', 'or', 'to', 'for',
  'showing', 'show', 'shows', 'shown', 'labelled', 'labeled', 'label',
  'labels', 'marked', 'mark', 'marks', 'diagram', 'picture', 'image',
  'figure', 'drawing', 'simple', 'needed', 'attach', 'letter', 'letters',
  'parts', 'part', 'its', 'their', 'is', 'are', 'be', 'by', 'at', 'as',
  'x', 'y', 'z',
])

export function briefTokens(brief) {
  return String(brief || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

/**
 * Score one bank picture against a set of brief tokens. Name hits weigh
 * more than keyword hits; exact token beats substring.
 */
export function scorePicture(pic, tokens) {
  if (!tokens.length) return 0
  const nameTokens = new Set(briefTokens(pic?.nameLower || pic?.name || ''))
  const keywords = (Array.isArray(pic?.keywords) ? pic.keywords : [])
    .map((k) => String(k).toLowerCase())
  let score = 0
  for (const t of tokens) {
    if (nameTokens.has(t)) { score += 3; continue }
    if (keywords.includes(t)) { score += 3; continue }
    if ([...nameTokens].some((n) => n.includes(t) || t.includes(n))) { score += 1; continue }
    if (keywords.some((k) => k.includes(t) || t.includes(k))) score += 1
  }
  return score
}

/**
 * Rank bank pictures for a diagram brief. Returns the top matches
 * (descending score), only including pictures that matched at least one
 * meaningful token — an empty result means "nothing close, generate it".
 */
export function rankPicturesForBrief(pictures, brief, { limit = 3 } = {}) {
  const tokens = briefTokens(brief)
  if (!tokens.length || !Array.isArray(pictures)) return []
  return pictures
    .map((pic) => ({ pic, score: scorePicture(pic, tokens) }))
    .filter(({ score }) => score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ pic, score }) => ({ ...pic, _matchScore: score }))
}
