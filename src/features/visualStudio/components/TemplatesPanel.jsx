/* Create-from-template (brief item 9). MVP templates are curriculum-aware
   generation presets: picking one pre-fills the AI panel with a topic + style
   so the teacher gets an editable diagram in one click. Every result is fully
   editable on the canvas afterward. */

import { IconTemplate } from './VsIcons'

export const TEMPLATES = [
  { id: 'human-body', title: 'Human body diagram', subject: 'Integrated Science', topic: 'The human body', styleId: 'bw_test_diagram', useCase: 'assessment' },
  { id: 'respiratory', title: 'Respiratory system', subject: 'Integrated Science', topic: 'Human respiratory system', styleId: 'bw_test_diagram', useCase: 'assessment' },
  { id: 'plant', title: 'Parts of a plant', subject: 'Integrated Science', topic: 'Parts of a plant', styleId: 'labelled_diagram', useCase: 'worksheet' },
  { id: 'animal', title: 'Animal diagram', subject: 'Integrated Science', topic: 'Animal body parts', styleId: 'labelled_diagram', useCase: 'worksheet' },
  { id: 'food-groups', title: 'Food groups', subject: 'Home Economics', topic: 'Food groups and balanced diet', styleId: 'colour_illustration', useCase: 'poster' },
  { id: 'water-cycle', title: 'Water cycle', subject: 'Integrated Science', topic: 'The water cycle', styleId: 'bw_test_diagram', useCase: 'lessonPlan' },
  { id: 'weather', title: 'Weather symbols', subject: 'Social Studies', topic: 'Weather and climate', styleId: 'line_drawing', useCase: 'worksheet' },
  { id: 'map', title: 'Map of Zambia', subject: 'Social Studies', topic: 'Map of Zambia, provinces', styleId: 'bw_test_diagram', useCase: 'assessment' },
  { id: 'shapes', title: 'Geometric shapes', subject: 'Mathematics', topic: '2D and 3D shapes', styleId: 'bw_test_diagram', useCase: 'worksheet' },
  { id: 'fractions', title: 'Fractions', subject: 'Mathematics', topic: 'Fractions as parts of a whole', styleId: 'bw_test_diagram', useCase: 'worksheet' },
  { id: 'number-line', title: 'Number line', subject: 'Mathematics', topic: 'Number line 0 to 20', styleId: 'line_drawing', useCase: 'worksheet' },
  { id: 'bar-chart', title: 'Bar chart', subject: 'Mathematics', topic: 'Blank bar chart grid', styleId: 'bw_test_diagram', useCase: 'worksheet' },
  { id: 'flow-chart', title: 'Flow chart', subject: 'Integrated Science', topic: 'Process flow chart', styleId: 'line_drawing', useCase: 'notes' },
  { id: 'venn', title: 'Venn diagram', subject: 'Mathematics', topic: 'Two-circle Venn diagram', styleId: 'bw_test_diagram', useCase: 'worksheet' },
  { id: 'life-cycle', title: 'Life cycle', subject: 'Integrated Science', topic: 'Life cycle of a butterfly', styleId: 'labelled_diagram', useCase: 'lessonPlan' },
  { id: 'safety-signs', title: 'Safety signs', subject: 'Integrated Science', topic: 'Laboratory and road safety signs', styleId: 'line_drawing', useCase: 'poster' },
  { id: 'comprehension', title: 'Comprehension picture', subject: 'English', topic: 'A busy market scene for comprehension', styleId: 'colour_illustration', useCase: 'worksheet' },
]

export default function TemplatesPanel({ onUseTemplate }) {
  return (
    <div>
      <p className="vs-sub" style={{ marginBottom: 12 }}>
        Pick a starting point — it pre-fills the AI generator with a topic and style. You can edit
        everything afterwards.
      </p>
      <div className="vs-cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' }}>
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" className="vs-card" onClick={() => onUseTemplate(t)} style={{ minHeight: 104 }}>
            <span className="vs-card__icon"><IconTemplate size={20} /></span>
            <p className="vs-card__title" style={{ fontSize: 14 }}>{t.title}</p>
            <p className="vs-card__text">{t.subject}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
