/* AI picture generator (brief item 2). Curriculum-aware selectors compose an
   improved prompt, which is sent to the existing `generateDiagram` callable
   (Recraft B&W line art by default, with OpenAI/Kie for colour/photoreal).
   Results can be opened in the label editor or quick-saved to My Visuals. */

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { GRADES, SUBJECTS, SUBJECT_MAP } from '../../../config/curriculum'
import { useSyllabusTopicOptions } from '../../../components/teacher/syllabusTopicOptions'
import { generateDiagram } from '../../../utils/generateDiagram'
import {
  VISUAL_STYLES, USE_CASES, ORIENTATIONS, IMAGE_SIZES,
  resolveGenerationParams, clampImageCount, MAX_IMAGES_PER_BATCH,
} from '../lib/visualStudioMeta'
import { composeVisualPrompt, buildVisualTitle } from '../lib/visualPrompt'
import { saveVisualAsset } from '../services/visualAssetService'
import { IconSparkles, IconImage } from './VsIcons'

export default function GeneratePanel({ onEdit, onToast, assessmentMode = false, seed = null }) {
  const { currentUser, userProfile } = useAuth()
  const uid = currentUser?.uid

  const seedSubjectId = seed?.subject
    ? (SUBJECTS.find((s) => s.label === seed.subject)?.id || SUBJECTS[0]?.id)
    : (SUBJECTS[0]?.id || 'science')

  const [grade, setGrade] = useState(String(seed?.grade || GRADES[0] || '4'))
  const [subjectId, setSubjectId] = useState(seedSubjectId || 'science')
  const [topic, setTopic] = useState(seed?.topic || '')
  const [subtopic, setSubtopic] = useState('')
  const [styleId, setStyleId] = useState(seed?.styleId || 'bw_test_diagram')
  const [useCase, setUseCase] = useState(seed?.useCase || (assessmentMode ? 'assessment' : 'worksheet'))
  const [orientation, setOrientation] = useState('landscape')
  const [sizeId, setSizeId] = useState('medium')
  const [count, setCount] = useState(2)

  const [promptText, setPromptText] = useState('')
  const [promptDirty, setPromptDirty] = useState(false)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState([])
  const [savingIdx, setSavingIdx] = useState(-1)

  const subjectLabel = SUBJECT_MAP[subjectId]?.label || subjectId
  const { topics, subtopics, loading: syllabusLoading } =
    useSyllabusTopicOptions(grade, subjectLabel, topic, '2023')

  // Auto-compose the prompt from the structured inputs until the teacher edits
  // it by hand (then we stop clobbering their text).
  const autoPrompt = useMemo(
    () => composeVisualPrompt({ grade, subject: subjectLabel, topic, subtopic, useCase, styleId }),
    [grade, subjectLabel, topic, subtopic, useCase, styleId],
  )
  useEffect(() => {
    if (!promptDirty) setPromptText(autoPrompt)
  }, [autoPrompt, promptDirty])

  const styleMeta = VISUAL_STYLES.find((s) => s.id === styleId)

  function buildVisual(result) {
    return {
      imageUrl: result.url,
      title: buildVisualTitle({ topic, subtopic, grade, subject: subjectLabel }),
      grade,
      subject: subjectLabel,
      topic,
      subtopic,
      style: styleId,
      useCase,
      isBlackAndWhite: Boolean(styleMeta?.blackAndWhite),
      sourceType: 'ai',
      aiModel: result.provider || '',
      aiPrompt: result.prompt || promptText,
    }
  }

  async function handleGenerate() {
    if (!topic.trim()) { setError('Pick or type a topic first.'); return }
    setError('')
    setResults([])
    setBusy(true)
    const { provider, style, size } = resolveGenerationParams({ styleId, orientation, sizeId })
    const prompt = (promptText || autoPrompt).trim()
    const out = []
    try {
      const n = clampImageCount(count)
      for (let i = 0; i < n; i += 1) {
        setProgress(`Generating ${i + 1} of ${n}…`)
        // Sequential so each call meters cleanly and one failure stops the rest.
        const r = await generateDiagram({ prompt, style, size, provider })
        out.push(r)
        setResults([...out])
      }
    } catch (e) {
      setError(e?.message || 'Generation failed. Try a simpler prompt.')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function quickSave(result, idx) {
    if (!uid) { setError('Please sign in.'); return }
    setSavingIdx(idx)
    try {
      await saveVisualAsset({
        createdBy: uid,
        createdByName: userProfile?.displayName || '',
        title: buildVisualTitle({ topic, subtopic, grade, subject: subjectLabel }),
        grade,
        subject: subjectLabel,
        topic,
        subtopic,
        style: styleId,
        useCase,
        imageType: 'diagram',
        isLabelled: false,
        hasAnswerKey: false,
        isBlackAndWhite: Boolean(styleMeta?.blackAndWhite),
        imageUrl: result.url,
        thumbnailUrl: result.url,
        sourceType: 'ai',
        aiModel: result.provider || '',
        aiPrompt: result.prompt || promptText,
        safetyStatus: 'unreviewed',
        status: 'draft',
        visibility: 'private',
      })
      onToast?.('Saved to My Visuals')
    } catch (e) {
      setError(e?.message || 'Could not save.')
    } finally {
      setSavingIdx(-1)
    }
  }

  return (
    <div className="vs-split">
      {/* form */}
      <div className="vs-panel">
        <h3>Generate with AI</h3>
        <p className="vs-sub">Pick the curriculum details and a style — the prompt is written for you.</p>

        <div className="vs-grid-2">
          <div className="vs-field">
            <label>Grade</label>
            <select value={grade} onChange={(e) => { setGrade(e.target.value); setTopic(''); setSubtopic('') }}>
              {GRADES.map((g) => <option key={g} value={String(g)}>Grade {g}</option>)}
            </select>
          </div>
          <div className="vs-field">
            <label>Subject</label>
            <select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setTopic(''); setSubtopic('') }}>
              {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div className="vs-field">
          <label>Topic</label>
          <select value={topics.includes(topic) ? topic : ''} onChange={(e) => { setTopic(e.target.value); setSubtopic('') }}>
            <option value="">{syllabusLoading ? 'Loading topics…' : 'Choose a topic…'}</option>
            {topics.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="text"
            placeholder="…or type your own topic"
            value={topics.includes(topic) ? '' : topic}
            onChange={(e) => { setTopic(e.target.value); setSubtopic('') }}
            style={{ marginTop: 6 }}
          />
        </div>

        {subtopics.length > 0 && (
          <div className="vs-field">
            <label>Sub-topic (optional)</label>
            <select value={subtopic} onChange={(e) => setSubtopic(e.target.value)}>
              <option value="">No sub-topic</option>
              {subtopics.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        <div className="vs-field">
          <label>Style</label>
          <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
            {VISUAL_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {styleMeta?.hint && <p className="vs-sub" style={{ marginTop: 5 }}>{styleMeta.hint}</p>}
        </div>

        <div className="vs-grid-2">
          <div className="vs-field">
            <label>Use case</label>
            <select value={useCase} onChange={(e) => setUseCase(e.target.value)}>
              {USE_CASES.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </div>
          <div className="vs-field">
            <label>Orientation</label>
            <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
              {ORIENTATIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="vs-grid-2">
          <div className="vs-field">
            <label>Size</label>
            <select value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
              {IMAGE_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="vs-field">
            <label>How many</label>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: MAX_IMAGES_PER_BATCH }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n} image{n === 1 ? '' : 's'}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="vs-field">
          <label>Prompt (auto-written — edit if you like)</label>
          <textarea
            value={promptText}
            onChange={(e) => { setPromptText(e.target.value); setPromptDirty(true) }}
          />
          {promptDirty && (
            <button
              type="button"
              className="vs-chip"
              style={{ marginTop: 6 }}
              onClick={() => { setPromptDirty(false); setPromptText(autoPrompt) }}
            >
              Reset to auto prompt
            </button>
          )}
        </div>

        <button
          type="button"
          className="vs-iconbtn"
          style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg,#9e5627,#d08a38)', color: '#fff', border: 'none', padding: '11px' }}
          disabled={busy}
          onClick={handleGenerate}
        >
          {busy ? <span className="vs-spinner" /> : <IconSparkles size={16} />}
          {busy ? (progress || 'Generating…') : `Generate ${clampImageCount(count)} image${clampImageCount(count) === 1 ? '' : 's'}`}
        </button>

        {error && <p className="vs-hint vs-note-warn" style={{ marginTop: 10 }}>⚠ {error}</p>}
        <p className="vs-hint" style={{ marginTop: 10 }}>
          AI images use your monthly generation quota. Reuse the Picture Bank before generating
          new images to save cost.
        </p>
      </div>

      {/* results */}
      <div className="vs-panel">
        <h3>Results</h3>
        {results.length === 0 ? (
          <div className="vs-hint" style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
            <IconImage size={20} />
            <span>Generated images appear here. Open one in the editor to add labels and arrows, then make learner and answer-key versions.</span>
          </div>
        ) : (
          <>
            <div className="vs-results">
              {results.map((r, i) => (
                <div className="vs-result" key={r.url}>
                  <img src={r.url} alt={`Generated diagram ${i + 1}`} crossOrigin="anonymous" />
                  <div className="vs-result__bar">
                    <button type="button" className="vs-iconbtn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onEdit(buildVisual(r))}>
                      Edit &amp; label
                    </button>
                    <button type="button" className="vs-iconbtn" disabled={savingIdx === i} onClick={() => quickSave(r, i)}>
                      {savingIdx === i ? <span className="vs-spinner" /> : 'Save'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="vs-hint vs-note-warn" style={{ marginTop: 12 }}>
              ⚠ Always review AI images before use — check the diagram is accurate, age-appropriate,
              correctly drawn, and prints clearly in black and white.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
