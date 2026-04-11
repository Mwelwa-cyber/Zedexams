import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import UpgradeModal from '../subscription/UpgradeModal'

function fmt(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}` }

const subjectColors = {
  Mathematics: 'bg-blue-100 text-blue-700',
  English:     'bg-purple-100 text-purple-700',
  Science:     'bg-orange-100 text-orange-700',
  'Social Studies': 'bg-teal-100 text-teal-700',
}

function PreQuiz({ quiz, canExam, onStart }) {
  const [mode, setMode] = useState('practice')
  const sc = subjectColors[quiz.subject] ?? 'bg-gray-100 text-gray-700'
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 to-green-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md animate-scale-in">
        <div className="text-center mb-5">
          <div className="text-5xl mb-2">📝</div>
          <h1 className="text-xl font-black text-gray-800">{quiz.title}</h1>
          <div className="flex justify-center gap-2 mt-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${sc}`}>{quiz.subject}</span>
            <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-bold">Grade {quiz.grade}</span>
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs font-bold">Term {quiz.term}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[['❓','Questions',quiz.questionCount??'—'],['⏱️','Minutes',quiz.duration],['⭐','Marks',quiz.totalMarks??'—']].map(([icon,label,val])=>(
            <div key={label} className="bg-gray-50 rounded-2xl p-3 text-center">
              <div className="text-xl">{icon}</div>
              <div className="font-black text-lg text-gray-800">{val}</div>
              <div className="text-xs text-gray-500">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-sm font-black text-gray-700 mb-2 text-center">Choose Your Mode</p>
        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { id:'practice', icon:'🌱', label:'Practice', sub:'See answers after each question', color:'green' },
            { id:'exam',     icon:'🏆', label:'Exam Mode', sub:'Timed, no hints', color:'blue', locked: !canExam },
          ].map(m => (
            <button key={m.id} onClick={()=>!m.locked&&setMode(m.id)}
              className={`p-4 rounded-2xl border-2 text-left transition-all min-h-0 relative ${mode===m.id?(m.color==='green'?'border-green-500 bg-green-50':'border-blue-500 bg-blue-50'):'border-gray-200 hover:border-gray-300'}`}>
              {m.locked && <div className="absolute top-2 right-2 text-gray-400 text-xs">🔒</div>}
              <div className="text-2xl mb-1">{m.icon}</div>
              <div className={`font-black text-sm ${m.locked?'text-gray-400':'text-gray-800'}`}>{m.label}</div>
              <div className={`text-xs mt-0.5 ${m.locked?'text-gray-300':'text-gray-500'}`}>{m.locked?'Premium only':m.sub}</div>
            </button>
          ))}
        </div>
        <button onClick={()=>onStart(mode)} className="w-full bg-green-600 hover:bg-green-700 text-white font-black text-lg py-4 rounded-2xl shadow-md">
          🚀 Start {mode==='practice'?'Practice':'Exam'}
        </button>
      </div>
    </div>
  )
}

export default function QuizRunner() {
  const { quizId } = useParams()
  const navigate   = useNavigate()
  const { currentUser } = useAuth()
  const { getQuizById, getQuestions, saveResult } = useFirestore()
  const { canUseExamMode } = useSubscription()

  const [quiz, setQuiz]       = useState(null)
  const [questions, setQs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const [started, setStarted]     = useState(false)
  const [mode, setMode]           = useState('practice')
  const [idx, setIdx]             = useState(0)
  const [answers, setAnswers]     = useState({})
  const [flagged, setFlagged]     = useState({})
  const [revealed, setRevealed]   = useState({})
  const [timeLeft, setTimeLeft]   = useState(0)
  const [startTime, setStartTime] = useState(null)
  const [showSubmit, setShowSubmit] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [feedbackType, setFeedbackType] = useState(null) // 'correct' | 'wrong'
  const timerRef   = useRef(null)
  const autoRef    = useRef(false)
  const submitRef  = useRef(null)   // always points to latest handleSubmit

  useEffect(()=>{
    async function load(){
      const [q,qs] = await Promise.all([getQuizById(quizId), getQuestions(quizId)])
      if(!q){ setError('Quiz not found'); setLoading(false); return }
      setQuiz(q); setQs(qs); setLoading(false)
    }
    load()
    return ()=>clearInterval(timerRef.current)
  },[quizId])

  function handleStart(m){
    if(m==='exam'&&!canUseExamMode){ setShowUpgrade(true); return }
    setMode(m); setStarted(true); setStartTime(Date.now())
    if(m==='exam') setTimeLeft((quiz.duration||30)*60)
  }

  useEffect(()=>{
    if(!started||mode!=='exam'||timeLeft<=0) return
    timerRef.current = setInterval(()=>{
      setTimeLeft(t=>{
        if(t<=1){ clearInterval(timerRef.current); if(!autoRef.current){autoRef.current=true; submitRef.current(true)} return 0 }
        return t-1
      })
    },1000)
    return ()=>clearInterval(timerRef.current)
  },[started,mode])

  function pick(qid, opt){
    setAnswers(a=>({...a,[qid]:opt}))
    if(mode==='practice'){
      setRevealed(r=>({...r,[qid]:true}))
      const currentQ = questions.find(qq => qq.id === qid)
      const isCorrect = currentQ && opt === currentQ.correctAnswer
      setFeedbackType(isCorrect ? 'correct' : 'wrong')
      setTimeout(() => setFeedbackType(null), 1300)
    }
  }

  // Keep submitRef in sync so the timer always calls the latest closure
  const handleSubmit = useCallback(async(auto=false)=>{
    if(!auto) setShowSubmit(false)
    setSubmitting(true)
    try{
      const timeSpent = startTime?Math.round((Date.now()-startTime)/1000):0
      let score=0,total=0
      const topicScores={}
      questions.forEach(q=>{
        const ok = answers[q.id]===q.correctAnswer
        total+=q.marks||1; if(ok)score+=q.marks||1
        const t=q.topic||'General'
        topicScores[t]??={correct:0,total:0}
        topicScores[t].total+=q.marks||1
        if(ok)topicScores[t].correct+=q.marks||1
      })
      const pct=total>0?Math.round((score/total)*100):0
      const rid = await saveResult({ userId:currentUser.uid, quizId, quizTitle:quiz.title, subject:quiz.subject, grade:quiz.grade, score, totalMarks:total, percentage:pct, mode, answers, topicScores, timeSpent })
      navigate(`/results/${rid}`)
    }catch(e){ console.error(e); setSubmitting(false); alert('Failed to save. Try again.') }
  },[answers,questions,quiz,quizId,currentUser,mode,startTime,navigate,saveResult])
  // Sync ref AFTER the callback is updated so the timer closure always has the latest version
  submitRef.current = handleSubmit

  if(loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="text-center"><div className="text-5xl mb-3 animate-bounce">📝</div><p className="text-green-600 font-bold text-lg">Loading quiz…</p></div></div>
  if(error)   return <div className="min-h-screen flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow p-8 text-center"><div className="text-4xl mb-3">😕</div><p className="text-red-600 font-bold">{error}</p><button onClick={()=>navigate('/quizzes')} className="mt-4 bg-green-600 text-white font-bold px-5 py-2 rounded-full">Back</button></div></div>
  if(!started) return <>{showUpgrade&&<UpgradeModal onClose={()=>setShowUpgrade(false)}/>}<PreQuiz quiz={quiz} canExam={canUseExamMode} onStart={handleStart}/></>
  if(submitting) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="text-center"><div className="text-5xl mb-3 animate-spin">⏳</div><p className="text-green-600 font-bold text-xl">Saving results…</p></div></div>

  const q = questions[idx]
  if(!q) return null
  const answered = Object.keys(answers).length
  const pct = questions.length?Math.round((answered/questions.length)*100):0
  const isRev = mode==='practice'&&revealed[q.id]
  const ua  = answers[q.id]
  const warn = mode==='exam'&&timeLeft<=60

  function optStyle(i){
    const base='w-full text-left p-4 rounded-2xl border-2 font-semibold text-base transition-all flex items-start gap-3 min-h-0'
    if(!isRev){ return ua===i?`${base} border-green-500 bg-green-50 text-green-800 shadow-md`:`${base} border-gray-200 bg-white hover:border-green-400 hover:bg-green-50` }
    if(i===q.correctAnswer) return `${base} border-green-500 bg-green-50 text-green-800 animate-pulse-green`
    if(ua===i&&ua!==q.correctAnswer) return `${base} border-red-400 bg-red-50 text-red-700 animate-shake`
    return `${base} border-gray-200 bg-gray-50 text-gray-400`
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Answer feedback overlay */}
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

      {showSubmit&&(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm animate-scale-in text-center">
            <div className="text-5xl mb-3">📤</div>
            <h2 className="text-xl font-black text-gray-800 mb-2">Submit Quiz?</h2>
            {questions.length-answered>0
              ?<p className="text-gray-600 text-sm mb-4">You have <span className="font-black text-orange-500">{questions.length-answered} unanswered</span> — they'll be marked incorrect.</p>
              :<p className="text-gray-600 text-sm mb-4">All {questions.length} questions answered. Ready!</p>}
            <div className="flex gap-3">
              <button onClick={()=>setShowSubmit(false)} className="flex-1 border-2 border-gray-200 text-gray-700 font-bold py-3 rounded-full min-h-0">← Keep Going</button>
              <button onClick={()=>handleSubmit(false)} className="flex-1 bg-green-600 text-white font-black py-3 rounded-full min-h-0">Submit ✓</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className={`${mode==='exam'?'bg-gradient-to-r from-blue-700 to-blue-900':'bg-gradient-to-r from-green-700 to-green-900'} text-white px-4 py-3 sticky top-0 z-30`}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs opacity-70">{quiz.subject} · Grade {quiz.grade}</p>
            <p className="font-black text-sm truncate max-w-[180px]">{quiz.title}</p>
          </div>
          {mode==='exam'&&<div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-black text-sm ${warn?'bg-red-500 animate-pulse':'bg-white/20'}`}>⏱️ {fmt(timeLeft)}</div>}
          {mode==='practice'&&<span className="bg-white/20 px-2 py-1 rounded-full text-xs font-bold">🌱 Practice</span>}
        </div>
        <div className="max-w-2xl mx-auto mt-2">
          <div className="w-full bg-white/20 rounded-full h-2">
            <div className="bg-yellow-400 h-2 rounded-full transition-all duration-500" style={{width:`${pct}%`}}/>
          </div>
          <div className="flex justify-between text-xs opacity-60 mt-0.5"><span>{answered} answered</span><span>{questions.length-answered} left</span></div>
        </div>
      </div>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 pb-36">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="bg-green-600 text-white font-black text-sm px-3 py-1 rounded-full">Q{idx+1}/{questions.length}</span>
            {q.topic&&<span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-1 rounded-full">{q.topic}</span>}
          </div>
          <button onClick={()=>setFlagged(f=>({...f,[q.id]:!f[q.id]}))}
            className={`p-2 rounded-full transition-colors min-h-0 ${flagged[q.id]?'bg-yellow-100 text-yellow-600':'bg-gray-100 text-gray-400'}`}>🚩</button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4">
          {/* Question image (optional) */}
          {q.imageUrl && (
            <div className="bg-gray-50 border-b border-gray-100 flex items-center justify-center p-2">
              <img
                src={q.imageUrl}
                alt="Question illustration"
                className="max-h-60 w-full object-contain rounded-lg"
                loading="lazy"
              />
            </div>
          )}
          <div className="p-4">
            <p className="text-lg font-bold text-gray-800 leading-relaxed">{q.text}</p>
            {q.marks>1&&<p className="text-xs text-gray-400 mt-1">[{q.marks} marks]</p>}
          </div>
        </div>

        <div className="space-y-3 mb-4">
          {q.options.map((opt,i)=>(
            <button key={i} onClick={()=>!isRev&&pick(q.id,i)} className={optStyle(i)} disabled={isRev}>
              <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-black border-2 ${isRev&&i===q.correctAnswer?'bg-green-500 text-white border-green-500':isRev&&ua===i&&ua!==q.correctAnswer?'bg-red-500 text-white border-red-500':ua===i&&!isRev?'bg-green-600 text-white border-green-600':'bg-gray-100 text-gray-600 border-gray-300'}`}>
                {['A','B','C','D'][i]}
              </span>
              <span className="flex-1">{opt}</span>
              {isRev&&i===q.correctAnswer&&<span>✅</span>}
              {isRev&&ua===i&&ua!==q.correctAnswer&&<span>❌</span>}
            </button>
          ))}
        </div>

        {isRev&&(
          <div className={`p-4 rounded-2xl mb-4 animate-slide-up ${ua===q.correctAnswer?'bg-green-100 border-2 border-green-300':ua===undefined?'bg-gray-100 border-2 border-gray-300':'bg-orange-50 border-2 border-orange-200'}`}>
            {ua===q.correctAnswer
              ? <><p className="font-black text-green-700 text-lg flex items-center gap-2">🌟 Excellent! Well done!</p><p className="text-green-600 text-sm mt-1">The answer is <strong>{q.options[q.correctAnswer]}</strong></p></>
              : ua===undefined
                ? <><p className="font-black text-gray-700 flex items-center gap-2">⏭️ Skipped</p><p className="text-gray-600 text-sm mt-1">Correct: <strong>{q.options[q.correctAnswer]}</strong></p></>
                : <><p className="font-black text-orange-700 text-lg flex items-center gap-2">💡 Not quite — you can do it!</p><p className="text-orange-600 text-sm mt-1">Correct answer: <strong>{q.options[q.correctAnswer]}</strong></p>{q.explanation&&<p className="text-gray-500 text-xs mt-1 italic">{q.explanation}</p>}</>
            }
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-30">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex gap-1 justify-center mb-3 overflow-x-auto pb-1">
            {questions.map((q2,i)=>(
              <button key={q2.id} onClick={()=>setIdx(i)} className={`w-8 h-8 flex-shrink-0 rounded-lg text-xs font-black transition-all min-h-0 ${i===idx?'ring-2 ring-offset-1 ring-green-500 bg-green-600 text-white':flagged[q2.id]?'bg-yellow-400 text-gray-800':answers[q2.id]!==undefined?'bg-green-200 text-green-800':'bg-gray-200 text-gray-600'}`}>
                {flagged[q2.id]?'🚩':i+1}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <button onClick={()=>setIdx(i=>Math.max(0,i-1))} disabled={idx===0}
              className="border-2 border-gray-200 text-gray-700 font-bold text-sm py-2 px-4 rounded-full disabled:opacity-40 min-h-0">← Prev</button>
            {idx<questions.length-1
              ?<button onClick={()=>setIdx(i=>i+1)} className="bg-green-600 text-white font-black text-sm py-2 px-5 rounded-full min-h-0">Next →</button>
              :<button onClick={()=>setShowSubmit(true)} className="bg-yellow-400 hover:bg-yellow-500 text-gray-800 font-black text-sm py-2 px-5 rounded-full min-h-0">Submit 🏁</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
