// Assessment Studio — the Table of Specifications view.
//
// A fourth studio surface alongside Builder, Preview and Marking key, because
// the Table of Specifications is a fourth DOCUMENT: the learner never sees it,
// it is not part of the marking, and it is the sheet a head teacher asks for
// when they check a teacher's file. It used to exist only as a download button
// on the pre-generation plan panel, which meant a teacher editing a saved paper
// had no way back to it at all.
//
// Derived from the paper as it now stands — not the plan it was generated from
// — because by the time a teacher files this, the questions are the truth about
// what is being assessed.

import Icon from '../studio/studioIcons'
import TableOfSpecificationPanel from '../TableOfSpecificationPanel'

export default function TableOfSpecificationView({
  blueprint = null,
  questions = [],
  meta = {},
  changeView,
}) {
  return (
    <section className="sv-view">
      <div className="sv-builder-bar">
        <button className="sv-chip" onClick={() => changeView('builder')}>
          <Icon name="builder" size={14} /> Builder
        </button>
        <button className="sv-chip" onClick={() => changeView('preview')}>
          <Icon name="preview" size={14} /> Preview
        </button>
        <button className="sv-chip" onClick={() => changeView('marking-key')}>
          <Icon name="key" size={14} /> Marking key
        </button>
        <button className="sv-chip active" onClick={() => changeView('tos')}>
          <Icon name="target" size={14} /> Spec table
        </button>
      </div>

      <div className="sv-doc-canvas">
        <TableOfSpecificationPanel
          blueprint={blueprint}
          questions={questions}
          meta={meta}
          heading="Table of Specifications"
        />
      </div>
    </section>
  )
}
