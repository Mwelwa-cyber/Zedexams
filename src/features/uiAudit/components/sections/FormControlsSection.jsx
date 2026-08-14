import { useState } from 'react'
import {
  AdvancedOptions,
  FieldDate,
  FieldGrid,
  FieldLabel,
  FieldNumberCombo,
  FieldSelect,
  FieldText,
  FieldTextarea,
  FieldWrapper,
  GenerateButton,
} from '../../../../shared/components/studioFields'
import DurationSelect from '../../../../shared/components/DurationSelect'
import ListTextarea from '../../../../shared/components/ListTextarea'
import { Block, Section, Specimen } from '../auditKit.jsx'
import { ForceFocus } from '../forcedStates.jsx'

/**
 * Section 3 — form controls.
 *
 * Rendered through `studioFields.jsx`, the real shared field set every teacher
 * studio uses, plus the two standalone control primitives (DurationSelect,
 * ListTextarea). Nothing here is a lookalike.
 *
 * SELECTS GET THE MOST ROOM ON PURPOSE.
 * `.studio-theme .studio-input` paints a fixed white background and a fixed
 * cream border, and Night reaches it through a separate override block —
 * which is exactly the arrangement that produced the tiling dropdown arrow
 * (`selectArrow.test.js`): a dark-theme rule used the `background` SHORTHAND,
 * which silently reset `background-repeat` and `background-position` set in
 * another rule, and the chevron tiled across every Class/Grade/Subject select
 * in the app, on Night only. Nothing in the offending rule mentioned repeat,
 * position or the arrow.
 *
 * So: check the chevron. One arrow, right-aligned, vertically centred, in all
 * four themes. And check the open list — a native <option> list is painted by
 * the platform from `color-scheme`, not by our CSS, so a dark theme that
 * forgets to declare `color-scheme: dark` opens a white menu out of a dark
 * control. index.css sets it on `html[data-theme='night']`; the note under the
 * open-select specimen explains what that means for the side-by-side columns.
 */

const SUBJECTS = [
  { value: 'maths', label: 'Mathematics' },
  { value: 'english', label: 'English' },
  { value: 'science', label: 'Integrated Science' },
]

const GROUPED = [
  { group: 'Tests' },
  { value: 'topic_test', label: 'Topic test' },
  { value: 'mid_term', label: 'Mid-term test' },
  { group: 'Examinations' },
  { value: 'mock_exam', label: 'Mock examination' },
  { value: 'final_exam', label: 'Final examination' },
]

export default function FormControlsSection() {
  const [text, setText] = useState('Fractions and decimals')
  const [area, setArea] = useState('Learners should be able to convert between fractions and decimals.')
  const [subject, setSubject] = useState('maths')
  const [type, setType] = useState('mid_term')
  const [date, setDate] = useState('2026-08-14')
  const [count, setCount] = useState(20)
  const [minutes, setMinutes] = useState(45)
  const [list, setList] = useState(['Add fractions', 'Simplify to lowest terms'])
  const [checked, setChecked] = useState(true)
  const [radio, setRadio] = useState('b')
  const [toggle, setToggle] = useState(true)

  return (
    <Section
      id="forms"
      title="3 · Form controls"
      note={
        'Rendered through studioFields.jsx — the real field set behind every teacher studio — plus DurationSelect and ListTextarea. Selects get the most attention here: the studio input is painted with fixed literals and reaches Night through a separate override block, which is the arrangement that once tiled the dropdown chevron across every select in the app.'
      }
    >
      <Block
        title="A studio field row, as it appears in a studio"
        note="Label, control, helper text — the shape a teacher actually meets."
      >
        <FieldGrid>
          <FieldText
            label="Paper title"
            value={text}
            onChange={setText}
            placeholder="e.g. Fractions and decimals"
            maxLength={80}
          />
          <FieldSelect
            label="Subject"
            value={subject}
            options={SUBJECTS}
            onChange={setSubject}
          />
        </FieldGrid>
        <div className="mt-3">
          <FieldTextarea
            label="Learning outcome"
            value={area}
            onChange={setArea}
            placeholder="What should the learner be able to do?"
            maxLength={300}
          />
        </div>
      </Block>

      <Block
        title="Select — closed, grouped, and open"
        note="The grouped select is the assessment-type picker (optgroups). The third is rendered with `size` so the option list is permanently open: a native option list is drawn by the platform from `color-scheme`, which index.css sets on html[data-theme='night'] — so in a side-by-side column the open list may stay light even where the control is dark. Judge open-list colour from the whole-page theme switch, not from a column."
      >
        <FieldGrid>
          <FieldSelect
            label="Assessment type (grouped)"
            value={type}
            options={GROUPED}
            onChange={setType}
          />
          <div>
            <FieldLabel>Open list (size=6)</FieldLabel>
            <select
              className="studio-input"
              size={6}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <optgroup label="Tests">
                <option value="topic_test">Topic test</option>
                <option value="weekly_test">Weekly test</option>
                <option value="mid_term">Mid-term test</option>
              </optgroup>
              <optgroup label="Examinations">
                <option value="mock_exam">Mock examination</option>
                <option value="examination">Examination</option>
                <option value="final_exam">Final examination</option>
              </optgroup>
            </select>
          </div>
        </FieldGrid>
        <div className="mt-3">
          <FieldLabel>Native select, unstyled (browser default)</FieldLabel>
          <select className="input-field" defaultValue="maths">
            {SUBJECTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="theme-text-muted mt-1 text-body-sm">
            Beside <code>.input-field</code> rather than{' '}
            <code>.studio-input</code>: the two are separate implementations of
            the same control and drift independently.
          </p>
        </div>
      </Block>

      <Block title="Dates, numbers and durations">
        <FieldGrid>
          <FieldDate label="Due date" value={date} onChange={setDate} />
          <FieldNumberCombo
            label="Number of questions"
            value={count}
            options={[10, 20, 30, 40].map((n) => ({ value: n, label: `${n}` }))}
            onChange={setCount}
          />
        </FieldGrid>
        <div className="mt-3 max-w-xs">
          <DurationSelect
            label="Duration"
            value={minutes}
            onChange={setMinutes}
          />
        </div>
      </Block>

      <Block
        title="Checkbox, radio, switch and file"
        note="No shared primitive exists for any of these — every surface hand-rolls them. What follows is the most common hand-rolled shape, tokenised; see Gaps found."
      >
        <div className="flex flex-wrap items-start gap-6">
          <FieldWrapper label="Checkbox">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-body-sm theme-text">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                  className="h-4 w-4 accent-[color:var(--accent)]"
                />
                Include an answer key
              </label>
              <label className="flex items-center gap-2 text-body-sm theme-text-muted">
                <input type="checkbox" disabled className="h-4 w-4" />
                Disabled
              </label>
            </div>
          </FieldWrapper>

          <FieldWrapper label="Radio">
            <div className="space-y-1.5">
              {[
                ['a', 'Easy'],
                ['b', 'Medium'],
                ['c', 'Hard'],
              ].map(([v, l]) => (
                <label
                  key={v}
                  className="flex items-center gap-2 text-body-sm theme-text"
                >
                  <input
                    type="radio"
                    name="ui-audit-difficulty"
                    value={v}
                    checked={radio === v}
                    onChange={() => setRadio(v)}
                    className="h-4 w-4 accent-[color:var(--accent)]"
                  />
                  {l}
                </label>
              ))}
            </div>
          </FieldWrapper>

          <FieldWrapper label="Switch / toggle">
            <button
              type="button"
              role="switch"
              aria-checked={toggle}
              onClick={() => setToggle((v) => !v)}
              className={`relative h-6 w-11 rounded-full border theme-border transition-colors ${
                toggle ? 'theme-accent-fill' : 'theme-bg-subtle'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full theme-card shadow-elev-sm transition-all ${
                  toggle ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </FieldWrapper>

          <FieldWrapper label="File input">
            <input type="file" className="text-body-sm theme-text" />
          </FieldWrapper>
        </div>
      </Block>

      <Block
        title="States — focused, error, disabled"
        note="The error styling is the studio's own: a red hairline plus a message. There is no error prop on any field primitive, so every studio applies it by hand — see Gaps found."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Specimen label="default">
            <input className="studio-input" defaultValue="Grade 7" />
          </Specimen>
          <Specimen label="focus-visible (pinned)">
            <ForceFocus>
              <input className="studio-input" defaultValue="Grade 7" />
            </ForceFocus>
          </Specimen>
          <Specimen label="error">
            <div className="w-full">
              <input
                className="studio-input border-[color:var(--danger)]"
                defaultValue=""
                aria-invalid="true"
                aria-describedby="ui-audit-err"
                placeholder="Required"
              />
              <p id="ui-audit-err" className="text-danger mt-1 text-body-sm font-bold">
                Pick a grade before generating.
              </p>
            </div>
          </Specimen>
          <Specimen label="disabled">
            <input className="studio-input" defaultValue="Grade 7" disabled />
          </Specimen>
        </div>
      </Block>

      <Block
        title="ListTextarea"
        note="Renders a bare <textarea> and nothing else — it carries no label of its own, so every call site supplies one. Wrapped here in the studio's FieldLabel to match how it actually appears."
      >
        <FieldWrapper label="Topics">
          <ListTextarea
            value={list}
            onChange={setList}
            rows={4}
            className="studio-input"
            placeholder="One topic per line"
          />
        </FieldWrapper>
      </Block>

      <Block
        title="AdvancedOptions + GenerateButton"
        note="The disclosure and the submit control every studio ends with."
      >
        <AdvancedOptions hint="Tone, difficulty spread, figure policy">
          <FieldGrid>
            <FieldSelect
              label="Difficulty"
              value={subject}
              options={SUBJECTS}
              onChange={setSubject}
            />
            <FieldText label="Notes for the model" value="" onChange={() => {}} />
          </FieldGrid>
        </AdvancedOptions>
        <div className="mt-3 flex flex-wrap gap-3">
          <GenerateButton generating={false}>Generate paper</GenerateButton>
          <GenerateButton generating>Generate paper</GenerateButton>
          <GenerateButton generating={false} disabled>
            Generate paper
          </GenerateButton>
        </div>
      </Block>
    </Section>
  )
}
