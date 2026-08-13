// The Table of Specifications, on screen and editable (§ teacher's file).
//
// The studio could already produce this document, but only as a download — the
// teacher clicked "Download Word", opened it in another app, and only then
// found out what it said. A Table of Specifications is checked, corrected and
// signed before it goes in a file, so it has to be VISIBLE where it is made,
// and every figure in it has to be changeable.
//
// So the grid below is the document: the same model the print window and the
// Word export walk, drawn as the real table with the real headings, with each
// cell an input the teacher can correct. What they see here is what lands in
// the file.
//
// Two ways to fill it, both of which teachers actually use:
//   • Suggested — filled in from the paper's own topics, thinking levels and
//     marks (or from the plan, before the paper exists). It is a SUGGESTION:
//     the whole point is that the teacher overrules it where they disagree.
//   • Blank — the printed frame with nothing in it, for a school that fills
//     these in by hand.
//
// Nothing here calls a model. The suggestion is derived from the plan the
// generator was already constrained by, so it costs nothing, appears instantly
// and cannot contradict the paper it describes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_BLANK_ROW_COUNT,
  TOS_MODES,
  TOS_TAXONOMY_OPTIONS,
  addTableOfSpecificationsRow,
  blankTableOfSpecificationsRows,
  buildTableOfSpecificationsModel,
  convertTableOfSpecificationsRows,
  downloadTableOfSpecificationsModelDocx,
  printTableOfSpecificationsModel,
  removeTableOfSpecificationsRow,
  setTableOfSpecificationsCell,
  setTableOfSpecificationsTopic,
  suggestTableOfSpecificationsRows,
  tableOfSpecificationsCellText,
  tableOfSpecificationsEdited,
} from '../lib/tableOfSpecifications'

function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export default function TableOfSpecificationPanel({
  // Either or both. `questions` (the paper as it now stands) wins over
  // `blueprint` (the paper as it was planned) — see suggestTableOfSpecifications.
  blueprint = null,
  questions = [],
  meta = {},
  defaultTaxonomy = '',
  disabled = false,
  heading = 'Table of Specifications',
}) {
  const suggestedTaxonomy = defaultTaxonomy ||
    (String(meta.framework || blueprint?.framework || '').includes('2013') ? 'traditional' : 'revised')

  const [taxonomy, setTaxonomy] = useState(suggestedTaxonomy)
  const [mode, setMode] = useState('suggested')
  const [rows, setRows] = useState(() => suggestTableOfSpecificationsRows(
    { blueprint, questions }, suggestedTaxonomy,
  ))
  const [signature, setSignature] = useState(() => ({
    schoolName: meta.schoolName || '',
    teacherName: meta.teacherName || '',
    checkedBy: '',
    preparedDate: meta.preparedDate || todayIso(),
  }))
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  // The suggestion the teacher is being offered, in the vocabulary they picked.
  const suggestionFor = useCallback(
    (taxonomyId) => suggestTableOfSpecificationsRows({ blueprint, questions }, taxonomyId),
    [blueprint, questions],
  )

  // What the suggestion is DERIVED FROM, as a value rather than an object
  // identity. The studio rebuilds its questions array on every keystroke, so an
  // identity-keyed effect would re-suggest (and re-render) forever; this only
  // fires when a topic, a thinking level or a mark actually changed.
  const sourceKey = [
    ...(blueprint?.sections || []).flatMap((section) => (section?.items || []).map(
      (item) => `b|${item?.topic}|${item?.bloomLevel}|${item?.marks}`,
    )),
    ...(questions || []).map((q) => `q|${q?.topic}|${q?.bloom || q?.bloomLevel}|${q?.marks}`),
  ].join('\n')

  // Re-derive when the PAPER changes — but never when the teacher has taken
  // the grid over. Overwriting their corrections because a question's marks
  // changed is the one behaviour that would stop them trusting the panel.
  const editedRef = useRef(false)
  useEffect(() => {
    if (editedRef.current || mode === 'blank') return
    setRows(suggestionFor(taxonomy))
    // `sourceKey` stands in for blueprint + questions by value; `suggestionFor`
    // changes identity on every studio render and must not drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, taxonomy, mode])

  const markEdited = useCallback((next) => {
    editedRef.current = true
    setRows(next)
    setMessage('')
  }, [])

  function changeTaxonomy(nextId) {
    if (nextId === taxonomy) return
    // Both vocabularies carry one column per cognitive level, so a teacher's
    // corrections survive the relabelling rather than being reset by it.
    setRows((current) => convertTableOfSpecificationsRows(current, taxonomy, nextId))
    setTaxonomy(nextId)
    setMessage('')
  }

  function changeMode(nextId) {
    if (nextId === mode) return
    setMode(nextId)
    setMessage('')
    if (nextId === 'blank') {
      setRows(blankTableOfSpecificationsRows(DEFAULT_BLANK_ROW_COUNT, taxonomy))
    } else {
      editedRef.current = false
      setRows(suggestionFor(taxonomy))
    }
  }

  function resetToSuggestion() {
    editedRef.current = false
    setRows(suggestionFor(taxonomy))
    setMessage('Back to the suggested figures.')
  }

  const model = useMemo(() => buildTableOfSpecificationsModel(
    { blueprint, questions },
    {
      ...meta,
      ...signature,
      bloomTaxonomy: taxonomy,
      mode,
      rows,
    },
  ), [blueprint, questions, meta, signature, taxonomy, mode, rows])

  // Derived, not a flag: a teacher who types a figure and then types it back
  // has not changed anything, and a panel still claiming otherwise would be
  // offering to undo an edit that no longer exists.
  const edited = mode !== 'blank' &&
    tableOfSpecificationsEdited(rows, suggestionFor(taxonomy), taxonomy)

  const selectedTaxonomy = TOS_TAXONOMY_OPTIONS.find((o) => o.id === taxonomy) || TOS_TAXONOMY_OPTIONS[0]
  const columns = model.columns
  const untagged = model.totals.untagged || 0

  async function exportSpecifications(kind) {
    if (busy || disabled) return
    setBusy(kind)
    setMessage('')
    try {
      if (kind === 'word') {
        const { filename } = await downloadTableOfSpecificationsModelDocx(model)
        setMessage(`${filename} is downloading.`)
      } else {
        printTableOfSpecificationsModel(model)
        setMessage('The filing copy is open in a new tab. Choose Print or Save as PDF.')
      }
    } catch (error) {
      setMessage(error?.message || 'Could not prepare the Table of Specifications.')
    } finally {
      setBusy('')
    }
  }

  const failed = /could not|blocked|no table/i.test(message)
  const locked = disabled || Boolean(busy)

  return (
    <section className="sv-tos" aria-labelledby="sv-tos-heading">
      <header className="sv-tos-head">
        <div>
          <h3 className="sv-tos-title" id="sv-tos-heading">{heading}</h3>
          <p className="sv-tos-sub">
            The topics, thinking levels and marks this paper covers — the copy that
            goes in your teacher&apos;s file. It is not part of the learner&apos;s
            question paper.
          </p>
        </div>
      </header>

      <div className="sv-tos-controls">
        <fieldset className="sv-tos-field">
          <legend>How it is filled in</legend>
          <div className="sv-tos-pills">
            {TOS_MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`sv-cpm-pill ${mode === option.id ? 'active' : ''}`}
                aria-pressed={mode === option.id}
                disabled={locked}
                onClick={() => changeMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="sv-tos-hint">
            {(TOS_MODES.find((o) => o.id === mode) || TOS_MODES[0]).description}
          </p>
        </fieldset>

        <fieldset className="sv-tos-field">
          <legend>Bloom&apos;s taxonomy format</legend>
          <div className="sv-tos-pills">
            {TOS_TAXONOMY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`sv-cpm-pill ${taxonomy === option.id ? 'active' : ''}`}
                aria-pressed={taxonomy === option.id}
                disabled={locked}
                onClick={() => changeTaxonomy(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="sv-tos-hint">{selectedTaxonomy.description}</p>
        </fieldset>
      </div>

      {/* The document, as it will print. Editable in place: this IS the
          suggestion, and a suggestion the teacher cannot overrule is just
          an assertion. */}
      <div className="sv-tos-sheet">
        <div className="sv-tos-sheet-head">
          {model.ministry && <div className="sv-tos-ministry">{model.ministry}</div>}
          <div className="sv-tos-school">{model.schoolName || 'SCHOOL NAME'}</div>
          <div className="sv-tos-doc-title">TABLE OF SPECIFICATIONS</div>
          <div className="sv-tos-doc-sub">
            {[model.title, model.grade, model.subject,
              model.term && `Term ${model.term}`, model.year]
              .filter(Boolean).join(' · ')}
          </div>
        </div>

        <div className="sv-tos-scroll">
          <table className="sv-tos-table">
            <caption className="sv-sr-only">
              Table of Specifications for {model.title}: questions by topic and
              cognitive level, using the {model.taxonomyLabel}.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sn">S/N</th>
                <th scope="col" className="topic">Topics covered</th>
                {columns.map((column) => (
                  <th key={column.key} scope="col" title={column.label}>
                    <span className="sv-tos-abbr">{column.short}</span>
                    <span className="sv-tos-full">{column.label}</span>
                  </th>
                ))}
                <th scope="col">Total</th>
                <th scope="col">Marks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td className="sn">{index + 1}</td>
                  <td className="topic">
                    <input
                      type="text"
                      className="sv-tos-input topic"
                      value={row.topic}
                      disabled={locked}
                      placeholder="Topic or syllabus area"
                      aria-label={`Topic for row ${index + 1}`}
                      onChange={(e) => markEdited(
                        setTableOfSpecificationsTopic(rows, index, e.target.value),
                      )}
                    />
                  </td>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <input
                        type="number"
                        min="0"
                        className="sv-tos-input num"
                        value={tableOfSpecificationsCellText(row[column.key])}
                        disabled={locked}
                        aria-label={`${column.label} questions for row ${index + 1}`}
                        onChange={(e) => markEdited(setTableOfSpecificationsCell(
                          rows, index, column.key, e.target.value, taxonomy,
                        ))}
                      />
                    </td>
                  ))}
                  <td className="sv-tos-total" aria-label={`Total questions for row ${index + 1}`}>
                    {tableOfSpecificationsCellText(row.questions)}
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      className="sv-tos-input num"
                      value={tableOfSpecificationsCellText(row.marks)}
                      disabled={locked}
                      aria-label={`Marks for row ${index + 1}`}
                      onChange={(e) => markEdited(setTableOfSpecificationsCell(
                        rows, index, 'marks', e.target.value, taxonomy,
                      ))}
                    />
                  </td>
                  <td className="sv-tos-rowaction">
                    <button
                      type="button"
                      className="sv-tos-remove"
                      disabled={locked || rows.length <= 1}
                      aria-label={`Remove row ${index + 1}`}
                      title="Remove this row"
                      onClick={() => markEdited(removeTableOfSpecificationsRow(rows, index))}
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sn" />
                <td className="topic">TOTAL</td>
                {columns.map((column) => (
                  <td key={column.key}>{tableOfSpecificationsCellText(model.totals[column.key])}</td>
                ))}
                <td className="sv-tos-total">{tableOfSpecificationsCellText(model.totals.questions)}</td>
                <td className="sv-tos-total">{tableOfSpecificationsCellText(model.totals.marks)}</td>
                <td className="sv-tos-rowaction" />
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="sv-tos-legend">
          {columns.map((column) => `${column.short} = ${column.label}`).join('  ·  ')}
        </p>
      </div>

      <div className="sv-tos-rowtools">
        <button
          type="button"
          className="sv-btn"
          disabled={locked}
          onClick={() => markEdited(addTableOfSpecificationsRow(rows, taxonomy))}
        >
          + Add a row
        </button>
        {edited && mode !== 'blank' && (
          <button type="button" className="sv-btn" disabled={locked} onClick={resetToSuggestion}>
            Reset to the suggestion
          </button>
        )}
        {edited && mode !== 'blank' && (
          <span className="sv-tos-note">Your figures — the suggestion has been changed.</span>
        )}
      </div>

      {untagged > 0 && mode !== 'blank' && (
        <p className="sv-tos-warn" role="status">
          {untagged} question{untagged === 1 ? ' has' : 's have'} no thinking level
          tagged, so {untagged === 1 ? 'it is' : 'they are'} not counted in any column.
          Tag {untagged === 1 ? 'it' : 'them'} in the question editor, or type the
          figures in above.
        </p>
      )}

      <div className="sv-tos-signature">
        <label>
          <span>School</span>
          <input
            type="text"
            value={signature.schoolName}
            disabled={locked}
            placeholder="School name"
            onChange={(e) => setSignature((s) => ({ ...s, schoolName: e.target.value }))}
          />
        </label>
        <label>
          <span>Prepared by</span>
          <input
            type="text"
            value={signature.teacherName}
            disabled={locked}
            placeholder="Your name"
            onChange={(e) => setSignature((s) => ({ ...s, teacherName: e.target.value }))}
          />
        </label>
        <label>
          <span>Checked by</span>
          <input
            type="text"
            value={signature.checkedBy}
            disabled={locked}
            placeholder="Head of department"
            onChange={(e) => setSignature((s) => ({ ...s, checkedBy: e.target.value }))}
          />
        </label>
        <label>
          <span>Date</span>
          <input
            type="date"
            value={signature.preparedDate}
            disabled={locked}
            onChange={(e) => setSignature((s) => ({ ...s, preparedDate: e.target.value }))}
          />
        </label>
      </div>

      <div className="sv-tos-actions">
        <button
          type="button"
          className="sv-btn"
          disabled={locked}
          onClick={() => exportSpecifications('pdf')}
        >
          {busy === 'pdf' ? 'Preparing…' : 'Print / Save PDF'}
        </button>
        <button
          type="button"
          className="sv-btn sv-btn-primary"
          disabled={locked}
          onClick={() => exportSpecifications('word')}
        >
          {busy === 'word' ? 'Preparing Word…' : 'Download Word copy'}
        </button>
      </div>

      {message && (
        <div role="status" className={`sv-tos-message ${failed ? 'is-error' : ''}`}>
          {message}
        </div>
      )}
    </section>
  )
}
