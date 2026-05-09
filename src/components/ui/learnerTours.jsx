/**
 * Per-surface first-session tours for learners (audit A8 PR 3).
 *
 * The dashboard-level tour (A8 PR 1) covers "what is this app". The
 * three learner hubs — quizzes, lessons, games — each have their own
 * first-visit friction points: how filters work, what's locked vs
 * free, where the leaderboard lives, why the daily challenge gets a
 * special card. A contextual 2-3 step overlay on each surface
 * answers those without making the empty-handed page feel
 * intimidating.
 *
 * Each tour uses its own localStorage key so dismissing one doesn't
 * dismiss the others. Reuses <OnboardingOverlay /> (refactored in
 * A8 PR 2) — the only thing that varies is the copy.
 */

import OnboardingOverlay from './OnboardingOverlay'

const QUIZZES_STEPS = [
  {
    id: 'welcome',
    title: 'Quizzes for your grade ✏️',
    body: 'These are CBC-aligned practice questions. Use the topic chips at the top to focus on the topic you want — for example "Fractions" or "Photosynthesis".',
    icon: '🎯',
  },
  {
    id: 'attempts',
    title: 'Your daily attempts',
    body: 'Free accounts can take a few quizzes a day. Premium unlocks unlimited attempts and the full library across every grade and subject.',
    icon: '📊',
  },
  {
    id: 'ask-zed',
    title: 'Stuck? Ask Zed',
    body: 'When you finish a quiz, tap "Explain this answer" on any question you got wrong. Zed walks you through the working step-by-step in plain words.',
    icon: '🦉',
  },
]

const LESSONS_STEPS = [
  {
    id: 'welcome',
    title: 'Lessons & study notes 📖',
    body: 'Teacher-written notes for every subject in your grade. Read at your own pace before you take a quiz on the topic.',
    icon: '📚',
  },
  {
    id: 'locked',
    title: 'Locked vs free',
    body: 'A few lessons per subject are free. The rest unlock with Premium — same library, just more material to go through.',
    icon: '🔓',
  },
]

const GAMES_STEPS = [
  {
    id: 'welcome',
    title: 'Curriculum games 🎮',
    body: 'Maths, English, Science and Social Studies — short, snappy games that earn you badges and put you on the leaderboard.',
    icon: '🏆',
  },
  {
    id: 'daily',
    title: 'Daily challenge',
    body: 'A new featured game appears at the top every day. Play it to keep your streak alive and climb the global leaderboard.',
    icon: '🔥',
  },
  {
    id: 'badges',
    title: 'Earn badges',
    body: 'Each subject has its own badges. Tap "My badges" from your profile to see what you\'ve unlocked and what\'s still on the way.',
    icon: '🎖️',
  },
]

export function QuizzesHubTour() {
  return (
    <OnboardingOverlay
      steps={QUIZZES_STEPS}
      storageKey="zedexams:quizzes-onboarded"
      finishLabel="Show me the quizzes →"
    />
  )
}

export function LessonsHubTour() {
  return (
    <OnboardingOverlay
      steps={LESSONS_STEPS}
      storageKey="zedexams:lessons-onboarded"
      finishLabel="Open the library →"
    />
  )
}

export function GamesHubTour() {
  return (
    <OnboardingOverlay
      steps={GAMES_STEPS}
      storageKey="zedexams:games-onboarded"
      finishLabel="Let's play 🎮"
    />
  )
}
