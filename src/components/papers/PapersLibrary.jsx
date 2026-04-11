import { useState, useEffect } from 'react'
import { useFirestore } from '../../hooks/useFirestore'
import { useSubscription } from '../../hooks/useSubscription'
import UpgradeModal from '../subscription/UpgradeModal'
import ComingSoon from '../ui/ComingSoon'

const SUBJECTS = ['Mathematics', 'English', 'Science', 'Social Studies']
const GRADES   = ['5', '6', '7']

const subjectStyle = {
  Mathematics:      { bg: 'bg-blue-50',   border: 'border-blue-200',   icon: '🔢', badge: 'bg-blue-100 text-blue-700' },
  English:          { bg: 'bg-purple-50', border: 'border-purple-200', icon: '📖', badge: 'bg-purple-100 text-purple-700' },
  Science:          { bg: 'bg-orange-50', border: 'border-orange-200', icon: '🔬', badge: 'bg-orange-100 text-orange-700' },
  'Social Studies': { bg: 'bg-teal-50',   border: 'border-teal-200',   icon: '🌍', badge: 'bg-teal-100 text-teal-700' },
}

function Chip({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-bold transition-all min-h-0 whitespace-nowrap ${
        active ? 'bg-green-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:border-green-400 hover:text-green-700'
      }`}>
      {label}
    </button>
  )
}

function PaperSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 bg-gray-200 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-4 bg-gray-200 rounded-lg w-3/4" />
          <div className="flex gap-2">
            <div className="h-5 bg-gray-200 rounded-full w-20" />
            <div className="h-5 bg-gray-200 rounded-full w-14" />
          </div>
        </div>
        <div className="w-20 h-9 bg-gray-200 rounded-xl flex-shrink-0" />
      </div>
    </div>
  )
}

export default function PapersLibrary() {
  const { getPapers, incrementDownload } = useFirestore()
  const { isPremium, paperLimit }        = useSubscription()

  const [papers, setPapers]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [gradeF, setGradeF]     = useState('')
  const [subjectF, setSubjectF] = useState('')
  const [showUpgrade, setShowUpgrade] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await getPapers({ grade: gradeF, subject: subjectF })
      setPapers(data)
      setLoading(false)
    }
    load()
  }, [gradeF, subjectF])

  async function handleDownload(paper, idx) {
    if (!isPremium && idx >= paperLimit) { setShowUpgrade(true); return }
    const url = paper.fileURL || paper.fileUrl
    if (url) {
      await incrementDownload(paper.id)
      window.open(url, '_blank')
    }
  }

  const freeRemaining = Math.max(0, paperLimit - papers.filter((_, i) => i < paperLimit).length)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-black text-gray-800">📄 Past Papers</h1>
        <p className="text-gray-500 text-sm mt-0.5">Download and practice with real exam papers</p>
      </div>

      {/* Premium banner */}
      {!isPremium && (
        <div className="bg-gradient-to-r from-green-600 to-green-700 rounded-2xl p-4 mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="font-black text-white text-sm">Free: {paperLimit} papers included</p>
            <p className="text-green-200 text-xs mt-0.5">Upgrade for unlimited access to all papers</p>
          </div>
          <button onClick={() => setShowUpgrade(true)}
            className="bg-white text-green-700 font-black text-xs px-4 py-2 rounded-xl flex-shrink-0 min-h-0 hover:bg-green-50 transition-colors">
            ⭐ Upgrade
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2 mb-5">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <Chip label="All Grades" active={!gradeF} onClick={() => setGradeF('')} />
          {GRADES.map(g => (
            <Chip key={g} label={`Grade ${g}`} active={gradeF === g} onClick={() => setGradeF(g === gradeF ? '' : g)} />
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <Chip label="All Subjects" active={!subjectF} onClick={() => setSubjectF('')} />
          {SUBJECTS.map(s => (
            <Chip key={s} label={s} active={subjectF === s} onClick={() => setSubjectF(s === subjectF ? '' : s)} />
          ))}
        </div>
      </div>

      {/* Results count */}
      {!loading && papers.length > 0 && (
        <p className="text-xs text-gray-400 font-bold mb-3">{papers.length} paper{papers.length !== 1 ? 's' : ''} found</p>
      )}

      {/* Papers list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <PaperSkeleton key={i} />)}
        </div>
      ) : papers.length === 0 && !gradeF && !subjectF ? (
        // No papers at all
        <ComingSoon
          title="Past Papers Coming Soon"
          message="Exam papers are being prepared and will be uploaded soon. In the meantime, try a quiz!"
          icon="📄"
        />
      ) : papers.length === 0 ? (
        // Papers exist but none match the current filters
        <ComingSoon
          onClearFilters={() => { setGradeF(''); setSubjectF('') }}
        />
      ) : (
        <div className="space-y-3">
          {papers.map((p, idx) => {
            const locked  = !isPremium && idx >= paperLimit
            const style   = subjectStyle[p.subject] ?? { bg: 'bg-gray-50', border: 'border-gray-200', icon: '📄', badge: 'bg-gray-100 text-gray-700' }
            const url     = p.fileURL || p.fileUrl

            return (
              <div key={p.id}
                className={`bg-white rounded-2xl border transition-shadow hover:shadow-md ${locked ? 'opacity-60' : 'border-gray-100'}`}>
                <div className="p-4 flex items-start gap-3">
                  {/* Icon */}
                  <div className={`${style.bg} ${style.border} border w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0`}>
                    {style.icon}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-gray-800 text-sm leading-snug">{p.title}</p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${style.badge}`}>{p.subject}</span>
                      <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">Grade {p.grade}</span>
                      {p.term && <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">Term {p.term}</span>}
                      {p.year && <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{p.year}</span>}
                    </div>
                    <p className="text-gray-400 text-xs mt-1.5">
                      {p.downloadCount > 0 ? `${p.downloadCount} download${p.downloadCount !== 1 ? 's' : ''}` : 'No downloads yet'}
                      {p.fileSize ? ` · ${(p.fileSize / (1024 * 1024)).toFixed(1)} MB` : ''}
                    </p>
                  </div>

                  {/* Action */}
                  <div className="flex-shrink-0">
                    {locked ? (
                      <button onClick={() => setShowUpgrade(true)}
                        className="flex items-center gap-1.5 bg-yellow-50 border border-yellow-200 text-yellow-700 font-black text-xs px-3 py-2 rounded-xl min-h-0 hover:bg-yellow-100 transition-colors">
                        🔒 Unlock
                      </button>
                    ) : url ? (
                      <button onClick={() => handleDownload(p, idx)}
                        className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white font-black text-xs px-4 py-2 rounded-xl min-h-0 transition-colors">
                        ⬇ Download
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400 font-bold px-3 py-2">Unavailable</span>
                    )}
                  </div>
                </div>

                {/* Locked overlay hint */}
                {locked && (
                  <div className="border-t border-yellow-100 bg-yellow-50 rounded-b-2xl px-4 py-2 flex items-center justify-between">
                    <p className="text-yellow-700 text-xs font-bold">⭐ Premium required for this paper</p>
                    <button onClick={() => setShowUpgrade(true)}
                      className="text-green-600 text-xs font-black underline min-h-0 bg-transparent shadow-none p-0">
                      Upgrade →
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
