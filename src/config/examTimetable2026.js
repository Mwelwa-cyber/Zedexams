/**
 * examTimetable2026 — the 2026 Grade-7 PSLE exam timetable, transcribed from
 * the official ECZ document (public/timetables/grade-7-2026-exam-timetable.pdf).
 *
 * This object is the single source of truth in three places:
 *   1. Client fallback — /timetable renders from this when the Firestore doc
 *      (examTimetables/g7-2026) is missing or unreadable, so the page never
 *      breaks on a cold install or before the seed script has run.
 *   2. Seed source — scripts/seed-exam-timetables.mjs writes exactly this
 *      shape into Firestore (plus a serverTimestamp updatedAt).
 *   3. Test fixture — scripts/test-exam-timetable.mjs validates this data and
 *      exercises the status/phase logic against it.
 *
 * Shape rules (any future year's doc must follow these):
 *   - Every datetime is an ISO string with an explicit +02:00 offset
 *     (Africa/Lusaka, no DST). Date.parse() then yields the correct absolute
 *     instant on a device in ANY timezone; wall-clock display slices the
 *     string directly (see formatSessionTime in utils/examTimetableLogic.js).
 *   - `subjectId` is a curriculum id from SUBJECT_MAP (src/config/curriculum.js)
 *     and drives the Practice Quiz deep link + subject colour coding.
 *   - `paperSubjectId` is an id valid in PAPER_SUBJECTS and drives the
 *     past-papers deep link. Either id may be null → that quick action is
 *     simply not rendered (e.g. the special papers have no curriculum
 *     subject, so they offer a past paper but no practice quiz).
 *   - Sessions where candidates sit ONE of several papers (Friday) carry
 *     `alternatives: true` + a `sessionNote`; the briefing day carries
 *     `briefing: true` with an empty `papers` array.
 *   - `startsAt` matches GRADE7_EXAM_START in GradeHub.jsx (the dashboard
 *     card's hardcoded countdown target) so both countdowns agree.
 */

export const PSLE_2026 = {
  id: 'g7-2026',
  grade: 7,
  year: 2026,
  examName: 'Primary School Leaving Examination',
  shortName: '2026 PSLE',
  board: 'ECZ',
  pdfUrl: '/timetables/grade-7-2026-exam-timetable.pdf',
  active: true,
  startsAt: '2026-10-26T08:00:00+02:00',
  endsAt: '2026-10-30T11:30:00+02:00',
  days: [
    {
      date: '2026-10-26',
      sessions: [
        {
          key: 'briefing',
          start: '2026-10-26T08:00:00+02:00',
          end: '2026-10-26T09:00:00+02:00',
          briefing: true,
          title: 'Guidelines to candidates and invigilators',
          papers: [],
        },
      ],
    },
    {
      date: '2026-10-27',
      sessions: [
        {
          key: 'eng-p1',
          start: '2026-10-27T08:00:00+02:00',
          end: '2026-10-27T09:30:00+02:00',
          papers: [
            {
              name: 'English Language',
              code: '1/1',
              durationMinutes: 90,
              subjectId: 'english',
              paperSubjectId: 'english',
            },
          ],
        },
        {
          key: 'sci-p1',
          start: '2026-10-27T10:30:00+02:00',
          end: '2026-10-27T11:30:00+02:00',
          papers: [
            {
              name: 'Integrated Science',
              code: '4/1',
              durationMinutes: 60,
              subjectId: 'science',
              paperSubjectId: 'science',
            },
          ],
        },
      ],
    },
    {
      date: '2026-10-28',
      sessions: [
        {
          key: 'math-p1',
          start: '2026-10-28T08:00:00+02:00',
          end: '2026-10-28T09:30:00+02:00',
          papers: [
            {
              name: 'Mathematics',
              code: '3/1',
              durationMinutes: 90,
              subjectId: 'mathematics',
              paperSubjectId: 'mathematics',
            },
          ],
        },
        {
          key: 'sp1',
          start: '2026-10-28T10:30:00+02:00',
          end: '2026-10-28T11:30:00+02:00',
          papers: [
            {
              name: 'Special Paper 1',
              code: '6/1',
              durationMinutes: 60,
              subjectId: null,
              paperSubjectId: 'special-paper-1',
            },
          ],
        },
      ],
    },
    {
      date: '2026-10-29',
      sessions: [
        {
          key: 'ss-p1',
          start: '2026-10-29T08:00:00+02:00',
          end: '2026-10-29T09:15:00+02:00',
          papers: [
            {
              name: 'Social Studies',
              code: '2/1',
              durationMinutes: 75,
              subjectId: 'social-studies',
              paperSubjectId: 'social-studies',
            },
          ],
        },
        {
          key: 'sp2',
          start: '2026-10-29T10:30:00+02:00',
          end: '2026-10-29T11:30:00+02:00',
          papers: [
            {
              name: 'Special Paper 2',
              code: '7/1',
              durationMinutes: 60,
              subjectId: null,
              paperSubjectId: 'special-paper-2',
            },
          ],
        },
      ],
    },
    {
      date: '2026-10-30',
      sessions: [
        {
          key: 'cts',
          start: '2026-10-30T08:00:00+02:00',
          // The three alternatives run 60–75 minutes; the session spans the
          // longest so the live "time remaining" covers every candidate.
          end: '2026-10-30T09:15:00+02:00',
          alternatives: true,
          sessionNote: 'Candidates sit ONE of these papers',
          papers: [
            {
              name: 'Technology Studies',
              code: '82/1',
              durationMinutes: 75,
              subjectId: 'technology',
              // The past-paper archive files technology papers under the
              // "Creative and Technology Studies" category, not the CBC
              // learning-area id (see SUBJECT_FILTERS in PastPapersHub).
              paperSubjectId: 'creative-technology-studies',
            },
            {
              name: 'Home Economics and Hospitality',
              code: '83/1',
              durationMinutes: 60,
              subjectId: 'home-economics',
              paperSubjectId: 'home-economics',
            },
            {
              name: 'Expressive Arts',
              code: '84/1',
              durationMinutes: 75,
              subjectId: 'expressive-arts',
              paperSubjectId: 'expressive-arts',
            },
          ],
        },
        {
          key: 'zl',
          start: '2026-10-30T10:30:00+02:00',
          end: '2026-10-30T11:30:00+02:00',
          alternatives: true,
          sessionNote: 'Candidates sit ONE language',
          papers: [
            {
              name: 'Cinyanja',
              code: '5/1',
              durationMinutes: 60,
              subjectId: 'cinyanja',
              paperSubjectId: 'cinyanja',
            },
            { name: 'Icibemba', code: '5/2', durationMinutes: 60, subjectId: null, paperSubjectId: null },
            { name: 'Silozi', code: '5/3', durationMinutes: 60, subjectId: null, paperSubjectId: null },
            { name: 'Chitonga', code: '5/4', durationMinutes: 60, subjectId: null, paperSubjectId: null },
            { name: 'Luvale', code: '5/5', durationMinutes: 60, subjectId: null, paperSubjectId: null },
            { name: 'Lunda', code: '5/6', durationMinutes: 60, subjectId: null, paperSubjectId: null },
            { name: 'Kiikaonde', code: '5/7', durationMinutes: 60, subjectId: null, paperSubjectId: null },
          ],
        },
      ],
    },
  ],
}

// Every timetable the client can fall back to when Firestore has nothing for
// the learner's grade. One entry per seeded timetable.
export const FALLBACK_TIMETABLES = [PSLE_2026]
