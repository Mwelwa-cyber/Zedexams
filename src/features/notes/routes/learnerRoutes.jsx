// src/features/notes/routes/learnerRoutes.jsx
//
// Notes Studio learner route definitions. App.jsx wraps each element in
// <ProtectedRoute><LearnerOnlyRoute>...</LearnerOnlyRoute></ProtectedRoute>
// for auth + role gating, then <LearnerGate> handles the grade-onboarding
// case.

import { LearnerNotesList } from '../pages/LearnerNotesList'
import { LearnerNoteRead }  from '../pages/LearnerNoteRead'

export const learnerNoteRouteDefs = [
  { path: '/lessons',     element: <LearnerNotesList /> },
  { path: '/lessons/:id', element: <LearnerNoteRead /> },
]
