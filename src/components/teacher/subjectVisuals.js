/**
 * subjectVisuals — the ONE subject → { icon, colour } map for teacher
 * surfaces (Assessment Papers list tiles, the timetable subject palette,
 * anywhere a subject needs a scannable visual identity).
 *
 * Icons are Lucide components — never emoji (emoji render differently per
 * OS and read as informal) and never mascots (learner-side only). Colours
 * are the Chip family hues so a subject keeps one identity across chips,
 * tiles and palette pills.
 *
 * Matching is by normalized substring so "Integrated Science", "Science"
 * and "INTEGRATED SCIENCE" all land on the same entry. Unknown subjects
 * fall back to FileText on neutral.
 */

import {
  BookOpen,
  Calculator,
  CookingPot,
  FileText,
  FlaskConical,
  Globe,
  HeartPulse,
  Landmark,
  Languages,
  Laptop,
  MessageSquare,
  Music,
  Palette,
  Sprout,
  Wrench,
} from 'lucide-react'

// Light wash + ink pairs, mirrored from the .zx-chip palette in index.css.
const TONES = {
  green: { bg: '#dff0e5', fg: '#1e7a4c' },
  blue: { bg: '#e2ecf8', fg: '#2b5fa3' },
  amber: { bg: '#fbefd2', fg: '#8a5a00' },
  pink: { bg: '#f8e2ec', fg: '#b04a78' },
  purple: { bg: '#ece5f8', fg: '#6b4fa3' },
  teal: { bg: '#dcefec', fg: '#16505d' },
  red: { bg: '#f9e3de', fg: '#b3402e' },
  neutral: { bg: '#f1eadb', fg: '#5b6472' },
}

// Order matters: first match wins, so more specific phrases sit above the
// generic ones ("home economics" before "economics"-style collisions).
const RULES = [
  { match: ['home economics', 'home econ'], icon: CookingPot, tone: 'pink' },
  { match: ['technology studies', 'design and technology', 'technology'], icon: Wrench, tone: 'blue' },
  { match: ['computer', 'ict', 'computing'], icon: Laptop, tone: 'purple' },
  { match: ['integrated science', 'science', 'biology', 'chemistry', 'physics'], icon: FlaskConical, tone: 'green' },
  { match: ['mathematics', 'maths', 'math'], icon: Calculator, tone: 'amber' },
  { match: ['english', 'literacy'], icon: BookOpen, tone: 'blue' },
  { match: ['literature'], icon: BookOpen, tone: 'purple' },
  { match: ['social studies', 'geography'], icon: Globe, tone: 'teal' },
  { match: ['history', 'civic', 'religious', 'r.e', 'moral'], icon: Landmark, tone: 'amber' },
  { match: ['expressive arts', 'creative', 'art and design', 'art'], icon: Palette, tone: 'pink' },
  { match: ['music'], icon: Music, tone: 'purple' },
  { match: ['physical education', 'p.e', 'health'], icon: HeartPulse, tone: 'red' },
  { match: ['agriculture', 'agricultural', 'environmental'], icon: Sprout, tone: 'green' },
  {
    match: ['zambian language', 'bemba', 'nyanja', 'tonga', 'lozi', 'kaonde', 'lunda', 'luvale', 'french', 'chinese', 'language'],
    icon: Languages,
    tone: 'teal',
  },
  { match: ['communication'], icon: MessageSquare, tone: 'blue' },
]

function normalize(subject) {
  return String(subject || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @returns {{ icon: Component, bg: string, fg: string, tone: string }}
 */
export function subjectVisual(subject) {
  const s = normalize(subject)
  if (s) {
    for (const rule of RULES) {
      if (rule.match.some((m) => s.includes(m))) {
        const tone = TONES[rule.tone]
        return { icon: rule.icon, bg: tone.bg, fg: tone.fg, tone: rule.tone }
      }
    }
  }
  const tone = TONES.neutral
  return { icon: FileText, bg: tone.bg, fg: tone.fg, tone: 'neutral' }
}

export default subjectVisual
