import Icon from './studioIcons'

/* ==================================================================
 * HOME VIEW
 * ================================================================== */
export function HomeView({ recentPapers, onNewPaper, onOpenPaper, onCreateWithAi, onTemplate, onLibrary, eyebrow = 'Teacher-only · Assessment Paper Studio' }) {
  const draftCount = recentPapers.filter(p => (p.importStatus || '') === 'needs_review' || !p.questionCount).length
  const totalQuestions = recentPapers.reduce((sum, p) => sum + (p.questionCount || 0), 0)

  return (
    <section className="sv-view">
      <div className="sv-canvas-area">
        <div className="sv-welcome">
          <div className="sv-welcome-eyebrow"><Icon name="builder" size={13} /> {eyebrow}</div>
          <h1 className="serif">
            Build school-ready <em>papers</em> the way teachers think.
          </h1>
          <p>Composable blocks. Real A4 output. AI that drafts sections and writes marking keys — but never publishes to learners.</p>
          <div className="sv-welcome-cta">
            <button className="sv-btn sv-btn-cream" onClick={onTemplate}><Icon name="sections" size={15} /> Start from a template</button>
            <button className="sv-btn sv-btn-ghost" onClick={onCreateWithAi}><Icon name="ai" size={15} /> Create with AI</button>
            <button className="sv-btn sv-btn-ghost" onClick={onNewPaper}><Icon name="scratch" size={15} /> Blank paper</button>
          </div>
        </div>

        <div className="sv-eyebrow">Quick actions</div>

        <div className="sv-ai-strip" onClick={onCreateWithAi}>
          <div className="sv-sparkle"><Icon name="ai" size={18} /></div>
          <div className="sv-ai-strip-text">
            <strong>Zed AI is ready to help</strong>
            <span>Generate questions on any CBC topic · auto-balanced sections · marking key included</span>
          </div>
          <button className="sv-btn sv-btn-gold sv-btn-sm">Open →</button>
        </div>

        <div className="sv-stat-strip">
          <Stat value={recentPapers.length} label="Papers" />
          <Stat value={draftCount} label="Need review" />
          <Stat value={totalQuestions} label="Questions saved" />
        </div>

        <div className="sv-eyebrow">
          Recently edited
          <a href="#" onClick={(e) => { e.preventDefault(); onLibrary() }}>View library →</a>
        </div>

        {recentPapers.length === 0 ? (
          <div className="sv-empty-panel">
            <span className="sv-empty-panel-ic"><Icon name="builder" size={24} /></span>
            <strong>No papers yet — let&apos;s make your first one</strong>
            <div className="sv-empty-panel-sub">
              Start from a ready-made template, generate one with AI, or build from a blank page.
            </div>
            <div className="sv-empty-panel-cta">
              <button className="sv-btn sv-btn-primary sv-btn-sm" onClick={onTemplate}><Icon name="sections" size={14} /> Templates</button>
              <button className="sv-btn sv-btn-outline sv-btn-sm" onClick={onCreateWithAi}><Icon name="ai" size={14} /> Create with AI</button>
            </div>
          </div>
        ) : (
          <div className="sv-paper-grid">
            {recentPapers.map(paper => (
              <PaperCard key={paper.id} paper={paper} onClick={() => onOpenPaper(paper.id)} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export function Stat({ value, label }) {
  return (
    <div className="sv-stat">
      <div className="sv-stat-v">{value}</div>
      <div className="sv-stat-l">{label}</div>
    </div>
  )
}

export function PaperCard({ paper, onClick }) {
  const status = paper.importStatus === 'needs_review' ? 'draft' : (paper.questionCount > 0 ? 'ready' : 'draft')
  const tag = paper.subject ? `${paper.subject} · Grade ${paper.grade}` : `Grade ${paper.grade}`
  const updatedAt = paper.updatedAt?.toDate ? paper.updatedAt.toDate() : (paper.createdAt?.toDate ? paper.createdAt.toDate() : null)
  const ago = updatedAt ? formatAgo(updatedAt) : ''
  return (
    <button className="sv-paper-card" onClick={onClick}>
      <div className="sv-thumb">
        <div className="sv-thumb-tag">{tag}</div>
        <div className="sv-mini-doc">
          <div className="sv-l tall" />
          <div className="sv-l" /><div className="sv-l short" />
          <div className="sv-l" /><div className="sv-l" />
          <div className="sv-l short" />
        </div>
      </div>
      <div className="sv-info">
        <h3 className="serif">{paper.title || 'Untitled paper'}</h3>
        <div className="sv-meta">
          {paper.questionCount || 0} questions · {paper.totalMarks || 0} marks · {paper.duration || 0} mins
        </div>
        <div className="sv-row">
          <span><span className={`sv-status-pill ${status}`}>{status === 'ready' ? 'Ready' : 'Draft'}</span></span>
          {ago && <span style={{ marginLeft: 'auto', color: 'var(--sv-muted-2)' }}>{ago}</span>}
        </div>
      </div>
    </button>
  )
}

export function formatAgo(date) {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}
