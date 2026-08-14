/* ZedExams Visual Studio — top-level page at /teacher/visual-studio.
 *
 * A single shell that switches between Home, AI generate, Templates, Picture
 * Bank, My Visuals, Blank canvas and the label Editor. Kept self-contained in
 * src/features/visualStudio/ so it can later be lifted into a standalone
 * web/desktop/mobile app with only the Firebase glue swapped out. */

import { useCallback, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import VisualStudioHome from '../components/VisualStudioHome'
import GeneratePanel from '../components/GeneratePanel'
import TemplatesPanel from '../components/TemplatesPanel'
import BlankPanel from '../components/BlankPanel'
import MyVisualsGrid from '../components/MyVisualsGrid'
import VisualCanvas from '../components/VisualCanvas'
import '../styles/visual-studio.css'

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'generate', label: 'Generate' },
  { id: 'templates', label: 'Templates' },
  { id: 'bank', label: 'Picture Bank' },
  { id: 'saved', label: 'My Visuals' },
  { id: 'blank', label: 'Blank canvas' },
]

export default function VisualStudioPage() {
  const { isTeacher, isAdmin } = useAuth()
  const [view, setView] = useState('home')
  const [prevView, setPrevView] = useState('home')
  const [visual, setVisual] = useState(null)
  const [seed, setSeed] = useState(null)
  const [seedKey, setSeedKey] = useState(0)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)

  const notify = useCallback((msg) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2800)
  }, [])

  const openEditor = useCallback((v) => {
    setVisual(v)
    setPrevView((cur) => (cur === 'editor' ? prevView : cur))
    setView('editor')
  }, [prevView])

  const useTemplate = useCallback((t) => {
    setSeed(t)
    setSeedKey((k) => k + 1)
    setView('generate')
  }, [])

  function goHome() {
    setVisual(null)
    setSeed(null)
    setView('home')
  }

  if (!isTeacher && !isAdmin) {
    return (
      <div className="vstudio">
        <div className="vstudio__main">
          <PageHeader eyebrow="Visual Studio" title="Picture & Diagram Studio" />
          <p className="vs-hint">Visual Studio is available to approved teachers. Ask an admin to enable a teacher account.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="vstudio">
      <SeoHelmet title="Visual Studio — ZedExams" noIndex />
      <div className="vstudio__main">
        <PageHeader
          eyebrow="ZedExams Visual Studio"
          title="Picture & Diagram Studio"
          description="Create classroom-ready diagrams, labelled illustrations and assessment pictures — generate with AI, label P/Q/R, make learner and answer-key versions, then send them to your studios."
          actions={view !== 'home' ? <Button variant="secondary" size="sm" onClick={goHome}>Home</Button> : null}
        />

        {view !== 'editor' && (
          <div className="vs-chips" style={{ margin: '4px 0 18px' }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`vs-chip ${view === t.id ? 'active' : ''}`}
                onClick={() => { if (t.id === 'generate') { setSeed(null) } setView(t.id) }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {view === 'home' && <VisualStudioHome onPick={(id) => { if (id === 'generate') setSeed(null); setView(id) }} />}
        {view === 'generate' && <GeneratePanel key={`gen-${seedKey}`} seed={seed} onEdit={openEditor} onToast={notify} />}
        {view === 'templates' && <TemplatesPanel onUseTemplate={useTemplate} onEdit={openEditor} />}
        {view === 'bank' && <MyVisualsGrid mode="shared" onEdit={openEditor} onToast={notify} />}
        {view === 'saved' && <MyVisualsGrid mode="mine" onEdit={openEditor} onToast={notify} />}
        {view === 'blank' && <BlankPanel onEdit={openEditor} onToast={notify} />}
        {view === 'editor' && visual && (
          <VisualCanvas visual={visual} onBack={() => setView(prevView || 'home')} onToast={notify} />
        )}
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)',
          background: '#15302a', color: '#fff', padding: '11px 18px', borderRadius: 12,
          fontSize: 13.5, fontWeight: 600, zIndex: 90, boxShadow: '0 12px 30px rgba(0,0,0,.25)',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
