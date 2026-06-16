/* Visual Studio home — five entry cards (brief item 1). Mobile-friendly:
   the grid collapses to one column under .vs-cards' media query. */

import {
  IconSparkles, IconTemplate, IconBank, IconBlank, IconSaved,
} from './VsIcons'

const CARDS = [
  {
    id: 'generate', cls: 'vs-card--ai', Icon: IconSparkles,
    title: 'Generate with AI',
    text: 'Describe a diagram; get a clean, printable picture you can label.',
  },
  {
    id: 'templates', cls: '', Icon: IconTemplate,
    title: 'Create from template',
    text: 'Start from a ready-made diagram and edit it.',
  },
  {
    id: 'bank', cls: 'vs-card--bank', Icon: IconBank,
    title: 'Use Picture Bank',
    text: 'Reuse a saved or shared picture — no new generation needed.',
  },
  {
    id: 'blank', cls: '', Icon: IconBlank,
    title: 'Blank canvas',
    text: 'Upload your own image, then add labels and arrows.',
  },
  {
    id: 'saved', cls: 'vs-card--bank', Icon: IconSaved,
    title: 'My saved visuals',
    text: 'Open, reuse or send your saved pictures to a studio.',
  },
]

export default function VisualStudioHome({ onPick }) {
  return (
    <div>
      <div className="vs-cards">
        {CARDS.map(({ id, cls, Icon, title, text }) => (
          <button key={id} type="button" className={`vs-card ${cls}`} onClick={() => onPick(id)}>
            <span className="vs-card__icon"><Icon size={22} /></span>
            <p className="vs-card__title">{title}</p>
            <p className="vs-card__text">{text}</p>
          </button>
        ))}
      </div>
      <p className="vs-hint" style={{ marginTop: 16 }}>
        Tip: black-and-white diagrams print clearly on tests and worksheets. Generate a
        picture, add letter labels (P, Q, R), then make a learner version and an answer key
        with one click.
      </p>
    </div>
  )
}
