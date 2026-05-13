import { useEffect, useState } from 'react'
import { collection, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, where, Timestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import PageHeader from '../ui/PageHeader'
import Card from '../ui/Card'
import Skeleton from '../ui/Skeleton'

const RECENT_DAYS = 14

function startOfDay(daysAgo) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d
}

export default function AdminAnalytics() {
  const [stats, setStats] = useState({
    totalLearners: 0, totalTeachers: 0, totalAdmins: 0,
    publishedQuizzes: 0, publishedLessons: 0,
    examsLast7: 0, resultsLast7: 0,
  })
  const [bySubject, setBySubject] = useState([])
  const [topQuizzes, setTopQuizzes] = useState([])
  const [weakTopics, setWeakTopics] = useState([])
  const [trend, setTrend] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const since7 = Timestamp.fromDate(startOfDay(7))
        const since14 = Timestamp.fromDate(startOfDay(RECENT_DAYS))
        const [
          learnersAgg, studentsAgg, teachersAgg, adminsAgg,
          publishedQuizAgg, publishedLessonAgg,
          examsAgg, resultsAgg, publicStatsSnap,
        ] = await Promise.all([
          getCountFromServer(query(collection(db, 'users'), where('role', '==', 'learner'))).catch(() => null),
          getCountFromServer(query(collection(db, 'users'), where('role', '==', 'student'))).catch(() => null),
          getCountFromServer(query(collection(db, 'users'), where('role', '==', 'teacher'))).catch(() => null),
          getCountFromServer(query(collection(db, 'users'), where('role', '==', 'admin'))).catch(() => null),
          getCountFromServer(query(collection(db, 'quizzes'), where('status', '==', 'published'))).catch(() => null),
          getCountFromServer(query(collection(db, 'lessons'), where('status', '==', 'published'))).catch(() => null),
          getCountFromServer(query(collection(db, 'exam_attempts'), where('submittedAt', '>=', since7))).catch(() => null),
          getCountFromServer(query(collection(db, 'results'), where('completedAt', '>=', since7))).catch(() => null),
          getDoc(doc(db, 'publicStats', 'global')).catch(() => null),
        ])
        if (cancelled) return
        setStats({
          totalLearners: (learnersAgg?.data()?.count ?? 0) + (studentsAgg?.data()?.count ?? 0),
          totalTeachers: teachersAgg?.data()?.count ?? 0,
          totalAdmins: adminsAgg?.data()?.count ?? 0,
          publishedQuizzes: publishedQuizAgg?.data()?.count ?? 0,
          publishedLessons: publishedLessonAgg?.data()?.count ?? 0,
          examsLast7: examsAgg?.data()?.count ?? 0,
          resultsLast7: resultsAgg?.data()?.count ?? 0,
          publicStats: publicStatsSnap?.exists() ? publicStatsSnap.data() : null,
        })

        // Performance per subject + top quizzes + weak topics — read the
        // most recent 200 results which is enough for trend signal.
        const recentResults = await getDocs(query(
          collection(db, 'results'),
          where('completedAt', '>=', since14),
          orderBy('completedAt', 'desc'),
          limit(200),
        )).catch(() => null)
        if (cancelled) return
        const rows = recentResults?.docs?.map(d => d.data()) || []

        const subjectMap = {}
        const quizMap = {}
        const topicMap = {}
        const dayMap = {}
        rows.forEach(r => {
          const subject = r.subject || 'unknown'
          if (!subjectMap[subject]) subjectMap[subject] = { count: 0, sum: 0 }
          subjectMap[subject].count++
          subjectMap[subject].sum += typeof r.percentage === 'number' ? r.percentage : 0

          const quizKey = r.quizId || r.quizTitle || 'unknown'
          if (!quizMap[quizKey]) quizMap[quizKey] = { title: r.quizTitle || quizKey, attempts: 0, sum: 0 }
          quizMap[quizKey].attempts++
          quizMap[quizKey].sum += typeof r.percentage === 'number' ? r.percentage : 0

          if (r.topicScores && typeof r.topicScores === 'object') {
            for (const [topic, data] of Object.entries(r.topicScores)) {
              if (!topicMap[topic]) topicMap[topic] = { correct: 0, total: 0 }
              topicMap[topic].correct += data?.correct ?? 0
              topicMap[topic].total += data?.total ?? 0
            }
          }

          const completed = typeof r.completedAt?.toDate === 'function' ? r.completedAt.toDate() : new Date(r.completedAt)
          if (completed && !Number.isNaN(completed.getTime?.())) {
            const key = completed.toISOString().slice(0, 10)
            dayMap[key] = (dayMap[key] || 0) + 1
          }
        })

        setBySubject(
          Object.entries(subjectMap)
            .map(([subject, { count, sum }]) => ({ subject, attempts: count, avg: count ? Math.round(sum / count) : 0 }))
            .sort((a, b) => b.attempts - a.attempts)
            .slice(0, 8),
        )

        setTopQuizzes(
          Object.entries(quizMap)
            .map(([id, v]) => ({ id, title: v.title, attempts: v.attempts, avg: v.attempts ? Math.round(v.sum / v.attempts) : 0 }))
            .sort((a, b) => b.attempts - a.attempts)
            .slice(0, 8),
        )

        setWeakTopics(
          Object.entries(topicMap)
            .filter(([, d]) => d.total >= 5)
            .map(([topic, d]) => ({ topic, accuracy: d.total ? Math.round((d.correct / d.total) * 100) : 0, total: d.total }))
            .sort((a, b) => a.accuracy - b.accuracy)
            .slice(0, 8),
        )

        // 14-day attempts trend.
        const trendArr = []
        for (let i = RECENT_DAYS - 1; i >= 0; i--) {
          const d = startOfDay(i)
          const key = d.toISOString().slice(0, 10)
          trendArr.push({ day: key.slice(5), count: dayMap[key] || 0 })
        }
        setTrend(trendArr)
        setError(null)
      } catch (e) {
        console.error('analytics load:', e)
        if (!cancelled) setError('Some analytics queries failed. Numbers below may be partial.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const maxTrend = Math.max(1, ...trend.map(t => t.count))

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports"
        title="Analytics overview"
        description="Platform health at a glance. Performance, top content, and engagement over the last two weeks."
      />

      {error && (
        <Card variant="flat" size="md" className="border-amber-200 bg-amber-50">
          <p className="text-sm font-bold text-amber-700">{error}</p>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Learners" value={stats.totalLearners} loading={loading} />
        <Tile label="Teachers" value={stats.totalTeachers} loading={loading} />
        <Tile label="Admins" value={stats.totalAdmins} loading={loading} />
        <Tile label="Published quizzes" value={stats.publishedQuizzes} loading={loading} />
        <Tile label="Published lessons" value={stats.publishedLessons} loading={loading} />
        <Tile label="Exam attempts · 7d" value={stats.examsLast7} loading={loading} />
        <Tile label="Quiz results · 7d" value={stats.resultsLast7} loading={loading} />
        <Tile label="Total quizzes taken" value={stats.publicStats?.quizzesTakenAllTime ?? '—'} loading={loading} />
      </div>

      <Card variant="elevated" size="md">
        <h3 className="font-black theme-text mb-3">Daily quiz attempts · last {RECENT_DAYS} days</h3>
        <div className="flex items-end gap-1.5 h-32">
          {trend.map(t => (
            <div key={t.day} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full theme-accent-fill rounded-t"
                style={{ height: `${(t.count / maxTrend) * 100}%`, minHeight: 2 }}
                title={`${t.day}: ${t.count}`}
              />
              <span className="text-[9px] theme-text-muted">{t.day}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card variant="elevated" size="md">
          <h3 className="font-black theme-text mb-3">Performance by subject (last {RECENT_DAYS} days)</h3>
          {bySubject.length === 0 ? <p className="text-sm theme-text-muted">No results recently.</p> : (
            <div className="space-y-2">
              {bySubject.map(s => (
                <div key={s.subject} className="flex items-center gap-3">
                  <span className="w-28 truncate text-sm font-bold theme-text">{s.subject}</span>
                  <div className="flex-1 h-2 rounded-full bg-black/5 overflow-hidden">
                    <div className="h-full theme-accent-fill" style={{ width: `${s.avg}%` }} />
                  </div>
                  <span className="w-20 text-right text-xs font-bold theme-text">{s.avg}% · {s.attempts}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card variant="elevated" size="md">
          <h3 className="font-black theme-text mb-3">Most-attempted quizzes</h3>
          {topQuizzes.length === 0 ? <p className="text-sm theme-text-muted">No recent attempts.</p> : (
            <ol className="space-y-1.5 text-sm">
              {topQuizzes.map((q, i) => (
                <li key={q.id} className="flex items-center justify-between gap-3">
                  <span className="theme-text truncate"><span className="theme-text-muted mr-2">{i + 1}.</span>{q.title}</span>
                  <span className="text-xs theme-text-muted">{q.attempts} attempts · {q.avg}% avg</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card variant="elevated" size="md">
        <h3 className="font-black theme-text mb-3">Weakest topics</h3>
        {weakTopics.length === 0 ? <p className="text-sm theme-text-muted">Not enough topic-scored data yet.</p> : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {weakTopics.map(t => (
              <li key={t.topic} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl theme-bg-subtle">
                <span className="truncate theme-text">{t.topic}</span>
                <span className="text-xs font-bold text-red-600">{t.accuracy}% across {t.total} qs</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Tile({ label, value, loading }) {
  return (
    <Card variant="elevated" size="sm" className="!p-4">
      <p className="text-[10px] font-black uppercase tracking-wider theme-text-muted">{label}</p>
      <p className="text-2xl font-black theme-text mt-1">{loading ? <Skeleton height={28} width={50} /> : value}</p>
    </Card>
  )
}
