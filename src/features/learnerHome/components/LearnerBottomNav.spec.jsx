/**
 * Who the learner tab bar is drawn for.
 *
 * ## The bug, as a user met it
 *
 * `/papers` and `/games` are public routes that mount `LearnerLayout`, so the
 * learner shell — and this bar — is what a TEACHER sees when they open the
 * past-paper archive on their phone, where this bar is the whole navigation.
 * Home pointed at `/dashboard` for every account, and `LearnerOnlyRoute`
 * refuses `/dashboard` to a teacher. So tapping Home, the obvious control for
 * "take me back to my part of the app", answered "Teacher accounts stay in
 * the teacher portal" — rendered inside this very shell, this bar still along
 * the bottom of it. Reported from the Android build, which is where it bites:
 * on a desktop the same tabs are a sidebar beside a page with other exits.
 *
 * ## What is asserted, and why it is the rendered href
 *
 * The resolver is unit-tested in `test:learner-tabs`. What that cannot see is
 * whether the shell asks it the right question — which is where the bug
 * actually lived, since `resolveLearnerTabs` did not exist and the shell read
 * no profile at all. So these render the real shell against real auth states
 * and read the destinations back off the DOM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))

const mockAuth = { currentUser: null, userProfile: null }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

import LearnerShell from './LearnerShell'

function signedInAs(role, extra = {}) {
  mockAuth.currentUser = { uid: 'u1' }
  mockAuth.userProfile = { role, ...extra }
}

function mount(path = '/papers') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <LearnerShell><div>PAGE</div></LearnerShell>
    </MemoryRouter>,
  )
  return [...screen.getByLabelText('Learner navigation').querySelectorAll('a')]
    .map((a) => ({ label: a.textContent.trim(), to: a.getAttribute('href') }))
}

beforeEach(() => {
  mockAuth.currentUser = null
  mockAuth.userProfile = null
})

describe('the learner tab bar, by audience', () => {
  it('gives a learner the four-tab IA unchanged', () => {
    signedInAs('learner')
    expect(mount('/papers')).toEqual([
      { label: 'Home', to: '/dashboard' },
      { label: 'Papers', to: '/papers' },
      { label: 'Notes', to: '/notes' },
      { label: 'Games', to: '/games' },
    ])
  })

  it('sends a teacher Home to the teacher portal, and offers no learner-only tab', () => {
    signedInAs('teacher')
    const tabs = mount('/papers')

    // The reported bug, stated as the assertion that would have caught it.
    expect(tabs.find((t) => t.label === 'Home').to).toBe('/teacher')
    expect(tabs.map((t) => t.to)).not.toContain('/dashboard')
    expect(tabs.map((t) => t.to)).not.toContain('/notes')
    // …and Papers is still reachable, so the bar is a way out rather than a
    // wall: hiding it entirely would strand a teacher on a shell that carries
    // no header of its own.
    expect(tabs.map((t) => t.to)).toEqual(['/teacher', '/papers', '/games'])
  })

  it('sends a guardian Home to the family portal', () => {
    signedInAs('parent')
    expect(mount('/papers').find((t) => t.label === 'Home').to).toBe('/family')
  })

  it('leaves an admin previewing the learner app on /dashboard', () => {
    // An admin passes LearnerOnlyRoute on role alone, and reaches the learner
    // side deliberately (the admin nav's "Learner view"). Retargeting their
    // Home to /admin would eject them from the preview they just opened.
    signedInAs('superAdmin')
    expect(mount('/dashboard')).toEqual([
      { label: 'Home', to: '/dashboard' },
      { label: 'Papers', to: '/papers' },
      { label: 'Notes', to: '/notes' },
      { label: 'Games', to: '/games' },
    ])
  })

  it('keeps all four tabs for a signed-out visitor', () => {
    // There is no account to refuse: ProtectedRoute sends them to sign in and
    // resolvePostAuthPath returns them to the tab they tapped. Narrowing this
    // bar would break that funnel to prevent a refusal they never meet — and
    // /papers has to stay crawlable.
    expect(mount('/papers').map((t) => t.to)).toEqual(['/dashboard', '/papers', '/notes', '/games'])
  })

  it('keeps all four tabs while the profile is still loading', () => {
    // Signed in, profile not yet read. The guard waits for the profile before
    // deciding anything; the bar must not decide sooner and flick a teacher's
    // Home tab from /dashboard to /teacher a moment after they look at it.
    mockAuth.currentUser = { uid: 'u1' }
    mockAuth.userProfile = null
    expect(mount('/papers').map((t) => t.to)).toEqual(['/dashboard', '/papers', '/notes', '/games'])
  })
})
