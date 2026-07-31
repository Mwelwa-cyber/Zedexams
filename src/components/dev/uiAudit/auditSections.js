import ButtonsSection from './sections/ButtonsSection.jsx'
import CardsSection from './sections/CardsSection.jsx'
import ContentSection from './sections/ContentSection.jsx'
import DataDisplaySection from './sections/DataDisplaySection.jsx'
import FeedbackSection from './sections/FeedbackSection.jsx'
import FormControlsSection from './sections/FormControlsSection.jsx'
import GapsSection from './sections/GapsSection.jsx'
import IconsSection from './sections/IconsSection.jsx'
import NavigationSection from './sections/NavigationSection.jsx'
import TokensSection from './sections/TokensSection.jsx'

/**
 * The audit page's table of contents, and the only place it is declared.
 *
 * The page body and the jump-link nav are both rendered from this array, so
 * they cannot disagree about what exists — a nav entry pointing at a section
 * that was removed is the kind of small rot that makes an internal tool stop
 * being trusted. Adding a section is one entry here.
 *
 * `allThemes: true` marks a section the side-by-side comparison mode renders
 * four times, once per theme. It is opt-in rather than universal because
 * four copies of the icon grid or the Lucide inventory is 1,200 SVGs and
 * tells you nothing — those sections have no theme-dependent surface worth
 * quadrupling. Tokens, buttons, form controls and cards are where a theme
 * actually breaks, which is what the brief asks the mode to cover.
 */
export const AUDIT_SECTIONS = Object.freeze([
  { id: 'tokens', title: 'Design tokens', Component: TokensSection, allThemes: true },
  { id: 'buttons', title: 'Buttons', Component: ButtonsSection, allThemes: true },
  { id: 'forms', title: 'Form controls', Component: FormControlsSection, allThemes: true },
  { id: 'cards', title: 'Cards', Component: CardsSection, allThemes: true },
  { id: 'navigation', title: 'Navigation + chrome', Component: NavigationSection, allThemes: true },
  { id: 'feedback', title: 'Feedback', Component: FeedbackSection, allThemes: true },
  { id: 'data', title: 'Data display', Component: DataDisplaySection, allThemes: true },
  { id: 'content', title: 'Content rendering', Component: ContentSection, allThemes: true },
  { id: 'icons', title: 'Icons', Component: IconsSection, allThemes: false },
  { id: 'gaps', title: 'Gaps found', Component: GapsSection, allThemes: false },
])
