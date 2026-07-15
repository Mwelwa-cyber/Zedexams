// dashboardAssignmentAdoption — pure decision for how the Teacher Dashboard
// handles a delivered active-assignment change (no React/Firebase/DOM).
//
// Inputs come from useRemoteAssignmentAdoption ({ id, source }) plus the
// dashboard's currently loaded assignment ids. The plan is deliberately
// conservative for ids the dashboard cannot resolve:
//
//   cross-tab + known    → adopt-silent   (teacher's own pick in another tab —
//                                          selector updates, no notice)
//   cross-tab + unknown  → ignore         (an assignment created after this
//                                          tab loaded its list: keep the
//                                          current valid assignment, never
//                                          clear the selector, never guess,
//                                          never write anything back — the
//                                          next mount loads the latest list)
//   remote (any)         → adopt-notice   (validated against Firestore by the
//                                          sync listener before dispatch) with
//                                          reload=true when the id is not in
//                                          the mount-time list, so the
//                                          selector can resolve it
//   no id                → ignore
//
// Run tests: npm run test:active-assignment-sync

export function dashboardAdoptionPlan({ id, source, knownIds } = {}) {
  const assignmentId = typeof id === 'string' ? id.trim() : ''
  if (!assignmentId) return { action: 'ignore' }
  const known = Array.isArray(knownIds) && knownIds.includes(assignmentId)
  if (source === 'cross-tab') {
    return known ? { action: 'adopt-silent' } : { action: 'ignore' }
  }
  return { action: 'adopt-notice', reload: !known }
}
