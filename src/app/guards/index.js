/**
 * Route guards — ProtectedRoute, LearnerOnlyRoute, AdminRoute + the MFA gate,
 * ParentRoute, StudioGate, PremiumGate.
 *
 * Empty until Phase 4. Two facts from the route register survive the move and
 * must not be "tidied" when it happens: `/admin/security/mfa-setup` sits
 * outside `AdminRoute` on purpose (an enrolment page cannot sit behind the gate
 * it enrols for), and the four preview routes are unguarded because they render
 * mock data only — giving any of them a Firestore read means adding a guard in
 * the same PR.
 */

export {}
