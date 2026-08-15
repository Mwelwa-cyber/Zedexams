import { useEffect, useState } from 'react'
import { listMyGenerations } from '../../utils/teacherLibraryService'
import { getCurrentForecastWeek } from '../../utils/moeCalendar'
import { getSubjectsForGrade, getTopicsForSubject } from '../utils/curriculumDataService.js'
import { cleanSubjectName } from '../utils/subjectName.js'
import {
  mapForecastGrade,
  matchSubjectKey,
  matchTopicLabel,
  matchSubtopicLabel,
  pickForecastDay,
  forecastDayDate,
} from '../utils/teacherPlanContext.js'

/**
 * useTeacherPlanContext — reads the teacher's most recent saved Weekly Forecast
 * and resolves it into the Lesson Plan Studio's own field values, so the studio
 * can open pre-filled to "this week's lesson".
 *
 * The forecast is stored as an `aiGenerations` doc (`tool: 'weekly_forecast'`,
 * content under `output`) — the same data `resolveTeacherPlanContext` grounds on
 * server-side. We resolve every value against the SAME syllabi data the studio's
 * dropdowns use (getSubjectsForGrade / getTopicsForSubject) and only return a
 * value when it maps to a real option, so the caller can safely prefill without
 * the studio's own "clear stale value" effects wiping an invalid selection.
 *
 * Fail-closed: any error (no forecast, offline, Firestore unavailable in tests)
 * resolves to `{ loading: false, suggestion: null }` and the studio opens empty
 * exactly as before.
 *
 * @param {string|null} uid
 * @returns {{ loading: boolean, suggestion: null | {
 *   grade: string, subject: string, subjectLabel: string,
 *   topic: string, subtopic: string, date: string, weekNumber: number|null,
 * } }}
 */
export function useTeacherPlanContext(uid) {
  const [state, setState] = useState({ loading: false, suggestion: null })

  useEffect(() => {
    if (!uid) {
      setState({ loading: false, suggestion: null })
      return undefined
    }

    let cancelled = false
    setState({ loading: true, suggestion: null })

    ;(async () => {
      try {
        const rows = await listMyGenerations({ uid, tool: 'weekly_forecast' })
        // listMyGenerations returns newest-first; take the most recent complete
        // forecast that actually carries day rows.
        const forecast = (Array.isArray(rows) ? rows : []).find(
          (r) => r && r.status === 'complete' && r.output && Array.isArray(r.output.days) && r.output.days.length,
        )
        if (!forecast) {
          if (!cancelled) setState({ loading: false, suggestion: null })
          return
        }

        const header = forecast.output.header || {}
        const grade = mapForecastGrade(header.grade)
        if (!grade) {
          if (!cancelled) setState({ loading: false, suggestion: null })
          return
        }

        // Only proceed if this grade actually has syllabi subjects in the studio
        // (CBC ships no data for some grades) — otherwise the studio would clear
        // the grade anyway, so prefilling it would just flash.
        const subjectKeys = await getSubjectsForGrade(grade, 'cbc').catch(() => [])
        if (!Array.isArray(subjectKeys) || subjectKeys.length === 0) {
          if (!cancelled) setState({ loading: false, suggestion: null })
          return
        }
        const subject = matchSubjectKey(header.subject, subjectKeys, cleanSubjectName)

        const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
        const day = pickForecastDay(forecast.output.days, todayName)

        // Topic/subtopic only when they resolve to a real syllabi option.
        let topic = ''
        let subtopic = ''
        if (subject && day && day.topic) {
          const topics = await getTopicsForSubject(subject, grade, 'cbc').catch(() => [])
          const topicHit = matchTopicLabel(day.topic, topics)
          if (topicHit) {
            topic = topicHit.label
            subtopic = matchSubtopicLabel(day.subtopic, topicHit.subtopics)
          }
        }

        let week = null
        try { week = getCurrentForecastWeek() } catch { week = null }
        const weekBeginning = header.weekBeginning || (week && week.beginning) || ''
        const date = day
          ? forecastDayDate(weekBeginning, day.day)
          : String(weekBeginning || '').slice(0, 10)
        const weekNumber = header.weekNumber != null ? header.weekNumber : (week && week.weekNumber) || null

        if (cancelled) return
        setState({
          loading: false,
          suggestion: {
            grade,
            subject,
            subjectLabel: subject ? cleanSubjectName(subject) : (header.subject || ''),
            topic,
            subtopic,
            date,
            weekNumber,
          },
        })
      } catch {
        if (!cancelled) setState({ loading: false, suggestion: null })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [uid])

  return state
}
