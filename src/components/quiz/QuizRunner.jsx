import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import UpgradeModal from '../subscription/UpgradeModal'
import QuizTip from './QuizTip'
import { getPakoTip } from '../../config/curriculum'
import { checkAnswerWithAI } from '../../utils/geminiChecker'

function fmt(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

// ── Theme presets ─────────────────────────────────────────────────────────────
const THEMES = {
  sky: {
    name: 'Sky Blue', emoji: '☁️', swatch: '#0EA5E9',
    bg: '#F0F9FF',
    headerGrad: 'linear-gradient(135deg, #0369a1 0%, #1e40af 100%)',
    examGrad:   'linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)',
    progressGrad: 'linear-gradient(90deg, #22C55E, #A3E635)',
    accent: '#0EA5E9', accentDark: '#0369A1',
    accentLight: '#e0f2fe', accentText: '#0284c7',
    card: '#ffffff', cardBorder: '#BAE6FD',
    text: '#0C1A2E', textSub: '#4B6280',
    navBg: '#ffffff', navBorder: '#BAE6FD',
    btnPrimary: '#0EA5E9', btnPrimaryText: '#ffffff',
    btnSec: '#ffffff', btnSecBorder: '#BAE6FD', btnSecText: '#4B6280',
    dotActive: '#0EA5E9', dotActiveText: '#ffffff',
    dotAnswered: '#bfdbfe', dotAnsweredText: '#1e40af',
    dotDefault: '#e0f2fe', dotDefaultText: '#4B6280',
    qNumBg: '#0EA5E9', qNumText: '#ffffff',
    badgeDefault: '#e0f2fe', badgeDefaultText: '#4B6280',
  },
  lavender: {
    name: 'Lavender', emoji: '💜', swatch: '#8B5CF6',
    bg: '#F5F3FF',
    headerGrad: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
    examGrad:   'linear-gradient(135deg, #6d28d9 0%, #4c1d95 100%)',
    progressGrad: 'linear-gradient(90deg, #22C55E, #A3E635)',
    accent: '#8B5CF6', accentDark: '#7C3AED',
    accentLight: '#ede9fe', accentText: '#6D28D9',
    card: '#ffffff', cardBorder: '#DDD6FE',
    text: '#1E1B4B', textSub: '#6B7280',
    navBg: '#ffffff', navBorder: '#DDD6FE',
    btnPrimary: '#8B5CF6', btnPrimaryText: '#ffffff',
    btnSec: '#ffffff', btnSecBorder: '#DDD6FE', btnSecText: '#6B7280',
    dotActive: '#8B5CF6', dotActiveText: '#ffffff',
    dotAnswered: '#ddd6fe', dotAnsweredText: '#6d28d9',
    dotDefault: '#ede9fe', dotDefaultText: '#6B7280',
    qNumBg: '#8B5CF6', qNumText: '#ffffff',
    badgeDefault: '#ede9fe', badgeDefaultText: '#6B7280',
  },
  midnight: {
    name: 'Midnight Tech', emoji: '🌙', swatch: '#1E293B',
    bg: '#0F172A',
    headerGrad: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    examGrad:   'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)',
    progressGrad: 'linear-gradient(90deg, #38BDF8, #818CF8)',
    accent: '#38BDF8', accentDark: '#0284c7',
    accentLight: 'rgba(56,189,248,0.12)', accentText: '#7dd3fc',
    card: '#1E293B', cardBorder: '#334155',
    text: '#F1F5F9', textSub: '#94A3B8',
    navBg: '#1E293B', navBorder: '#334155',
    btnPrimary: '#38BDF8', btnPrimaryText: '#0F172A',
    btnSec: '#1E293B', btnSecBorder: '#334155', btnSecText: '#94A3B8',
    dotActive: '#38BDF8', dotActiveText: '#0F172A',
    dotAnswered: 'rgba(56,189,248,0.2)', dotAnsweredText: '#7dd3fc',
    dotDefault: '#1E293B', dotDefaultText: '#94A3B8',
    qNumBg: '#38BDF8', qNumText: '#0F172A',
    badgeDefault: 'rgba(56,189,248,0.12)', badgeDefaultText: '#7dd3fc',
  },
  oatmeal: {
    name: 'Warm Oatmeal', emoji: '🍞', swatch: '#D97706',
    bg: '#FDF6EC',
    headerGrad: 'linear-gradient(135deg, #92400e 0%, #78350f 100%)',
    examGrad:   'linear-gradient(135deg, #92400e 0%, #78350f 100%)',
    progressGrad: 'linear-gradient(90deg, #F59E0B, #FCD34D)',
    accent: '#D97706', accentDark: '#B45309',
    accentLight: '#fef3c7', accentText: '#92400E',
    card: '#FFFDF7', cardBorder: '#E7D5C0',
    text: '#1C1917', textSub: '#78716C',
    navBg: '#FFFDF7', navBorder: '#E7D5C0',
    btnPrimary: '#D97706', btnPrimaryText: '#ffffff',
    btnSec: '#FFFDF7', btnSecBorder: '#E7D5C0', btnSecText: '#78716C',
    dotActive: '#D97706', dotActiveText: '#ffffff',
    dotAnswered: '#fef3c7', dotAnsweredText: '#92400E',
    dotDefault: '#fef9f0', dotDefaultText: '#78716C',
    qNumBg: '#D97706', qNumText: '#ffffff',
    badgeDefault: '#fef3c7', badgeDefaultText: '#78716C',
  },
  solar: {
    name: 'Solar Yellow', emoji: '☀️', swatch: '#F59E0B',
    bg: '#FFFBEB',
    headerGrad: 'linear-gradient(135deg, #b45309 0%, #92400e 100%)',
    examGrad:   'linear-gradient(135deg, #92400e 0%, #78350f 100%)',
    progressGrad: 'linear-gradient(90deg, #FBBF24, #FDE68A)',
    accent: '#F59E0B', accentDark: '#D97706',
    accentLight: '#fef3c7', accentText: '#92400E',
    card: '#ffffff', cardBorder: '#FDE68A',
    text: '#1C1917', textSub: '#78716C',
    navBg: '#ffffff', navBorder: '#FDE68A',
    btnPrimary: '#F59E0B', btnPrimaryText: '#1C1917',
    btnSec: '#ffffff', btnSecBorder: '#FDE68A', btnSecText: '#78716C',
    dotActive: '#F59E0B', dotActiveText: '#1C1917',
    dotAnswered: '#fef3c7', dotAnsweredText: '#92400E',
    dotDefault: '#fffbeb', dotDefaultText: '#78716C',
    qNumBg: '#F59E0B', qNumText: '#1C1917',
    badgeDefault: '#fef3c7', badgeDefaultText: '#78716C',
  },
}
const THEME_KEYS = Object.keys(THEMES)

// ── Theme Switcher ────────────────────────────────────────────────────────────
function ThemeSwitcher({ themeKey, onSwitch }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Change theme"
        className="w-9 h-9 rounded-full flex items-center justify-center text-base transition-all min-h-0"
        style={{ background: 'rgba(255,255,255,0.2)' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.32)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)' }}
      >
        🎨
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-50 animate-scale-in"
          style={{
            background: '#ffffff',
            borderRadius: 18,
            boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
            border: '1px solid #E5E7EB',
            padding: '12px',
            minWidth: 170,
          }}
        >
          <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-2 px-1">Theme</p>
          {THEME_KEYS.map(key => {
            const t = THEMES[key]
            const isActive = themeKey === key
            return (
              <button
                key={key}
                onClick={() => { onSwitch(key); setOpen(false) }}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl transition-colors min-h-0 text-left"
                style={{
                  background: isActive ? '#f9fafb' : 'transparent',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f9fafb' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <span
                  className="w-5 h-5 rounded-full flex-shrink-0"
                  style={{
                    background: t.swatch,
                    boxShadow: isActive ? `0 0 0 3px ${t.swatch}40` : 'none',
                  }}
                />
                <span className={`text-xs font-bold flex-1 ${isActive ? 'text-gray-900' : 'text-gray-600'}`}>
                  {t.name}
                </span>
                {isActive && <span className="text-green-600 text-xs font-black">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Answer Option Card ────────────────────────────────────────────────────────
function OptionCard({ opt, optIdx, isSelected, isRevealed, isCorrect, isWrong, disabled, onClick, theme }) {
  const [hov, setHov] = useState(false)
  const letters = ['A', 'B', 'C', 'D']

  // Compute visual state
  let bg, border, color, shadow = 'none', badgeBg, badgeColor, badgeContent

  if (isRevealed && isCorrect) {
    bg = '#f0fdf4'; border = '#22C55E'; color = '#15803d'
    shadow = '0 0 0 4px rgba(34,197,94,0.18), 0 4px 16px rgba(34,197,94,0.12)'
    badgeBg = '#22C55E'; badgeColor = '#ffffff'; badgeContent = '✓'
  } else if (isRevealed && isWrong) {
    bg = '#fff1f2'; border = '#f87171'; color = '#b91c1c'
    badgeBg = '#f87171'; badgeColor = '#ffffff'; badgeContent = '✗'
  } else if (isRevealed) {
    // neutral — another option, not selected
    bg = theme.card; border = theme.cardBorder; color = theme.textSub
    badgeBg = theme.badgeDefault; badgeColor = theme.badgeDefaultText; badgeContent = letters[optIdx]
  } else if (isSelected) {
    bg = theme.accentLight; border = theme.accent; color = theme.accentText
    shadow = `0 0 0 3px ${theme.accent}30`
    badgeBg = theme.accent; badgeColor = theme.btnPrimaryText; badgeContent = letters[optIdx]
  } else if (hov && !disabled) {
    bg = theme.accentLight; border = theme.accent + 'aa'; color = theme.text
    badgeBg = theme.accentLight; badgeColor = theme.accentText; badgeContent = letters[optIdx]
  } else {
    bg = theme.card; border = theme.cardBorder; color = theme.text
    badgeBg = theme.badgeDefault; badgeColor = theme.badgeDefaultText; badgeContent = letters[optIdx]
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={`w-full text-left flex items-center gap-3 min-h-0 ${isWrong && isRevealed ? 'animate-shake' : ''}`}
      style={{
        fontFamily: "'Outfit', 'Nunito', sans-serif",
        background: bg,
        border: `2px solid ${border}`,
        borderRadius: 16,
        padding: '14px 16px',
        boxShadow: shadow,
        transition: 'all 0.18s ease',
        color,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {/* Letter badge */}
      <span
        className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-black transition-all"
        style={{
          background: badgeBg,
          color: badgeColor,
          transition: 'all 0.18s ease',
        }}
      >
        {badgeContent}
      </span>

      {/* Option text */}
      <span className="flex-1 font-semibold text-[15px] leading-snug">{opt}</span>

      {/* Correct indicator */}
      {isRevealed && isCorrect && (
        <span className="flex-shrink-0 text-lg animate-pop">✅</span>
      )}
    </button>
  )
}

// ── Pre-Quiz screen ───────────────────────────────────────────────────────────
function PreQuiz({ quiz, canExam, onStart, theme, themeKey, onSwitchTheme }) {
  const [mode, setMode] = useState('practice')

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ fontFamily: "'Outfit', 'Nunito', sans-serif", background: theme.bg }}
    >
      <div
        className="w-full max-w-md animate-scale-in overflow-hidden"
        style={{
          background: theme.card,
          borderRadius: 28,
          boxShadow: '0 24px 64px rgba(0,0,0,0.14)',
          border: `1px solid ${theme.cardBorder}`,
        }}
      >
        {/* Header stripe */}
        <div
          className="px-6 py-5 flex items-start justify-between gap-3"
          style={{ background: theme.headerGrad }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-white/70 text-xs font-bold">{quiz.subject}</span>
              <span className="text-white/50 text-xs">·</span>
              <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">Grade {quiz.grade}</span>
              <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">Term {quiz.term}</span>
            </div>
            <h1 className="text-xl font-black text-white leading-tight">{quiz.title}</h1>
          </div>
          <ThemeSwitcher themeKey={themeKey} onSwitch={onSwitchTheme} />
        </div>

        <div className="p-6">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              ['❓', quiz.questionCount ?? '—', 'Questions'],
              ['⏱️', quiz.duration,              'Minutes'],
              ['⭐', quiz.totalMarks ?? '—',     'Marks'],
            ].map(([icon, val, label]) => (
              <div
                key={label}
                className="text-center py-4 rounded-2xl"
                style={{ background: theme.accentLight }}
              >
                <div className="text-2xl mb-1">{icon}</div>
                <div className="font-black text-lg" style={{ color: theme.text }}>{val}</div>
                <div className="text-xs font-bold" style={{ color: theme.textSub }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Mode selector */}
          <p className="text-xs font-black uppercase tracking-wider text-center mb-3" style={{ color: theme.textSub }}>
            Choose Mode
          </p>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { id: 'practice', icon: '🌱', label: 'Practice',  sub: 'See answers live',   locked: false },
              { id: 'exam',     icon: '🏆', label: 'Exam Mode', sub: canExam ? 'Timed · no hints' : 'Premium only', locked: !canExam },
            ].map(m => {
              const sel = mode === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => !m.locked && setMode(m.id)}
                  className="p-4 text-left relative transition-all min-h-0"
                  style={{
                    background: sel ? theme.accentLight : theme.card,
                    border: `2px solid ${sel ? theme.accent : theme.cardBorder}`,
                    borderRadius: 16,
                    boxShadow: sel ? `0 0 0 3px ${theme.accent}28` : 'none',
                    opacity: m.locked ? 0.55 : 1,
                    cursor: m.locked ? 'not-allowed' : 'pointer',
                  }}
                >
                  {m.locked && (
                    <span className="absolute top-2 right-2 text-xs" style={{ color: theme.textSub }}>🔒</span>
                  )}
                  <div className="text-2xl mb-1">{m.icon}</div>
                  <div className="font-black text-sm" style={{ color: m.locked ? theme.textSub : theme.text }}>{m.label}</div>
                  <div className="text-xs mt-0.5" style={{ color: theme.textSub }}>{m.sub}</div>
                </button>
              )
            })}
          </div>

          <button
            onClick={() => onStart(mode)}
            className="w-full font-black text-lg py-4 rounded-2xl min-h-0 transition-all"
            style={{
              background: theme.btnPrimary,
              color: theme.btnPrimaryText,
              borderRadius: 16,
              boxShadow: `0 8px 24px ${theme.accent}40`,
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 12px 28px ${theme.accent}50` }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = `0 8px 24px ${theme.accent}40` }}
          >
            🚀 Start {mode === 'practice' ? 'Practice' : 'Exam'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main QuizRunner ───────────────────────────────────────────────────────────
export default function QuizRunner() {
  const { quizId }   = useParams()
  const navigate     = useNavigate()
  const { currentUser }    = useAuth()
  const { getQuizById, getQuestions, saveResult } = useFirestore()
  const { canUseExamMode, canAccessFullContent } = useSubscription()

  // ── Theme ─────────────────────────────────────────────────────────────────
  const [themeKey, setThemeKey] = useState(() => localStorage.getItem('quizTheme') || 'sky')
  const theme = THEMES[themeKey] || THEMES.sky
  function switchTheme(key) { setThemeKey(key); localStorage.setItem('quizTheme', key) }

  // ── Quiz data ─────────────────────────────────────────────────────────────
  const [quiz, setQuiz]       = useState(null)
  const [questions, setQs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // ── Session state ─────────────────────────────────────────────────────────
  const [started, setStarted]         = useState(false)
  const [mode, setMode]               = useState('practice')
  const [idx, setIdx]                 = useState(0)
  const [answers, setAnswers]         = useState({})
  const [flagged, setFlagged]         = useState({})
  const [revealed, setRevealed]       = useState({})
  const [timeLeft, setTimeLeft]       = useState(0)
  const [startTime, setStartTime]     = useState(null)
  const [showSubmit, setShowSubmit]   = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [actionError, setActionError] = useState('')
  const [feedbackType, setFeedbackType] = useState(null) // 'correct' | 'wrong'
  const [pakoTip, setPakoTip]           = useState({ visible: false, text: '', isCorrect: null })
  // ── Short-answer / AI state ───────────────────────────────────────────────
  const [shortText, setShortText]   = useState({})  // {qid: typed text}
  const [aiChecking, setAiChecking] = useState({})  // {qid: boolean}
  const [aiResults, setAiResults]   = useState({})  // {qid: {correct, feedback}}
  const timerRef  = useRef(null)
  const autoRef   = useRef(false)
  const submitRef = useRef(null)

  // ── Load quiz + access gate ───────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const [q, qs] = await Promise.all([getQuizById(quizId), getQuestions(quizId)])
      if (!q) { setError('Quiz not found'); setLoading(false); return }
      // Access gate: non-demo quizzes require full access
      if (!q.isDemo && !canAccessFullContent) {
        navigate('/quizzes', { replace: true, state: { blocked: true } })
        return
      }
      setQuiz(q); setQs(qs); setLoading(false)
    }
    load()
    return () => clearInterval(timerRef.current)
  }, [quizId, canAccessFullContent])

  // ── Start ─────────────────────────────────────────────────────────────────
  function handleStart(m) {
    if (m === 'exam' && !canUseExamMode) { setShowUpgrade(true); return }
    setMode(m); setStarted(true); setStartTime(Date.now())
    if (m === 'exam') setTimeLeft((quiz.duration || 30) * 60)
  }

  // ── Exam timer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!started || mode !== 'exam' || timeLeft <= 0) return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current)
          if (!autoRef.current) { autoRef.current = true; submitRef.current(true) }
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [started, mode])

  // ── Pick answer ───────────────────────────────────────────────────────────
  function pick(qid, opt) {
    setAnswers(a => ({ ...a, [qid]: opt }))
    if (mode === 'practice') {
      setRevealed(r => ({ ...r, [qid]: true }))
      const currentQ  = questions.find(qq => qq.id === qid)
      const isCorrect = currentQ && opt === currentQ.correctAnswer
      setFeedbackType(isCorrect ? 'correct' : 'wrong')
      setTimeout(() => setFeedbackType(null), 1300)
      const tipText = currentQ?.explanation?.trim() || getPakoTip(currentQ?.topic, isCorrect)
      setPakoTip({ visible: true, text: tipText, isCorrect })
    }
  }

  // ── AI check for short-answer questions ──────────────────────────────────
  async function checkShortAnswer(qid) {
    const curQ = questions.find(qq => qq.id === qid)
    const text = shortText[qid]?.trim()
    if (!text || !curQ) return
    const questionText = [
      String(curQ.text ?? '').trim(),
      String(curQ.diagramText ?? '').trim(),
    ].filter(Boolean).join('\n')
    const expectedAnswer = String(curQ.correctAnswer ?? '').trim()
    if (!questionText) {
      setActionError('This question needs question text before AI can check it.')
      return
    }

    setAiChecking(c => ({ ...c, [qid]: true }))
    setActionError('')
    try {
      const result = await checkAnswerWithAI({
        question:      questionText,
        correctAnswer: expectedAnswer,
        studentAnswer: text,
        subject:       quiz?.subject ?? '',
        grade:         quiz?.grade   ?? '',
      })
      setAiResults(r => ({ ...r, [qid]: result }))
      // Store in answers so submit scoring can pick it up
      setAnswers(a => ({ ...a, [qid]: { text, correct: result.correct } }))
      if (mode === 'practice') {
        setRevealed(r => ({ ...r, [qid]: true }))
        setFeedbackType(result.correct ? 'correct' : 'wrong')
        setTimeout(() => setFeedbackType(null), 1300)
        setPakoTip({ visible: true, text: result.feedback, isCorrect: result.correct })
      }
    } catch (err) {
      console.error('AI check failed:', err)
      setActionError(err?.message || 'AI marking is temporarily unavailable. Please try again.')
    } finally {
      setAiChecking(c => ({ ...c, [qid]: false }))
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (auto = false) => {
    if (!auto) setShowSubmit(false)
    setSubmitting(true)
    try {
      const timeSpent = startTime ? Math.round((Date.now() - startTime) / 1000) : 0
      let score = 0, total = 0
      const topicScores = {}
      questions.forEach(q => {
        // short_answer stores {text, correct}; MCQ/TF store the option index
        const ok = q.type === 'short_answer'
          ? answers[q.id]?.correct === true
          : answers[q.id] === q.correctAnswer
        total += q.marks || 1; if (ok) score += q.marks || 1
        const t = q.topic || 'General'
        topicScores[t] ??= { correct: 0, total: 0 }
        topicScores[t].total += q.marks || 1
        if (ok) topicScores[t].correct += q.marks || 1
      })
      const pct = total > 0 ? Math.round((score / total) * 100) : 0
      const rid = await saveResult({
        userId: currentUser.uid, quizId, quizTitle: quiz.title,
        subject: quiz.subject, grade: quiz.grade, score,
        totalMarks: total, percentage: pct, mode, answers, topicScores, timeSpent,
      })
      navigate(`/results/${rid}`)
    } catch (e) {
      console.error(e)
      setSubmitting(false)
      setActionError('Failed to save your results. Please check your connection and try again.')
    }
  }, [answers, questions, quiz, quizId, currentUser, mode, startTime, navigate, saveResult])
  submitRef.current = handleSubmit

  // ── Full-page states ──────────────────────────────────────────────────────
  const pageStyle = { fontFamily: "'Outfit', 'Nunito', sans-serif", background: theme.bg }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={pageStyle}>
      <div className="text-center">
        <div className="text-5xl mb-3 animate-bounce">📝</div>
        <p className="font-bold text-lg" style={{ color: theme.accentDark }}>Loading quiz…</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={pageStyle}>
      <div
        className="text-center p-8"
        style={{ background: theme.card, borderRadius: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.1)', border: `1px solid ${theme.cardBorder}` }}
      >
        <div className="text-4xl mb-3">😕</div>
        <p className="font-bold text-red-600">{error}</p>
        <button
          onClick={() => navigate('/quizzes')}
          className="mt-4 text-white font-bold px-5 py-2 rounded-full"
          style={{ background: theme.btnPrimary, color: theme.btnPrimaryText }}
        >← Back</button>
      </div>
    </div>
  )

  if (!started) return (
    <>
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      <PreQuiz
        quiz={quiz} canExam={canUseExamMode} onStart={handleStart}
        theme={theme} themeKey={themeKey} onSwitchTheme={switchTheme}
      />
    </>
  )

  if (submitting) return (
    <div className="min-h-screen flex items-center justify-center" style={pageStyle}>
      <div className="text-center">
        <div className="text-5xl mb-3 animate-spin">⏳</div>
        <p className="font-black text-xl" style={{ color: theme.accentDark }}>Saving results…</p>
      </div>
    </div>
  )

  // ── Active quiz UI ────────────────────────────────────────────────────────
  const q       = questions[idx]
  if (!q) return null

  const answered = Object.keys(answers).length
  const pct      = questions.length ? Math.round((answered / questions.length) * 100) : 0
  const isRev    = mode === 'practice' && revealed[q.id]
  const ua       = answers[q.id]
  const warn     = mode === 'exam' && timeLeft <= 60

  return (
    <div className="min-h-screen flex flex-col" style={pageStyle}>

      {actionError && (
        <div
          role="alert"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md animate-slide-up"
        >
          <div
            className="rounded-2xl px-4 py-3 shadow-xl flex items-start gap-3"
            style={{ background: '#fff7ed', border: '2px solid #fdba74', color: '#9a3412' }}
          >
            <span className="text-lg leading-none mt-0.5">⚠️</span>
            <p className="flex-1 text-sm font-bold leading-snug">{actionError}</p>
            <button
              onClick={() => setActionError('')}
              className="text-orange-700/70 hover:text-orange-900 min-h-0 p-0 bg-transparent shadow-none text-lg leading-none"
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Correct/Wrong feedback overlay ────────────────────────────────── */}
      {feedbackType && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
          {feedbackType === 'correct' ? (
            <div className="flex flex-col items-center animate-pop">
              <div className="text-8xl animate-star-burst filter drop-shadow-lg">⭐</div>
              <div className="mt-2 bg-green-500 text-white font-black text-xl px-7 py-2.5 rounded-2xl shadow-xl">
                Correct! 🎉
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center animate-pop">
              <div className="text-7xl">💪</div>
              <div className="mt-2 bg-orange-400 text-white font-black text-lg px-6 py-2.5 rounded-2xl shadow-xl">
                Keep going!
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Submit confirmation modal ──────────────────────────────────────── */}
      {showSubmit && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div
            className="w-full max-w-sm animate-scale-in text-center p-6"
            style={{
              background: theme.card,
              borderRadius: 24,
              boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
              border: `1px solid ${theme.cardBorder}`,
            }}
          >
            <div className="text-5xl mb-3">📤</div>
            <h2 className="text-xl font-black mb-2" style={{ color: theme.text }}>Submit Quiz?</h2>
            {questions.length - answered > 0
              ? <p className="text-sm mb-5" style={{ color: theme.textSub }}>
                  You have{' '}
                  <span className="font-black text-orange-500">{questions.length - answered} unanswered</span>
                  {' '}— they'll be marked incorrect.
                </p>
              : <p className="text-sm mb-5" style={{ color: theme.textSub }}>
                  All {questions.length} questions answered. Ready!
                </p>
            }
            <div className="flex gap-3">
              <button
                onClick={() => setShowSubmit(false)}
                className="flex-1 font-bold py-3 rounded-2xl min-h-0 transition-all"
                style={{
                  background: theme.btnSec,
                  border: `2px solid ${theme.btnSecBorder}`,
                  color: theme.btnSecText,
                }}
              >← Keep Going</button>
              <button
                onClick={() => handleSubmit(false)}
                className="flex-1 font-black py-3 rounded-2xl min-h-0 shadow-lg transition-all"
                style={{ background: theme.btnPrimary, color: theme.btnPrimaryText }}
              >Submit ✓</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <div
        className="text-white sticky top-0 z-30"
        style={{ background: mode === 'exam' ? theme.examGrad : theme.headerGrad }}
      >
        <div className="max-w-2xl md:max-w-3xl mx-auto px-4 py-3">
          {/* Title row */}
          <div className="flex items-center justify-between mb-3">
            <div className="min-w-0 flex-1 mr-3">
              <p className="text-white/60 text-xs font-bold truncate">{quiz.subject} · Grade {quiz.grade}</p>
              <p className="font-black text-sm truncate leading-tight">{quiz.title}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {mode === 'exam' && (
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-black text-sm tabular-nums ${warn ? 'animate-pulse' : ''}`}
                  style={{ background: warn ? '#ef4444' : 'rgba(255,255,255,0.2)' }}
                >
                  ⏱️ {fmt(timeLeft)}
                </div>
              )}
              {mode === 'practice' && (
                <span className="bg-white/20 px-2.5 py-1 rounded-full text-xs font-bold">🌱 Practice</span>
              )}
              <ThemeSwitcher themeKey={themeKey} onSwitch={switchTheme} />
            </div>
          </div>

          {/* Progress bar — thick gradient */}
          <div className="w-full rounded-full overflow-hidden" style={{ height: 8, background: 'rgba(255,255,255,0.2)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #22C55E, #A3E635)' }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-white/55 font-bold mt-1">
            <span>{answered} answered</span>
            <span>{questions.length - answered} left</span>
          </div>
        </div>
      </div>

      {/* ── Scrollable question area ──────────────────────────────────────── */}
      <div className="flex-1 max-w-2xl md:max-w-3xl mx-auto w-full px-4 py-4 pb-44">

        {/* Q number + topic + flag */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-black text-sm px-3 py-1 rounded-full"
              style={{ background: theme.qNumBg, color: theme.qNumText }}
            >
              Q{idx + 1} <span className="font-normal opacity-60">/ {questions.length}</span>
            </span>
            {q.topic && (
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ background: theme.accentLight, color: theme.accentText }}
              >{q.topic}</span>
            )}
          </div>
          <button
            onClick={() => setFlagged(f => ({ ...f, [q.id]: !f[q.id] }))}
            className="p-2 rounded-full transition-all min-h-0"
            style={{
              background: flagged[q.id] ? '#fef9c3' : theme.accentLight,
              color: flagged[q.id] ? '#ca8a04' : theme.textSub,
            }}
            title={flagged[q.id] ? 'Unflag' : 'Flag for review'}
          >🚩</button>
        </div>

        {/* Question card */}
        <div
          className="overflow-hidden mb-4"
          style={{
            background: theme.card,
            borderRadius: 20,
            boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
            border: `1px solid ${theme.cardBorder}`,
          }}
        >
          {q.imageUrl && (
            <div
              className="flex items-center justify-center p-3 border-b"
              style={{ background: theme.accentLight, borderColor: theme.cardBorder }}
            >
              <img
                src={q.imageUrl}
                alt="Question illustration"
                className="max-h-60 w-full object-contain rounded-xl"
                loading="lazy"
              />
            </div>
          )}
          <div className="p-5">
            <p className="text-[17px] font-bold leading-relaxed" style={{ color: theme.text }}>{q.text}</p>
            {q.marks > 1 && (
              <p className="text-xs mt-2 font-bold" style={{ color: theme.textSub }}>[{q.marks} marks]</p>
            )}
          </div>
        </div>

        {/* ── SHORT ANSWER (AI-checked) ──────────────────────────────────── */}
        {q.type === 'short_answer' ? (() => {
          const aiRes     = aiResults[q.id]
          const checking  = aiChecking[q.id]
          const typed     = shortText[q.id] ?? ''
          const checked   = !!aiRes
          const saCorrect = aiRes?.correct

          return (
            <div className="mb-4 space-y-3">
              {/* Text input */}
              <div
                className="overflow-hidden transition-all"
                style={{
                  background: theme.card,
                  border: `2px solid ${checked
                    ? saCorrect ? '#22C55E' : '#f87171'
                    : theme.accent}`,
                  borderRadius: 16,
                }}
              >
                <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: theme.cardBorder }}>
                  <span className="text-sm" style={{ color: theme.textSub }}>🤖 AI-checked answer</span>
                </div>
                <div className="flex items-center gap-2 p-3">
                  <input
                    type="text"
                    value={typed}
                    onChange={e => {
                      setShortText(s => ({ ...s, [q.id]: e.target.value }))
                      if (actionError) setActionError('')
                      // Reset result if they edit after checking
                      if (checked) {
                        setAiResults(r => { const n = { ...r }; delete n[q.id]; return n })
                        setAnswers(a  => { const n = { ...a }; delete n[q.id]; return n })
                        setRevealed(r => { const n = { ...r }; delete n[q.id]; return n })
                      }
                    }}
                    onKeyDown={e => { if (e.key === 'Enter' && typed.trim() && !checking && !checked) checkShortAnswer(q.id) }}
                    disabled={checking}
                    placeholder="Type your answer here…"
                    className="flex-1 bg-transparent outline-none text-base font-semibold"
                    style={{ color: theme.text }}
                  />
                  {checking && (
                    <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0"
                      style={{ borderColor: theme.accent }} />
                  )}
                  {checked && (
                    <span className="text-xl flex-shrink-0">{saCorrect ? '✅' : '❌'}</span>
                  )}
                </div>
              </div>

              {/* Check Answer button */}
              {!checked && (
                <button
                  onClick={() => checkShortAnswer(q.id)}
                  disabled={!typed.trim() || checking}
                  className="w-full font-black py-3.5 rounded-2xl transition-all min-h-0"
                  style={{
                    background: typed.trim() && !checking ? theme.btnPrimary : theme.accentLight,
                    color: typed.trim() && !checking ? theme.btnPrimaryText : theme.textSub,
                    opacity: !typed.trim() ? 0.5 : 1,
                  }}
                >
                  {checking ? '🤖 AI is checking…' : '🤖 Check My Answer'}
                </button>
              )}

              {/* AI result feedback */}
              {checked && (
                <div
                  className="p-4 rounded-2xl animate-slide-up"
                  style={{
                    background: saCorrect ? '#f0fdf4' : '#fff7ed',
                    border: `2px solid ${saCorrect ? '#86efac' : '#fdba74'}`,
                  }}
                >
                  {saCorrect ? (
                    <>
                      <p className="font-black text-green-700 text-lg flex items-center gap-2">🌟 Correct! Well done!</p>
                      <p className="text-green-600 text-sm mt-1">{aiRes.feedback}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-black text-orange-700 text-lg flex items-center gap-2">💡 Not quite!</p>
                      <p className="text-orange-600 text-sm mt-1">{aiRes.feedback}</p>
                      {mode === 'practice' && q.correctAnswer && (
                        <p className="text-gray-500 text-xs mt-1.5">
                          Expected: <strong>{q.correctAnswer}</strong>
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Professor Pako tip (practice mode) */}
              {checked && mode === 'practice' && (
                <QuizTip
                  isCorrect={saCorrect}
                  tipText={pakoTip.text}
                  visible={pakoTip.visible}
                  onDismiss={() => setPakoTip(p => ({ ...p, visible: false }))}
                />
              )}
            </div>
          )
        })() : (
          <>
            {/* ── MCQ / True-False options ──────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {q.options.map((opt, i) => (
                <OptionCard
                  key={i}
                  opt={opt}
                  optIdx={i}
                  isSelected={!isRev && ua === i}
                  isRevealed={isRev}
                  isCorrect={isRev && i === q.correctAnswer}
                  isWrong={isRev && ua === i && ua !== q.correctAnswer}
                  disabled={isRev}
                  onClick={() => !isRev && pick(q.id, i)}
                  theme={theme}
                />
              ))}
            </div>

            {/* Professor Pako tip */}
            {isRev && (
              <QuizTip
                isCorrect={ua === q.correctAnswer ? true : ua === undefined ? null : false}
                tipText={pakoTip.text}
                visible={pakoTip.visible}
                onDismiss={() => setPakoTip(p => ({ ...p, visible: false }))}
              />
            )}

            {/* Result feedback banner */}
            {isRev && (
              <div
                className="p-4 rounded-2xl mb-4 animate-slide-up"
                style={{
                  background: ua === q.correctAnswer ? '#f0fdf4'
                    : ua === undefined ? theme.accentLight
                    : '#fff7ed',
                  border: `2px solid ${ua === q.correctAnswer ? '#86efac'
                    : ua === undefined ? theme.cardBorder
                    : '#fdba74'}`,
                }}
              >
                {ua === q.correctAnswer ? (
                  <>
                    <p className="font-black text-green-700 text-lg flex items-center gap-2">🌟 Excellent! Well done!</p>
                    <p className="text-green-600 text-sm mt-1">The answer is <strong>{q.options[q.correctAnswer]}</strong></p>
                  </>
                ) : ua === undefined ? (
                  <>
                    <p className="font-black flex items-center gap-2" style={{ color: theme.text }}>⏭️ Skipped</p>
                    <p className="text-sm mt-1" style={{ color: theme.textSub }}>
                      Correct: <strong>{q.options[q.correctAnswer]}</strong>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-black text-orange-700 text-lg flex items-center gap-2">💡 Not quite — you can do it!</p>
                    <p className="text-orange-600 text-sm mt-1">
                      Correct answer: <strong>{q.options[q.correctAnswer]}</strong>
                    </p>
                    {q.explanation && (
                      <p className="text-gray-500 text-xs mt-1.5 italic">{q.explanation}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Fixed bottom navigation ────────────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 safe-area-bottom"
        style={{
          background: theme.navBg,
          borderTop: `1px solid ${theme.navBorder}`,
          boxShadow: '0 -4px 20px rgba(0,0,0,0.07)',
        }}
      >
        <div className="max-w-2xl md:max-w-3xl mx-auto px-4 py-3">
          {/* Question X of Y + compact progress dots (max 12 shown) */}
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-black" style={{ color: theme.textSub }}>
              Question <span style={{ color: theme.accent }}>{idx + 1}</span> of {questions.length}
            </span>
            <span className="text-xs font-bold" style={{ color: theme.textSub }}>
              {answered}/{questions.length} answered
            </span>
          </div>
          {/* Compact segment progress bar */}
          {questions.length <= 20 ? (
            <div className="flex gap-1 mb-3">
              {questions.map((q2, i) => {
                const isCurr = i === idx
                const isAns  = answers[q2.id] !== undefined
                const isFl   = flagged[q2.id]
                return (
                  <button
                    key={q2.id}
                    onClick={() => setIdx(i)}
                    title={`Q${i + 1}${isAns ? ' ✓' : ''}${isFl ? ' 🚩' : ''}`}
                    className="flex-1 min-h-0 rounded transition-all"
                    style={{
                      height: 6,
                      background: isCurr ? theme.dotActive
                        : isFl ? '#fbbf24'
                        : isAns ? theme.dotAnswered
                        : theme.dotDefault,
                      outline: isCurr ? `2px solid ${theme.dotActive}` : 'none',
                      outlineOffset: 1,
                    }}
                  />
                )
              })}
            </div>
          ) : (
            /* For long quizzes (>20 Qs): show a smooth progress bar instead */
            <div className="mb-3 rounded-full overflow-hidden" style={{ height: 6, background: theme.dotDefault }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${questions.length ? Math.round(((idx + 1) / questions.length) * 100) : 0}%`,
                  background: theme.dotActive,
                }}
              />
            </div>
          )}

          {/* Prev / Next / Submit */}
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={idx === 0}
              className="font-bold text-sm py-2.5 px-5 rounded-2xl min-h-0 transition-all disabled:opacity-35"
              style={{
                background: theme.btnSec,
                border: `2px solid ${theme.btnSecBorder}`,
                color: theme.btnSecText,
              }}
            >← Prev</button>

            {idx < questions.length - 1 ? (
              <button
                onClick={() => setIdx(i => i + 1)}
                className="font-black text-sm py-2.5 px-7 rounded-2xl min-h-0 transition-all"
                style={{
                  background: theme.btnPrimary,
                  color: theme.btnPrimaryText,
                  boxShadow: `0 4px 14px ${theme.accent}45`,
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
              >Next →</button>
            ) : (
              <button
                onClick={() => setShowSubmit(true)}
                className="font-black text-sm py-2.5 px-7 rounded-2xl min-h-0 transition-all"
                style={{
                  background: '#f59e0b',
                  color: '#1c1917',
                  boxShadow: '0 4px 14px rgba(245,158,11,0.4)',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
              >Submit 🏁</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
